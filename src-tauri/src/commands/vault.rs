use crate::error::{map_err, ApiResult, AppError};
use crate::log_util::{trunc, OpTimer};
use crate::models::wiki::WikiRenameResult;
use crate::services::vault::{self, CreateVaultResult};
use crate::services::wiki::rename::run_local_rename_transaction;
use crate::services::wiki::WikiIndexState;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_fs::FsExt;

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

/// Extend the fs-plugin scope so the renderer can read/write this vault dir.
///
/// The dialog plugin grants runtime scope for a picked folder, but that grant
/// is not persisted. On startup restore a vault located outside the static
/// scope (`$HOME/**`, `$DOCUMENT/**`, …) would otherwise fail every fs-plugin
/// call with "forbidden path" until the user re-picks it. Called whenever a
/// local vault becomes active, before the file tree loads. Idempotent.
#[tauri::command]
pub fn vault_allow_fs_scope<R: Runtime>(app: AppHandle<R>, path: String) -> ApiResult<()> {
    let op = OpTimer::start_with(
        "vault_allow_fs_scope",
        format!("path={}", trunc(&path, 200)),
    );
    let p = match vault_path_arg(&path) {
        Ok(p) => p,
        Err(err) => {
            op.finish_err(&err);
            return map_err(err);
        }
    };
    match app.fs_scope().allow_directory(&p, true) {
        Ok(()) => op.finish_result(Ok(())),
        Err(e) => {
            let err = AppError::message(format!("allow fs scope failed: {e}"));
            op.finish_err(&err);
            map_err(err)
        }
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiMoveArgs {
    pub vault_path: String,
    /// Vault-relative file or directory path to rename/move.
    pub from_rel: String,
    /// Vault-relative final path, including the new basename.
    pub to_rel: String,
}

/// Move or rename one local Vault path while updating resolved internal links.
#[tauri::command]
pub fn wiki_move(
    args: WikiMoveArgs,
    index: State<'_, WikiIndexState>,
) -> ApiResult<WikiRenameResult> {
    let vault = match vault_path_arg(&args.vault_path) {
        Ok(vault) if vault.is_dir() => vault,
        Ok(_) => return map_err(AppError::message("vault path is not a directory")),
        Err(error) => return map_err(error),
    };
    let mut guard = match index.inner.lock() {
        Ok(guard) => guard,
        Err(error) => return map_err(AppError::message(format!("wiki index lock: {error}"))),
    };
    match run_local_rename_transaction(&vault, &mut guard, &args.from_rel, &args.to_rel, || Ok(()))
    {
        Ok(result) => ApiResult::ok(result),
        Err(error) => map_err(AppError::message(error.to_string())),
    }
}
