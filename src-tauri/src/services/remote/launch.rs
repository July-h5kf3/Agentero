//! Resolve how to launch BYOA when the active vault is remote.

use super::session::{parse_remote_handle, RemoteRegistry, RemoteSession, LOCAL_SIM_HOST};
use crate::error::AppError;
use crate::services::fs::WriteOpts;
use crate::services::vault::{self, CreateVaultResult};
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

/// Seed missing bundled skills directly into the remote vault.
///
/// Remote vault handles are opaque session ids, so the local `vault_ensure`
/// command cannot be used for them. Existing remote files are never replaced.
pub async fn ensure_remote_vault_skills(
    session: &RemoteSession,
) -> Result<CreateVaultResult, AppError> {
    let mut created = Vec::new();
    for (rel, content) in vault::bundled_skill_files() {
        if session.fs.exists(rel).await? {
            continue;
        }
        session
            .fs
            .write(
                rel,
                content.as_bytes(),
                WriteOpts {
                    create_parents: true,
                },
            )
            .await?;
        created.push((*rel).to_string());
    }

    Ok(CreateVaultResult {
        path: session.remote_path.clone(),
        created,
        open_path: "AGENTS.md".into(),
    })
}

/// Pull `.agents/skills/*/SKILL.md` into the session work root so Host can inject skills.
pub async fn materialize_skills_to_work(session: &RemoteSession) -> Result<(), AppError> {
    let mirror_root = session.work_root.join(".agents/skills");
    let _ = std::fs::remove_dir_all(&mirror_root);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_vault() -> PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("agentero-remote-skills-{n}"));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[tokio::test]
    async fn ensure_remote_vault_skills_seeds_missing_files_without_overwrite() {
        let root = tmp_vault();
        let agents = root.join("AGENTS.md");
        let existing_skill = root.join(".agents/skills/paper-reader/SKILL.md");
        std::fs::write(&agents, "# user agents\n").unwrap();
        std::fs::create_dir_all(existing_skill.parent().unwrap()).unwrap();
        std::fs::write(&existing_skill, "# user skill\n").unwrap();

        let registry = RemoteRegistry::new();
        let info = registry
            .connect(LOCAL_SIM_HOST, None, &root.to_string_lossy())
            .await
            .unwrap();
        let session = registry.get(&info.session_id).await.unwrap();

        let first = ensure_remote_vault_skills(&session).await.unwrap();
        assert!(first
            .created
            .contains(&".agents/skills/deep-research/SKILL.md".to_string()));
        assert!(!first
            .created
            .contains(&".agents/skills/paper-reader/SKILL.md".to_string()));
        assert_eq!(std::fs::read_to_string(&agents).unwrap(), "# user agents\n");
        assert_eq!(
            std::fs::read_to_string(&existing_skill).unwrap(),
            "# user skill\n"
        );

        let second = ensure_remote_vault_skills(&session).await.unwrap();
        assert!(second.created.is_empty());

        registry.disconnect(&info.session_id).await.unwrap();
        let _ = std::fs::remove_dir_all(root);
    }
}
