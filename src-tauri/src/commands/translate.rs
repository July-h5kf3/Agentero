//! Application translation commands (free MT; Agent path stays on the frontend ACP).

use crate::error::{map_err, ApiResult};
use crate::services::translate::{self, TranslateTextArgs, TranslateTextResult};

#[tauri::command]
pub async fn translate_text(args: TranslateTextArgs) -> ApiResult<TranslateTextResult> {
    use crate::log_util::OpTimer;

    let text_len = args.text.chars().count();
    let op = OpTimer::start_with(
        "translate_text",
        format!(
            "provider={} src={} tgt={} text_len={text_len}",
            args.provider, args.source_lang, args.target_lang
        ),
    );
    match translate::translate_text(args).await {
        Ok(r) => {
            op.finish_ok();
            ApiResult::ok(r)
        }
        Err(e) => {
            op.finish_err(&e);
            map_err(e)
        }
    }
}
