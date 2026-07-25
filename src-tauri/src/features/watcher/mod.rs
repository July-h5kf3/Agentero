//! Filesystem watcher: notifies the renderer when Vault files change on disk
//! (external editors, Agent subprocess writes) so open editors and the file
//! tree can reload. One recursive watcher per window; events are scoped to the
//! originating window via its label.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify_debouncer_full::new_debouncer;
use notify_debouncer_full::notify::event::{ModifyKind, RenameMode};
use notify_debouncer_full::notify::{EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, EventTarget};

/// Payload for the `vault:file-changed` event (consumed by the renderer).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangedPayload {
    /// Absolute paths touched by this (debounced) batch.
    pub paths: Vec<String>,
    /// Coarse change kind: "create" | "modify" | "remove" | "other".
    pub kind: String,
    /// Present only when the OS delivered one trustworthy old/new rename pair.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rename: Option<FileRename>,
}

/// A rename pair emitted by the native watcher. `None` means the watcher did
/// not preserve enough information for automatic internal-link repair.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRename {
    pub from: String,
    pub to: String,
}

struct WatchHandle {
    stop: Arc<AtomicBool>,
}

/// Per-window filesystem watchers. Mirrors the `Mutex<HashMap<..>>` pattern used
/// by `AgentRunController`.
pub struct FsWatchController {
    inner: Mutex<HashMap<String, WatchHandle>>,
}

impl Default for FsWatchController {
    fn default() -> Self {
        Self::new()
    }
}

impl FsWatchController {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    /// Start (or restart) a recursive watcher on `vault_path` for `window_label`.
    /// Any previous watcher for the same window is stopped first.
    pub fn start(
        &self,
        app: AppHandle,
        window_label: String,
        vault_path: String,
    ) -> Result<(), String> {
        self.stop(&window_label);

        let stop = Arc::new(AtomicBool::new(false));
        let stop_thread = stop.clone();
        let watch_root = vault_path.clone();
        let label = window_label.clone();

        std::thread::Builder::new()
            .name(format!("vault-watch:{window_label}"))
            .spawn(move || {
                let (tx, rx) = std::sync::mpsc::channel();
                let mut debouncer = match new_debouncer(Duration::from_millis(300), None, tx) {
                    Ok(d) => d,
                    Err(e) => {
                        log::error!(target: "agentero::watcher", "vault watcher init failed: {e}");
                        return;
                    }
                };
                if let Err(e) = debouncer
                    .watcher()
                    .watch(std::path::Path::new(&watch_root), RecursiveMode::Recursive)
                {
                    log::error!(target: "agentero::watcher", "vault watcher watch failed: {e}");
                    return;
                }
                // Keep the debouncer alive for the lifetime of this loop.
                loop {
                    if stop_thread.load(Ordering::Relaxed) {
                        break;
                    }
                    match rx.recv_timeout(Duration::from_millis(500)) {
                        Ok(Ok(events)) => {
                            for payload in payloads_from_events(events) {
                                let _ = app.emit_to(
                                    EventTarget::webview_window(label.clone()),
                                    "vault:file-changed",
                                    payload,
                                );
                            }
                        }
                        Ok(Err(_errs)) => {}
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                    }
                }
                drop(debouncer);
            })
            .map_err(|e| e.to_string())?;

        let mut guard = self
            .inner
            .lock()
            .map_err(|_| "fs watch controller lock poisoned".to_string())?;
        guard.insert(window_label, WatchHandle { stop });
        Ok(())
    }

    /// Stop and drop the watcher for `window_label` (no-op if none).
    pub fn stop(&self, window_label: &str) {
        if let Ok(mut guard) = self.inner.lock() {
            if let Some(handle) = guard.remove(window_label) {
                handle.stop.store(true, Ordering::Relaxed);
            }
        }
    }
}

/// Ignore churn from internal state and VCS metadata.
fn is_ignored(path: &str) -> bool {
    let p = path.replace('\\', "/");
    p.contains("/.agentero/") || p.contains("/.git/") || p.contains("/node_modules/")
}

fn kind_label(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "create",
        EventKind::Remove(_) => "remove",
        EventKind::Modify(ModifyKind::Name(_)) => "rename",
        EventKind::Modify(_) => "modify",
        _ => "other",
    }
}

/// `notify` marks `Both` only when one event contains the old and new path in
/// order. Other rename modes (or any filtered/incomplete pair) are deliberately
/// treated as an ordinary structural event: they may refresh the tree/index but
/// can never authorize a Vault rewrite.
fn verified_rename_pair(kind: &EventKind, paths: &[String]) -> Option<FileRename> {
    if !matches!(kind, EventKind::Modify(ModifyKind::Name(RenameMode::Both)))
        || paths.len() != 2
        || paths[0] == paths[1]
    {
        return None;
    }
    Some(FileRename {
        from: paths[0].clone(),
        to: paths[1].clone(),
    })
}

/// Convert a debounced batch into one payload per event kind, dropping ignored paths.
fn payloads_from_events(
    events: Vec<notify_debouncer_full::DebouncedEvent>,
) -> Vec<FileChangedPayload> {
    let mut out: Vec<FileChangedPayload> = Vec::new();
    for event in events {
        let kind = kind_label(&event.kind);
        let paths: Vec<String> = event
            .paths
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .filter(|p| !is_ignored(p))
            .collect();
        if paths.is_empty() {
            continue;
        }
        let rename = verified_rename_pair(&event.kind, &paths);
        out.push(FileChangedPayload {
            paths,
            kind: kind.to_string(),
            rename,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_complete_notify_rename_pairs_are_trusted() {
        let kind = EventKind::Modify(ModifyKind::Name(RenameMode::Both));
        let paths = vec!["/vault/old.md".to_string(), "/vault/new.md".to_string()];
        let pair = verified_rename_pair(&kind, &paths).expect("trusted pair");
        assert_eq!(pair.from, "/vault/old.md");
        assert_eq!(pair.to, "/vault/new.md");

        assert!(verified_rename_pair(
            &EventKind::Modify(ModifyKind::Name(RenameMode::Any)),
            &paths,
        )
        .is_none());
        assert!(verified_rename_pair(&kind, &paths[..1]).is_none());
    }
}

/// Tauri command shells for this feature.
pub mod commands;
