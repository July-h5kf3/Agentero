//! Command registration shared between desktop and iOS.
//!
//! Desktop-only commands are listed once via `$($desktop:path),*` so the iOS
//! branch does not duplicate the common list.

/// Commands available on every platform (including iOS).
/// Desktop-only extras are appended by the caller.
macro_rules! common_commands {
    ($($extra:path),* $(,)?) => {
        ::tauri::generate_handler![
            crate::commands::settings::settings_get,
            crate::commands::settings::settings_set,
            crate::commands::settings::settings_path,
            crate::commands::settings::host_identity,
            crate::commands::agent::agent_list_agents,
            crate::commands::agent::agent_list_templates,
            crate::commands::agent::agent_list_skills,
            crate::commands::agent::agent_scan_catalog,
            crate::commands::agent::agent_upsert_agent,
            crate::commands::agent::agent_ensure_catalog,
            crate::commands::agent::agent_remove_agent,
            crate::commands::agent::agent_set_default,
            crate::commands::agent::agent_set_enabled,
            crate::commands::agent::agent_set_proxy,
            crate::commands::agent::agent_discover,
            crate::commands::agent::agent_probe,
            crate::commands::agent::agent_probe_catalog,
            crate::commands::agent::agent_cancel_run,
            crate::commands::background_tasks::background_task_cancel,
            crate::commands::agent::agent_respond_permission,
            crate::commands::graph::graph_get_backlinks,
            crate::commands::graph::graph_get_graph,
            crate::commands::graph::graph_rebuild,
            crate::commands::vault::vault_create,
            crate::commands::vault::vault_ensure,
            crate::commands::vault::vault_allow_fs_scope,
            crate::commands::trash::path_trash,
            crate::commands::trash::path_untrash,
            crate::commands::trash::path_list_trash,
            crate::commands::trash::path_restore_item,
            crate::commands::trash::path_purge_item,
            crate::commands::trash::path_purge_trash,
            crate::commands::translate::translate_text,
            crate::commands::lookup::lookup_import,
            crate::commands::lookup::lookup_import_batch,
            crate::commands::lookup::lookup_translator_config,
            crate::commands::lookup::paper_download_assets,
            crate::commands::lookup::paper_import_local_pdf,
            crate::commands::lookup::paper_stage_import_file,
            crate::commands::lookup::paper_export,
            crate::commands::lookup::paper_import,
            crate::commands::paper::paper_get,
            crate::commands::paper::paper_list,
            crate::commands::paper::paper_delete,
            crate::commands::paper::paper_move,
            crate::commands::paper::paper_set_is_read,
            crate::commands::paper::paper_set_tags,
            crate::commands::paper::paper_rescan,
            crate::commands::search::vault_search,
            crate::app::menu::set_locale,
            $($extra),*
        ]
    };
}

/// Attach the platform-appropriate invoke handler to the builder.
pub fn attach_handlers(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    #[cfg(not(target_os = "ios"))]
    {
        builder.invoke_handler(common_commands![
            crate::commands::agent::agent_open_install_terminal,
            crate::commands::agent::agent_run_once,
            crate::commands::agent::agent_list_sessions,
            crate::commands::agent::agent_load_session,
            crate::commands::agent::agent_warm,
            crate::commands::remote::remote_connect,
            crate::commands::remote::remote_disconnect,
            crate::commands::remote::remote_status,
            crate::commands::remote::remote_vault_ensure,
            crate::commands::remote::remote_list,
            crate::commands::remote::remote_stat,
            crate::commands::remote::remote_read_text,
            crate::commands::remote::remote_write_text,
            crate::commands::remote::remote_read_bytes,
            crate::commands::remote::remote_mkdir,
            crate::commands::remote::remote_remove,
            crate::commands::remote::remote_write_bytes,
            crate::commands::remote::remote_paper_list,
            crate::commands::remote::remote_paper_get,
            crate::commands::remote::remote_paper_delete,
            crate::commands::remote::remote_paper_rescan,
            crate::commands::remote::remote_paper_set_tags,
            crate::commands::remote::remote_paper_set_is_read,
            crate::commands::remote::remote_cache_file,
            crate::commands::remote::remote_cache_stats,
            crate::commands::remote::remote_cache_clear,
            crate::commands::remote::remote_agent_discover,
            crate::commands::remote::remote_agent_scan,
            crate::commands::remote::remote_agent_probe,
            crate::commands::remote::remote_agent_open_install_terminal,
            crate::commands::remote::remote_host_identity,
            crate::commands::terminal::path_open_in_terminal,
            crate::commands::window::window_new,
            crate::commands::window::settings_window_open,
            crate::commands::lookup::paper_parse_body,
            crate::commands::zotero::zotero_scan,
            crate::commands::zotero::zotero_migrate,
            crate::commands::watcher::fs_watch_start,
            crate::commands::watcher::fs_watch_stop,
            crate::commands::connector::connector_get_status,
            crate::commands::connector::connector_set_enabled,
            crate::commands::connector::connector_set_vault,
            crate::commands::connector::connector_set_parent_dir,
            crate::commands::connector::connector_set_port,
        ])
    }
    #[cfg(target_os = "ios")]
    {
        builder.invoke_handler(common_commands![])
    }
}
