//! Minimal axum HTTP server compatible with Zotero Connector endpoints.

use super::import::import_connector_item;
use super::state::{ConnectorController, ConnectorItemSaved, ProgressAttachment, ProgressItem};
use crate::error::AppError;
use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

#[derive(Clone)]
struct AppState {
    ctrl: Arc<ConnectorController>,
}

pub async fn serve(
    listener: TcpListener,
    shutdown_rx: oneshot::Receiver<()>,
    ctrl: Arc<ConnectorController>,
) -> Result<(), AppError> {
    let state = AppState { ctrl };
    let app = Router::new()
        .route("/connector/ping", get(ping_get).post(ping_post))
        .route("/connector/saveItems", post(save_items))
        .route("/connector/sessionProgress", post(session_progress))
        .route(
            "/connector/getSelectedCollection",
            post(get_selected_collection),
        )
        .route("/connector/updateSession", post(update_session))
        .route("/connector/delaySync", post(delay_sync))
        .fallback(fallback)
        .with_state(state);

    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = shutdown_rx.await;
        })
        .await
        .map_err(|e| AppError::message(format!("connector server: {e}")))
}

async fn fallback() -> Response {
    text_response(StatusCode::NOT_FOUND, "text/plain", "No endpoint found\n")
}

fn text_response(status: StatusCode, content_type: &str, body: &str) -> Response {
    let mut res = Response::new(Body::from(body.to_string()));
    *res.status_mut() = status;
    if let Ok(v) = HeaderValue::from_str(content_type) {
        res.headers_mut().insert(header::CONTENT_TYPE, v);
    }
    add_zotero_headers(res.headers_mut());
    res
}

fn json_response(status: StatusCode, value: Value) -> Response {
    let body = value.to_string();
    let mut res = Response::new(Body::from(body));
    *res.status_mut() = status;
    res.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    add_zotero_headers(res.headers_mut());
    res
}

fn add_zotero_headers(headers: &mut HeaderMap) {
    for (k, v) in ConnectorController::response_headers() {
        if let (Ok(name), Ok(val)) = (header::HeaderName::try_from(k), HeaderValue::from_str(v)) {
            headers.insert(name, val);
        }
    }
}

/// Host must be localhost / 127.0.0.1 (DNS rebinding protection).
/// Returns `Some(response)` when the request must be rejected.
fn check_host(headers: &HeaderMap) -> Option<Response> {
    let host = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let host_only = host.split(':').next().unwrap_or(host);
    if host_only.eq_ignore_ascii_case("localhost") || host_only == "127.0.0.1" {
        None
    } else {
        Some(text_response(
            StatusCode::BAD_REQUEST,
            "text/plain",
            "Invalid Host header\n",
        ))
    }
}

/// Reject browser simple-requests without connector API version header.
fn check_browser_guard(headers: &HeaderMap, method: &Method) -> Option<Response> {
    if method == Method::GET || method == Method::HEAD || method == Method::OPTIONS {
        return None;
    }
    let has_api = headers.get("x-zotero-connector-api-version").is_some()
        || headers.get("zotero-allowed-request").is_some();
    if has_api {
        return None;
    }

    let ua = headers
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let is_browser = ua.starts_with("Mozilla/") || headers.contains_key(header::ORIGIN);
    if !is_browser {
        return None;
    }

    let ct = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    // application/json triggers CORS preflight; simple content types are blocked.
    let simple = matches!(
        ct.as_str(),
        "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain" | ""
    );
    if simple {
        return Some(text_response(
            StatusCode::FORBIDDEN,
            "text/plain",
            "Request not allowed\n",
        ));
    }
    None
}

fn guard(headers: &HeaderMap, method: &Method) -> Option<Response> {
    check_host(headers).or_else(|| check_browser_guard(headers, method))
}

async fn ping_get(headers: HeaderMap) -> Response {
    if let Some(r) = check_host(&headers) {
        return r;
    }
    text_response(
        StatusCode::OK,
        "text/html",
        "<!DOCTYPE html><html><head>\
         <title>Zotero Connector Server is Available</title></head>\
         <body>Zotero Connector Server is Available</body></html>",
    )
}

async fn ping_post(headers: HeaderMap) -> Response {
    if let Some(r) = check_host(&headers) {
        return r;
    }
    json_response(
        StatusCode::OK,
        json!({
            "prefs": {
                "automaticSnapshots": false,
                "downloadAssociatedFiles": true,
                "supportsAttachmentUpload": false,
                "supportsTagsAutocomplete": false,
                "canUserAddNote": false,
                "reportActiveURL": false
            }
        }),
    )
}

#[derive(Debug, Deserialize)]
struct SaveItemsBody {
    /// Official Connector uses `sessionID` (capital ID).
    #[serde(default, alias = "sessionId", rename = "sessionID")]
    session_id: Option<String>,
    #[serde(default)]
    items: Vec<Value>,
    #[serde(default)]
    uri: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

async fn save_items(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SaveItemsBody>,
) -> Response {
    if let Some(r) = guard(&headers, &Method::POST) {
        return r;
    }

    let session_id = body
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("sess-{}", uuid::Uuid::new_v4()));

    let page_uri = body
        .uri
        .as_deref()
        .or(body.url.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    if body.items.is_empty() {
        return json_response(StatusCode::BAD_REQUEST, json!({ "error": "NO_ITEMS" }));
    }

    let (vault, parent_dir) = match state.ctrl.vault_and_parent() {
        Ok(v) => v,
        Err(e) => {
            state.ctrl.emit_error(&e.to_string(), Some(&session_id));
            return json_response(
                StatusCode::SERVICE_UNAVAILABLE,
                json!({ "error": e.to_string() }),
            );
        }
    };

    // Pre-register session skeleton so SESSION_EXISTS works for concurrent saves.
    let mut progress_items: Vec<ProgressItem> = Vec::new();
    for (idx, item) in body.items.iter().enumerate() {
        let id = item
            .get("id")
            .cloned()
            .unwrap_or_else(|| Value::from(idx as i64 + 1));
        let title = item
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled")
            .to_string();
        let item_type = item
            .get("itemType")
            .and_then(|v| v.as_str())
            .unwrap_or("journalArticle")
            .to_string();
        let mut attachments = Vec::new();
        if let Some(atts) = item.get("attachments").and_then(|v| v.as_array()) {
            for (ai, a) in atts.iter().enumerate() {
                attachments.push(ProgressAttachment {
                    id: format!("{ai}"),
                    title: a
                        .get("title")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Attachment")
                        .to_string(),
                    content_type: a
                        .get("mimeType")
                        .or_else(|| a.get("contentType"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("application/pdf")
                        .to_string(),
                    progress: 0,
                });
            }
        }
        progress_items.push(ProgressItem {
            id,
            title,
            item_type,
            attachments,
        });
    }

    if let Err(e) = state
        .ctrl
        .create_session(&session_id, progress_items.clone())
    {
        if e.to_string().contains("SESSION_EXISTS") {
            return json_response(StatusCode::CONFLICT, json!({ "error": "SESSION_EXISTS" }));
        }
        return json_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": e.to_string() }),
        );
    }

    let mut out_items: Vec<Value> = Vec::new();
    for item in &body.items {
        match import_connector_item(&vault, &parent_dir, item, page_uri).await {
            Ok(r) => {
                state.ctrl.emit_item_saved(ConnectorItemSaved {
                    path: r.path.clone(),
                    id: r.id.clone(),
                    title: r.title.clone(),
                    deduped: r.deduped,
                    session_id: session_id.clone(),
                });
                let mut atts = Vec::new();
                if let Some(arr) = item.get("attachments").and_then(|v| v.as_array()) {
                    for (ai, a) in arr.iter().enumerate() {
                        atts.push(json!({
                            "id": format!("{session_id}_{ai}"),
                            "title": a.get("title").and_then(|v| v.as_str()).unwrap_or("Attachment"),
                            "contentType": a.get("mimeType").and_then(|v| v.as_str()).unwrap_or("application/pdf"),
                            "mimeType": a.get("mimeType").and_then(|v| v.as_str()).unwrap_or("application/pdf"),
                        }));
                    }
                }
                out_items.push(json!({
                    "id": r.connector_item_id,
                    "title": r.title,
                    "itemType": r.item_type,
                    "attachments": atts,
                }));
            }
            Err(e) => {
                state.ctrl.emit_error(&e.to_string(), Some(&session_id));
                state.ctrl.mark_session_done(&session_id);
                return json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    json!({ "error": e.to_string() }),
                );
            }
        }
    }

    state.ctrl.mark_session_done(&session_id);

    json_response(
        StatusCode::CREATED,
        json!({
            "items": out_items,
            "singleFile": false
        }),
    )
}

#[derive(Debug, Deserialize)]
struct SessionIdBody {
    #[serde(default, alias = "sessionId", rename = "sessionID")]
    session_id: Option<String>,
}

async fn session_progress(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<SessionIdBody>,
) -> Response {
    if let Some(r) = guard(&headers, &Method::POST) {
        return r;
    }
    let Some(sid) = body
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    else {
        return json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "SESSION_ID_NOT_PROVIDED" }),
        );
    };
    match state.ctrl.session_progress_json(sid) {
        Ok(v) => json_response(StatusCode::OK, v),
        Err(_) => json_response(
            StatusCode::BAD_REQUEST,
            json!({ "error": "SESSION_NOT_FOUND" }),
        ),
    }
}

async fn get_selected_collection(headers: HeaderMap) -> Response {
    if let Some(r) = guard(&headers, &Method::POST) {
        return r;
    }
    json_response(
        StatusCode::OK,
        json!({
            "libraryID": 1,
            "libraryName": "Agentero Vault",
            "libraryEditable": true,
            "editable": true,
            "id": null,
            "name": "Agentero Vault",
            "targets": [{
                "id": "L1",
                "name": "Agentero Vault",
                "level": 0
            }]
        }),
    )
}

async fn update_session(headers: HeaderMap) -> Response {
    if let Some(r) = guard(&headers, &Method::POST) {
        return r;
    }
    // MVP: accept and ignore target/tags changes.
    json_response(StatusCode::OK, json!({}))
}

async fn delay_sync(headers: HeaderMap) -> Response {
    if let Some(r) = check_host(&headers) {
        return r;
    }
    let mut res = Response::new(Body::empty());
    *res.status_mut() = StatusCode::NO_CONTENT;
    add_zotero_headers(res.headers_mut());
    res
}
