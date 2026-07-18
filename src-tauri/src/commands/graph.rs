use crate::error::{map_err, ApiResult, AppError};
use crate::models::wiki::{BacklinksResponse, GraphResponse, RebuildResult};
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
