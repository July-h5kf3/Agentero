use crate::core::error::{map_err, ApiResult, AppError};

use super::{
    collect_status, install_shim, managed_shim_path, resolve_bundled_cli, uninstall_shim,
    CliInstallResult, CliInstallStatus,
};
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub fn cli_install_status<R: Runtime>(app: AppHandle<R>) -> ApiResult<CliInstallStatus> {
    ApiResult::ok(collect_status(&app))
}

#[tauri::command]
pub fn cli_install_command<R: Runtime>(app: AppHandle<R>) -> ApiResult<CliInstallResult> {
    let bundled = match resolve_bundled_cli(&app) {
        Some(p) => p,
        None => {
            return map_err(AppError::message(
                "Bundled CLI not found. In dev run `pnpm cli:bundle`, then try Install again. Release builds include the CLI.",
            ));
        }
    };
    let shim = managed_shim_path();
    if let Err(e) = install_shim(&bundled, &shim) {
        return map_err(e);
    }
    let mut status = collect_status(&app);
    if !status.preferred_bin_on_path {
        status.message = Some(format!(
            "Installed to {}. Add that directory to PATH if `agentero` is not found in new terminals.",
            status.preferred_bin_dir
        ));
    } else {
        status.message = Some("Installed. Run `agentero --version` in a new terminal.".to_string());
    }
    ApiResult::ok(CliInstallResult {
        status,
        action: "install".into(),
    })
}

#[tauri::command]
pub fn cli_uninstall_command<R: Runtime>(app: AppHandle<R>) -> ApiResult<CliInstallResult> {
    let bundled = resolve_bundled_cli(&app);
    let shim = managed_shim_path();
    match uninstall_shim(&shim, bundled.as_deref()) {
        Ok(_) => {}
        Err(e) => return map_err(e),
    }
    let mut status = collect_status(&app);
    status.message = Some("Removed the Agentero-managed CLI shim.".into());
    ApiResult::ok(CliInstallResult {
        status,
        action: "uninstall".into(),
    })
}
