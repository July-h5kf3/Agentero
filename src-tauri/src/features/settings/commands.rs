//! App settings commands — durable XDG config file.

use crate::core::error::{map_err, ApiResult};
use crate::features::connector::ConnectorController;
use crate::features::settings::{AppSettings, AppSettingsStore, SettingsGetResult};
use serde::Serialize;
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostIdentity {
    /// Local machine hostname (best-effort).
    pub hostname: String,
    /// Short label for Settings host chip (hostname or "This computer").
    pub label: String,
    /// Guest OS family for brand icon: `macos` | `windows` | `linux` | `other`.
    pub os: String,
}

/// Local host identity for the Settings host badge.
#[tauri::command]
pub fn host_identity() -> ApiResult<HostIdentity> {
    let hostname = local_hostname();
    let label = if hostname.is_empty() || hostname == "localhost" {
        "This computer".into()
    } else {
        hostname.clone()
    };
    ApiResult::ok(HostIdentity {
        hostname,
        label,
        os: compile_os().into(),
    })
}

fn compile_os() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "other"
    }
}

fn local_hostname() -> String {
    std::process::Command::new("hostname")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "This computer".into())
}
