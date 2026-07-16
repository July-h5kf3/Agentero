//! Multi-window helpers.

use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

/// Open a fresh Agentero window without restoring the last vault (`?fresh=1`).
#[tauri::command]
pub fn window_new(app: AppHandle) -> Result<(), String> {
    let label = format!("agentero-{}", uuid::Uuid::new_v4().simple());

    let mut builder =
        WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html?fresh=1".into()))
            .title("Agentero")
            .inner_size(1280.0, 800.0)
            .min_inner_size(800.0, 520.0)
            .resizable(true)
            .focused(true);

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .hidden_title(true)
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .traffic_light_position(tauri::LogicalPosition::new(14.0, 18.0));
    }

    // Non-macOS: frameless window; caption buttons are drawn in the React title
    // bar (see WindowControls) so the chrome matches the macOS Overlay look.
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.decorations(false);
    }

    let window = builder.build().map_err(|e| e.to_string())?;
    let _ = window.set_focus();

    // Native menu is macOS-only; other platforms drive actions from the React
    // title bar + keyboard shortcuts, so no window menu is attached.
    #[cfg(target_os = "macos")]
    if let Some(menu) = app.menu() {
        let _ = window.set_menu(menu);
    }

    Ok(())
}
