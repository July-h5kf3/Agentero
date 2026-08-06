//! Application translation commands (free MT; Agent path stays on the frontend ACP).

use crate::core::error::{map_err, ApiResult};
use crate::features::settings::{is_translate_api_key_mask, AppSettingsStore};
use crate::features::translate::{self, TranslateTextArgs, TranslateTextResult};
use tauri::{AppHandle, Manager};

#[tauri::command]
#[specta::specta]
pub async fn translate_text(
    app: AppHandle,
    mut args: TranslateTextArgs,
) -> ApiResult<TranslateTextResult> {
    use crate::core::log_util::OpTimer;

    // Commercial BYOK: Host keeps the real key. Frontend may send a `*`-mask or omit.
    // Resolve before any `.await` so we never hold managed state across await.
    {
        let needs_stored_key = args
            .api_key
            .as_deref()
            .map(|k| {
                let t = k.trim();
                t.is_empty() || is_translate_api_key_mask(t)
            })
            .unwrap_or(true);
        if needs_stored_key {
            let store = app.state::<AppSettingsStore>();
            if let Some(key) = store.translate_api_key(&args.provider) {
                args.api_key = Some(key);
            } else if args
                .api_key
                .as_deref()
                .is_some_and(is_translate_api_key_mask)
            {
                // Mask without a stored secret → clear so required_api_key errors cleanly.
                args.api_key = None;
            }
        }
    }

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
    use std::path::Path;

    /// Typed IPC pilot (tauri-specta): keeps `src/lib/core/bindings.ts` in
    /// sync with the Rust command signatures.
    ///
    /// By default this only verifies the committed file matches the Rust
    /// signatures without overwriting it, so `cargo test` does not dirty the
    /// working tree. To regenerate, run:
    /// `AGENTERO_UPDATE_BINDINGS=1 cargo test -p agentero export_typescript_bindings`
    #[test]
    fn export_typescript_bindings() {
        let builder = tauri_specta::Builder::<tauri::Wry>::new()
            .commands(tauri_specta::collect_commands![super::translate_text]);

        let out_path = Path::new("../src/lib/core/bindings.ts");
        let update = std::env::var("AGENTERO_UPDATE_BINDINGS").is_ok();

        if update {
            builder
                .export(specta_typescript::Typescript::default(), out_path)
                .expect("export typescript bindings");
            return;
        }

        let temp_dir =
            std::env::temp_dir().join(format!("agentero-bindings-{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");
        let temp_path = temp_dir.join("bindings.ts");
        builder
            .export(specta_typescript::Typescript::default(), &temp_path)
            .expect("export typescript bindings to temp");

        let expected = std::fs::read_to_string(&temp_path).expect("read temp bindings");
        let actual = std::fs::read_to_string(out_path).expect("read committed bindings");
        let _ = std::fs::remove_dir_all(&temp_dir);

        fn normalize(s: &str) -> String {
            s.chars()
                .filter(|c| !c.is_whitespace())
                .map(|c| if c == ';' { ',' } else { c })
                .collect()
        }

        assert_eq!(
            normalize(&expected),
            normalize(&actual),
            "bindings.ts is out of sync with Rust command signatures; rerun with AGENTERO_UPDATE_BINDINGS=1"
        );
    }
}
