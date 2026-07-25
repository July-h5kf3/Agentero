//! Map Connector `saveItems` payloads into Vault papers (reuse lookup pipeline).

use crate::core::error::AppError;
use crate::core::fs::WriteOpts;
use crate::features::catalog::papers;
use crate::features::connector::{ConnectorController, ConnectorProgress};
use crate::features::import::{
    enrich_remote_urls, ensure_paper_assets_with_cookies, free_mt_to_zh, looks_mostly_cjk,
    map_zotero_item, normalize_parent_dir, paper_record_from_meta, write_paper_shell_opts,
    PaperMeta,
};
use crate::features::remote::import_bridge::{unique_remote_paper_path, upload_tree};
use crate::features::remote::RemoteSession;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

#[derive(Debug, Clone)]
pub struct ConnectorImportResult {
    pub path: String,
    pub id: String,
    pub title: String,
    pub deduped: bool,
    pub connector_item_id: Value,
    pub item_type: String,
}

pub async fn import_connector_item_with_cookies(
    ctrl: Arc<ConnectorController>,
    session_id: &str,
    vault: &Path,
    parent_dir: &str,
    item: &Value,
    page_uri: Option<&str>,
    cookies: Option<&str>,
) -> Result<ConnectorImportResult, AppError> {
    use crate::features::import::paper_import::{
        paper_commit, AssetsPolicy, CommitStatus, DedupePolicy, PaperCommitOptions,
    };

    let connector_item_id = item.get("id").cloned().unwrap_or(Value::Null);
    let item_type = item
        .get("itemType")
        .and_then(|v| v.as_str())
        .unwrap_or("journalArticle")
        .to_string();

    let meta = connector_paper_meta(item, page_uri)?;
    let (abstract_text, arxiv_id, pdf_url, doi) = (
        meta.abstract_text.clone(),
        meta.arxiv_id.clone(),
        meta.pdf_url.clone(),
        meta.doi.clone(),
    );

    // No abstract MT and no awaited downloads — the browser extension's HTTP
    // request must finish within ~15s, so assets stay Deferred.
    let commit = paper_commit(
        meta,
        PaperCommitOptions {
            vault,
            parent_dir,
            dedupe: DedupePolicy::ByCatalogId,
            assets: AssetsPolicy::Deferred,
            translate_abstract: false,
            fresh_timestamps: true,
        },
    )
    .await?;

    if commit.status == CommitStatus::Deduped {
        return Ok(ConnectorImportResult {
            path: commit.path,
            id: commit.id,
            title: commit.title,
            deduped: true,
            connector_item_id,
            item_type,
        });
    }

    let paper_dir = PathBuf::from(&commit.paper_dir);

    // Translate the abstract to Chinese in the background (the synchronous shell
    // write above skips MT to stay within the Connector's 15s timeout). Guarded
    // by NOTES.md mtime so a user edit is never overwritten.
    let created_at = fs::metadata(paper_dir.join("NOTES.md"))
        .and_then(|m| m.modified())
        .ok();
    if let Some(abstract_text) = abstract_text {
        let abs = abstract_text.trim().to_string();
        if !abs.is_empty() && !looks_mostly_cjk(&abs) {
            let notes_path = paper_dir.join("NOTES.md");
            tauri::async_runtime::spawn(async move {
                translate_notes_abstract(notes_path, abs, created_at).await;
            });
        }
    }

    schedule_asset_download_with_cookies(
        Some(ctrl),
        session_id,
        &commit.title,
        vault.to_path_buf(),
        commit.path.clone(),
        paper_dir,
        commit.id.clone(),
        arxiv_id,
        pdf_url,
        doi,
        cookies.map(str::to_string),
        None,
    );

    Ok(ConnectorImportResult {
        path: commit.path,
        id: commit.id,
        title: commit.title,
        deduped: false,
        connector_item_id,
        item_type,
    })
}

/// Background asset download + liteparse with connector progress events.
/// With `remote` set, the staged tree is uploaded after parsing (remote vault).
#[allow(clippy::too_many_arguments)]
fn schedule_asset_download_with_cookies(
    ctrl: Option<Arc<ConnectorController>>,
    session_id: &str,
    title: &str,
    vault_root: PathBuf,
    path_rel: String,
    paper_dir: PathBuf,
    id: String,
    arxiv_id: Option<String>,
    pdf_url: Option<String>,
    doi: Option<String>,
    cookies: Option<String>,
    remote: Option<Arc<RemoteSession>>,
) {
    let session_id = session_id.to_string();
    let title = title.to_string();
    let path_key = path_rel.clone();
    tauri::async_runtime::spawn(async move {
        let emit = |status: &str, detail: &str, error: Option<String>| {
            if let Some(ctrl) = ctrl.as_ref() {
                ctrl.emit_progress(ConnectorProgress {
                    key: format!("{session_id}:{path_key}"),
                    session_id: session_id.clone(),
                    path: path_key.clone(),
                    title: title.clone(),
                    status: status.into(),
                    progress: None,
                    detail: Some(detail.into()),
                    error,
                });
            }
        };
        emit("running", "Downloading paper assets", None);
        let assets = ensure_paper_assets_with_cookies(
            &paper_dir,
            &id,
            arxiv_id.as_deref(),
            pdf_url.as_deref(),
            doi.as_deref(),
            cookies.as_deref(),
        )
        .await;
        emit("running", "Generating readable paper text", None);
        let parse = crate::features::import::pdf_parse::maybe_generate_paper_md_after_download(
            &vault_root,
            &path_rel,
            &paper_dir,
        )
        .await;
        let upload = match &remote {
            Some(session) => upload_tree(session.fs.as_ref(), &paper_dir, &path_rel).await,
            None => Ok(()),
        };
        let error = match (&assets, &parse, &upload) {
            (Err(e), _, _) => Some(e.to_string()),
            (_, p, _) if !p.messages.is_empty() && !p.paper_md => Some(p.messages.join("; ")),
            (_, _, Err(e)) => Some(e.to_string()),
            _ => None,
        };
        if error.is_some() {
            emit("failed", "Asset download failed", error);
        } else {
            emit("completed", "Assets ready", None);
        }
    });
}

/// Remote vault variant: stage shell → SFTP → catalog push; assets in background.
pub async fn import_connector_item_remote_with_cookies(
    ctrl: Arc<ConnectorController>,
    session_id: &str,
    session: Arc<RemoteSession>,
    parent_dir: &str,
    item: &Value,
    page_uri: Option<&str>,
    cookies: Option<&str>,
) -> Result<ConnectorImportResult, AppError> {
    let parent_rel = normalize_parent_dir(parent_dir)?;
    let connector_item_id = item.get("id").cloned().unwrap_or(Value::Null);
    let item_type = item
        .get("itemType")
        .and_then(|v| v.as_str())
        .unwrap_or("journalArticle")
        .to_string();

    let mut meta = connector_paper_meta(item, page_uri)?;

    let id = meta.id.clone();
    if id.is_empty() {
        return Err(AppError::message("resolved metadata has empty id"));
    }

    if let Ok(Some(existing)) = papers::get_by_id(&session.work_root, &id) {
        return Ok(ConnectorImportResult {
            path: existing.path,
            id: existing.id,
            title: existing.title,
            deduped: true,
            connector_item_id,
            item_type,
        });
    }

    let (folder_id, path_rel) =
        unique_remote_paper_path(session.fs.as_ref(), &parent_rel, &id).await?;
    meta.id = folder_id.clone();
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    meta.added_at = now.clone();
    meta.updated_at = now;

    let staging = session.work_root.join(&path_rel);
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    fs::create_dir_all(&staging)?;
    write_paper_shell_opts(&staging, &meta, false).await?;
    let record = paper_record_from_meta(&path_rel, &meta);
    papers::upsert_paper(&session.work_root, &record)?;

    // Shell only first so Connector HTTP stays under timeout.
    upload_tree(session.fs.as_ref(), &staging, &path_rel).await?;
    {
        let mut cat = session.catalog.lock().await;
        cat.push(session.fs.clone()).await?;
    }

    schedule_asset_download_with_cookies(
        Some(ctrl),
        session_id,
        &meta.title,
        session.work_root.clone(),
        path_rel.clone(),
        staging,
        meta.id.clone(),
        meta.arxiv_id.clone(),
        meta.pdf_url.clone(),
        meta.doi.clone(),
        cookies.map(str::to_string),
        Some(session.clone()),
    );

    Ok(ConnectorImportResult {
        path: path_rel,
        id: meta.id,
        title: meta.title,
        deduped: false,
        connector_item_id,
        item_type,
    })
}

/// Store a SingleFile HTML snapshot inside a paper unit.
pub async fn write_snapshot_html(
    vault: &Path,
    paper_rel: &str,
    html: &str,
) -> Result<String, AppError> {
    let rel = paper_rel.trim().trim_matches('/').replace('\\', "/");
    if rel.is_empty() {
        return Err(AppError::message("paper folder missing"));
    }
    let dir = vault.join(&rel);
    if !dir.is_dir() {
        return Err(AppError::message("paper folder missing"));
    }
    fs::write(dir.join("snapshot.html"), html.as_bytes())?;
    Ok(format!("{rel}/snapshot.html"))
}

pub async fn write_snapshot_html_remote(
    session: Arc<RemoteSession>,
    paper_rel: &str,
    html: &str,
) -> Result<String, AppError> {
    let rel = paper_rel.trim().trim_matches('/').replace('\\', "/");
    if rel.is_empty() || !session.fs.exists(&rel).await? {
        return Err(AppError::message("paper folder missing"));
    }
    let path = format!("{rel}/snapshot.html");
    session
        .fs
        .write(
            &path,
            html.as_bytes(),
            WriteOpts {
                create_parents: true,
            },
        )
        .await?;
    Ok(path)
}

/// Write browser-uploaded PDF into a remote paper folder and best-effort PAPER.md.
pub async fn write_attachment_pdf_remote(
    session: Arc<RemoteSession>,
    paper_rel: &str,
    bytes: &[u8],
) -> Result<String, AppError> {
    if bytes.len() < 4 || &bytes[..4] != b"%PDF" {
        return Err(AppError::message("uploaded attachment is not a PDF"));
    }
    let rel = paper_rel.trim().trim_matches('/').replace('\\', "/");
    if rel.is_empty() || !session.fs.exists(&rel).await? {
        return Err(AppError::message("paper folder missing"));
    }
    let id = rel.rsplit('/').next().unwrap_or("paper").to_string();
    let pdf_rel = format!("{rel}/{id}.pdf");
    session
        .fs
        .write(
            &pdf_rel,
            bytes,
            WriteOpts {
                create_parents: true,
            },
        )
        .await?;

    // Stage for liteparse then push PAPER.md if generated.
    let staging = session.work_root.join(&rel);
    let _ = fs::create_dir_all(&staging);
    let _ = fs::write(staging.join(format!("{id}.pdf")), bytes);
    let session_bg = session.clone();
    let rel_bg = rel.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::features::import::pdf_parse::maybe_generate_paper_md_after_download(
            &session_bg.work_root,
            &rel_bg,
            &session_bg.work_root.join(&rel_bg),
        )
        .await;
        let paper_md = session_bg.work_root.join(&rel_bg).join("PAPER.md");
        if paper_md.is_file() {
            if let Ok(md) = fs::read(&paper_md) {
                let _ = session_bg
                    .fs
                    .write(
                        &format!("{rel_bg}/PAPER.md"),
                        &md,
                        WriteOpts {
                            create_parents: true,
                        },
                    )
                    .await;
            }
        }
    });

    Ok(rel)
}

/// List org folders under remote `papers/` for the Connector collection picker.
pub async fn list_save_targets_remote(
    session: &RemoteSession,
) -> Vec<crate::features::connector::targets::SaveTarget> {
    use crate::features::connector::targets::SaveTarget;
    let mut out = vec![SaveTarget {
        id: "L1".into(),
        name: "papers".into(),
        level: 0,
    }];
    walk_remote_org(session, "papers", 1, &mut out).await;
    out
}

async fn walk_remote_org(
    session: &RemoteSession,
    rel: &str,
    level: u32,
    out: &mut Vec<crate::features::connector::targets::SaveTarget>,
) {
    if level > 12 {
        return;
    }
    let Ok(entries) = session.fs.list(rel).await else {
        return;
    };
    let mut dirs: Vec<String> = entries
        .into_iter()
        .filter(|e| e.is_dir && !e.name.starts_with('.'))
        .map(|e| e.name)
        .collect();
    dirs.sort_by_key(|a| a.to_lowercase());
    for name in dirs {
        let child = format!("{rel}/{name}");
        // Paper unit heuristic: NOTES.md / metadata.json / {stem}.pdf
        let is_paper = session
            .fs
            .exists(&format!("{child}/NOTES.md"))
            .await
            .unwrap_or(false)
            || session
                .fs
                .exists(&format!("{child}/metadata.json"))
                .await
                .unwrap_or(false)
            || session
                .fs
                .exists(&format!("{child}/{name}.pdf"))
                .await
                .unwrap_or(false);
        if is_paper {
            continue;
        }
        out.push(crate::features::connector::targets::SaveTarget {
            id: format!("D{child}"),
            name: name.clone(),
            level,
        });
        Box::pin(walk_remote_org(session, &child, level + 1, out)).await;
    }
}

/// Move a remote paper folder under a new org parent + catalog path rewrite.
pub async fn move_paper_folder_remote(
    session: &RemoteSession,
    from_rel: &str,
    dest_parent: &str,
) -> Result<String, AppError> {
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
    if !session.fs.exists(&from).await? {
        return Err(AppError::message(format!("paper folder missing: {from}")));
    }
    if session.fs.exists(&new_rel).await? {
        return Err(AppError::message(format!(
            "destination already exists: {new_rel}"
        )));
    }
    let _ = session.fs.mkdir(&dest_parent).await;
    session.fs.rename(&from, &new_rel).await?;
    let _ = papers::move_under_path(&session.work_root, &from, &new_rel);
    {
        let mut cat = session.catalog.lock().await;
        cat.push(session.fs.clone()).await?;
    }
    Ok(new_rel)
}

/// Map a connector item and apply connector-specific meta fixups: tag the
/// source, fall back to the captured page URI for source/html URLs, and prefer
/// a browser-captured PDF attachment URL when the translator gave none —
/// ACM/IEEE et al. often only expose the PDF through the page the user is on.
fn connector_paper_meta(item: &Value, page_uri: Option<&str>) -> Result<PaperMeta, AppError> {
    let mut meta = map_zotero_item(item)?;
    meta.meta_source = Some("zotero-connector".into());
    if meta.source_url.is_none() {
        if let Some(uri) = page_uri.filter(|s| !s.is_empty()) {
            meta.source_url = Some(uri.to_string());
        }
    }
    if meta.html_url.is_none() {
        meta.html_url = meta.source_url.clone();
    }
    enrich_remote_urls(&mut meta);
    if meta.pdf_url.as_deref().map(str::is_empty).unwrap_or(true) {
        meta.pdf_url = pdf_attachment_url(item);
    }
    Ok(meta)
}

/// First PDF attachment URL from a connector item (browser-captured PDF link).
fn pdf_attachment_url(item: &Value) -> Option<String> {
    let atts = item.get("attachments").and_then(|v| v.as_array())?;
    for a in atts {
        let mime = a
            .get("mimeType")
            .or_else(|| a.get("contentType"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let url = a.get("url").and_then(|v| v.as_str()).unwrap_or("").trim();
        if url.is_empty() {
            continue;
        }
        if mime.contains("pdf") || url.to_ascii_lowercase().ends_with(".pdf") {
            return Some(url.to_string());
        }
    }
    None
}

/// Translate the abstract to Chinese and replace the leading `> ` blockquote in
/// NOTES.md. Skips when the file was edited after `created` (mtime guard) or the
/// blockquote was already changed, so user notes are never overwritten.
async fn translate_notes_abstract(
    notes_path: PathBuf,
    abstract_text: String,
    created: Option<SystemTime>,
) {
    // User edited the note after the shell was written → leave it alone.
    if let (Some(created), Ok(meta)) = (created, fs::metadata(&notes_path)) {
        if meta.modified().map(|m| m > created).unwrap_or(false) {
            return;
        }
    }

    let Some(translated) = free_mt_to_zh(&abstract_text).await else {
        return;
    };

    let Ok(content) = fs::read_to_string(&notes_path) else {
        return;
    };
    let original_q = format!("> {}", abstract_text.trim());
    let translated_q = format!("> {translated}");
    // Only swap the still-untouched abstract blockquote.
    if !content.contains(&original_q) || content.contains(&translated_q) {
        return;
    }
    let mut out = Vec::new();
    let mut replaced = false;
    for line in content.lines() {
        if !replaced && line.trim() == original_q.trim() {
            out.push(translated_q.clone());
            replaced = true;
        } else {
            out.push(line.to_string());
        }
    }
    if replaced {
        let _ = fs::write(&notes_path, out.join("\n"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn map_sample_arxiv_item() {
        let item = json!({
            "itemType": "preprint",
            "title": "Attention Is All You Need",
            "creators": [
                {"creatorType": "author", "firstName": "Ashish", "lastName": "Vaswani"}
            ],
            "url": "https://arxiv.org/abs/1706.03762",
            "DOI": "10.48550/arXiv.1706.03762",
            "abstractNote": "The dominant sequence transduction models…",
            "attachments": [{
                "title": "PDF",
                "mimeType": "application/pdf",
                "url": "https://arxiv.org/pdf/1706.03762"
            }]
        });
        let meta = map_zotero_item(&item).expect("map");
        assert!(meta.arxiv_id.is_some() || meta.doi.is_some());
        assert!(!meta.title.is_empty());
    }
}
