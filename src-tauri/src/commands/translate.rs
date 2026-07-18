//! Application translation commands (free MT; Agent path stays on the frontend ACP).

use crate::error::{map_err, ApiResult};
use crate::services::translate::{self, TranslateTextArgs, TranslateTextResult};

#[tauri::command]
pub async fn translate_text(args: TranslateTextArgs) -> ApiResult<TranslateTextResult> {
    match translate::translate_text(args).await {
        Ok(r) => ApiResult::ok(r),
        Err(e) => map_err(e),
    }
}
