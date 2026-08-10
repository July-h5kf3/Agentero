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

/// Return unique system font family names (sorted). Empty on mobile / failure.
#[tauri::command]
pub fn list_system_fonts() -> ApiResult<Vec<String>> {
    #[cfg(any(target_os = "ios", target_os = "android"))]
    {
        return ApiResult::ok(Vec::new());
    }
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        use std::collections::BTreeSet;
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let mut names = BTreeSet::new();
        for face in db.faces() {
            for (family, _) in &face.families {
                let t = family.trim();
                if !t.is_empty() {
                    names.insert(t.to_string());
                }
            }
        }
        ApiResult::ok(names.into_iter().collect())
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
