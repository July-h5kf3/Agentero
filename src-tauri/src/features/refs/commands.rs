//! `paper_refs_parse` / `paper_refs_list` — reference sidecar commands.

use crate::core::error::{map_err, ApiResult, AppError};
use crate::core::log_util::{trunc, OpTimer};
use crate::features::settings::AppSettingsStore;
use serde::Deserialize;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperRefsParseArgs {
    pub vault_path: String,
    pub path: String,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperRefsListArgs {
    pub vault_path: String,
    pub path: String,
}

/// Parse (or refresh with `force`) the reference sidecar for one paper.
/// Online lookup follows the `citationOnlineEnabled` setting.
#[tauri::command]
pub async fn paper_refs_parse(
    app: tauri::AppHandle,
    args: PaperRefsParseArgs,
) -> Result<ApiResult<super::CiteSidecar>, String> {
    let op = OpTimer::start_with(
        "paper_refs_parse",
        format!("path={} force={}", trunc(&args.path, 120), args.force),
    );
    let vault = PathBuf::from(args.vault_path.trim());
    if !vault.is_dir() {
        let err = AppError::message("vault path is not a directory");
        op.finish_err(&err);
        return Ok(map_err(err));
    }
    let online = app
        .state::<AppSettingsStore>()
        .get()
        .map(|r| r.settings.citation_online_enabled)
        .unwrap_or(true);
    Ok(op.finish_result(super::parse_paper_refs(&vault, &args.path, online, args.force).await))
}

/// Read the existing reference sidecar; `None` when it has not been parsed yet.
#[tauri::command]
pub fn paper_refs_list(args: PaperRefsListArgs) -> ApiResult<Option<super::CiteSidecar>> {
    let op = OpTimer::start_with(
        "paper_refs_list",
        format!("path={}", trunc(&args.path, 120)),
    );
    let vault = PathBuf::from(args.vault_path.trim());
    if !vault.is_dir() {
        let err = AppError::message("vault path is not a directory");
        op.finish_err(&err);
        return map_err(err);
    }
    let rel = match crate::core::fs::sanitize_vault_rel(&args.path) {
        Ok(rel) => rel,
        Err(_) => {
            let err = AppError::message("invalid paper path");
            op.finish_err(&err);
            return map_err(err);
        }
    };
    let sidecar_path = vault.join(rel).join("source").join(super::SIDECAR_FILE);
    op.finish_result(Ok(super::read_sidecar(&sidecar_path)))
}
