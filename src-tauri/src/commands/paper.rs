//! Paper metadata commands — catalog.sqlite is authoritative.

use crate::error::{map_err, ApiResult, AppError};
use crate::models::wiki::WikiRenameResult;
use crate::services::catalog::papers::{self, PaperRecord};
use crate::services::wiki::rename::run_local_rename_transaction;
use crate::services::wiki::WikiIndexState;
use serde::Deserialize;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperGetArgs {
    pub vault_path: String,
    /// Vault-relative paper folder path, e.g. `papers/1706.03762`.
    #[serde(default)]
    pub path: Option<String>,
    /// Logical id (arxiv id / citekey) if path unknown.
    #[serde(default)]
    pub id: Option<String>,
}

/// Get one paper's metadata from catalog.sqlite.
#[tauri::command]
pub fn paper_get(args: PaperGetArgs) -> ApiResult<PaperRecord> {
    let vault = PathBuf::from(args.vault_path.trim());
    if !vault.is_dir() {
        return map_err(AppError::message("vault path is not a directory"));
    }

    let result = if let Some(path) = args
        .path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let path = path.trim_matches('/').replace('\\', "/");
        papers::get_by_path(&vault, &path)
    } else if let Some(id) = args.id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        papers::get_by_id(&vault, id)
    } else {
        return map_err(AppError::message("path or id is required"));
    };

    match result {
        Ok(Some(row)) => ApiResult::ok(row),
        Ok(None) => map_err(AppError::message("paper not found in catalog")),
        Err(e) => map_err(e),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperListArgs {
    pub vault_path: String,
}

/// List all papers for the library table (catalog.sqlite).
#[tauri::command]
pub fn paper_list(args: PaperListArgs) -> ApiResult<Vec<PaperRecord>> {
    let vault = PathBuf::from(args.vault_path.trim());
    if !vault.is_dir() {
        return map_err(AppError::message("vault path is not a directory"));
    }
    match papers::list_all(&vault) {
        Ok(rows) => ApiResult::ok(rows),
        Err(e) => map_err(e),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperDeleteArgs {
    pub vault_path: String,
    /// Vault-relative path of a paper folder, or an org folder under `papers/`.
    /// Deletes that row and any papers nested under `path/`.
    pub path: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperDeleteResult {
    /// Number of catalog rows removed.
    pub removed: usize,
}

/// Remove paper row(s) from catalog.sqlite (does not delete files).
#[tauri::command]
pub fn paper_delete(args: PaperDeleteArgs) -> ApiResult<PaperDeleteResult> {
    let vault = PathBuf::from(args.vault_path.trim());
    if !vault.is_dir() {
        return map_err(AppError::message("vault path is not a directory"));
    }
    let path = args.path.trim().trim_matches('/').replace('\\', "/");
    if path.is_empty() {
        return map_err(AppError::message("path is required"));
    }
    match papers::delete_under_path(&vault, &path) {
        Ok(removed) => ApiResult::ok(PaperDeleteResult { removed }),
        Err(e) => map_err(e),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperSetIsReadArgs {
    pub vault_path: String,
    /// Vault-relative paper folder path.
    pub path: String,
    pub is_read: bool,
}

/// Update catalog `is_read` after paper-reader workflow completes (or reset).
#[tauri::command]
pub fn paper_set_is_read(args: PaperSetIsReadArgs) -> ApiResult<PaperRecord> {
    let vault = PathBuf::from(args.vault_path.trim());
    if !vault.is_dir() {
        return map_err(AppError::message("vault path is not a directory"));
    }
    let path = args.path.trim().trim_matches('/').replace('\\', "/");
    if path.is_empty() {
        return map_err(AppError::message("path is required"));
    }
    match papers::set_is_read(&vault, &path, args.is_read) {
        Ok(row) => ApiResult::ok(row),
        Err(e) => map_err(e),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperMoveArgs {
    pub vault_path: String,
    /// Vault-relative item to move (paper folder, org folder, or file under `papers/`).
    pub from_rel: String,
    /// Vault-relative destination parent (`papers` or under `papers/`).
    pub dest_parent_rel: String,
    /// Dirty open Markdown/NOTES paths supplied by the renderer. The Host
    /// rejects a transaction that would move or rewrite one of these files.
    #[serde(default)]
    pub dirty_paths: Vec<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperMoveResult {
    /// New vault-relative path of the moved item.
    pub new_rel: String,
    /// Link-aware transaction details for UI refresh and diagnostics.
    pub link_update: WikiRenameResult,
}

/// Move an item into another `papers/` folder on disk and rewrite matching
/// catalog path prefixes. Never overwrites an existing target.
#[tauri::command]
pub fn paper_move(
    args: PaperMoveArgs,
    index: State<'_, WikiIndexState>,
) -> ApiResult<PaperMoveResult> {
    let mut guard = match index.inner.lock() {
        Ok(guard) => guard,
        Err(error) => return map_err(AppError::message(format!("wiki index lock: {error}"))),
    };
    match move_inner(args, &mut guard) {
        Ok(r) => ApiResult::ok(r),
        Err(e) => map_err(e),
    }
}

fn move_inner(
    args: PaperMoveArgs,
    index: &mut crate::services::wiki::index::WikiIndex,
) -> Result<PaperMoveResult, AppError> {
    let vault = PathBuf::from(args.vault_path.trim());
    if !vault.is_dir() {
        return Err(AppError::message("vault path is not a directory"));
    }
    let from = args.from_rel.trim().trim_matches('/').replace('\\', "/");
    let dest_raw = args
        .dest_parent_rel
        .trim()
        .trim_matches('/')
        .replace('\\', "/");
    let dest_parent = if dest_raw.is_empty() {
        "papers".to_string()
    } else {
        dest_raw
    };
    if from.is_empty() || from == "papers" {
        return Err(AppError::message("cannot move this path"));
    }
    if dest_parent != "papers" && !dest_parent.starts_with("papers/") {
        return Err(AppError::message("destination must be under papers/"));
    }
    if from.contains("..") || dest_parent.contains("..") {
        return Err(AppError::message("invalid path"));
    }
    // Reject moving a folder into itself or its own descendant.
    if dest_parent == from || dest_parent.starts_with(&format!("{from}/")) {
        return Err(AppError::message("cannot move a folder into itself"));
    }
    let base = from.rsplit('/').next().unwrap_or(from.as_str()).to_string();
    let new_rel = format!("{dest_parent}/{base}");
    if new_rel == from {
        return Err(AppError::message("already in this folder"));
    }
    let link_update =
        run_local_rename_transaction(&vault, index, &from, &new_rel, &args.dirty_paths, || {
            papers::move_under_path(&vault, &from, &new_rel)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
        .map_err(|error| AppError::message(error.to_string()))?;
    Ok(PaperMoveResult {
        new_rel,
        link_update,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperSetTagsArgs {
    pub vault_path: String,
    /// Vault-relative paper folder path.
    pub path: String,
    /// Full replacement list (not a patch merge).
    /// Each item may be a bare string or `{ name, color? }` (Apple-style color id).
    pub tags: Vec<papers::PaperTag>,
}

/// Replace catalog tags for a paper (syncs metadata.json projection).
#[tauri::command]
pub fn paper_set_tags(args: PaperSetTagsArgs) -> ApiResult<PaperRecord> {
    let vault = PathBuf::from(args.vault_path.trim());
    if !vault.is_dir() {
        return map_err(AppError::message("vault path is not a directory"));
    }
    let path = args.path.trim().trim_matches('/').replace('\\', "/");
    if path.is_empty() {
        return map_err(AppError::message("path is required"));
    }
    match papers::set_tags(&vault, &path, &args.tags) {
        Ok(row) => ApiResult::ok(row),
        Err(e) => map_err(e),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperRescanArgs {
    pub vault_path: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperRescanResult {
    /// Number of paper folders re-imported into the catalog.
    pub count: usize,
}

/// Rebuild catalog rows from `papers/` metadata.json — recovers papers that are
/// on disk but missing from the catalog (added externally, or a lost row).
#[tauri::command]
pub fn paper_rescan(args: PaperRescanArgs) -> ApiResult<PaperRescanResult> {
    use crate::log_util::OpTimer;

    let vault = PathBuf::from(args.vault_path.trim());
    let op = OpTimer::start("paper_rescan");
    if !vault.is_dir() {
        let err = AppError::message("vault path is not a directory");
        op.finish_err(&err);
        return map_err(err);
    }
    match papers::rebuild_from_disk(&vault) {
        Ok(count) => {
            op.finish_ok_extra(format!("count={count}"));
            ApiResult::ok(PaperRescanResult { count })
        }
        Err(e) => {
            op.finish_err(&e);
            map_err(e)
        }
    }
}
