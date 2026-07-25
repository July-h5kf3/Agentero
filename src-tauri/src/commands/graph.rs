use crate::error::{map_err, ApiResult, AppError};
use crate::models::wiki::{
    BacklinksResponse, GraphResponse, InternalLinkSyntax, OutgoingLinksResponse, RebuildResult,
    WikiResolveResponse, WikiSearchCandidate, WikiSearchCandidateKind,
};
use crate::services::wiki::WikiIndexState;
use tauri::State;

#[tauri::command]
pub fn graph_get_backlinks(
    index: State<'_, WikiIndexState>,
    vault_path: String,
    path: String,
) -> ApiResult<BacklinksResponse> {
    let mut guard = match index.inner.lock() {
        Ok(g) => g,
        Err(e) => return map_err(AppError::message(format!("wiki index lock: {e}"))),
    };
    if let Err(e) = guard.ensure_vault(&vault_path) {
        return map_err(AppError::message(e));
    }
    ApiResult::ok(guard.get_backlinks(&vault_path, &path))
}

/// Return every explicit occurrence authored by `path`, including unresolved and
/// invalid-fragment diagnostics. This is intentionally separate from Graph, whose
/// file-level projection may deduplicate edges.
#[tauri::command]
pub fn wiki_get_outgoing(
    index: State<'_, WikiIndexState>,
    vault_path: String,
    path: String,
) -> ApiResult<OutgoingLinksResponse> {
    let mut guard = match index.inner.lock() {
        Ok(g) => g,
        Err(e) => return map_err(AppError::message(format!("wiki index lock: {e}"))),
    };
    if let Err(e) = guard.ensure_vault(&vault_path) {
        return map_err(AppError::message(e));
    }
    ApiResult::ok(guard.get_outgoing(&vault_path, &path))
}

#[tauri::command]
pub fn wiki_resolve(
    index: State<'_, WikiIndexState>,
    vault_path: String,
    source_path: String,
    link_text: String,
    syntax: Option<InternalLinkSyntax>,
) -> ApiResult<WikiResolveResponse> {
    let mut guard = match index.inner.lock() {
        Ok(g) => g,
        Err(e) => return map_err(AppError::message(format!("wiki index lock: {e}"))),
    };
    if let Err(e) = guard.ensure_vault(&vault_path) {
        return map_err(AppError::message(e));
    }
    ApiResult::ok(guard.resolve_text(
        &vault_path,
        &source_path,
        &link_text,
        syntax.unwrap_or(InternalLinkSyntax::Wikilink),
    ))
}

#[tauri::command]
pub fn wiki_search(
    index: State<'_, WikiIndexState>,
    vault_path: String,
    query: String,
    path: Option<String>,
    kind: Option<WikiSearchCandidateKind>,
) -> ApiResult<Vec<WikiSearchCandidate>> {
    let mut guard = match index.inner.lock() {
        Ok(g) => g,
        Err(e) => return map_err(AppError::message(format!("wiki index lock: {e}"))),
    };
    if let Err(e) = guard.ensure_vault(&vault_path) {
        return map_err(AppError::message(e));
    }
    ApiResult::ok(guard.search_scoped(&query, path.as_deref(), kind.as_ref()))
}

#[tauri::command]
pub fn graph_get_graph(
    index: State<'_, WikiIndexState>,
    vault_path: String,
    center: Option<String>,
    depth: Option<u32>,
) -> ApiResult<GraphResponse> {
    let mut guard = match index.inner.lock() {
        Ok(g) => g,
        Err(e) => return map_err(AppError::message(format!("wiki index lock: {e}"))),
    };
    if let Err(e) = guard.ensure_vault(&vault_path) {
        return map_err(AppError::message(e));
    }
    let center_ref = center.as_deref().filter(|s| !s.trim().is_empty());
    ApiResult::ok(guard.get_graph(&vault_path, center_ref, depth))
}

#[tauri::command]
pub fn graph_rebuild(
    index: State<'_, WikiIndexState>,
    vault_path: String,
) -> ApiResult<RebuildResult> {
    use crate::log_util::OpTimer;

    let op = OpTimer::start("graph_rebuild");
    let mut guard = match index.inner.lock() {
        Ok(g) => g,
        Err(e) => {
            let err = AppError::message(format!("wiki index lock: {e}"));
            op.finish_err(&err);
            return map_err(err);
        }
    };
    match guard.rebuild(&vault_path) {
        Ok(r) => {
            op.finish_ok();
            ApiResult::ok(r)
        }
        Err(e) => {
            let err = AppError::message(e);
            op.finish_err(&err);
            map_err(err)
        }
    }
}
