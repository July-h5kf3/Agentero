//! App settings commands — durable XDG config file.

use crate::core::error::{map_err, ApiResult};
use crate::features::connector::ConnectorController;
use crate::features::settings::{AppSettings, AppSettingsStore, SettingsGetResult};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn settings_get(store: State<'_, AppSettingsStore>) -> ApiResult<SettingsGetResult> {
    match store.get() {
        Ok(r) => ApiResult::ok(r),
        Err(e) => map_err(e),
    }
}

#[tauri::command]
pub fn settings_set(
    app: AppHandle,
    store: State<'_, AppSettingsStore>,
    connector: State<'_, Arc<ConnectorController>>,
    settings: AppSettings,
) -> ApiResult<AppSettings> {
    match store.set(settings) {
        Ok(s) => {
            let _ = connector.set_port(s.connector_port);
            // Keep every window's settings cache fresh (settings window, main windows).
            let _ = app.emit("settings:changed", &s);
            ApiResult::ok(s)
        }
        Err(e) => map_err(e),
    }
}
