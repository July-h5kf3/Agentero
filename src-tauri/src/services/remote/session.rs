//! Active remote vault sessions (SSH/SFTP or local-sim for tests).

use super::catalog_mirror::CatalogMirror;
use super::sftp_fs::SftpFs;
use crate::error::AppError;
use crate::services::fs::{FsCaps, LocalFs, VaultFs};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Magic host for local-sim backend (dev / unit-style integration without SSH).
pub const LOCAL_SIM_HOST: &str = "__local_sim__";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSessionInfo {
    pub session_id: String,
    pub kind: String,
    pub display_name: String,
    pub host: String,
    pub remote_path: String,
    pub caps: FsCaps,
    /// Pseudo vault path for frontend: `remote:<sessionId>`
    pub vault_handle: String,
}

pub struct RemoteSession {
    pub id: String,
    pub host: String,
    pub remote_path: String,
    pub display_name: String,
    pub kind: String,
    pub fs: Arc<dyn VaultFs>,
    pub work_root: PathBuf,
    pub blob_root: PathBuf,
    pub catalog: Mutex<CatalogMirror>,
}

impl RemoteSession {
    pub fn info(&self) -> RemoteSessionInfo {
        RemoteSessionInfo {
            session_id: self.id.clone(),
            kind: self.kind.clone(),
            display_name: self.display_name.clone(),
            host: self.host.clone(),
            remote_path: self.remote_path.clone(),
            caps: self.fs.caps(),
            vault_handle: format!("remote:{}", self.id),
        }
    }
}

pub struct RemoteRegistry {
    inner: Mutex<HashMap<String, Arc<RemoteSession>>>,
}

impl Default for RemoteRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl RemoteRegistry {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    pub async fn get(&self, session_id: &str) -> Result<Arc<RemoteSession>, AppError> {
        self.inner
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| AppError::message(format!("remote session not found: {session_id}")))
    }

    pub async fn disconnect(&self, session_id: &str) -> Result<(), AppError> {
        let session = {
            let mut map = self.inner.lock().await;
            map.remove(session_id).ok_or_else(|| {
                AppError::message(format!("remote session not found: {session_id}"))
            })?
        };
        // Best-effort catalog push before drop
        {
            let mut cat = session.catalog.lock().await;
            let _ = cat.push(session.fs.clone()).await;
        }
        let _ = std::fs::remove_dir_all(&session.work_root);
        // Keep blob cache for LRU reuse; optional cleanup of empty parent
        Ok(())
    }

    pub async fn connect(
        &self,
        host: &str,
        user: Option<&str>,
        remote_path: &str,
    ) -> Result<RemoteSessionInfo, AppError> {
        let host = host.trim();
        let remote_path = remote_path.trim();
        if host.is_empty() || remote_path.is_empty() {
            return Err(AppError::message("host and remotePath are required"));
        }

        let (kind, fs, display_name): (String, Arc<dyn VaultFs>, String) = if host == LOCAL_SIM_HOST
        {
            let root = PathBuf::from(remote_path);
            if !root.is_dir() {
                return Err(AppError::message(format!(
                    "local-sim path is not a directory: {}",
                    root.display()
                )));
            }
            let display = format!("local-sim:{}", root.display());
            ("local-sim".into(), Arc::new(LocalFs::new(root)), display)
        } else {
            let destination = match user.map(str::trim).filter(|s| !s.is_empty()) {
                Some(u) => format!("{u}@{host}"),
                None => host.to_string(),
            };
            let sftp = SftpFs::connect(&destination, remote_path).await?;
            let display = format!("{destination}:{remote_path}");
            ("ssh".into(), Arc::new(sftp), display)
        };

        let session_id = uuid::Uuid::new_v4().to_string();
        let cache_key = hex::encode(Sha256::digest(format!("{host}\0{remote_path}").as_bytes()));
        let base_cache = dirs::cache_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("agentero")
            .join("remote")
            .join(&cache_key);
        let work_root = base_cache.join("work").join(&session_id);
        let blob_root = base_cache.join("blobs");
        std::fs::create_dir_all(&work_root)?;
        std::fs::create_dir_all(&blob_root)?;

        let catalog = CatalogMirror::checkout(fs.clone(), &work_root).await?;

        let session = Arc::new(RemoteSession {
            id: session_id.clone(),
            host: host.to_string(),
            remote_path: remote_path.to_string(),
            display_name,
            kind,
            fs,
            work_root,
            blob_root,
            catalog: Mutex::new(catalog),
        });

        let info = session.info();
        self.inner.lock().await.insert(session_id, session);
        Ok(info)
    }
}

/// Resolve vault handle `remote:<id>` → session id.
pub fn parse_remote_handle(vault_handle: &str) -> Option<&str> {
    let h = vault_handle.trim();
    h.strip_prefix("remote:").filter(|id| !id.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::fs::WriteOpts;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_vault() -> PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("agentero-remote-sim-{n}"));
        std::fs::create_dir_all(p.join("papers/demo")).unwrap();
        std::fs::create_dir_all(p.join("notes")).unwrap();
        std::fs::write(p.join("AGENTS.md"), "# agents\n").unwrap();
        std::fs::write(p.join("papers/demo/NOTES.md"), "# Demo paper\n\nhello\n").unwrap();
        p
    }

    #[tokio::test]
    async fn local_sim_connect_list_read_write_catalog() {
        let root = tmp_vault();
        let reg = RemoteRegistry::new();
        let info = reg
            .connect(LOCAL_SIM_HOST, None, &root.to_string_lossy())
            .await
            .expect("connect");
        assert_eq!(info.kind, "local-sim");
        assert!(info.vault_handle.starts_with("remote:"));

        let session = reg.get(&info.session_id).await.unwrap();
        let entries = session.fs.list("").await.unwrap();
        assert!(entries.iter().any(|e| e.name == "papers" && e.is_dir));
        assert!(entries.iter().any(|e| e.name == "AGENTS.md" && e.is_file));

        let notes = session.fs.read("papers/demo/NOTES.md").await.unwrap();
        assert!(String::from_utf8_lossy(&notes).contains("Demo paper"));

        session
            .fs
            .write(
                "notes/idea.md",
                b"# idea\n",
                WriteOpts {
                    create_parents: true,
                },
            )
            .await
            .unwrap();
        assert!(root.join("notes/idea.md").is_file());

        // catalog work mirror exists
        assert!(session.work_root.join(".agentero/catalog.sqlite").is_file());
        // and was pushed to "remote" authority
        assert!(root.join(".agentero/catalog.sqlite").is_file());

        reg.disconnect(&info.session_id).await.unwrap();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn parse_handle() {
        assert_eq!(parse_remote_handle("remote:abc"), Some("abc"));
        assert_eq!(parse_remote_handle("/local/path"), None);
    }

    /// Live SSH smoke test (e.g. Host `dgx` in `~/.ssh/config`).
    ///
    /// ```bash
    /// AGENTERO_REMOTE_SSH_HOST=dgx \
    /// AGENTERO_REMOTE_SSH_PATH=/home/phil/agentero-remote-test-vault \
    /// cargo test -p agentero --lib live_ssh_remote_vault -- --ignored --nocapture
    /// ```
    #[tokio::test]
    #[ignore = "set AGENTERO_REMOTE_SSH_HOST + AGENTERO_REMOTE_SSH_PATH for live SSH"]
    async fn live_ssh_remote_vault() {
        use crate::services::fs::WriteOpts;
        use crate::services::remote::agent_exec;

        let host = std::env::var("AGENTERO_REMOTE_SSH_HOST")
            .expect("AGENTERO_REMOTE_SSH_HOST (ssh config Host alias)");
        let path = std::env::var("AGENTERO_REMOTE_SSH_PATH")
            .expect("AGENTERO_REMOTE_SSH_PATH (absolute remote vault path)");
        let user = std::env::var("AGENTERO_REMOTE_SSH_USER").ok();

        eprintln!("connecting host={host} path={path} user={user:?}");
        let reg = RemoteRegistry::new();
        let info = reg
            .connect(&host, user.as_deref(), &path)
            .await
            .expect("remote_connect");
        eprintln!("connected: {:?}", info.display_name);
        assert_eq!(info.kind, "ssh");
        assert!(info.vault_handle.starts_with("remote:"));

        let session = reg.get(&info.session_id).await.expect("session");

        // list root
        let root = session.fs.list("").await.expect("list root");
        eprintln!(
            "root entries: {:?}",
            root.iter().map(|e| &e.name).collect::<Vec<_>>()
        );
        assert!(
            root.iter().any(|e| e.name == "papers" && e.is_dir),
            "expected papers/ on remote"
        );
        assert!(
            root.iter().any(|e| e.name == "AGENTS.md" && e.is_file),
            "expected AGENTS.md"
        );

        // read NOTES
        let notes = session
            .fs
            .read("papers/demo-paper/NOTES.md")
            .await
            .expect("read NOTES");
        let notes_s = String::from_utf8_lossy(&notes);
        eprintln!("NOTES.md:\n{notes_s}");
        assert!(notes_s.contains("Demo Paper") || notes_s.contains("NOTES"));

        // write-through then re-read
        let stamp = chrono::Utc::now().to_rfc3339();
        let body = format!("# remote write test\n\nstamp={stamp}\n");
        session
            .fs
            .write(
                "notes/remote-smoke.md",
                body.as_bytes(),
                WriteOpts {
                    create_parents: true,
                },
            )
            .await
            .expect("write notes/remote-smoke.md");
        let back = session
            .fs
            .read("notes/remote-smoke.md")
            .await
            .expect("re-read smoke");
        assert_eq!(String::from_utf8_lossy(&back), body);

        // catalog work mirror present + paper rescan markers
        assert!(
            session.work_root.join(".agentero/catalog.sqlite").is_file(),
            "work catalog missing"
        );
        // push already done at connect; re-stat remote catalog
        let cat_meta = session
            .fs
            .stat(".agentero/catalog.sqlite")
            .await
            .expect("remote catalog after connect");
        eprintln!(
            "remote catalog size={} mtime={}",
            cat_meta.size, cat_meta.mtime
        );
        assert!(cat_meta.size > 0);

        // paper rescan should find demo-paper and push catalog
        use crate::services::catalog::papers::{self, PaperRecord};
        let papers_list = session.fs.list("papers").await.expect("list papers");
        assert!(
            papers_list
                .iter()
                .any(|e| e.name == "demo-paper" && e.is_dir),
            "demo-paper folder"
        );
        // Minimal rescan: upsert demo-paper into work catalog then push
        let now = chrono::Utc::now().to_rfc3339();
        let rec = PaperRecord {
            path: "papers/demo-paper".into(),
            id: "demo-paper".into(),
            paper_type: "article".into(),
            title: "Demo Paper on DGX".into(),
            authors: vec![],
            creators: None,
            year: None,
            date: None,
            abstract_text: None,
            tags: vec![],
            arxiv_id: None,
            doi: None,
            isbn: None,
            issn: None,
            pmid: None,
            publication: None,
            volume: None,
            issue: None,
            pages: None,
            publisher: None,
            place: None,
            series: None,
            language: None,
            pdf_url: None,
            html_url: None,
            source_url: None,
            body_source: None,
            body_quality: None,
            bibtex_key: None,
            citation_count: None,
            zotero_item_type: None,
            meta_source: Some("live_ssh_test".into()),
            extra: None,
            summary: None,
            status: "unread".into(),
            is_read: false,
            added_at: now.clone(),
            updated_at: now,
        };
        papers::upsert_paper(&session.work_root, &rec).expect("upsert paper");
        {
            let mut cat = session.catalog.lock().await;
            cat.push(session.fs.clone())
                .await
                .expect("push catalog after upsert");
        }
        let listed = papers::list_all(&session.work_root).expect("list catalog");
        eprintln!(
            "catalog papers: {:?}",
            listed.iter().map(|p| &p.path).collect::<Vec<_>>()
        );
        assert!(
            listed.iter().any(|p| p.path == "papers/demo-paper"),
            "demo-paper in catalog"
        );

        // agent discover via ssh which (login shell PATH)
        let dest_for_ssh = host.clone();
        let mut found_any_agent = false;
        for bin in ["claude", "codex", "opencode", "claude-agent-acp", "grok"] {
            match agent_exec::remote_which(&dest_for_ssh, bin).await {
                Ok(Some(p)) => {
                    eprintln!("remote which {bin} -> {p}");
                    found_any_agent = true;
                }
                Ok(None) => eprintln!("remote which {bin} -> (not found)"),
                Err(e) => eprintln!("remote which {bin} err: {e}"),
            }
        }
        assert!(
            found_any_agent,
            "expected at least one agent binary on remote PATH (login shell)"
        );

        reg.disconnect(&info.session_id).await.expect("disconnect");
        eprintln!("disconnect ok");
    }
}
