mod commands;
/// Shared error types (used by Host commands and the headless CLI).
pub mod error;
#[cfg(target_os = "macos")]
mod i18n;
mod models;
/// Domain services (Vault / Catalog / Lookup / Wiki / …).
/// The CLI path-depends on this crate and may `use agentero_lib::services::{vault,catalog,…}`;
/// it must **not** use `services::agent` (BYOA is desktop-only).
pub mod services;

#[cfg(target_os = "macos")]
use i18n::menu_labels;
use services::agent::{AgentRegistry, AgentRunController};
use services::wiki::WikiIndexState;
#[cfg(target_os = "macos")]
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
fn build_menu(app: &tauri::AppHandle, lang: &str) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let labels = menu_labels(lang);

    // Appears under the app name menu on macOS (e.g. "Agentero").
    let settings = MenuItemBuilder::with_id("settings", labels.settings)
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let new_window = MenuItemBuilder::with_id("new_window", labels.new_window)
        .accelerator("CmdOrCtrl+N")
        .build(app)?;

    let open_vault = MenuItemBuilder::with_id("open_vault", labels.open_vault)
        .accelerator("CmdOrCtrl+O")
        .build(app)?;

    let create_vault = MenuItemBuilder::with_id("create_vault", labels.create_vault)
        .accelerator("CmdOrCtrl+Shift+N")
        .build(app)?;

    let refresh_tree = MenuItemBuilder::with_id("refresh_tree", labels.refresh_tree)
        .accelerator("CmdOrCtrl+R")
        .build(app)?;

    // Smart Close (⌘W): frontend closes the active tab first; with no tabs, closes the window.
    // Must not use PredefinedMenuItem::CloseWindow — that would steal ⌘W before the renderer.
    let close = MenuItemBuilder::with_id("close_tab_or_window", labels.close)
        .accelerator("CmdOrCtrl+W")
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
        .item(&new_window)
        .separator()
        .item(&open_vault)
        .item(&create_vault)
        .item(&refresh_tree)
        .separator()
        .item(&close)
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
/// macOS-only: other platforms have no native window menu (actions live in the
/// React title bar + keyboard shortcuts), so this is a no-op there.
#[tauri::command]
fn set_locale(app: tauri::AppHandle, locale: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let menu = build_menu(&app, &locale).map_err(|e| e.to_string())?;
        app.set_menu(menu).map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (&app, &locale);
    }
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
        .manage(AgentRunController::new())
        .manage(WikiIndexState::new())
        .invoke_handler(tauri::generate_handler![
            commands::agent::agent_list_agents,
            commands::agent::agent_list_templates,
            commands::agent::agent_list_skills,
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
            commands::agent::agent_codex_list_threads,
            commands::agent::agent_codex_read_thread,
            commands::agent::agent_cancel_run,
            commands::agent::agent_warm,
            commands::graph::graph_get_backlinks,
            commands::graph::graph_get_graph,
            commands::graph::graph_rebuild,
            commands::vault::vault_create,
            commands::terminal::path_open_in_terminal,
            commands::window::window_new,
            commands::lookup::lookup_import,
            commands::lookup::lookup_translator_config,
            commands::lookup::paper_download_assets,
            commands::lookup::paper_parse_body,
            commands::lookup::paper_export,
            commands::lookup::paper_import,
            commands::paper::paper_get,
            commands::paper::paper_list,
            commands::paper::paper_delete,
            commands::paper::paper_set_is_read,
            commands::paper::paper_set_tags,
            commands::zotero::zotero_scan,
            commands::zotero::zotero_migrate,
            set_locale,
        ])
        .setup(|app| {
            // Non-macOS windows are frameless (custom caption buttons in React);
            // strip native decorations before the window is shown to avoid a flash.
            #[cfg(not(target_os = "macos"))]
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_decorations(false);
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
            }
            // Native menu is macOS-only; the renderer re-syncs the locale on mount.
            #[cfg(target_os = "macos")]
            {
                let menu = build_menu(app.handle(), "en")?;
                app.set_menu(menu)?;
            }
            // Ensure registry is loaded early.
            let _ = app.state::<AgentRegistry>();
            let _ = app.state::<WikiIndexState>();
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "new_window" {
                if let Err(e) = commands::window::window_new(app.clone()) {
                    eprintln!("window_new failed: {e}");
                }
                return;
            }
            let _ = app.emit(id, ());
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
