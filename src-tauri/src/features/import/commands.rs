//! Magic-wand / identifier import commands + catalog export/import via Translator.

use crate::core::error::ApiResult;
use crate::core::log_util::{trunc, OpTimer};
use crate::features::import::{
    AssetDownloadResult, ImportLocalPdfArgs, ImportLocalPdfResult, LookupImportBatchArgs,
    LookupImportBatchResult, PaperDownloadAssetsArgs, PaperExportArgs, PaperExportResult,
    PaperImportArgs, PaperImportResult, StageImportFileArgs, StageImportFileResult,
};
use crate::features::remote::{import_bridge, parse_remote_handle, RemoteRegistry};
use std::sync::Arc;
use tauri::State;

/// Batch resolve identifiers and write papers into vault.
/// Deduplicates within the batch and against existing catalog entries.
#[tauri::command]
pub async fn lookup_import_batch(
    app: tauri::AppHandle,
    registry: State<'_, Arc<RemoteRegistry>>,
    args: LookupImportBatchArgs,
) -> Result<ApiResult<LookupImportBatchResult>, String> {
    let n = args.texts.len();
    let op = OpTimer::start_with("lookup_import_batch", format!("count={n}"));
    if let Some(session_id) = parse_remote_handle(&args.vault_path) {
        let session = match registry.get(session_id).await {
            Ok(s) => s,
            Err(e) => {
                op.finish_err(&e);
                return Ok(crate::core::error::map_err(e));
            }
        };
        return Ok(
            op.finish_result(import_bridge::import_by_identifier_batch_remote(session, args).await)
        );
    }
    let task_id = args.task_id.clone();
    let result = super::import_by_identifier_batch(args, Some(&app)).await;
    if let Some(task_id) = task_id.as_deref() {
        crate::features::agent::background_tasks::finish(task_id);
    }
    Ok(op.finish_result(result))
}

/// Download PDF (+ arXiv LaTeX) for an existing paper folder that is missing local assets.
/// When no TeX remains after download, also tries liteparse → PAPER.md.
#[tauri::command]
pub async fn paper_download_assets(
    app: tauri::AppHandle,
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
                return Ok(crate::core::error::map_err(e));
            }
        };
        return Ok(
            op.finish_result(import_bridge::download_paper_assets_remote(session, args).await)
        );
    }
    let task_id = args.task_id.clone();
    let result = super::download_paper_assets_with_progress(args, Some(&app)).await;
    if let Some(task_id) = task_id.as_deref() {
        crate::features::agent::background_tasks::finish(task_id);
    }
    Ok(op.finish_result(result))
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
                return Ok(crate::core::error::map_err(e));
            }
        };
        return Ok(op.finish_result_ok_extra(
            import_bridge::import_local_pdfs_remote(session, args).await,
            |r| format!("imported={} errors={}", r.papers.len(), r.errors.len()),
        ));
    }
    Ok(
        op.finish_result_ok_extra(super::import_local_pdfs(args).await, |r| {
            format!("imported={} errors={}", r.papers.len(), r.errors.len())
        }),
    )
}

/// Stage a path-less OS drop (File bytes as base64) into `~/.agentero/import-tmp/`.
#[tauri::command]
pub fn paper_stage_import_file(args: StageImportFileArgs) -> ApiResult<StageImportFileResult> {
    let name = trunc(&args.file_name, 80);
    let op = OpTimer::start_with("paper_stage_import_file", format!("name={name}"));
    op.finish_result(super::stage_import_file(args))
}

/// Export catalog papers via Translator `POST /export` (Zotero JSON array → BibTeX/RIS/…).
#[tauri::command]
pub async fn paper_export(args: PaperExportArgs) -> ApiResult<PaperExportResult> {
    let format = args.format.as_deref().unwrap_or("bibtex");
    let op = OpTimer::start_with("paper_export", format!("format={format}"));
    op.finish_result(super::export_catalog(args).await)
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
                return Ok(crate::core::error::map_err(e));
            }
        };
        return Ok(op.finish_result_ok_extra(
            import_bridge::import_catalog_remote(session, args).await,
            |r| format!("imported={} skipped={}", r.imported, r.skipped),
        ));
    }
    Ok(
        op.finish_result_ok_extra(super::import_catalog(args).await, |r| {
            format!("imported={} skipped={}", r.imported, r.skipped)
        }),
    )
}
