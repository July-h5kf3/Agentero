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
use crate::services::remote::{import_bridge, parse_remote_handle, RemoteRegistry};
use serde::Serialize;
use std::sync::Arc;
use tauri::State;

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
/// Remote vaults (`remote:<sessionId>`) stage locally then SFTP-upload + catalog push.
#[tauri::command]
pub async fn lookup_import(
    registry: State<'_, Arc<RemoteRegistry>>,
    args: LookupImportArgs,
) -> Result<ApiResult<LookupImportResult>, String> {
    let id = trunc(&args.text, 80);
    let op = OpTimer::start_with("lookup_import", format!("query={id}"));
    if let Some(session_id) = parse_remote_handle(&args.vault_path) {
        let session = match registry.get(session_id).await {
            Ok(s) => s,
            Err(e) => {
                op.finish_err(&e);
                return Ok(crate::error::map_err(e));
            }
        };
        return Ok(
            op.finish_result(import_bridge::import_by_identifier_remote(session, args).await)
        );
    }
    Ok(op.finish_result(lookup::import_by_identifier(args).await))
}

/// Download PDF (+ arXiv LaTeX) for an existing paper folder that is missing local assets.
/// When no TeX remains after download, also tries liteparse → PAPER.md.
#[tauri::command]
pub async fn paper_download_assets(
    registry: State<'_, Arc<RemoteRegistry>>,
    args: PaperDownloadAssetsArgs,
) -> Result<ApiResult<AssetDownloadResult>, String> {
    let path = trunc(&args.path, 120);
    let op = OpTimer::start_with("paper_download_assets", format!("path={path}"));
    if let Some(session_id) = parse_remote_handle(&args.vault_path) {
        let session = match registry.get(session_id).await {
            Ok(s) => s,
            Err(e) => {
                op.finish_err(&e);
                return Ok(crate::error::map_err(e));
            }
        };
        return Ok(
            op.finish_result(import_bridge::download_paper_assets_remote(session, args).await)
        );
    }
    Ok(op.finish_result(lookup::download_paper_assets(args).await))
}

/// Import local PDF file(s) into the vault as paper folders (copy + catalog + liteparse).
#[tauri::command]
pub async fn paper_import_local_pdf(
    registry: State<'_, Arc<RemoteRegistry>>,
    args: ImportLocalPdfArgs,
) -> Result<ApiResult<ImportLocalPdfResult>, String> {
    let n = args.file_paths.len();
    let op = OpTimer::start_with("paper_import_local_pdf", format!("count={n}"));
    if let Some(session_id) = parse_remote_handle(&args.vault_path) {
        let session = match registry.get(session_id).await {
            Ok(s) => s,
            Err(e) => {
                op.finish_err(&e);
                return Ok(crate::error::map_err(e));
            }
        };
        return Ok(op.finish_result_ok_extra(
            import_bridge::import_local_pdfs_remote(session, args).await,
            |r| format!("imported={} errors={}", r.papers.len(), r.errors.len()),
        ));
    }
    Ok(
        op.finish_result_ok_extra(lookup::import_local_pdfs(args).await, |r| {
            format!("imported={} errors={}", r.papers.len(), r.errors.len())
        }),
    )
}

/// Generate PAPER.md from PDF via liteparse when the paper has no TeX.
/// Remote vaults: pull PDF to work mirror → parse → SFTP put `PAPER.md`.
#[tauri::command]
pub async fn paper_parse_body(
    registry: State<'_, Arc<RemoteRegistry>>,
    args: PaperParseBodyArgs,
) -> Result<ApiResult<PaperParseResult>, String> {
    let path = trunc(&args.path, 120);
    let op = OpTimer::start_with("paper_parse_body", format!("path={path}"));
    if let Some(session_id) = parse_remote_handle(&args.vault_path) {
        let session = match registry.get(session_id).await {
            Ok(s) => s,
            Err(e) => {
                op.finish_err(&e);
                return Ok(crate::error::map_err(e));
            }
        };
        return Ok(op.finish_result(
            import_bridge::parse_paper_body_remote(session, &args.path, args.force).await,
        ));
    }
    Ok(op.finish_result(pdf_parse::parse_paper_body(args).await))
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
pub async fn paper_import(
    registry: State<'_, Arc<RemoteRegistry>>,
    args: PaperImportArgs,
) -> Result<ApiResult<PaperImportResult>, String> {
    let op = OpTimer::start("paper_import");
    if let Some(session_id) = parse_remote_handle(&args.vault_path) {
        let session = match registry.get(session_id).await {
            Ok(s) => s,
            Err(e) => {
                op.finish_err(&e);
                return Ok(crate::error::map_err(e));
            }
        };
        return Ok(op.finish_result_ok_extra(
            import_bridge::import_catalog_remote(session, args).await,
            |r| format!("imported={} skipped={}", r.imported, r.skipped),
        ));
    }
    Ok(
        op.finish_result_ok_extra(lookup::import_catalog(args).await, |r| {
            format!("imported={} skipped={}", r.imported, r.skipped)
        }),
    )
}
