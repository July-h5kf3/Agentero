//! Application assembly: plugins, managed state, setup, and event wiring.

mod handlers;
mod logging;
pub mod menu;

use crate::services::agent::{AgentRegistry, AgentRunController};
use crate::services::app_settings::AppSettingsStore;
#[cfg(not(target_os = "ios"))]
use crate::services::connector::ConnectorController;
#[cfg(not(target_os = "ios"))]
use crate::services::remote::RemoteRegistry;
#[cfg(not(target_os = "ios"))]
use crate::services::watcher::FsWatchController;
use crate::services::wiki::WikiIndexState;
#[cfg(not(target_os = "ios"))]
use std::sync::Arc;
#[cfg(not(target_os = "ios"))]
use tauri::Emitter;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(logging::build_log_plugin().build());

    #[cfg(not(target_os = "ios"))]
    {
        builder = builder.plugin(tauri_plugin_shell::init());
    }

    builder = builder
        .manage(AppSettingsStore::load())
        .manage(AgentRegistry::load())
        .manage(AgentRunController::new())
        .manage(crate::services::agent::PermissionGate::new())
        .manage(WikiIndexState::new());

    #[cfg(not(target_os = "ios"))]
    {
        builder = builder
            .manage(FsWatchController::new())
            .manage(Arc::new(ConnectorController::new()))
            .manage(Arc::new(RemoteRegistry::new()));
    }

    builder = handlers::attach_handlers(builder);

    builder = builder.setup(|app| {
        // Window chrome / show is desktop-only; mobile windows are managed by the
        // embedder and do not expose these APIs.
        #[cfg(not(target_os = "ios"))]
        {
            #[cfg(not(target_os = "macos"))]
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_decorations(false);
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
            }
        }
        // Native menu is macOS-only; the renderer re-syncs the locale on mount.
        #[cfg(target_os = "macos")]
        {
            let menu = menu::build_menu(app.handle(), "en")?;
            app.set_menu(menu)?;
        }
        // Ensure registry is loaded early.
        let _ = app.state::<AgentRegistry>();
        let _ = app.state::<WikiIndexState>();
        #[cfg(not(target_os = "ios"))]
        {
            let connector = app.state::<Arc<ConnectorController>>();
            connector.set_app_handle(app.handle().clone());
            let remote = app.state::<Arc<RemoteRegistry>>();
            connector.set_remote_registry(Arc::clone(&remote));
        }
        log::info!(
            target: "agentero::op",
            "op start app_ready debug={}",
            cfg!(debug_assertions)
        );
        Ok(())
    });

    #[cfg(not(target_os = "ios"))]
    {
        builder = builder.on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == "new_window" {
                if let Err(e) = crate::commands::window::window_new(app.clone()) {
                    log::error!(target: "agentero::op", "op end window_new ok=false error={e}");
                }
                return;
            }
            let _ = app.emit(id, ());
        });
    }

    #[cfg(not(target_os = "ios"))]
    {
        builder = builder.on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<FsWatchController>().stop(window.label());
            }
        });
    }

    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                #[cfg(not(target_os = "ios"))]
                app.state::<Arc<ConnectorController>>().stop();
            }
        });
}
