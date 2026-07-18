//! Map Connector `saveItems` payloads into Vault papers (reuse lookup pipeline).

use crate::error::AppError;
use crate::services::catalog::papers;
use crate::services::lookup::{
    enrich_remote_urls, ensure_paper_assets, map_zotero_item, normalize_parent_dir,
    paper_record_from_meta, write_paper_shell,
};
use serde_json::Value;
use std::fs;
use std::path::Path;

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

    write_paper_shell(&paper_dir, &meta).await?;
    let record = paper_record_from_meta(&path_rel, &meta);
    papers::upsert_paper(vault, &record)?;

    // Best-effort assets (do not fail the whole save)
    let _ = ensure_paper_assets(
        &paper_dir,
        &meta.id,
        meta.arxiv_id.as_deref(),
        meta.pdf_url.as_deref(),
        meta.doi.as_deref(),
    )
    .await;
    let _ = crate::services::pdf_parse::maybe_generate_paper_md_after_download(
        vault, &path_rel, &paper_dir,
    )
    .await;

    Ok(ConnectorImportResult {
        path: path_rel,
        id: meta.id,
        title: meta.title,
        deduped: false,
        connector_item_id,
        item_type,
    })
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
