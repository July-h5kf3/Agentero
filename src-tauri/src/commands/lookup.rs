//! Magic-wand / identifier import commands + catalog export/import via Translator.
//! Also `paper_parse_body` (liteparse → PAPER.md).

use crate::error::{map_err, ApiResult};
use crate::services::lookup::{
    self, AssetDownloadResult, LookupImportArgs, LookupImportResult, PaperDownloadAssetsArgs,
    PaperExportArgs, PaperExportResult, PaperImportArgs, PaperImportResult,
    DEFAULT_TRANSLATOR_BASE_URL,
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
    match lookup::import_by_identifier(args).await {
        Ok(r) => ApiResult::ok(r),
        Err(e) => map_err(e),
    }
}

/// Download PDF (+ arXiv LaTeX) for an existing paper folder that is missing local assets.
/// When no TeX remains after download, also tries liteparse → PAPER.md.
#[tauri::command]
pub async fn paper_download_assets(
    args: PaperDownloadAssetsArgs,
) -> ApiResult<AssetDownloadResult> {
    match lookup::download_paper_assets(args).await {
        Ok(r) => ApiResult::ok(r),
        Err(e) => map_err(e),
    }
}

/// Generate PAPER.md from local PDF via liteparse when the paper has no TeX.
#[tauri::command]
pub async fn paper_parse_body(args: PaperParseBodyArgs) -> ApiResult<PaperParseResult> {
    match pdf_parse::parse_paper_body(args).await {
        Ok(r) => ApiResult::ok(r),
        Err(e) => map_err(e),
    }
}

/// Export catalog papers via Translator `POST /export` (Zotero JSON array → BibTeX/RIS/…).
#[tauri::command]
pub async fn paper_export(args: PaperExportArgs) -> ApiResult<PaperExportResult> {
    match lookup::export_catalog(args).await {
        Ok(r) => ApiResult::ok(r),
        Err(e) => map_err(e),
    }
}

/// Import BibTeX/RIS/… via Translator `POST /import`, write papers into vault + catalog.
#[tauri::command]
pub async fn paper_import(args: PaperImportArgs) -> ApiResult<PaperImportResult> {
    match lookup::import_catalog(args).await {
        Ok(r) => ApiResult::ok(r),
        Err(e) => map_err(e),
    }
}
