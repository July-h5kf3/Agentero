use crate::error::{map_err, ApiResult, AppError};
use crate::log_util::{trunc, OpTimer};
use crate::services::vault::{self, CreateVaultResult};
use std::path::PathBuf;

/// Create / scaffold a Agentero vault at the given absolute path.
#[tauri::command]
pub fn vault_create(path: String) -> ApiResult<CreateVaultResult> {
    let p = PathBuf::from(path.trim());
    let op = OpTimer::start_with("vault_create", format!("path={}", trunc(&path, 200)));
    if p.as_os_str().is_empty() {
        let err = AppError::message("path is required");
        op.finish_err(&err);
        return map_err(err);
    }
    op.finish_result(vault::create_vault(&p))
}
