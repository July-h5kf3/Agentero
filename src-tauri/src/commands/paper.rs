//! Paper metadata commands — catalog.sqlite is authoritative.

use crate::error::{map_err, ApiResult, AppError};
use crate::services::catalog::papers::{self, PaperRecord};
use serde::Deserialize;
use std::path::PathBuf;

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
