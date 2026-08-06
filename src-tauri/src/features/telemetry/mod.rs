//! Opt-out diagnostics reporting (crash / error logs, device & agent inventory).
//!
//! The server endpoint is baked in at build time via the
//! `AGENTERO_TELEMETRY_ENDPOINT` environment variable; when unset every entry
//! point is a no-op. Users can additionally opt out via
//! `AppSettings::telemetry_enabled`. Payloads are scrubbed of the user's home
//! directory before upload.

use crate::core::error::AppError;
use crate::core::paths;
use crate::features::agent::models::CatalogAcpStatus;
use crate::features::agent::AgentRegistry;
use crate::features::network;
use crate::features::settings::AppSettingsStore;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Upper bound of host ERROR lines attached to one report.
const MAX_ERROR_LINES: usize = 100;
const MAX_ENTRY_CHARS: usize = 500;
const MAX_STACK_CHARS: usize = 4000;

/// Build-time endpoint; `None` disables telemetry entirely.
pub fn endpoint() -> Option<&'static str> {
    option_env!("AGENTERO_TELEMETRY_ENDPOINT")
        .map(str::trim)
        .filter(|url| !url.is_empty())
}

/// True when an endpoint is compiled in and the user has not opted out.
pub fn enabled(store: &AppSettingsStore) -> bool {
    endpoint().is_some()
        && store
            .get()
            .map(|r| r.settings.telemetry_enabled)
            .unwrap_or(false)
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Replace the user's home directory with `~` so paths never leak identity.
pub fn sanitize(text: &str) -> String {
    match dirs::home_dir() {
        Some(home) => text.replace(home.to_string_lossy().as_ref(), "~"),
        None => text.to_string(),
    }
}

fn truncate(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryEvent {
    /// `launch` | `crash` | `error` | `manual`.
    pub event: String,
    pub install_id: String,
    pub app_version: String,
    pub timestamp_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device: Option<DeviceInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agents: Option<Vec<AgentInstall>>,
    /// Locally queued session records (one per app run). Completed sessions
    /// are appended on exit; the launch report drains the queue and adds the
    /// current open session, so the server only stores ready-made rows.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sessions: Vec<SessionRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<ErrorEntry>,
}

/// One app run: start / end timestamps and duration. For the session still
/// open at report time, `endedAtMs` / `durationMs` are null.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub started_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub os_name: String,
    pub os_version: String,
    pub arch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_model: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstall {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub acp_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEntry {
    /// `host-log` | `frontend` | `crash`.
    pub source: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp_ms: Option<u64>,
}

/// Stable anonymous install id (UUID v4 persisted in the config dir).
pub fn install_id() -> String {
    let path = paths::agentero_config_dir().join("telemetry_id");
    if let Ok(raw) = std::fs::read_to_string(&path) {
        let id = raw.trim();
        if !id.is_empty() {
            return id.to_string();
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, &id);
    id
}

pub fn collect_device_info() -> DeviceInfo {
    let info = os_info::get();
    DeviceInfo {
        os_name: info.os_type().to_string(),
        os_version: info.version().to_string(),
        arch: std::env::consts::ARCH.to_string(),
        device_model: device_model(),
    }
}

/// Best-effort hardware model (e.g. `Mac15,7`); never fails the report.
fn device_model() -> Option<String> {
    let model = raw_device_model()?;
    let model = model.trim().to_string();
    (!model.is_empty()).then_some(model)
}

fn raw_device_model() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("sysctl")
            .args(["-n", "hw.model"])
            .output()
            .ok()?;
        Some(String::from_utf8_lossy(&out.stdout).into_owned())
    }
    #[cfg(target_os = "linux")]
    {
        std::fs::read_to_string("/sys/devices/virtual/dmi/id/product_name").ok()
    }
    #[cfg(target_os = "windows")]
    {
        let out = std::process::Command::new("reg")
            .args([
                "query",
                r"HKLM\HARDWARE\DESCRIPTION\System\BIOS",
                "/v",
                "SystemProductName",
            ])
            .output()
            .ok()?;
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .find_map(|line| line.split("REG_SZ").nth(1))
            .map(str::trim)
            .map(str::to_string)
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        None
    }
}

/// Installed / available ACP agents from the catalog scan (id + flags only).
pub fn collect_agents(registry: &AgentRegistry) -> Vec<AgentInstall> {
    let Ok(scan) = registry.scan_catalog() else {
        return Vec::new();
    };
    let mut out: Vec<AgentInstall> = scan
        .entries
        .iter()
        .map(|e| AgentInstall {
            id: e.template_id.clone(),
            name: e.name.clone(),
            installed: e.binary_available,
            acp_ready: matches!(e.acp_status, CatalogAcpStatus::Ready),
        })
        .collect();
    for a in &scan.custom_agents {
        out.push(AgentInstall {
            id: a.id.clone(),
            name: a.name.clone(),
            installed: a.available,
            acp_ready: a.last_probe_ok == Some(true),
        });
    }
    out
}

/// ERROR-level lines from the rotated `agentero*.log` files (sanitized, capped).
pub fn collect_host_error_entries(log_dir: &Path) -> Vec<ErrorEntry> {
    let mut lines: Vec<String> = Vec::new();
    let Ok(read_dir) = std::fs::read_dir(log_dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = read_dir
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("agentero") && n.ends_with(".log"))
        })
        .collect();
    files.sort();
    for path in files {
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        for line in raw.lines() {
            if line.contains("ERROR") {
                lines.push(truncate(&sanitize(line), MAX_ENTRY_CHARS));
            }
        }
    }
    lines
        .into_iter()
        .rev()
        .take(MAX_ERROR_LINES)
        .map(|message| ErrorEntry {
            source: "host-log".into(),
            message,
            stack: None,
            timestamp_ms: None,
        })
        .collect()
}

fn pending_crash_path() -> PathBuf {
    paths::agentero_config_dir().join("pending_crash.json")
}

/// Panic hook: persist the crash for the next launch (network is unreliable
/// mid-crash), then defer to the previous hook.
pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic".into());
        let location = info.location().map(|l| format!("{l}")).unwrap_or_default();
        let record = serde_json::json!({
            "message": sanitize(&message),
            "location": sanitize(&location),
            "backtrace": sanitize(&std::backtrace::Backtrace::force_capture().to_string()),
            "appVersion": APP_VERSION,
            "timestampMs": now_ms(),
        });
        let path = pending_crash_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, record.to_string());
        previous(info);
    }));
}

/// Read and clear the pending crash record written by the panic hook.
pub fn take_pending_crash() -> Option<ErrorEntry> {
    let path = pending_crash_path();
    let raw = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(&path);
    parse_pending_crash(&raw)
}

fn parse_pending_crash(raw: &str) -> Option<ErrorEntry> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let message = v.get("message")?.as_str()?;
    let location = v
        .get("location")
        .and_then(|l| l.as_str())
        .filter(|l| !l.is_empty())
        .map(|l| format!(" @ {l}"))
        .unwrap_or_default();
    Some(ErrorEntry {
        source: "crash".into(),
        message: truncate(&format!("{message}{location}"), MAX_ENTRY_CHARS),
        stack: v
            .get("backtrace")
            .and_then(|b| b.as_str())
            .map(|s| truncate(s, MAX_STACK_CHARS)),
        timestamp_ms: v.get("timestampMs").and_then(|t| t.as_u64()),
    })
}

fn session_start_path() -> PathBuf {
    paths::agentero_config_dir().join("session_start")
}

/// JSONL queue of completed session records awaiting upload.
fn session_queue_path() -> PathBuf {
    paths::agentero_config_dir().join("sessions.jsonl")
}

/// Cap the local queue so a long-unreachable server cannot grow it forever.
const MAX_QUEUED_SESSIONS: usize = 500;

/// Mark the current session start; called once the startup report confirms
/// telemetry is enabled.
pub fn record_session_start() {
    let path = session_start_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&path, now_ms().to_string());
}

/// Append the finished session to the local queue — the next launch report
/// uploads it (the network is unreliable during process exit).
pub fn record_session_end() {
    let end = now_ms();
    let start = std::fs::read_to_string(session_start_path())
        .ok()
        .and_then(|raw| raw.trim().parse::<u64>().ok())
        .filter(|&s| s <= end);
    let record = SessionRecord {
        started_at_ms: start.unwrap_or(end),
        ended_at_ms: Some(end),
        duration_ms: start.map(|s| end - s),
        app_version: Some(APP_VERSION.into()),
    };
    let Ok(line) = serde_json::to_string(&record) else {
        return;
    };
    let path = session_queue_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(f, "{line}");
    }
    let _ = std::fs::remove_file(session_start_path());
}

/// Drain the queued session records (newest last, capped).
pub fn take_queued_sessions() -> Vec<SessionRecord> {
    let path = session_queue_path();
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return Vec::new();
    };
    let _ = std::fs::remove_file(&path);
    let records: Vec<SessionRecord> = raw
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    if records.len() > MAX_QUEUED_SESSIONS {
        records[records.len() - MAX_QUEUED_SESSIONS..].to_vec()
    } else {
        records
    }
}

/// Drop stale markers when telemetry is off so nothing lingers for a later
/// re-enable.
pub fn clear_session_markers() {
    let _ = std::fs::remove_file(session_start_path());
    let _ = std::fs::remove_file(session_queue_path());
}

/// POST the event with one retry; failures only log, never surface to users.
pub async fn send(event: &TelemetryEvent) -> Result<(), AppError> {
    let Some(url) = endpoint() else {
        return Ok(());
    };
    let client = network::client_builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| AppError::message(format!("telemetry client: {e}")))?;
    let mut last_error = String::new();
    for _ in 0..2 {
        match client.post(url).json(event).send().await {
            Ok(resp) if resp.status().is_success() => return Ok(()),
            Ok(resp) => last_error = format!("HTTP {}", resp.status()),
            Err(e) => last_error = e.to_string(),
        }
    }
    Err(AppError::message(format!(
        "telemetry upload failed: {last_error}"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_replaces_home_dir() {
        let home = dirs::home_dir().expect("home dir");
        let input = format!("{}/vault/paper.pdf failed", home.display());
        let out = sanitize(&input);
        assert!(out.starts_with("~/vault/paper.pdf"));
        assert!(!out.contains(home.to_string_lossy().as_ref()));
    }

    #[test]
    fn collects_only_error_lines_capped() {
        let n = now_ms();
        let dir = std::env::temp_dir().join(format!("agentero-telemetry-test-{n}"));
        let _ = std::fs::create_dir_all(&dir);
        let mut content = String::new();
        for i in 0..150 {
            content.push_str(&format!("2026-08-06T00:00:00Z INFO[agentero] line {i}\n"));
        }
        for i in 0..120 {
            content.push_str(&format!("2026-08-06T00:00:00Z ERROR[agentero] boom {i}\n"));
        }
        std::fs::write(dir.join("agentero.log"), content).unwrap();
        let entries = collect_host_error_entries(&dir);
        assert_eq!(entries.len(), MAX_ERROR_LINES);
        assert!(entries.iter().all(|e| e.source == "host-log"));
        // Newest errors first.
        assert!(entries[0].message.contains("boom 119"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn parses_pending_crash_record() {
        let raw = serde_json::json!({
            "message": "index out of bounds",
            "location": "src/features/catalog/mod.rs:10:5",
            "backtrace": "stack frame",
            "appVersion": "0.4.1",
            "timestampMs": 123_u64,
        })
        .to_string();
        let entry = parse_pending_crash(&raw).expect("parse crash");
        assert_eq!(entry.source, "crash");
        assert!(entry.message.contains("index out of bounds"));
        assert!(entry.message.contains("catalog/mod.rs"));
        assert_eq!(entry.timestamp_ms, Some(123));
        assert!(parse_pending_crash("not json").is_none());
    }

    #[test]
    fn install_id_is_stable() {
        assert_eq!(install_id(), install_id());
    }

    #[test]
    fn session_record_roundtrip() {
        let s = SessionRecord {
            started_at_ms: 1_700_000_000_000,
            ended_at_ms: Some(1_700_000_042_000),
            duration_ms: Some(42_000),
            app_version: Some("0.4.1".into()),
        };
        let raw = serde_json::to_string(&s).unwrap();
        assert!(raw.contains("startedAtMs"));
        let back: SessionRecord = serde_json::from_str(&raw).unwrap();
        assert_eq!(back.started_at_ms, s.started_at_ms);
        assert_eq!(back.duration_ms, Some(42_000));
        // Open session (reported while running) omits end fields.
        let open = SessionRecord {
            started_at_ms: 1,
            ended_at_ms: None,
            duration_ms: None,
            app_version: None,
        };
        let raw = serde_json::to_string(&open).unwrap();
        assert!(!raw.contains("endedAtMs"));
    }
}

pub mod commands;
