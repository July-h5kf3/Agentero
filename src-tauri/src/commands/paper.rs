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
