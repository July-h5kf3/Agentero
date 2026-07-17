//! Commands to start/stop the per-window Vault filesystem watcher.

use tauri::{Manager, State};

use crate::services::watcher::FsWatchController;

/// Start (or restart) watching `vault_path` for this window. Emits
/// `vault:file-changed` to this window when files change on disk.
#[tauri::command]
pub fn fs_watch_start(
    window: tauri::WebviewWindow,
    controller: State<'_, FsWatchController>,
    vault_path: String,
) -> Result<(), String> {
    let vault = vault_path.trim().to_string();
    if vault.is_empty() {
        return Err("vault path is required".to_string());
    }
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    controller.start(app, label, vault)
}

/// Stop watching for this window (no-op if not watching).
#[tauri::command]
pub fn fs_watch_stop(
    window: tauri::WebviewWindow,
    controller: State<'_, FsWatchController>,
) -> Result<(), String> {
    controller.stop(window.label());
    Ok(())
}
