//! Map Connector `saveItems` payloads into Vault papers (reuse lookup pipeline).

use crate::error::AppError;
use crate::services::catalog::papers;
use crate::services::lookup::{
    enrich_remote_urls, ensure_paper_assets, looks_mostly_cjk, map_zotero_item,
    normalize_parent_dir, paper_record_from_meta, write_paper_shell_opts,
};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
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

/// Import one Zotero-shaped item JSON into the vault.
///
/// Returns as soon as catalog + NOTES shell are written. PDF / TeX / PAPER.md
/// download runs in a background task so the official Connector (≈15s timeout)
/// does not hang or fail on slow network / abstract MT.
pub async fn import_connector_item(
    vault: &Path,
    parent_dir: &str,
    item: &Value,
    page_uri: Option<&str>,
) -> Result<ConnectorImportResult, AppError> {
    let parent_rel = normalize_parent_dir(parent_dir)?;
    let connector_item_id = item.get("id").cloned().unwrap_or(Value::Null);
    let item_type = item
        .get("itemType")
        .and_then(|v| v.as_str())
        .unwrap_or("journalArticle")
        .to_string();

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

    // Prefer a PDF attachment URL surfaced by the browser connector when the
    // translator gave none — ACM/IEEE et al. often only expose the PDF through
    // the page the user is on, which the connector captures as an attachment.
    if meta.pdf_url.as_deref().map(str::is_empty).unwrap_or(true) {
        meta.pdf_url = pdf_attachment_url(item);
    }

    let id = meta.id.clone();
    if id.is_empty() {
        return Err(AppError::message("resolved metadata has empty id"));
    }

    // Dedup by catalog id
    if let Ok(Some(existing)) = papers::get_by_id(vault, &id) {
        return Ok(ConnectorImportResult {
            path: existing.path,
            id: existing.id,
            title: existing.title,
            deduped: true,
            connector_item_id,
            item_type,
        });
    }

    let path_rel = unique_paper_path(vault, &parent_rel, &id)?;
    let paper_dir = vault.join(&path_rel);
    fs::create_dir_all(&paper_dir)?;

    // Fresh timestamps for this import
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    meta.added_at = now.clone();
    meta.updated_at = now;
    // Keep folder id as path segment (may differ if unique_paper_path added suffix)
    let folder_id = path_rel.rsplit('/').next().unwrap_or(&id).to_string();
    if folder_id != meta.id {
        meta.id = folder_id.clone();
    }

    // No abstract MT here — free MT can exceed the Connector's 15s request timeout.
    write_paper_shell_opts(&paper_dir, &meta, false).await?;
    let created_at = fs::metadata(paper_dir.join("NOTES.md"))
        .and_then(|m| m.modified())
        .ok();
    let record = paper_record_from_meta(&path_rel, &meta);
    papers::upsert_paper(vault, &record)?;

    // Translate the abstract to Chinese in the background (the synchronous shell
    // write above skips MT to stay within the Connector's 15s timeout). Guarded
    // by NOTES.md mtime so a user edit is never overwritten.
    if let Some(abstract_text) = meta.abstract_text.clone() {
        let abs = abstract_text.trim().to_string();
        if !abs.is_empty() && !looks_mostly_cjk(&abs) {
            let notes_path = paper_dir.join("NOTES.md");
            tauri::async_runtime::spawn(async move {
                translate_notes_abstract(notes_path, abs, created_at).await;
            });
        }
    }

    schedule_asset_download(
        vault.to_path_buf(),
        path_rel.clone(),
        paper_dir,
        meta.id.clone(),
        meta.arxiv_id.clone(),
        meta.pdf_url.clone(),
        meta.doi.clone(),
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

/// Fire-and-forget PDF / TeX / PAPER.md fetch after HTTP 201 is free to return.
fn schedule_asset_download(
    vault: PathBuf,
    path_rel: String,
    paper_dir: PathBuf,
    id: String,
    arxiv_id: Option<String>,
    pdf_url: Option<String>,
    doi: Option<String>,
) {
    tauri::async_runtime::spawn(async move {
        let _ = ensure_paper_assets(
            &paper_dir,
            &id,
            arxiv_id.as_deref(),
            pdf_url.as_deref(),
            doi.as_deref(),
        )
        .await;
        let _ = crate::services::pdf_parse::maybe_generate_paper_md_after_download(
            &vault, &path_rel, &paper_dir,
        )
        .await;
    });
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
    use crate::services::translate::{translate_text, TranslateTextArgs, MAX_TEXT_CHARS};

    // User edited the note after the shell was written → leave it alone.
    if let (Some(created), Ok(meta)) = (created, fs::metadata(&notes_path)) {
        if meta.modified().map(|m| m > created).unwrap_or(false) {
            return;
        }
    }

    let slice: String = abstract_text.chars().take(MAX_TEXT_CHARS).collect();
    let mut translated: Option<String> = None;
    for provider in [
        "googleapi",
        "bing",
        "youdao",
        "huoshanweb",
        "tencenttransmart",
    ] {
        if let Ok(r) = translate_text(TranslateTextArgs {
            text: slice.clone(),
            source_lang: "auto".into(),
            target_lang: "zh-CN".into(),
            provider: provider.into(),
            free_base_url: None,
            timeout_ms: Some(15_000),
        })
        .await
        {
            let t = r.text.trim().to_string();
            if !t.is_empty() {
                translated = Some(t);
                break;
            }
        }
    }
    let Some(translated) = translated else {
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

fn unique_paper_path(vault: &Path, parent_rel: &str, id: &str) -> Result<String, AppError> {
    let base = format!("{parent_rel}/{id}").replace('\\', "/");
    let candidate = vault.join(&base);
    if !candidate.exists() {
        return Ok(base);
    }
    // If catalog already has this path, treat as collision on disk only.
    for n in 2..50 {
        let alt = format!("{parent_rel}/{id}-{n}").replace('\\', "/");
        if !vault.join(&alt).exists() {
            return Ok(alt);
        }
    }
    Err(AppError::message("could not allocate unique paper path"))
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
