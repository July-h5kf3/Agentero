//! Tauri commands + startup wiring for diagnostics reporting.

use super::{
    collect_agents, collect_device_info, collect_host_error_entries, enabled, install_id, now_ms,
    sanitize, take_pending_crash, ErrorEntry, TelemetryEvent, APP_VERSION,
};
use crate::core::error::{map_err, ApiResult};
use crate::features::agent::AgentRegistry;
use crate::features::settings::AppSettingsStore;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySendResult {
    /// Endpoint compiled in and user opt-out off.
    pub enabled: bool,
    pub sent: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendErrorArgs {
    pub errors: Vec<FrontendError>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendError {
    pub message: String,
    #[serde(default)]
    pub stack: Option<String>,
    #[serde(default)]
    pub context: Option<String>,
}

/// Manual "send diagnostics" from Settings: full device/agent inventory plus
/// recent host ERROR lines.
#[tauri::command]
pub async fn telemetry_send_diagnostics(app: AppHandle) -> ApiResult<TelemetrySendResult> {
    let (is_enabled, agents) = {
        let store = app.state::<AppSettingsStore>();
        let registry = app.state::<AgentRegistry>();
        (enabled(&store), collect_agents(&registry))
    };
    if !is_enabled {
        return ApiResult::ok(TelemetrySendResult {
            enabled: false,
            sent: false,
        });
    }
    let errors = app
        .path()
        .app_log_dir()
        .map(|dir| collect_host_error_entries(&dir))
        .unwrap_or_default();
    let event = TelemetryEvent {
        event: "manual".into(),
        install_id: install_id(),
        app_version: APP_VERSION.into(),
        timestamp_ms: now_ms(),
        device: Some(collect_device_info()),
        agents: Some(agents),
        sessions: Vec::new(),
        errors,
    };
    match super::send(&event).await {
        Ok(()) => ApiResult::ok(TelemetrySendResult {
            enabled: true,
            sent: true,
        }),
        Err(e) => map_err(e),
    }
}

/// Batched renderer errors (window.onerror / unhandledrejection / ErrorBoundary).
#[tauri::command]
pub async fn telemetry_report_frontend_errors(
    app: AppHandle,
    args: FrontendErrorArgs,
) -> ApiResult<()> {
    let is_enabled = {
        let store = app.state::<AppSettingsStore>();
        enabled(&store)
    };
    if !is_enabled || args.errors.is_empty() {
        return ApiResult::ok(());
    }
    let errors: Vec<ErrorEntry> = args
        .errors
        .into_iter()
        .take(20)
        .map(|e| {
            let context = e.context.map(|c| format!("[{c}] ")).unwrap_or_default();
            ErrorEntry {
                source: "frontend".into(),
                message: sanitize(&format!("{context}{}", e.message)),
                stack: e.stack.map(|s| sanitize(&s)),
                timestamp_ms: Some(now_ms()),
            }
        })
        .collect();
    let event = TelemetryEvent {
        event: "error".into(),
        install_id: install_id(),
        app_version: APP_VERSION.into(),
        timestamp_ms: now_ms(),
        device: None,
        agents: None,
        sessions: Vec::new(),
        errors,
    };
    if let Err(e) = super::send(&event).await {
        log::warn!(target: "agentero::telemetry", "{e}");
    }
    ApiResult::ok(())
}

/// Fire-and-forget launch report: device + agents + pending crash + recent
/// host ERROR lines. Runs off the setup path so boot is never blocked.
pub fn spawn_startup_report(app: AppHandle) {
    if super::endpoint().is_none() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let (is_enabled, agents) = {
            let store = app.state::<AppSettingsStore>();
            let registry = app.state::<AgentRegistry>();
            (enabled(&store), collect_agents(&registry))
        };
        if !is_enabled {
            return;
        }
        super::record_session_start();
        let sessions = super::take_queued_sessions();
        let mut errors = app
            .path()
            .app_log_dir()
            .map(|dir| collect_host_error_entries(&dir))
            .unwrap_or_default();
        let crashed = match take_pending_crash() {
            Some(crash) => {
                errors.push(crash);
                true
            }
            None => false,
        };
        let event = TelemetryEvent {
            event: if crashed { "crash" } else { "launch" }.into(),
            install_id: install_id(),
            app_version: APP_VERSION.into(),
            timestamp_ms: now_ms(),
            device: Some(collect_device_info()),
            agents: Some(agents),
            sessions,
            errors,
        };
        if let Err(e) = super::send(&event).await {
            log::warn!(target: "agentero::telemetry", "{e}");
        } else {
            log::info!(
                target: "agentero::op",
                "op end telemetry_startup ok=true event={}",
                event.event
            );
        }
    });
}

/// Synchronous exit hook: persist session end for the next launch report.
/// Must stay allocation-light and never block — it runs in the exit path.
pub fn record_exit(app: &AppHandle) {
    if super::endpoint().is_none() {
        return;
    }
    let is_enabled = {
        let store = app.state::<AppSettingsStore>();
        enabled(&store)
    };
    if is_enabled {
        super::record_session_end();
    } else {
        super::clear_session_markers();
    }
}
