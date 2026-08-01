//! Multi-window helpers.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::core::log_util::OpTimer;

// Settings store is only used for macOS traffic-light y scaling.
#[cfg(target_os = "macos")]
use crate::features::settings::AppSettingsStore;

/// Default traffic-light y position at 100% UI scale. Matches tauri.conf.json.
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_Y_DEFAULT: f64 = 18.0;
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_X: f64 = 14.0;

/// Top-left y for the macOS traffic-light buttons in the 32px Settings header.
/// 9 + 14 (button height) = 23, leaving 9px above and 9px below for vertical centering.
#[cfg(target_os = "macos")]
const SETTINGS_TRAFFIC_LIGHT_Y: f64 = 16.0;

pub const SETTINGS_WINDOW_LABEL: &str = "settings";

/// Open a fresh Agentero window without restoring the last vault (`?fresh=1`).
///
/// `async` is load-bearing: sync command handlers run on the main thread inside
/// the calling webview's IPC callback, and building a webview from there hangs
/// on Windows — wry waits in a nested message loop for the WebView2 controller
/// callback, which WebView2 only runs once the current handler returns, so
/// `build()` never comes back and the new window stays blank. Async handlers run
/// off the main thread, so window creation is queued onto the event loop
/// instead of nested inside another handler.
#[tauri::command]
pub async fn window_new(app: AppHandle) -> Result<(), String> {
    let op = OpTimer::start("window_new");
    let label = format!("agentero-{}", uuid::Uuid::new_v4().simple());

    // Main window uses tauri.conf.json `dragDropEnabled: false` so HTML5 DnD
    // works (vault moves / agent chips). OS file drops are cancelled in the
    // frontend so the webview never navigates to a dropped PDF.
    // WebviewWindowBuilder in this Tauri version has no drag_drop_enabled();
    // secondary windows inherit platform defaults — frontend still preventDefaults.
    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut builder =
        WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html?fresh=1".into()))
            .title("Agentero")
            .inner_size(1280.0, 800.0)
            .min_inner_size(800.0, 520.0)
            .visible(false)
            .resizable(true);

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

/// Open a singleton native Settings window, or focus it if already open.
///
/// See [`window_new`] for why this must stay `async`.
#[tauri::command]
pub async fn settings_window_open(
    app: AppHandle,
    section: String,
    vault_path: Option<String>,
) -> Result<(), String> {
    let op = OpTimer::start("settings_window_open");

    if let Some(win) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        let _ = win.set_focus();
        op.finish_ok_extra("existing");
        return Ok(());
    }

    let mut url = format!(
        "index.html?window=settings&section={}",
        urlencoding::encode(&section)
    );
    if let Some(path) = vault_path {
        url.push_str(&format!("&vault_path={}", urlencoding::encode(&path)));
    }

    #[cfg_attr(not(target_os = "macos"), allow(unused_mut))]
    let mut builder =
        WebviewWindowBuilder::new(&app, SETTINGS_WINDOW_LABEL, WebviewUrl::App(url.into()))
            .title("Settings")
            .inner_size(720.0, 560.0)
            .min_inner_size(640.0, 480.0)
            .visible(false)
            .resizable(true);

    #[cfg(target_os = "macos")]
    {
        // The 32px header (Tailwind h-8) does not scale with `ui_scale`, so the
        // y position stays at the constant that vertically centers the buttons.
        builder = builder
            .hidden_title(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .traffic_light_position(tauri::LogicalPosition::new(
                TRAFFIC_LIGHT_X,
                SETTINGS_TRAFFIC_LIGHT_Y,
            ));
    }

    let window = match builder.build() {
        Ok(w) => w,
        Err(e) => {
            op.finish_err_msg("settings", &e);
            // Keep the main window's `⌘,` toggle out of a stuck "open" state.
            let _ = app.emit("settings_window_closed", ());
            return Err(e.to_string());
        }
    };
    let _ = window.set_focus();

    op.finish_ok_extra("new");
    Ok(())
}
