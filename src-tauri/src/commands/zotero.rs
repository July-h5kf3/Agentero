//! Zotero migration commands: scan a Zotero data directory and migrate its
//! library into the catalog. Fully local (no Translator).

use crate::error::{map_err, ApiResult};
use crate::services::lookup::{
    migrate_zotero, scan_zotero, ZoteroMigrateArgs, ZoteroMigrateResult, ZoteroScan, ZoteroScanArgs,
};

/// Read-only preview of a Zotero data directory (item + local-PDF counts).
#[tauri::command]
pub fn zotero_scan(args: ZoteroScanArgs) -> ApiResult<ZoteroScan> {
    match scan_zotero(args) {
        Ok(r) => ApiResult::ok(r),
        Err(e) => map_err(e),
    }
}

/// Migrate a Zotero library into `papers/…` + catalog; optionally copy PDFs.
#[tauri::command]
pub async fn zotero_migrate(args: ZoteroMigrateArgs) -> ApiResult<ZoteroMigrateResult> {
    match migrate_zotero(args).await {
        Ok(r) => ApiResult::ok(r),
        Err(e) => map_err(e),
    }
}
