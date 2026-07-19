//! Resolve how to launch BYOA when the active vault is remote.

use super::session::{parse_remote_handle, RemoteRegistry, RemoteSession, LOCAL_SIM_HOST};
use crate::error::AppError;
use crate::services::fs::WriteOpts;
use std::path::PathBuf;
use std::sync::Arc;

/// Where the agent process should run and what cwd to advertise over ACP/Codex.
/// Clone is cheap: `session` is an `Arc`.
#[derive(Clone)]
pub struct RemoteAgentTarget {
    pub kind: String,
    /// SSH destination (`host` or `user@host`). Empty for local-sim.
    pub destination: String,
    /// Absolute path on the machine where the agent runs.
    pub remote_cwd: String,
    /// Ephemeral local work root (catalog + optional skill mirror).
    pub work_root: PathBuf,
    pub session: Arc<RemoteSession>,
}

impl RemoteAgentTarget {
    pub fn is_ssh(&self) -> bool {
        self.kind == "ssh"
    }

    /// Path string passed to ACP `new_session` / Codex as cwd (remote absolute path).
    pub fn agent_cwd(&self) -> PathBuf {
        PathBuf::from(&self.remote_cwd)
    }
}

/// If `vault_path` is `remote:<sessionId>`, resolve launch target; else `None` (local vault).
pub async fn resolve_remote_target(
    registry: &RemoteRegistry,
    vault_path: Option<&str>,
) -> Result<Option<RemoteAgentTarget>, AppError> {
    let Some(raw) = vault_path.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let Some(session_id) = parse_remote_handle(raw) else {
        return Ok(None);
    };
    let session = registry.get(session_id).await?;
    let destination = if session.kind == "local-sim" || session.host == LOCAL_SIM_HOST {
        String::new()
    } else {
        // Prefer host as stored (may already be `user@host` from connect UI).
        session.host.clone()
    };
    Ok(Some(RemoteAgentTarget {
        kind: session.kind.clone(),
        destination,
        remote_cwd: session.remote_path.clone(),
        work_root: session.work_root.clone(),
        session,
    }))
}

/// Pull `.agents/skills/*/SKILL.md` into the session work root so Host can inject skills.
pub async fn materialize_skills_to_work(session: &RemoteSession) -> Result<(), AppError> {
    let skills_rel = ".agents/skills";
    let entries = match session.fs.list(skills_rel).await {
        Ok(e) => e,
        Err(_) => return Ok(()), // no skills dir on remote
    };
    for e in entries {
        if !e.is_dir {
            continue;
        }
        let skill_md = format!("{}/SKILL.md", e.path);
        let Ok(bytes) = session.fs.read(&skill_md).await else {
            continue;
        };
        let dest = session.work_root.join(&e.path).join("SKILL.md");
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&dest, bytes)?;
        // Also pull shallow reference files if present (optional, best-effort)
        let refs_rel = format!("{}/references", e.path);
        if let Ok(refs) = session.fs.list(&refs_rel).await {
            for r in refs {
                if !r.is_file {
                    continue;
                }
                if let Ok(rb) = session.fs.read(&r.path).await {
                    let rd = session.work_root.join(&r.path);
                    if let Some(parent) = rd.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    let _ = std::fs::write(rd, rb);
                }
            }
        }
    }
    // Touch a marker so work_root looks like a vault for skill_roots filter
    let _ = session
        .fs
        .write(
            ".agents/.agentero-remote-mirror",
            b"ok\n",
            WriteOpts {
                create_parents: true,
            },
        )
        .await;
    Ok(())
}

/// Read a vault-relative note after a remote agent run (for notes-review).
pub async fn read_remote_note(
    session: &RemoteSession,
    rel: &str,
) -> Result<Option<String>, AppError> {
    match session.fs.read(rel).await {
        Ok(bytes) => Ok(Some(
            String::from_utf8(bytes).map_err(|e| AppError::message(format!("utf-8: {e}")))?,
        )),
        Err(_) => Ok(None),
    }
}

/// Build vault-relative NOTES path from paper target (same rules as local snapshot).
pub fn notes_rel_from_target(target: &str) -> String {
    let t = target.trim().trim_matches('/').replace('\\', "/");
    if t.ends_with(".md") {
        t
    } else {
        format!("{t}/NOTES.md")
    }
}
