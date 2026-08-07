use super::{
    apply_alias_repairs, apply_wikilink_repairs, diagnose, plan_wikilink_repairs,
    set_ignored_alias_paths, AliasRepairChange, AliasRepairResult, DoctorDirtyPathsState,
    DoctorReport, DoctorVaultState, WikilinkRepairChange, WikilinkRepairPlan, WikilinkRepairResult,
};
use crate::core::error::{map_err, ApiResult, AppError};
use crate::features::wiki::WikiIndexState;
use serde::Deserialize;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorCheckArgs {
    pub vault_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorApplyAliasesArgs {
    pub vault_path: String,
    pub changes: Vec<AliasRepairChange>,
    #[serde(default)]
    pub dirty_paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorSetDirtyPathsArgs {
    pub vault_path: String,
    #[serde(default)]
    pub dirty_paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorIgnoreAliasesArgs {
    pub vault_path: String,
    #[serde(default)]
    pub paths: Vec<String>,
    /// `true` = add to ignore list; `false` = restore (remove from list).
    pub ignore: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorPlanWikilinksArgs {
    pub vault_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorApplyWikilinksArgs {
    pub vault_path: String,
    pub changes: Vec<WikilinkRepairChange>,
    #[serde(default)]
    pub dirty_paths: Vec<String>,
}

#[tauri::command]
pub fn doctor_set_dirty_paths(
    args: DoctorSetDirtyPathsArgs,
    state: State<'_, DoctorDirtyPathsState>,
) -> ApiResult<()> {
    match state.set(&args.vault_path, &args.dirty_paths) {
        Ok(()) => ApiResult::ok(()),
        Err(error) => map_err(AppError::message(format!(
            "doctor dirty paths lock: {error}"
        ))),
    }
}

#[tauri::command]
pub fn doctor_check(args: DoctorCheckArgs) -> ApiResult<DoctorReport> {
    let vault = PathBuf::from(&args.vault_path);
    if !vault.is_dir() {
        return map_err(AppError::message("vault path is not a directory"));
    }
    match diagnose(&vault) {
        Ok(report) => ApiResult::ok(report),
        Err(error) => map_err(error),
    }
}

#[tauri::command]
pub fn doctor_ignore_aliases(args: DoctorIgnoreAliasesArgs) -> ApiResult<DoctorVaultState> {
    let vault = PathBuf::from(&args.vault_path);
    match set_ignored_alias_paths(&vault, &args.paths, args.ignore) {
        Ok(state) => ApiResult::ok(state),
        Err(error) => map_err(error),
    }
}

#[tauri::command]
pub fn doctor_apply_aliases(
    args: DoctorApplyAliasesArgs,
    index: State<'_, WikiIndexState>,
    dirty_state: State<'_, DoctorDirtyPathsState>,
) -> ApiResult<AliasRepairResult> {
    let vault = PathBuf::from(&args.vault_path);
    let mut dirty_paths = match dirty_state.get(&args.vault_path) {
        Ok(paths) => paths,
        Err(error) => {
            return map_err(AppError::message(format!(
                "doctor dirty paths lock: {error}"
            )))
        }
    };
    dirty_paths.extend(args.dirty_paths);
    match apply_alias_repairs(&vault, &args.changes, &dirty_paths) {
        Ok(result) => {
            if !result.updated_paths.is_empty() {
                let mut guard = match index.inner.lock() {
                    Ok(guard) => guard,
                    Err(error) => {
                        return map_err(AppError::message(format!("wiki index lock: {error}")))
                    }
                };
                if let Err(error) = guard.rebuild(&args.vault_path) {
                    return map_err(AppError::message(format!(
                        "aliases updated but Wiki index rebuild failed: {error}"
                    )));
                }
            }
            ApiResult::ok(result)
        }
        Err(error) => ApiResult::err_with_details(
            AppError::message(error.to_string()),
            serde_json::to_value(&error).unwrap_or_default(),
        ),
    }
}

#[tauri::command]
pub fn doctor_plan_wikilinks(args: DoctorPlanWikilinksArgs) -> ApiResult<WikilinkRepairPlan> {
    let vault = PathBuf::from(&args.vault_path);
    if !vault.is_dir() {
        return map_err(AppError::message("vault path is not a directory"));
    }
    match plan_wikilink_repairs(&vault) {
        Ok(plan) => ApiResult::ok(plan),
        Err(error) => ApiResult::err_with_details(
            AppError::message(error.to_string()),
            serde_json::to_value(&error).unwrap_or_default(),
        ),
    }
}

#[tauri::command]
pub fn doctor_apply_wikilinks(
    args: DoctorApplyWikilinksArgs,
    index: State<'_, WikiIndexState>,
    dirty_state: State<'_, DoctorDirtyPathsState>,
) -> ApiResult<WikilinkRepairResult> {
    let vault = PathBuf::from(&args.vault_path);
    let mut dirty_paths = match dirty_state.get(&args.vault_path) {
        Ok(paths) => paths,
        Err(error) => {
            return map_err(AppError::message(format!(
                "doctor dirty paths lock: {error}"
            )))
        }
    };
    dirty_paths.extend(args.dirty_paths);
    match apply_wikilink_repairs(&vault, &args.changes, &dirty_paths) {
        Ok(result) => {
            if !result.updated_paths.is_empty() {
                let mut guard = match index.inner.lock() {
                    Ok(guard) => guard,
                    Err(error) => {
                        return map_err(AppError::message(format!("wiki index lock: {error}")))
                    }
                };
                if let Err(error) = guard.rebuild(&args.vault_path) {
                    return map_err(AppError::message(format!(
                        "wikilinks updated but Wiki index rebuild failed: {error}"
                    )));
                }
            }
            ApiResult::ok(result)
        }
        Err(error) => ApiResult::err_with_details(
            AppError::message(error.to_string()),
            serde_json::to_value(&error).unwrap_or_default(),
        ),
    }
}
