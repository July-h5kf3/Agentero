//! Multi-window helpers.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::features::settings::AppSettingsStore;

/// Default traffic-light y position at 100% UI scale. Matches tauri.conf.json.
const TRAFFIC_LIGHT_Y_DEFAULT: f64 = 18.0;
const TRAFFIC_LIGHT_X: f64 = 14.0;

/// Open a fresh Agentero window without restoring the last vault (`?fresh=1`).
#[tauri::command]
pub fn window_new(app: AppHandle) -> Result<(), String> {
    use crate::core::log_util::OpTimer;

    let op = OpTimer::start("window_new");
    let label = format!("agentero-{}", uuid::Uuid::new_v4().simple());

    // Main window uses tauri.conf.json `dragDropEnabled: false` so HTML5 DnD
    // works (vault moves / agent chips). OS file drops are cancelled in the
    // frontend so the webview never navigates to a dropped PDF.
    // WebviewWindowBuilder in this Tauri version has no drag_drop_enabled();
    // secondary windows inherit platform defaults — frontend still preventDefaults.
    let mut builder =
        WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html?fresh=1".into()))
            .title("Agentero")
            .inner_size(1280.0, 800.0)
            .min_inner_size(800.0, 520.0)
            .resizable(true)
            .focused(true);

    #[cfg(target_os = "macos")]
    {
        let scale = app
            .state::<AppSettingsStore>()
            .get()
            .map(|r| r.settings.ui_scale)
            .unwrap_or(1.0);
        let y = if scale.is_finite() && (0.8..=1.5).contains(&scale) {
            TRAFFIC_LIGHT_Y_DEFAULT * scale
        } else {
            TRAFFIC_LIGHT_Y_DEFAULT
        };
        builder = builder
            .hidden_title(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .traffic_light_position(tauri::LogicalPosition::new(TRAFFIC_LIGHT_X, y));
    }

    // Non-macOS: frameless window; caption buttons are drawn in the React title
    // bar (see WindowControls) so the chrome matches the macOS Overlay look.
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.decorations(false);
    }

    let window = match builder.build() {
        Ok(w) => w,
        Err(e) => {
            op.finish_err_msg("window", &e);
            return Err(e.to_string());
        }
    };
    let _ = window.set_focus();

    // Native menu is macOS-only; other platforms drive actions from the React
    // title bar + keyboard shortcuts, so no window menu is attached.
    #[cfg(target_os = "macos")]
    if let Some(menu) = app.menu() {
        let _ = window.set_menu(menu);
    }

    op.finish_ok_extra(format!("label={label}"));
    Ok(())
}
