//! App settings commands — durable XDG config file.

use crate::core::error::{map_err, ApiResult};
#[cfg(not(target_os = "ios"))]
use crate::features::connector::ConnectorController;
use crate::features::settings::{AppSettings, AppSettingsStore, SettingsGetResult};
#[cfg(not(target_os = "ios"))]
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
#[cfg(not(target_os = "ios"))]
pub fn settings_set(
    app: AppHandle,
    store: State<'_, AppSettingsStore>,
    agents: State<'_, crate::features::agent::AgentRegistry>,
    connector: State<'_, Arc<ConnectorController>>,
    settings: AppSettings,
) -> ApiResult<AppSettings> {
    if let Err(e) = crate::features::network::configure_proxy(
        settings.network_proxy_enabled,
        &settings.network_proxy_url,
    ) {
        return map_err(e);
    }
    match store.set(settings) {
        Ok(s) => {
            let _ = agents.set_proxy(s.network_proxy_enabled, s.network_proxy_url.clone());
            let _ = connector.set_port(s.connector_port);
            // Keep every window's settings cache fresh (settings window, main windows).
            let _ = app.emit("settings:changed", &s);
            ApiResult::ok(s)
        }
        Err(e) => map_err(e),
    }
}

/// iOS has no local Connector process. Settings remain durable and are still
/// broadcast to the WebView, but no desktop-only port update is attempted.
#[tauri::command]
#[cfg(target_os = "ios")]
pub fn settings_set(
    app: AppHandle,
    store: State<'_, AppSettingsStore>,
    agents: State<'_, crate::features::agent::AgentRegistry>,
    settings: AppSettings,
) -> ApiResult<AppSettings> {
    if let Err(e) = crate::features::network::configure_proxy(
        settings.network_proxy_enabled,
        &settings.network_proxy_url,
    ) {
        return map_err(e);
    }
    match store.set(settings) {
        Ok(s) => {
            let _ = agents.set_proxy(s.network_proxy_enabled, s.network_proxy_url.clone());
            let _ = app.emit("settings:changed", &s);
            ApiResult::ok(s)
        }
        Err(e) => map_err(e),
    }
}
