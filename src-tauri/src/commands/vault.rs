use crate::error::{map_err, ApiResult, AppError};
use crate::log_util::{trunc, OpTimer};
use crate::services::vault::{self, CreateVaultResult};
use std::path::PathBuf;

fn vault_path_arg(path: &str) -> Result<std::path::PathBuf, AppError> {
    let p = PathBuf::from(path.trim());
    if p.as_os_str().is_empty() {
        return Err(AppError::message("path is required"));
    }
    Ok(p)
}

/// Create / scaffold a Agentero vault at the given absolute path.
#[tauri::command]
pub fn vault_create(path: String) -> ApiResult<CreateVaultResult> {
    let op = OpTimer::start_with("vault_create", format!("path={}", trunc(&path, 200)));
    match vault_path_arg(&path) {
        Ok(p) => op.finish_result(vault::create_vault(&p)),
        Err(err) => {
            op.finish_err(&err);
            map_err(err)
        }
    }
}

/// Ensure vault scaffold + seed any **missing** bundled skills (no overwrite).
///
/// Call on vault open so app updates can ship new `.agents/skills/*` without
/// requiring the user to re-run Create Vault.
#[tauri::command]
pub fn vault_ensure(path: String) -> ApiResult<CreateVaultResult> {
    let op = OpTimer::start_with("vault_ensure", format!("path={}", trunc(&path, 200)));
    match vault_path_arg(&path) {
        Ok(p) => op.finish_result(vault::ensure_vault(&p)),
        Err(err) => {
            op.finish_err(&err);
            map_err(err)
        }
    }
}
