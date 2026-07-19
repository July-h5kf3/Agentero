//! Magic-wand identifier lookup via Translator Runtime (placeholder base URL).
//!
//! @see docs/backend/identifier-lookup.md

mod assets;
mod map;
mod parse;
mod zotero_db;
mod zotero_io;

pub use assets::{ensure_paper_assets, has_local_pdf, has_local_tex, AssetDownloadResult};
pub use map::{enrich_remote_urls, map_zotero_item, PaperMeta};
pub use zotero_db::{
    migrate_zotero, scan_zotero, MigrateProgress, ZoteroMigrateArgs, ZoteroMigrateResult,
    ZoteroScan, ZoteroScanArgs,
};
pub use zotero_io::{
    export_catalog, import_catalog, PaperExportArgs, PaperExportResult, PaperImportArgs,
    PaperImportResult,
};

use crate::error::AppError;
use crate::services::catalog::papers::{self, PaperRecord};
use map::local_pdf_meta;
use parse::{extract_primary_identifier, IdentifierKind};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Default Translator Runtime base URL (hosted service).
/// Override via Settings → `translatorBaseUrl` / `LookupImportArgs.translator_base_url`.
pub const DEFAULT_TRANSLATOR_BASE_URL: &str = "https://translator.philfan.cn";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookupImportArgs {
    pub vault_path: String,
    /// Vault-relative parent, e.g. `papers` or `papers/nlp`.
    pub parent_dir: String,
    pub text: String,
    /// Optional override; empty → [`DEFAULT_TRANSLATOR_BASE_URL`].
    #[serde(default)]
    pub translator_base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperDownloadAssetsArgs {
    pub vault_path: String,
    /// Vault-relative paper folder, e.g. `papers/1706.03762`.
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportLocalPdfArgs {
    pub vault_path: String,
    /// Vault-relative parent, e.g. `papers` or `papers/nlp`.
    pub parent_dir: String,
    /// Absolute paths to local PDF files chosen by the user.
    pub file_paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportLocalPdfResult {
    /// One entry per successfully imported PDF.
    pub papers: Vec<LookupImportResult>,
    /// `"<file>: <reason>"` for each file that failed to import.
    #[serde(default)]
    pub errors: Vec<String>,
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
    /// Whether local PDF was present after import download attempt.
    #[serde(default)]
    pub pdf: bool,
    /// Whether local TeX was present after import download attempt.
    #[serde(default)]
    pub tex: bool,
    /// Whether PAPER.md was written (no-TeX liteparse path).
    #[serde(default)]
    pub paper_md: bool,
    /// Download / parse messages (for UI warnings).
    #[serde(default)]
    pub asset_messages: Vec<String>,
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

    let path_rel = format!("{parent_rel}/{id}").replace('\\', "/");
    let paper_dir = vault.join(&path_rel);
    fs::create_dir_all(&paper_dir)?;

    write_paper_shell(&paper_dir, &meta).await?;

    // 1) Catalog SQLite is authoritative; metadata.json is a projection
    let record = paper_record_from_meta(&path_rel, &meta);
    papers::upsert_paper(&vault, &record)?;

    // 2) Always download PDF into source/; arXiv also unpacks LaTeX
    // 3) No TeX → liteparse PAPER.md after download
    let mut assets = ensure_paper_assets(
        &paper_dir,
        &id,
        meta.arxiv_id.as_deref(),
        meta.pdf_url.as_deref(),
        meta.doi.as_deref(),
    )
    .await
    .unwrap_or_else(|e| {
        let mut r = AssetDownloadResult::default();
        r.messages.push(format!("asset download error: {e}"));
        r
    });

    let parse = crate::services::pdf_parse::maybe_generate_paper_md_after_download(
        &vault, &path_rel, &paper_dir,
    )
    .await;
    assets.paper_md = parse.paper_md;
    for m in parse.messages {
        assets.messages.push(m);
    }

    let paper_dir_str = paper_dir.to_string_lossy().to_string();

    Ok(LookupImportResult {
        paper_dir: paper_dir_str,
        path: path_rel,
        id: meta.id,
        title: meta.title,
        used_translator,
        translator_base_url: base,
        pdf: assets.pdf,
        tex: assets.tex,
        paper_md: assets.paper_md,
        asset_messages: assets.messages,
    })
}

/// On-demand download of PDF (+ arXiv LaTeX) for an existing paper folder.
pub async fn download_paper_assets(
    args: PaperDownloadAssetsArgs,
) -> Result<AssetDownloadResult, AppError> {
    let vault = PathBuf::from(args.vault_path.trim());
    if !vault.is_dir() {
        return Err(AppError::message("vault path is not a directory"));
    }
    let path_rel = args
        .path
        .trim()
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    if path_rel.is_empty() || path_rel.split('/').any(|p| p == ".." || p.is_empty()) {
        return Err(AppError::message("invalid paper path"));
    }
    let paper_dir = vault.join(&path_rel);
    if !paper_dir.is_dir() {
        return Err(AppError::message("paper folder not found"));
    }

    let (id, arxiv_id, pdf_url, doi) = if let Ok(Some(row)) = papers::get_by_path(&vault, &path_rel)
    {
        (row.id, row.arxiv_id, row.pdf_url, row.doi)
    } else {
        // Fallback: folder name as id; treat as arXiv if it looks like one
        let name = paper_dir
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("paper")
            .to_string();
        let arxiv = parse::extract_arxiv_id(&name);
        let pdf = arxiv
            .as_ref()
            .map(|a| format!("https://arxiv.org/pdf/{}", a));
        (name, arxiv, pdf, None)
    };

    let mut result = ensure_paper_assets(
        &paper_dir,
        &id,
        arxiv_id.as_deref(),
        pdf_url.as_deref(),
        doi.as_deref(),
    )
    .await?;

    // After download: no TeX + has PDF → liteparse PAPER.md
    let parse = crate::services::pdf_parse::maybe_generate_paper_md_after_download(
        &vault, &path_rel, &paper_dir,
    )
    .await;
    result.paper_md = parse.paper_md;
    for m in parse.messages {
        result.messages.push(m);
    }
    Ok(result)
}

/// Import one or more local PDF files as paper folders (copy + catalog + liteparse).
/// Filename-derived title/id; no network lookup. Each PDF becomes `{parent}/{slug}/{slug}.pdf`.
pub async fn import_local_pdfs(args: ImportLocalPdfArgs) -> Result<ImportLocalPdfResult, AppError> {
    let vault = PathBuf::from(args.vault_path.trim());
    if !vault.is_dir() {
        return Err(AppError::message("vault path is not a directory"));
    }
    let parent_rel = normalize_parent_dir(&args.parent_dir)?;

    let mut papers_out = Vec::new();
    let mut errors = Vec::new();
    for src in &args.file_paths {
        match import_one_local_pdf(&vault, &parent_rel, src).await {
            Ok(r) => papers_out.push(r),
            Err(e) => {
                let name = Path::new(src.trim())
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or(src.as_str());
                errors.push(format!("{name}: {e}"));
            }
        }
    }
    // All failed → surface as an error; partial success returns per-file errors.
    if papers_out.is_empty() && !errors.is_empty() {
        return Err(AppError::message(errors.join("; ")));
    }
    Ok(ImportLocalPdfResult {
        papers: papers_out,
        errors,
    })
}

async fn import_one_local_pdf(
    vault: &Path,
    parent_rel: &str,
    src_path: &str,
) -> Result<LookupImportResult, AppError> {
    let src = PathBuf::from(src_path.trim());
    if !src.is_file() {
        return Err(AppError::message("file not found"));
    }
    let is_pdf = src
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
    if !is_pdf {
        return Err(AppError::message("not a PDF file"));
    }

    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("paper");
    let title = title_from_stem(stem);
    let base_id = slug_from_stem(stem);
    let (id, path_rel, paper_dir) = unique_paper_path(vault, parent_rel, &base_id);
    fs::create_dir_all(&paper_dir)?;

    // PDF lives in the paper folder root as `{id}.pdf` (same as downloaded PDFs).
    fs::copy(&src, paper_dir.join(format!("{id}.pdf")))
        .map_err(|e| AppError::message(format!("copy PDF failed: {e}")))?;

    let meta = local_pdf_meta(id.clone(), title.clone());
    write_paper_shell(&paper_dir, &meta).await?;
    let record = paper_record_from_meta(&path_rel, &meta);
    papers::upsert_paper(vault, &record)?;

    // No TeX + has PDF → liteparse PAPER.md so the paper has a readable body.
    let parse = crate::services::pdf_parse::maybe_generate_paper_md_after_download(
        vault, &path_rel, &paper_dir,
    )
    .await;

    Ok(LookupImportResult {
        paper_dir: paper_dir.to_string_lossy().to_string(),
        path: path_rel,
        id: meta.id,
        title: meta.title,
        used_translator: false,
        translator_base_url: String::new(),
        pdf: true,
        tex: false,
        paper_md: parse.paper_md,
        asset_messages: parse.messages,
    })
}

/// Folder-safe slug from a filename stem (alphanumerics + dots; other runs → `-`).
fn slug_from_stem(stem: &str) -> String {
    let mut s = String::new();
    let mut prev_sep = true; // suppress leading separators
    for c in stem.trim().chars() {
        if c.is_ascii_alphanumeric() || c == '.' {
            s.push(c);
            prev_sep = false;
        } else if !prev_sep {
            s.push('-');
            prev_sep = true;
        }
    }
    let s: String = s.chars().take(60).collect();
    let s = s.trim_matches(|c| c == '-' || c == '.').to_string();
    if s.is_empty() {
        "paper".into()
    } else {
        s
    }
}

/// Human title from a filename stem (underscores → spaces, whitespace collapsed).
fn title_from_stem(stem: &str) -> String {
    let spaced: String = stem
        .trim()
        .chars()
        .map(|c| if c == '_' { ' ' } else { c })
        .collect();
    let collapsed = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        "Untitled".into()
    } else {
        collapsed
    }
}

/// Pick a non-existing `{parent}/{id}` folder, suffixing `-2`, `-3`, … on collision.
/// Returns `(id, path_rel, absolute_dir)`.
fn unique_paper_path(vault: &Path, parent_rel: &str, base_id: &str) -> (String, String, PathBuf) {
    let mut id = base_id.to_string();
    let mut n = 2;
    loop {
        let path_rel = format!("{parent_rel}/{id}");
        let dir = vault.join(&path_rel);
        if !dir.exists() || n > 999 {
            return (id, path_rel, dir);
        }
        id = format!("{base_id}-{n}");
        n += 1;
    }
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
        .user_agent("agentero-lookup/0.1 (+https://github.com/poco-ai/agentero)")
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
        .user_agent("agentero-lookup/0.1")
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

pub(crate) fn paper_record_from_meta(path: &str, meta: &PaperMeta) -> PaperRecord {
    PaperRecord {
        path: path.replace('\\', "/"),
        id: meta.id.clone(),
        paper_type: meta.paper_type.clone(),
        title: meta.title.clone(),
        authors: meta.authors.clone(),
        creators: meta.creators.clone(),
        year: meta.year,
        date: meta.date.clone(),
        abstract_text: meta.abstract_text.clone(),
        tags: meta.tags.clone(),
        arxiv_id: meta.arxiv_id.clone(),
        doi: meta.doi.clone(),
        isbn: meta.isbn.clone(),
        issn: meta.issn.clone(),
        pmid: meta.pmid.clone(),
        publication: meta.publication.clone(),
        volume: meta.volume.clone(),
        issue: meta.issue.clone(),
        pages: meta.pages.clone(),
        publisher: meta.publisher.clone(),
        place: meta.place.clone(),
        series: meta.series.clone(),
        language: meta.language.clone(),
        pdf_url: meta.pdf_url.clone(),
        html_url: meta.html_url.clone(),
        source_url: meta.source_url.clone(),
        body_source: None,
        body_quality: None,
        bibtex_key: meta.bibtex_key.clone(),
        citation_count: None,
        zotero_item_type: meta.zotero_item_type.clone(),
        meta_source: meta.meta_source.clone(),
        extra: meta.extra.clone(),
        summary: meta.summary.clone(),
        status: meta.status.clone(),
        is_read: false,
        added_at: meta.added_at.clone(),
        updated_at: meta.updated_at.clone(),
    }
}

/// Write `{paper}/NOTES.md` shell + empty `highlights.md`.
/// Abstract is shown in **Chinese** when free-MT succeeds (fallback: original text).
/// Catalog still stores the original `abstract_text`.
pub(crate) async fn write_paper_shell(paper_dir: &Path, meta: &PaperMeta) -> Result<(), AppError> {
    write_paper_shell_opts(paper_dir, meta, true).await
}

/// Same as [`write_paper_shell`], with optional abstract MT.
/// Connector saves must stay under the browser extension's ~15s timeout, so they
/// pass `translate_abstract = false` and fetch assets asynchronously.
pub(crate) async fn write_paper_shell_opts(
    paper_dir: &Path,
    meta: &PaperMeta,
    translate_abstract: bool,
) -> Result<(), AppError> {
    let abstract_block = match meta
        .abstract_text
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(a) => {
            let display = if translate_abstract {
                abstract_for_notes(a).await
            } else {
                a.to_string()
            };
            format!("> {display}\n\n")
        }
        None => String::new(),
    };
    let notes = format!("# {}\n\n{abstract_block}", meta.title);
    fs::write(paper_dir.join("NOTES.md"), notes)?;
    fs::write(paper_dir.join("highlights.md"), "")?;
    Ok(())
}

/// Prefer zh-CN translation of the abstract for NOTES.md display.
///
/// Free MT endpoints are unofficial and any single one may be blocked or
/// rate-limited (e.g. Google is unreachable from mainland China), so try a
/// small fallback chain and keep the original text only when every engine fails.
async fn abstract_for_notes(text: &str) -> String {
    if looks_mostly_cjk(text) {
        return text.to_string();
    }
    let slice: String = text
        .chars()
        .take(crate::services::translate::MAX_TEXT_CHARS)
        .collect();
    for provider in [
        "googleapi",
        "bing",
        "youdao",
        "huoshanweb",
        "tencenttransmart",
    ] {
        if let Ok(r) = crate::services::translate::translate_text(
            crate::services::translate::TranslateTextArgs {
                text: slice.clone(),
                source_lang: "auto".into(),
                target_lang: "zh-CN".into(),
                provider: provider.into(),
                free_base_url: None,
                timeout_ms: Some(15_000),
            },
        )
        .await
        {
            let t = r.text.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    text.to_string()
}

/// Heuristic: already mostly CJK → skip MT (e.g. Chinese papers).
fn looks_mostly_cjk(s: &str) -> bool {
    let mut cjk = 0usize;
    let mut letters = 0usize;
    for c in s.chars() {
        if ('\u{4e00}'..='\u{9fff}').contains(&c) {
            cjk += 1;
        } else if c.is_ascii_alphabetic() {
            letters += 1;
        }
    }
    cjk > 0 && cjk >= letters
}

pub(crate) fn normalize_parent_dir(raw: &str) -> Result<String, AppError> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_from_stem_basic() {
        assert_eq!(
            slug_from_stem("Attention Is All You Need"),
            "Attention-Is-All-You-Need"
        );
        assert_eq!(
            slug_from_stem("vaswani_2017_attention"),
            "vaswani-2017-attention"
        );
        assert_eq!(slug_from_stem("1706.03762"), "1706.03762");
        assert_eq!(slug_from_stem("  spaced  "), "spaced");
        assert_eq!(slug_from_stem("!!!"), "paper");
    }

    #[test]
    fn title_from_stem_basic() {
        assert_eq!(
            title_from_stem("vaswani_2017_attention"),
            "vaswani 2017 attention"
        );
        assert_eq!(title_from_stem("  Hello   World  "), "Hello World");
        assert_eq!(title_from_stem("   "), "Untitled");
    }

    #[test]
    fn looks_mostly_cjk_detects_chinese() {
        assert!(looks_mostly_cjk("本文提出了一种新的注意力机制。"));
        assert!(!looks_mostly_cjk(
            "We propose a new attention mechanism for sequence transduction."
        ));
        assert!(!looks_mostly_cjk(""));
    }
}
