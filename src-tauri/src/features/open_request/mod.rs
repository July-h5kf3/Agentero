//! Deep-link / second-instance vault open requests.
//!
//! CLI emits `agentero://open?path=…`; the Host validates the directory, extends
//! fs scope, caches a pending path for startup races, and emits
//! `vault:open-request` for the renderer.

use crate::core::error::ApiResult;
use crate::core::error::AppError;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_fs::FsExt;
use url::Url;

pub const EVENT_VAULT_OPEN_REQUEST: &str = "vault:open-request";

/// Last validated open path waiting for the frontend to consume.
#[derive(Default)]
pub struct PendingVaultOpen {
    path: Mutex<Option<String>>,
}

impl PendingVaultOpen {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set(&self, path: String) {
        if let Ok(mut guard) = self.path.lock() {
            *guard = Some(path);
        }
    }

    pub fn take(&self) -> Option<String> {
        self.path.lock().ok().and_then(|mut g| g.take())
    }

    pub fn peek(&self) -> Option<String> {
        self.path.lock().ok().and_then(|g| g.clone())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultOpenPayload {
    pub path: String,
}

/// Parse `agentero://open?path=` (or `agentero:open?path=` variants).
pub fn parse_open_url(raw: &str) -> Result<PathBuf, AppError> {
    let url = Url::parse(raw).map_err(|e| AppError::message(format!("invalid open URL: {e}")))?;
    let scheme = url.scheme();
    if scheme != "agentero" {
        return Err(AppError::message(format!(
            "unsupported URL scheme: {scheme}"
        )));
    }
    // `agentero://open?path=` → host "open"
    let host = url.host_str().unwrap_or("");
    let path_seg = url.path().trim_matches('/');
    let is_open = host.eq_ignore_ascii_case("open") || path_seg.eq_ignore_ascii_case("open");
    if !is_open {
        return Err(AppError::message(format!(
            "unsupported agentero URL action: {}",
            if host.is_empty() { path_seg } else { host }
        )));
    }
    let path = url
        .query_pairs()
        .find(|(k, _)| k == "path")
        .map(|(_, v)| v.into_owned())
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| AppError::message("open URL missing path query"))?;
    Ok(PathBuf::from(path))
}

/// Validate local directory, allow fs scope, store pending, emit + focus window.
pub fn handle_open_path<R: Runtime>(app: &AppHandle<R>, path: &Path) -> Result<String, AppError> {
    let trimmed = path.to_string_lossy();
    if trimmed.trim().is_empty() {
        return Err(AppError::message("path is required"));
    }
    if !path.exists() {
        return Err(AppError::message(format!(
            "path does not exist: {}",
            path.display()
        )));
    }
    if !path.is_dir() {
        return Err(AppError::message(format!(
            "path is not a directory: {}",
            path.display()
        )));
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| AppError::message(format!("failed to resolve path: {e}")))?;
    let path_str = canonical.to_string_lossy().to_string();

    if let Err(e) = app.fs_scope().allow_directory(&canonical, true) {
        log::warn!(
            target: "agentero::op",
            "vault open allow_directory failed path={} error={e}",
            trunc(&path_str)
        );
    }

    if let Some(state) = app.try_state::<PendingVaultOpen>() {
        state.set(path_str.clone());
    }

    let payload = VaultOpenPayload {
        path: path_str.clone(),
    };
    let _ = app.emit(EVENT_VAULT_OPEN_REQUEST, &payload);

    focus_main_window(app);
    log::info!(
        target: "agentero::op",
        "op end vault_open_request ok=true path={}",
        trunc(&path_str)
    );
    Ok(path_str)
}

/// Handle one or more deep-link URLs; non-open URLs are ignored with a warning.
pub fn handle_deep_link_urls<R: Runtime>(app: &AppHandle<R>, urls: &[String]) {
    for raw in urls {
        if raw.contains("://pair") || raw.contains(":pair") {
            // Mobile pairing — leave to the mobile UI / other handlers.
            continue;
        }
        match parse_open_url(raw) {
            Ok(path) => {
                if let Err(e) = handle_open_path(app, &path) {
                    log::warn!(
                        target: "agentero::op",
                        "op end vault_open_request ok=false url={} error={e}",
                        trunc(raw)
                    );
                    let _ = app.emit(
                        "vault:open-error",
                        serde_json::json!({ "message": e.to_string() }),
                    );
                }
            }
            Err(e) => {
                log::debug!(
                    target: "agentero::op",
                    "skip deep link url={} error={e}",
                    trunc(raw)
                );
            }
        }
    }
}

/// Scan CLI argv for `agentero://` URLs (second instance / Windows / Linux).
pub fn handle_argv_urls<R: Runtime>(app: &AppHandle<R>, argv: &[String]) {
    let urls: Vec<String> = argv
        .iter()
        .filter(|a| a.starts_with("agentero://") || a.starts_with("agentero:"))
        .cloned()
        .collect();
    if !urls.is_empty() {
        handle_deep_link_urls(app, &urls);
    }
}

fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn trunc(s: &str) -> String {
    const MAX: usize = 200;
    if s.len() <= MAX {
        s.to_string()
    } else {
        format!("{}…", &s[..MAX])
    }
}

/// Take the pending open path (startup race: frontend ready after Host queued).
#[tauri::command]
pub fn vault_open_take_pending(
    state: tauri::State<'_, PendingVaultOpen>,
) -> ApiResult<Option<String>> {
    ApiResult::ok(state.take())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_open_query() {
        let p = parse_open_url("agentero://open?path=%2Ftmp%2Fresearch").unwrap();
        assert_eq!(p, PathBuf::from("/tmp/research"));
    }

    #[test]
    fn rejects_missing_path() {
        assert!(parse_open_url("agentero://open").is_err());
    }

    #[test]
    fn rejects_other_scheme() {
        assert!(parse_open_url("https://example.com/open?path=/tmp").is_err());
    }
}
