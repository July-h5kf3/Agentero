//! Zotero migration commands: scan a Zotero data directory and migrate its
//! library into the catalog. Fully local (no Translator).

use crate::error::{map_err, ApiResult};
use crate::services::lookup::{
    migrate_zotero, scan_zotero, MigrateProgress, ZoteroMigrateArgs, ZoteroMigrateResult,
    ZoteroScan, ZoteroScanArgs,
};
use tauri::ipc::Channel;

/// Read-only preview of a Zotero data directory (item + local-PDF counts).
#[tauri::command]
pub fn zotero_scan(args: ZoteroScanArgs) -> ApiResult<ZoteroScan> {
    match scan_zotero(args) {
        Ok(r) => ApiResult::ok(r),
        Err(e) => map_err(e),
    }
}

/// Migrate a Zotero library into `papers/…` + catalog; optionally copy PDFs.
/// Streams `{current,total}` progress to the UI via `on_progress`.
#[tauri::command]
pub async fn zotero_migrate(
    args: ZoteroMigrateArgs,
    on_progress: Channel<MigrateProgress>,
) -> ApiResult<ZoteroMigrateResult> {
    let report = move |current, total| {
        let _ = on_progress.send(MigrateProgress { current, total });
    };
    match migrate_zotero(args, report).await {
        Ok(r) => ApiResult::ok(r),
        Err(e) => map_err(e),
    }
}
