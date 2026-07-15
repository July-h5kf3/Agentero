//! Magic-wand identifier lookup via Translator Runtime (placeholder base URL).
//!
//! @see docs/backend/identifier-lookup.md

mod map;
mod parse;

use crate::error::AppError;
use map::{enrich_remote_urls, map_zotero_item, PaperMeta};
use parse::{extract_primary_identifier, IdentifierKind};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Default Translator Runtime base URL (hosted service).
/// Override via Settings → `translatorBaseUrl` / `LookupImportArgs.translator_base_url`.
pub const DEFAULT_TRANSLATOR_BASE_URL: &str = "https://translator.poco-ai.com";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupImportArgs {
    pub vault_path: String,
    /// Vault-relative parent, e.g. `papers` or `papers/nlp`.
    pub parent_dir: String,
    pub text: String,
    #[serde(default)]
    pub download_fulltext_to_local: bool,
    /// Optional override; empty → [`DEFAULT_TRANSLATOR_BASE_URL`].
    #[serde(default)]
    pub translator_base_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupImportResult {
    pub paper_dir: String,
    pub path: String,
    pub id: String,
    pub title: String,
    pub used_translator: bool,
    pub translator_base_url: String,
}

pub async fn import_by_identifier(args: LookupImportArgs) -> Result<LookupImportResult, AppError> {
    let vault = PathBuf::from(args.vault_path.trim());
    if !vault.is_dir() {
        return Err(AppError::message("vault path is not a directory"));
    }

    let parent_rel = normalize_parent_dir(&args.parent_dir)?;
    let base = args
        .translator_base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_TRANSLATOR_BASE_URL)
        .trim_end_matches('/')
        .to_string();

    let text = args.text.trim();
    if text.is_empty() {
        return Err(AppError::message("identifier text is empty"));
    }

    let (mut meta, used_translator) = resolve_metadata(text, &base).await?;
    enrich_remote_urls(&mut meta);

    let id = meta.id.clone();
    if id.is_empty() {
        return Err(AppError::message("resolved metadata has empty id"));
    }

    let paper_dir = vault.join(&parent_rel).join(&id);
    fs::create_dir_all(&paper_dir)?;

    write_paper_shell(&paper_dir, &meta)?;

    // Download policy: no preview URL → always try; has preview → only if setting on
    let has_preview = non_empty(&meta.pdf_url) || non_empty(&meta.html_url);
    let should_download = !has_preview || args.download_fulltext_to_local;
    if should_download {
        if let Some(url) = meta
            .pdf_url
            .as_deref()
            .filter(|u| !u.is_empty())
            .or(meta.html_url.as_deref().filter(|u| !u.is_empty()))
        {
            let _ = download_to_source(&paper_dir, &id, url).await;
        }
    }

    // Transition metadata.json (catalog upsert can replace later)
    let meta_path = paper_dir.join("metadata.json");
    let json = serde_json::to_string_pretty(&meta).map_err(AppError::from)?;
    fs::write(meta_path, format!("{json}\n"))?;

    let paper_dir_str = paper_dir.to_string_lossy().to_string();
    let path_rel = format!("{parent_rel}/{id}").replace('\\', "/");

    Ok(LookupImportResult {
        paper_dir: paper_dir_str,
        path: path_rel,
        id: meta.id,
        title: meta.title,
        used_translator,
        translator_base_url: base,
    })
}

async fn resolve_metadata(
    text: &str,
    translator_base: &str,
) -> Result<(PaperMeta, bool), AppError> {
    // Prefer Translator Runtime (placeholder URL)
    match translator_fetch(text, translator_base).await {
        Ok(meta) => Ok((meta, true)),
        Err(e) => {
            // Fall back for arXiv so local dev works without sidecar
            if let Some(aid) = parse::extract_arxiv_id(text) {
                let meta = fetch_arxiv_metadata(&aid).await?;
                Ok((meta, false))
            } else {
                Err(AppError::message(format!(
                    "translator unreachable at {translator_base} ({e}); only arXiv fallback is available without Runtime"
                )))
            }
        }
    }
}

async fn translator_fetch(text: &str, base: &str) -> Result<PaperMeta, AppError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("motif-lookup/0.1 (+https://github.com/poco-ai/motif)")
        .build()
        .map_err(|e| AppError::message(format!("http client: {e}")))?;

    let ident = extract_primary_identifier(text);
    let (endpoint, body) = match &ident {
        Some((IdentifierKind::Url, url)) => (format!("{base}/web"), url.clone()),
        Some((_, value)) => (format!("{base}/search"), value.clone()),
        None => {
            // Treat as search raw text / possible URL
            if text.starts_with("http://") || text.starts_with("https://") {
                (format!("{base}/web"), text.to_string())
            } else {
                (format!("{base}/search"), text.to_string())
            }
        }
    };

    let res = client
        .post(&endpoint)
        .header("Content-Type", "text/plain")
        .body(body)
        .send()
        .await
        .map_err(|e| AppError::message(format!("translator request failed: {e}")))?;

    let status = res.status();
    let bytes = res
        .bytes()
        .await
        .map_err(|e| AppError::message(format!("translator read body: {e}")))?;

    if status.as_u16() == 300 {
        return Err(AppError::message(
            "translator returned multiple choices; pick a single paper URL/id",
        ));
    }
    if !status.is_success() {
        let snippet = String::from_utf8_lossy(&bytes);
        let short: String = snippet.chars().take(200).collect();
        return Err(AppError::message(format!(
            "translator HTTP {status}: {short}"
        )));
    }

    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|e| AppError::message(format!("translator JSON: {e}")))?;

    let item = if value.is_array() {
        value
            .as_array()
            .and_then(|a| a.first())
            .cloned()
            .ok_or_else(|| AppError::message("translator returned empty items array"))?
    } else if value.is_object() {
        // Some servers return a single object
        value
    } else {
        return Err(AppError::message("unexpected translator response shape"));
    };

    map_zotero_item(&item)
}

async fn fetch_arxiv_metadata(arxiv_id: &str) -> Result<PaperMeta, AppError> {
    let bare = regex_lite_strip_version(arxiv_id);
    let api = format!(
        "https://export.arxiv.org/api/query?id_list={}",
        urlencoding_encode(&bare)
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("motif-lookup/0.1")
        .build()
        .map_err(|e| AppError::message(format!("http client: {e}")))?;
    let xml = client
        .get(&api)
        .send()
        .await
        .map_err(|e| AppError::message(format!("arXiv API: {e}")))?
        .text()
        .await
        .map_err(|e| AppError::message(format!("arXiv body: {e}")))?;

    map::map_arxiv_atom(&xml, &bare)
}

fn regex_lite_strip_version(id: &str) -> String {
    let s = id
        .trim()
        .trim_start_matches("arXiv:")
        .trim_start_matches("arxiv:");
    // strip trailing vN
    if let Some(i) = s.rfind('v') {
        if s[i + 1..].chars().all(|c| c.is_ascii_digit()) && i > 0 {
            return s[..i].to_string();
        }
    }
    s.to_string()
}

fn urlencoding_encode(s: &str) -> String {
    // minimal encode for arxiv ids
    s.replace('/', "%2F")
}

fn write_paper_shell(paper_dir: &Path, meta: &PaperMeta) -> Result<(), AppError> {
    let notes = format!(
        "# {}\n\n{}\n",
        meta.title,
        meta.abstract_text
            .as_deref()
            .map(|a| format!("> {a}\n\n"))
            .unwrap_or_default()
    );
    fs::write(paper_dir.join("NOTES.md"), notes)?;
    fs::write(paper_dir.join("highlights.md"), "")?;
    Ok(())
}

async fn download_to_source(paper_dir: &Path, id: &str, url: &str) -> Result<(), AppError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .user_agent("motif-lookup/0.1")
        .build()
        .map_err(|e| AppError::message(format!("http client: {e}")))?;
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::message(format!("download: {e}")))?;
    if !res.status().is_success() {
        return Err(AppError::message(format!("download HTTP {}", res.status())));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| AppError::message(format!("download body: {e}")))?;
    let source = paper_dir.join("source");
    fs::create_dir_all(&source)?;
    let name = if url.contains(".pdf") || url.contains("/pdf/") {
        format!("{id}.pdf")
    } else {
        format!("{id}.bin")
    };
    fs::write(source.join(name), bytes)?;
    Ok(())
}

fn normalize_parent_dir(raw: &str) -> Result<String, AppError> {
    let s = raw.trim().replace('\\', "/").trim_matches('/').to_string();
    if s.is_empty() {
        return Ok("papers".into());
    }
    if s == "papers" || s.starts_with("papers/") {
        // reject path traversal
        if s.split('/').any(|p| p == ".." || p.is_empty()) {
            return Err(AppError::message("invalid parent_dir"));
        }
        return Ok(s);
    }
    Err(AppError::message(
        "parent_dir must be papers or under papers/",
    ))
}

fn non_empty(s: &Option<String>) -> bool {
    s.as_ref().is_some_and(|v| !v.trim().is_empty())
}
