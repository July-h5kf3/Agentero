//! Magic-wand / identifier import commands + catalog export/import via Translator.
//! Also `paper_parse_body` (liteparse → PAPER.md).

use crate::error::ApiResult;
use crate::log_util::{trunc, OpTimer};
use crate::services::lookup::{
    self, AssetDownloadResult, ImportLocalPdfArgs, ImportLocalPdfResult, LookupImportArgs,
    LookupImportResult, PaperDownloadAssetsArgs, PaperExportArgs, PaperExportResult,
    PaperImportArgs, PaperImportResult, DEFAULT_TRANSLATOR_BASE_URL,
};
use crate::services::pdf_parse::{self, PaperParseBodyArgs, PaperParseResult};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslatorConfig {
    /// Placeholder base URL for Zotero translation-server.
    pub default_base_url: String,
}

/// Return default Translator Runtime base URL (Settings default).
#[tauri::command]
pub fn lookup_translator_config() -> ApiResult<TranslatorConfig> {
    ApiResult::ok(TranslatorConfig {
        default_base_url: DEFAULT_TRANSLATOR_BASE_URL.to_string(),
    })
}

/// Resolve identifier via Translator (placeholder URL) and write paper into vault.
/// Always downloads PDF; arXiv also downloads and unpacks LaTeX into `source/`.
#[tauri::command]
pub async fn lookup_import(args: LookupImportArgs) -> ApiResult<LookupImportResult> {
    let id = trunc(&args.text, 80);
    let op = OpTimer::start_with("lookup_import", format!("query={id}"));
    op.finish_result(lookup::import_by_identifier(args).await)
}

/// Download PDF (+ arXiv LaTeX) for an existing paper folder that is missing local assets.
/// When no TeX remains after download, also tries liteparse → PAPER.md.
#[tauri::command]
pub async fn paper_download_assets(
    args: PaperDownloadAssetsArgs,
) -> ApiResult<AssetDownloadResult> {
    let path = trunc(&args.path, 120);
    let op = OpTimer::start_with("paper_download_assets", format!("path={path}"));
    op.finish_result(lookup::download_paper_assets(args).await)
}

/// Import local PDF file(s) into the vault as paper folders (copy + catalog + liteparse).
#[tauri::command]
pub async fn paper_import_local_pdf(args: ImportLocalPdfArgs) -> ApiResult<ImportLocalPdfResult> {
    let n = args.file_paths.len();
    let op = OpTimer::start_with("paper_import_local_pdf", format!("count={n}"));
    op.finish_result_ok_extra(lookup::import_local_pdfs(args).await, |r| {
        format!("imported={} errors={}", r.papers.len(), r.errors.len())
    })
}

/// Generate PAPER.md from local PDF via liteparse when the paper has no TeX.
#[tauri::command]
pub async fn paper_parse_body(args: PaperParseBodyArgs) -> ApiResult<PaperParseResult> {
    let path = trunc(&args.path, 120);
    let op = OpTimer::start_with("paper_parse_body", format!("path={path}"));
    op.finish_result(pdf_parse::parse_paper_body(args).await)
}

/// Export catalog papers via Translator `POST /export` (Zotero JSON array → BibTeX/RIS/…).
#[tauri::command]
pub async fn paper_export(args: PaperExportArgs) -> ApiResult<PaperExportResult> {
    let format = args.format.as_deref().unwrap_or("bibtex");
    let op = OpTimer::start_with("paper_export", format!("format={format}"));
    op.finish_result(lookup::export_catalog(args).await)
}

/// Import BibTeX/RIS/… via Translator `POST /import`, write papers into vault + catalog.
#[tauri::command]
pub async fn paper_import(args: PaperImportArgs) -> ApiResult<PaperImportResult> {
    let op = OpTimer::start("paper_import");
    op.finish_result_ok_extra(lookup::import_catalog(args).await, |r| {
        format!("imported={} skipped={}", r.imported, r.skipped)
    })
}
