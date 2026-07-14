mod commands;
mod error;
mod i18n;
mod models;
mod services;

use i18n::menu_labels;
use services::agent::AgentRegistry;
use services::wiki::WikiIndexState;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager,
};

fn build_menu(app: &tauri::AppHandle, lang: &str) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let labels = menu_labels(lang);

    // Appears under the app name menu on macOS (e.g. "motif").
    let settings = MenuItemBuilder::with_id("settings", labels.settings)
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let open_vault = MenuItemBuilder::with_id("open_vault", labels.open_vault)
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    let refresh_tree = MenuItemBuilder::with_id("refresh_tree", labels.refresh_tree)
        .accelerator("CmdOrCtrl+R")
        .build(app)?;

    let toggle_sidebar = MenuItemBuilder::with_id("toggle_sidebar", labels.toggle_sidebar)
        .accelerator("CmdOrCtrl+Alt+S")
        .build(app)?;

    let toggle_chat = MenuItemBuilder::with_id("toggle_chat", labels.toggle_chat)
        .accelerator("CmdOrCtrl+L")
        .build(app)?;

    let app_submenu = SubmenuBuilder::new(app, labels.app)
        .about(None)
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file_submenu = SubmenuBuilder::new(app, labels.file)
        .item(&open_vault)
        .item(&refresh_tree)
        .separator()
        .close_window()
        .build()?;

    // Required so text fields keep standard edit shortcuts after custom menu is set.
    let edit_submenu = SubmenuBuilder::new(app, labels.edit)
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_submenu = SubmenuBuilder::new(app, labels.view)
        .item(&toggle_sidebar)
        .item(&toggle_chat)
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, labels.window)
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&view_submenu)
        .item(&window_submenu)
        .build()
}

/// Rebuild and install the native application menu for the given locale.
/// Called by the renderer whenever the language preference changes.
#[tauri::command]
fn set_locale(app: tauri::AppHandle, locale: String) -> Result<(), String> {
    let menu = build_menu(&app, &locale).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(AgentRegistry::load())
        .manage(WikiIndexState::new())
        .invoke_handler(tauri::generate_handler![
            commands::agent::agent_list_agents,
            commands::agent::agent_list_templates,
            commands::agent::agent_scan_catalog,
            commands::agent::agent_upsert_agent,
            commands::agent::agent_ensure_catalog,
            commands::agent::agent_remove_agent,
            commands::agent::agent_set_default,
            commands::agent::agent_set_enabled,
            commands::agent::agent_set_proxy,
            commands::agent::agent_discover,
            commands::agent::agent_probe,
            commands::agent::agent_probe_catalog,
            commands::agent::agent_run_once,
            commands::agent::agent_warm,
            commands::graph::graph_get_backlinks,
            commands::graph::graph_get_graph,
            commands::graph::graph_rebuild,
            set_locale,
        ])
        .setup(|app| {
            // English by default; the renderer re-syncs the stored locale on mount.
            let menu = build_menu(app.handle(), "en")?;
            app.set_menu(menu)?;
            // Ensure registry is loaded early.
            let _ = app.state::<AgentRegistry>();
            let _ = app.state::<WikiIndexState>();
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            let _ = app.emit(id, ());
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
