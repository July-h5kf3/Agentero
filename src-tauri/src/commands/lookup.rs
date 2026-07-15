//! Magic-wand / identifier import commands.

use crate::error::{map_err, ApiResult};
use crate::services::lookup::{
    self, LookupImportArgs, LookupImportResult, DEFAULT_TRANSLATOR_BASE_URL,
};
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
#[tauri::command]
pub async fn lookup_import(args: LookupImportArgs) -> ApiResult<LookupImportResult> {
    match lookup::import_by_identifier(args).await {
        Ok(r) => ApiResult::ok(r),
        Err(e) => map_err(e),
    }
}
