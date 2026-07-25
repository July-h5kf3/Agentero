//! Local PDF → `PAPER.md` via liteparse (no TeX papers).
//!
//! @see docs/backend/data-model.md § PAPER.md
//! @see docs/backend/api.md `paper_parse_body`

use crate::core::error::AppError;
use crate::features::catalog::papers;
use crate::features::import::{has_local_pdf, has_local_tex};
use liteparse::config::{ImageMode, LiteParseConfig, OutputFormat};
use liteparse::LiteParse;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const PAPER_MD: &str = "PAPER.md";

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperParseResult {
    pub paper_md: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_quality: Option<String>,
    pub messages: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperParseBodyArgs {
    pub vault_path: String,
    /// Vault-relative paper folder, e.g. `papers/1706.03762`.
    pub path: String,
    /// When true, overwrite existing `PAPER.md`. Default false.
    #[serde(default)]
    pub force: bool,
}

/// True when `{paper}/PAPER.md` exists.
pub fn has_paper_md(paper_dir: &Path) -> bool {
    paper_dir.join(PAPER_MD).is_file()
}

/// Find first local PDF under the paper folder (prefer root `*.pdf`, then nested).
pub fn find_local_pdf(paper_dir: &Path) -> Option<PathBuf> {
    // Prefer direct children of the paper folder (canonical location)
    if let Ok(entries) = fs::read_dir(paper_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file()
                && path
                    .extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
            {
                return Some(path);
            }
        }
    }
    // Recursive: PDFs under source/ or nested dirs
    find_pdf_under(paper_dir)
}

fn find_pdf_under(root: &Path) -> Option<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if stack.len() < 32 {
                    stack.push(path);
                }
            } else if path
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| e.eq_ignore_ascii_case("pdf"))
            {
                return Some(path);
            }
        }
    }
    None
}

/// After PDF/TeX download: if no TeX and PDF present, generate `PAPER.md` when missing.
pub async fn maybe_generate_paper_md_after_download(
    vault: &Path,
    path_rel: &str,
    paper_dir: &Path,
) -> PaperParseResult {
    parse_paper_body_inner(vault, path_rel, paper_dir, false).await
}

/// Manual / bulk parse entry (command).
pub async fn parse_paper_body(args: PaperParseBodyArgs) -> Result<PaperParseResult, AppError> {
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
    Ok(parse_paper_body_inner(&vault, &path_rel, &paper_dir, args.force).await)
}

async fn parse_paper_body_inner(
    vault: &Path,
    path_rel: &str,
    paper_dir: &Path,
    force: bool,
) -> PaperParseResult {
    let mut out = PaperParseResult::default();

    if has_local_tex(paper_dir) {
        out.messages.push("skip: local TeX present".into());
        return out;
    }

    if has_paper_md(paper_dir) && !force {
        out.paper_md = true;
        out.messages.push("PAPER.md already present".into());
        return out;
    }

    if !has_local_pdf(paper_dir) {
        out.messages.push("skip: no local PDF".into());
        return out;
    }

    let Some(pdf_path) = find_local_pdf(paper_dir) else {
        out.messages.push("skip: PDF path not found".into());
        return out;
    };

    match run_liteparse_markdown(&pdf_path).await {
        Ok((markdown, body_source, body_quality)) => {
            if markdown.trim().is_empty() {
                out.messages.push("liteparse returned empty text".into());
                return out;
            }
            match fs::write(paper_dir.join(PAPER_MD), &markdown) {
                Ok(()) => {
                    out.paper_md = true;
                    out.body_source = Some(body_source.clone());
                    out.body_quality = Some(body_quality.clone());
                    out.messages.push("PAPER.md written".into());
                    if let Err(e) =
                        update_catalog_body(vault, path_rel, &body_source, &body_quality)
                    {
                        out.messages
                            .push(format!("catalog body fields update failed: {e}"));
                    }
                }
                Err(e) => out.messages.push(format!("write PAPER.md failed: {e}")),
            }
        }
        Err(e) => out.messages.push(format!("liteparse failed: {e}")),
    }

    out
}

async fn run_liteparse_markdown(pdf_path: &Path) -> Result<(String, String, String), AppError> {
    let path_str = pdf_path
        .to_str()
        .ok_or_else(|| AppError::message("pdf path is not valid utf-8"))?;

    // Prefer native text; OCR is best-effort and must not abort the whole parse.
    let config = LiteParseConfig {
        ocr_enabled: true,
        ocr_failure_fatal: false,
        output_format: OutputFormat::Markdown,
        image_mode: ImageMode::Off,
        quiet: true,
        max_pages: 500,
        extract_links: true,
        ..Default::default()
    };

    let parser = LiteParse::new(config);

    // Complexity pre-pass for quality labeling (cheap text-layer only).
    let needs_ocr = match parser
        .is_complex(liteparse::types::PdfInput::Path(path_str.to_string()))
        .await
    {
        Ok(pages) => pages.iter().any(|p| p.needs_ocr),
        Err(_) => false,
    };

    let result = parser
        .parse(path_str)
        .await
        .map_err(|e| AppError::message(format!("liteparse: {e}")))?;

    let (body_source, body_quality) = if needs_ocr {
        ("ocr".to_string(), "low".to_string())
    } else {
        ("pdf".to_string(), "medium".to_string())
    };

    Ok((result.text, body_source, body_quality))
}

fn update_catalog_body(
    vault: &Path,
    path_rel: &str,
    body_source: &str,
    body_quality: &str,
) -> Result<(), AppError> {
    let Some(mut row) = papers::get_by_path(vault, path_rel)? else {
        // No catalog row yet — still wrote PAPER.md; skip SQLite.
        return Ok(());
    };
    row.body_source = Some(body_source.to_string());
    row.body_quality = Some(body_quality.to_string());
    row.updated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    papers::upsert_paper(vault, &row)?;
    Ok(())
}
