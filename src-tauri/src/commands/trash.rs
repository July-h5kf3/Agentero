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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashVaultArgs {
    pub vault_path: String,
}

/// List every item currently in the recycle bin (Recycle Bin view).
#[tauri::command]
pub fn path_list_trash(args: TrashVaultArgs) -> ApiResult<Vec<trash::TrashEntry>> {
    let vault = PathBuf::from(args.vault_path.trim());
    match trash::list_trash(&vault) {
        Ok(items) => ApiResult::ok(items),
        Err(e) => map_err(e),
    }
}

/// Empty the entire recycle bin (permanent).
#[tauri::command]
pub fn path_purge_trash(args: TrashVaultArgs) -> ApiResult<()> {
    let vault = PathBuf::from(args.vault_path.trim());
    match trash::purge_all(&vault) {
        Ok(()) => ApiResult::ok(()),
        Err(e) => map_err(e),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItemArgs {
    pub vault_path: String,
    pub batch_id: String,
    /// Basename of the stored copy inside the batch (from `path_list_trash`).
    pub stored: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathRestoreItemResult {
    /// Vault-relative path the item was restored to.
    pub rel: String,
}

/// Restore a single recycle-bin item to its original path.
#[tauri::command]
pub fn path_restore_item(args: TrashItemArgs) -> ApiResult<PathRestoreItemResult> {
    let vault = PathBuf::from(args.vault_path.trim());
    match trash::restore_item(&vault, &args.batch_id, &args.stored) {
        Ok(rel) => ApiResult::ok(PathRestoreItemResult { rel }),
        Err(e) => map_err(e),
    }
}

/// Permanently delete a single recycle-bin item.
#[tauri::command]
pub fn path_purge_item(args: TrashItemArgs) -> ApiResult<()> {
    let vault = PathBuf::from(args.vault_path.trim());
    match trash::purge_item(&vault, &args.batch_id, &args.stored) {
        Ok(()) => ApiResult::ok(()),
        Err(e) => map_err(e),
    }
}
