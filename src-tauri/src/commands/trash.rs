//! Recycle-bin commands: undoable delete + restore.

use crate::error::{map_err, ApiResult};
use crate::services::trash;
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathTrashArgs {
    pub vault_path: String,
    /// Vault-relative paths to move into the recycle bin.
    pub rels: Vec<String>,
}

/// Move files/folders into the vault recycle bin (undoable delete).
#[tauri::command]
pub fn path_trash(args: PathTrashArgs) -> ApiResult<trash::TrashResult> {
    let vault = PathBuf::from(args.vault_path.trim());
    match trash::trash_paths(&vault, &args.rels) {
        Ok(res) => ApiResult::ok(res),
        Err(e) => map_err(e),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathUntrashArgs {
    pub vault_path: String,
    /// Batch id returned by `path_trash`.
    pub batch_id: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathUntrashResult {
    /// Number of items restored to their original location.
    pub restored: usize,
}

/// Restore a recycle-bin batch (undo a delete).
#[tauri::command]
pub fn path_untrash(args: PathUntrashArgs) -> ApiResult<PathUntrashResult> {
    let vault = PathBuf::from(args.vault_path.trim());
    match trash::restore_batch(&vault, &args.batch_id) {
        Ok(restored) => ApiResult::ok(PathUntrashResult { restored }),
        Err(e) => map_err(e),
    }
}
