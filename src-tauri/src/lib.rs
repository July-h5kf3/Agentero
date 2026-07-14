mod commands;
mod error;
mod models;
mod services;

use services::agent::AgentRegistry;
use services::wiki::WikiIndexState;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    Emitter, Manager,
};

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    // Appears under the app name menu on macOS (e.g. "motif").
    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let open_vault = MenuItemBuilder::with_id("open_vault", "Open Vault…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    let refresh_tree = MenuItemBuilder::with_id("refresh_tree", "Refresh File Tree")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;

    let toggle_sidebar = MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar")
        .accelerator("CmdOrCtrl+Alt+S")
        .build(app)?;

    let toggle_chat = MenuItemBuilder::with_id("toggle_chat", "Toggle Chat")
        .accelerator("CmdOrCtrl+L")
        .build(app)?;

    let app_submenu = SubmenuBuilder::new(app, "Motif")
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

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(&open_vault)
        .item(&refresh_tree)
        .separator()
        .close_window()
        .build()?;

    // Required so text fields keep standard edit shortcuts after custom menu is set.
    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_submenu = SubmenuBuilder::new(app, "View")
        .item(&toggle_sidebar)
        .item(&toggle_chat)
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
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
            commands::graph::graph_rebuild,
        ])
        .setup(|app| {
            let menu = build_menu(app.handle())?;
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
