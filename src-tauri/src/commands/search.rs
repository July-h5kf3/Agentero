//! Vault-wide full-text Markdown search (command palette "contents" tier).

use crate::core::error::{map_err, ApiResult};
use crate::services::search::{self, VaultSearchArgs, VaultSearchResult};

/// Full-text search over the Vault's Markdown files. See `services::search`.
#[tauri::command]
pub fn vault_search(args: VaultSearchArgs) -> ApiResult<VaultSearchResult> {
    match search::vault_search(args) {
        Ok(r) => ApiResult::ok(r),
        Err(e) => map_err(e),
    }
}
