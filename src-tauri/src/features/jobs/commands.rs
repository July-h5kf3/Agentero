use crate::core::error::{map_err, ApiResult};
use serde::Deserialize;
use std::path::PathBuf;
use tauri::State;

use super::{emit_job_changed, parse_lane, validate_job_paper, JobCenter, JobLane, JobSnapshot};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobParseRefsEnqueueArgs {
    pub vault_path: String,
    pub path: String,
    #[serde(default)]
    pub lane: Option<JobLane>,
    #[serde(default)]
    pub force: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobParseBodyEnqueueArgs {
    pub vault_path: String,
    pub path: String,
    #[serde(default)]
    pub lane: Option<JobLane>,
    #[serde(default)]
    pub force: bool,
    #[serde(default)]
    pub task_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobFocusPaperArgs {
    pub vault_path: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobListArgs {
    #[serde(default)]
    pub vault_path: Option<String>,
    #[serde(default)]
    pub path: Option<String>,
}

#[tauri::command]
pub async fn job_parse_refs_enqueue(
    app: tauri::AppHandle,
    center: State<'_, JobCenter>,
    args: JobParseRefsEnqueueArgs,
) -> Result<ApiResult<JobSnapshot>, String> {
    let (vault, path) = match validate_job_paper(&args.vault_path, &args.path) {
        Ok(valid) => valid,
        Err(e) => return Ok(map_err(e)),
    };
    let snapshot = center
        .enqueue_parse_refs(&vault, &path, parse_lane(args.lane), args.force)
        .await;
    emit_job_changed(&app, snapshot.clone());

    let job_id = snapshot.id.clone();
    let runner = center.handle();
    tauri::async_runtime::spawn(async move {
        runner.run_parse_refs_job(app, job_id).await;
    });

    Ok(ApiResult::ok(snapshot))
}

#[tauri::command]
pub async fn job_parse_body_enqueue(
    app: tauri::AppHandle,
    center: State<'_, JobCenter>,
    args: JobParseBodyEnqueueArgs,
) -> Result<ApiResult<JobSnapshot>, String> {
    let (vault, path) = match validate_job_paper(&args.vault_path, &args.path) {
        Ok(valid) => valid,
        Err(e) => return Ok(map_err(e)),
    };
    let snapshot = center
        .enqueue_parse_body(
            &vault,
            &path,
            parse_lane(args.lane),
            args.force,
            args.task_id,
        )
        .await;
    emit_job_changed(&app, snapshot.clone());

    let job_id = snapshot.id.clone();
    let runner = center.handle();
    tauri::async_runtime::spawn(async move {
        runner.run_parse_body_job(app, job_id).await;
    });

    Ok(ApiResult::ok(snapshot))
}

#[tauri::command]
pub async fn job_focus_paper(
    app: tauri::AppHandle,
    center: State<'_, JobCenter>,
    args: JobFocusPaperArgs,
) -> Result<ApiResult<Vec<JobSnapshot>>, String> {
    let (vault, path) = match validate_job_paper(&args.vault_path, &args.path) {
        Ok(valid) => valid,
        Err(e) => return Ok(map_err(e)),
    };
    let promoted = center.promote_paper(&vault, &path).await;
    for snapshot in &promoted {
        emit_job_changed(&app, snapshot.clone());
    }
    Ok(ApiResult::ok(promoted))
}

#[tauri::command]
pub async fn job_cancel(
    center: State<'_, JobCenter>,
    job_id: String,
) -> Result<ApiResult<bool>, String> {
    Ok(ApiResult::ok(center.cancel(&job_id).await))
}

#[tauri::command]
pub async fn job_list(
    center: State<'_, JobCenter>,
    args: JobListArgs,
) -> Result<ApiResult<Vec<JobSnapshot>>, String> {
    let vault = args
        .vault_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from);
    Ok(ApiResult::ok(
        center.list(vault.as_deref(), args.path.as_deref()).await,
    ))
}
