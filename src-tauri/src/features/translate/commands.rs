//! Application translation commands (free MT; Agent path stays on the frontend ACP).

use crate::core::error::{map_err, ApiResult};
use crate::features::translate::{self, TranslateTextArgs, TranslateTextResult};

#[tauri::command]
#[specta::specta]
pub async fn translate_text(args: TranslateTextArgs) -> ApiResult<TranslateTextResult> {
    use crate::core::log_util::OpTimer;

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

#[cfg(test)]
mod tests {
    /// Typed IPC pilot (tauri-specta): keeps `src/lib/core/bindings.ts` in
    /// sync with the Rust command signatures. Regenerate with
    /// `cargo test -p agentero export_typescript_bindings`.
    #[test]
    fn export_typescript_bindings() {
        let builder = tauri_specta::Builder::<tauri::Wry>::new()
            .commands(tauri_specta::collect_commands![super::translate_text]);
        builder
            .export(
                specta_typescript::Typescript::default(),
                "../src/lib/core/bindings.ts",
            )
            .expect("export typescript bindings");
    }
}
