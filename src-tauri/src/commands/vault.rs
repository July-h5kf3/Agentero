use crate::error::{map_err, ApiResult, AppError};
use crate::services::vault::{self, CreateVaultResult};
use std::path::PathBuf;

/// Create / scaffold a Motif vault at the given absolute path.
#[tauri::command]
pub fn vault_create(path: String) -> ApiResult<CreateVaultResult> {
    let p = PathBuf::from(path.trim());
    if p.as_os_str().is_empty() {
        return map_err(AppError::message("path is required"));
    }
    match vault::create_vault(&p) {
        Ok(r) => ApiResult::ok(r),
        Err(e) => map_err(e),
    }
}
