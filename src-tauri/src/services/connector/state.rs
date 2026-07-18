//! Process-wide connector server state and lifecycle.

use super::server;
use crate::error::AppError;
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

/// Default Zotero Connector port (must match official extension default).
pub const DEFAULT_CONNECTOR_PORT: u16 = 23119;

const CONNECTOR_API_VERSION: &str = "2";
const AGENTERO_CONNECTOR_VERSION: &str = "0.1.0-agentero";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorStatus {
    pub enabled: bool,
    pub listening: bool,
    pub port: u16,
    pub bound_address: Option<String>,
    pub last_error: Option<String>,
    pub vault_path: Option<String>,
    pub parent_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorItemSaved {
    pub path: String,
    pub id: String,
    pub title: String,
    pub deduped: bool,
    pub session_id: String,
}

#[derive(Debug, Clone)]
pub struct ProgressAttachment {
    pub id: String,
    pub title: String,
    pub content_type: String,
    pub progress: i32,
}

#[derive(Debug, Clone)]
pub struct ProgressItem {
    pub id: serde_json::Value,
    pub title: String,
    pub item_type: String,
    pub attachments: Vec<ProgressAttachment>,
}

#[derive(Debug)]
pub struct SaveSession {
    pub created: std::time::Instant,
    pub items: Vec<ProgressItem>,
    pub done: bool,
    /// Vault-relative parent (`papers` or `papers/…`) for this save session.
    pub parent_dir: String,
    /// Paper folders created in this session (vault-relative), for updateSession moves.
    pub paper_paths: Vec<String>,
}

struct Inner {
    enabled: bool,
    listening: bool,
    port: u16,
    last_error: Option<String>,
    vault_path: Option<PathBuf>,
    parent_dir: String,
    /// Cancels the accept loop when the server should stop.
    shutdown_tx: Option<oneshot::Sender<()>>,
    sessions: HashMap<String, SaveSession>,
    app: Option<AppHandle>,
}

/// Shared controller managed by Tauri (`app.manage`).
pub struct ConnectorController {
    inner: Mutex<Inner>,
    /// Fast path for handlers without locking the full struct for vault checks.
    running: AtomicBool,
}

impl Default for ConnectorController {
    fn default() -> Self {
        Self::new()
    }
}

impl ConnectorController {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                enabled: false,
                listening: false,
                port: DEFAULT_CONNECTOR_PORT,
                last_error: None,
                vault_path: None,
                parent_dir: "papers".into(),
                shutdown_tx: None,
                sessions: HashMap::new(),
                app: None,
            }),
            running: AtomicBool::new(false),
        }
    }

    pub fn set_app_handle(&self, app: AppHandle) {
        if let Ok(mut g) = self.inner.lock() {
            g.app = Some(app);
        }
    }

    pub fn status(&self) -> ConnectorStatus {
        let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        ConnectorStatus {
            enabled: g.enabled,
            listening: g.listening,
            port: g.port,
            bound_address: if g.listening {
                Some(format!("127.0.0.1:{}", g.port))
            } else {
                None
            },
            last_error: g.last_error.clone(),
            vault_path: g.vault_path.as_ref().map(|p| p.display().to_string()),
            parent_dir: g.parent_dir.clone(),
        }
    }

    /// Update the Vault path used by `saveItems` (None when no vault open).
    pub fn set_vault(&self, vault_path: Option<String>) {
        if let Ok(mut g) = self.inner.lock() {
            g.vault_path = vault_path
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .map(PathBuf::from);
        }
        self.emit_status();
    }

    pub fn set_parent_dir(&self, parent_dir: String) {
        if let Ok(mut g) = self.inner.lock() {
            let trimmed = parent_dir
                .trim()
                .replace('\\', "/")
                .trim_matches('/')
                .to_string();
            if !trimmed.is_empty() {
                g.parent_dir = trimmed;
            }
        }
    }

    pub fn vault_and_parent(&self) -> Result<(PathBuf, String), AppError> {
        let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let vault = g
            .vault_path
            .clone()
            .ok_or_else(|| AppError::message("No vault open — open a vault in Agentero first"))?;
        if !vault.is_dir() {
            return Err(AppError::message("Vault path is not a directory"));
        }
        Ok((vault, g.parent_dir.clone()))
    }

    /// Enable or disable the HTTP server. Idempotent.
    pub fn set_enabled(self: &Arc<Self>, enabled: bool) -> ConnectorStatus {
        if !enabled {
            self.stop_server();
            if let Ok(mut g) = self.inner.lock() {
                g.enabled = false;
                g.last_error = None;
            }
            self.emit_status();
            return self.status();
        }

        {
            let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            g.enabled = true;
            g.last_error = None;
            if g.listening {
                return self.status_from(&g);
            }
        }

        match self.start_server() {
            Ok(()) => {}
            Err(e) => {
                if let Ok(mut g) = self.inner.lock() {
                    g.enabled = true;
                    g.listening = false;
                    g.last_error = Some(e.to_string());
                }
                self.running.store(false, Ordering::SeqCst);
            }
        }
        self.emit_status();
        self.status()
    }

    fn status_from(&self, g: &Inner) -> ConnectorStatus {
        ConnectorStatus {
            enabled: g.enabled,
            listening: g.listening,
            port: g.port,
            bound_address: if g.listening {
                Some(format!("127.0.0.1:{}", g.port))
            } else {
                None
            },
            last_error: g.last_error.clone(),
            vault_path: g.vault_path.as_ref().map(|p| p.display().to_string()),
            parent_dir: g.parent_dir.clone(),
        }
    }

    fn start_server(self: &Arc<Self>) -> Result<(), AppError> {
        let port = {
            let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            g.port
        };

        // Stop any previous listener first.
        self.stop_server_internal();

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let ctrl = Arc::clone(self);

        // Bind on the current runtime so EADDRINUSE fails before we claim success.
        let listener = tauri::async_runtime::block_on(async {
            tokio::net::TcpListener::bind(std::net::SocketAddr::from(([127, 0, 0, 1], port))).await
        })
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AddrInUse {
                AppError::message(format!(
                    "Port {port} is already in use (often Zotero is running). Quit the other app and try again."
                ))
            } else {
                AppError::message(format!("Failed to bind 127.0.0.1:{port}: {e}"))
            }
        })?;

        {
            let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            g.shutdown_tx = Some(shutdown_tx);
            g.listening = true;
            g.last_error = None;
        }
        self.running.store(true, Ordering::SeqCst);

        let ctrl_serve = Arc::clone(&ctrl);
        tauri::async_runtime::spawn(async move {
            if let Err(e) = server::serve(listener, shutdown_rx, ctrl_serve).await {
                if let Ok(mut g) = ctrl.inner.lock() {
                    g.listening = false;
                    g.last_error = Some(e.to_string());
                }
                ctrl.running.store(false, Ordering::SeqCst);
                ctrl.emit_status();
            }
        });

        Ok(())
    }

    pub fn stop(&self) {
        self.stop_server();
        if let Ok(mut g) = self.inner.lock() {
            g.enabled = false;
        }
        self.emit_status();
    }

    fn stop_server(&self) {
        self.stop_server_internal();
        if let Ok(mut g) = self.inner.lock() {
            g.listening = false;
        }
        self.running.store(false, Ordering::SeqCst);
    }

    fn stop_server_internal(&self) {
        if let Ok(mut g) = self.inner.lock() {
            if let Some(tx) = g.shutdown_tx.take() {
                let _ = tx.send(());
            }
            g.listening = false;
        }
        self.running.store(false, Ordering::SeqCst);
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn create_session(
        &self,
        session_id: &str,
        items: Vec<ProgressItem>,
    ) -> Result<(), AppError> {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        self.gc_sessions_locked(&mut g);
        if g.sessions.contains_key(session_id) {
            return Err(AppError::message("SESSION_EXISTS"));
        }
        let parent_dir = g.parent_dir.clone();
        g.sessions.insert(
            session_id.to_string(),
            SaveSession {
                created: std::time::Instant::now(),
                items,
                done: false,
                parent_dir,
                paper_paths: Vec::new(),
            },
        );
        Ok(())
    }

    /// Parent dir for a live session (falls back to global default).
    pub fn session_parent_dir(&self, session_id: &str) -> String {
        let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.sessions
            .get(session_id)
            .map(|s| s.parent_dir.clone())
            .unwrap_or_else(|| g.parent_dir.clone())
    }

    pub fn record_session_paper(&self, session_id: &str, paper_path: &str) {
        if let Ok(mut g) = self.inner.lock() {
            if let Some(s) = g.sessions.get_mut(session_id) {
                s.paper_paths.push(paper_path.replace('\\', "/"));
            }
        }
    }

    pub fn mark_session_done(&self, session_id: &str) {
        if let Ok(mut g) = self.inner.lock() {
            if let Some(s) = g.sessions.get_mut(session_id) {
                s.done = true;
            }
        }
    }

    /// Apply Connector collection picker change: remember parent + move papers already saved.
    pub fn update_session_target(
        &self,
        session_id: &str,
        target: &str,
    ) -> Result<String, AppError> {
        let parent = super::targets::resolve_target_parent(target).ok_or_else(|| {
            AppError::message(format!("unknown or invalid save target: {target}"))
        })?;

        let (vault, paths_to_move) = {
            let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            g.parent_dir = parent.clone();
            let vault = g
                .vault_path
                .clone()
                .ok_or_else(|| AppError::message("No vault open"))?;
            let session = g
                .sessions
                .get_mut(session_id)
                .ok_or_else(|| AppError::message("SESSION_NOT_FOUND"))?;
            session.parent_dir = parent.clone();
            let paths = session.paper_paths.clone();
            (vault, paths)
        };

        let mut new_paths = Vec::new();
        for from in &paths_to_move {
            match move_paper_folder(&vault, from, &parent) {
                Ok(new_rel) => new_paths.push(new_rel),
                Err(e) => {
                    // Keep going; surface soft error via event.
                    self.emit_error(&format!("move {from}: {e}"), Some(session_id));
                    new_paths.push(from.clone());
                }
            }
        }

        if !new_paths.is_empty() {
            if let Ok(mut g) = self.inner.lock() {
                if let Some(s) = g.sessions.get_mut(session_id) {
                    s.paper_paths = new_paths.clone();
                }
            }
            for path in &new_paths {
                // Refresh UI for each moved paper.
                if let Some(id) = path.rsplit('/').next() {
                    self.emit_item_saved(ConnectorItemSaved {
                        path: path.clone(),
                        id: id.to_string(),
                        title: id.to_string(),
                        deduped: false,
                        session_id: session_id.to_string(),
                    });
                }
            }
        }

        Ok(parent)
    }

    /// JSON body for `/connector/getSelectedCollection`.
    pub fn selected_collection_json(&self) -> serde_json::Value {
        let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let parent = g.parent_dir.clone();
        let vault_name = g
            .vault_path
            .as_ref()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
            .unwrap_or("Agentero Vault");

        let targets = if let Some(vault) = &g.vault_path {
            super::targets::list_save_targets(vault)
        } else {
            vec![super::targets::SaveTarget {
                id: "L1".into(),
                name: "papers".into(),
                level: 0,
            }]
        };

        let (sel_id, sel_name) = if parent == "papers" {
            ("L1".to_string(), "papers".to_string())
        } else {
            let name = parent
                .rsplit('/')
                .next()
                .unwrap_or(parent.as_str())
                .to_string();
            (format!("D{parent}"), name)
        };

        serde_json::json!({
            "libraryID": 1,
            "libraryName": vault_name,
            "libraryEditable": true,
            "editable": true,
            "id": if parent == "papers" { serde_json::Value::Null } else { serde_json::json!(sel_id) },
            "name": sel_name,
            "targets": targets,
        })
    }

    pub fn session_progress_json(&self, session_id: &str) -> Result<serde_json::Value, AppError> {
        let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let session = g
            .sessions
            .get(session_id)
            .ok_or_else(|| AppError::message("SESSION_NOT_FOUND"))?;
        let items: Vec<serde_json::Value> = session
            .items
            .iter()
            .map(|it| {
                let atts: Vec<serde_json::Value> = it
                    .attachments
                    .iter()
                    .map(|a| {
                        serde_json::json!({
                            "id": format!("{}_{}", session_id, a.id),
                            "title": a.title,
                            "contentType": a.content_type,
                            "mimeType": a.content_type,
                            "progress": a.progress,
                        })
                    })
                    .collect();
                serde_json::json!({
                    "id": it.id,
                    "title": it.title,
                    "itemType": it.item_type,
                    "attachments": atts,
                })
            })
            .collect();
        Ok(serde_json::json!({
            "items": items,
            "done": session.done,
        }))
    }

    fn gc_sessions_locked(&self, g: &mut Inner) {
        let ttl = if g.sessions.len() >= 10 {
            std::time::Duration::from_secs(60)
        } else {
            std::time::Duration::from_secs(600)
        };
        g.sessions.retain(|_, s| s.created.elapsed() < ttl);
    }

    pub fn emit_item_saved(&self, payload: ConnectorItemSaved) {
        if let Ok(g) = self.inner.lock() {
            if let Some(app) = &g.app {
                let _ = app.emit("connector:item-saved", &payload);
            }
        }
    }

    pub fn emit_error(&self, message: &str, session_id: Option<&str>) {
        if let Ok(g) = self.inner.lock() {
            if let Some(app) = &g.app {
                let _ = app.emit(
                    "connector:error",
                    serde_json::json!({
                        "message": message,
                        "sessionId": session_id,
                    }),
                );
            }
        }
    }

    fn emit_status(&self) {
        let status = self.status();
        if let Ok(g) = self.inner.lock() {
            if let Some(app) = &g.app {
                let _ = app.emit("connector:status", &status);
            }
        }
    }

    pub fn response_headers() -> [(&'static str, &'static str); 2] {
        [
            ("X-Zotero-Version", AGENTERO_CONNECTOR_VERSION),
            ("X-Zotero-Connector-API-Version", CONNECTOR_API_VERSION),
        ]
    }
}

/// Move a paper folder under a new org parent and rewrite catalog paths.
fn move_paper_folder(
    vault: &std::path::Path,
    from_rel: &str,
    dest_parent: &str,
) -> Result<String, AppError> {
    use crate::services::catalog::papers;

    let from = from_rel.trim().trim_matches('/').replace('\\', "/");
    let dest_parent = dest_parent.trim().trim_matches('/').replace('\\', "/");
    if from.is_empty() {
        return Err(AppError::message("empty paper path"));
    }
    let base = from.rsplit('/').next().unwrap_or(from.as_str()).to_string();
    let new_rel = format!("{dest_parent}/{base}");
    if new_rel == from {
        return Ok(from);
    }
    let from_abs = vault.join(&from);
    let new_abs = vault.join(&new_rel);
    if !from_abs.is_dir() {
        return Err(AppError::message(format!("paper folder missing: {from}")));
    }
    if new_abs.exists() {
        return Err(AppError::message(format!(
            "destination already exists: {new_rel}"
        )));
    }
    if let Some(parent) = new_abs.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(&from_abs, &new_abs)?;
    let _ = papers::move_under_path(vault, &from, &new_rel);
    Ok(new_rel)
}
