//! Tauri commands for the Zotero Connector–compatible local server.

use crate::error::ApiResult;
use crate::services::connector::{ConnectorController, ConnectorStatus};
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn connector_get_status(
    ctrl: State<'_, Arc<ConnectorController>>,
) -> ApiResult<ConnectorStatus> {
    ApiResult::ok(ctrl.status())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorSetEnabledArgs {
    pub enabled: bool,
}

#[tauri::command]
pub fn connector_set_enabled(
    ctrl: State<'_, Arc<ConnectorController>>,
    args: ConnectorSetEnabledArgs,
) -> ApiResult<ConnectorStatus> {
    ApiResult::ok(ctrl.set_enabled(args.enabled))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorSetVaultArgs {
    pub vault_path: Option<String>,
}

#[tauri::command]
pub fn connector_set_vault(
    ctrl: State<'_, Arc<ConnectorController>>,
    args: ConnectorSetVaultArgs,
) -> ApiResult<()> {
    ctrl.set_vault(args.vault_path);
    ApiResult::ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorSetParentDirArgs {
    /// Vault-relative parent, e.g. `papers` or `papers/nlp`.
    pub parent_dir: String,
}

/// Remember the default save location (also exposed as selected collection).
#[tauri::command]
pub fn connector_set_parent_dir(
    ctrl: State<'_, Arc<ConnectorController>>,
    args: ConnectorSetParentDirArgs,
) -> ApiResult<()> {
    ctrl.set_parent_dir(args.parent_dir);
    ApiResult::ok(())
}
