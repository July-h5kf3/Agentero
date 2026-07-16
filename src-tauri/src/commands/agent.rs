use crate::error::{map_err, ApiResult, AppError};
use crate::models::agent::{
    AgentDescriptor, AgentListResponse, AgentSkill, AgentTemplate, AgentTemplateInfo,
    CatalogScanResponse, ProbeResult, RunOnceAccepted, RunOnceRequest, UpsertAgentRequest,
    WarmRequest, WarmResult,
};
use crate::services::agent::codex::{CodexThreadHistory, CodexThreadInfo};
use crate::services::agent::{
    builtin_templates, codex_list_threads, codex_read_thread, list_agent_skills, new_ids,
    prepare_codex_thread, probe_agent, probe_codex, run_codex_turn, run_once, warm_agent,
    warm_codex, AgentEventEmitter, AgentRegistry, AgentRunController,
};
use serde::Serialize;
use tauri::{Manager, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentOnly {
    pub agent: AgentDescriptor,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplatesResponse {
    pub templates: Vec<AgentTemplateInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnabledResponse {
    pub enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProxyResponse {
    pub proxy_enabled: bool,
    pub proxy_url: String,
}

fn list_from_state(state: crate::models::agent::AgentRegistryState) -> AgentListResponse {
    AgentListResponse {
        agents: state.agents,
        default_id: state.default_id,
        enabled: state.enabled,
    }
}

#[tauri::command]
pub fn agent_list_agents(registry: State<'_, AgentRegistry>) -> ApiResult<AgentListResponse> {
    match registry.snapshot() {
        Ok(s) => ApiResult::ok(list_from_state(s)),
        Err(e) => map_err(e),
    }
}

#[tauri::command]
pub fn agent_list_templates() -> ApiResult<TemplatesResponse> {
    ApiResult::ok(TemplatesResponse {
        templates: builtin_templates(),
    })
}

#[tauri::command]
pub fn agent_list_skills(vault_path: Option<String>) -> ApiResult<Vec<AgentSkill>> {
    ApiResult::ok(list_agent_skills(vault_path.as_deref()))
}

#[tauri::command]
pub fn agent_scan_catalog(registry: State<'_, AgentRegistry>) -> ApiResult<CatalogScanResponse> {
    match registry.scan_catalog() {
        Ok(s) => ApiResult::ok(s),
        Err(e) => map_err(e),
    }
}

#[tauri::command]
pub fn agent_upsert_agent(
    registry: State<'_, AgentRegistry>,
    request: UpsertAgentRequest,
) -> ApiResult<AgentOnly> {
    match registry.upsert(request) {
        Ok(agent) => ApiResult::ok(AgentOnly { agent }),
        Err(e) => map_err(e),
    }
}

#[tauri::command]
pub fn agent_ensure_catalog(
    registry: State<'_, AgentRegistry>,
    template_id: String,
    set_default: bool,
) -> ApiResult<AgentOnly> {
    match registry.ensure_catalog_agent(&template_id, set_default) {
        Ok(agent) => ApiResult::ok(AgentOnly { agent }),
        Err(e) => map_err(e),
    }
}

#[tauri::command]
pub fn agent_remove_agent(
    registry: State<'_, AgentRegistry>,
    id: String,
) -> ApiResult<serde_json::Value> {
    match registry.remove(&id) {
        Ok(()) => ApiResult::ok(serde_json::Value::Null),
        Err(e) => map_err(e),
    }
}

#[tauri::command]
pub fn agent_set_default(
    registry: State<'_, AgentRegistry>,
    id: Option<String>,
) -> ApiResult<AgentListResponse> {
    match registry.set_default(id) {
        Ok(s) => ApiResult::ok(list_from_state(s)),
        Err(e) => map_err(e),
    }
}

#[tauri::command]
pub fn agent_set_enabled(
    registry: State<'_, AgentRegistry>,
    enabled: bool,
) -> ApiResult<EnabledResponse> {
    match registry.set_enabled(enabled) {
        Ok(s) => ApiResult::ok(EnabledResponse { enabled: s.enabled }),
        Err(e) => map_err(e),
    }
}

#[tauri::command]
pub fn agent_set_proxy(
    registry: State<'_, AgentRegistry>,
    proxy_enabled: bool,
    proxy_url: String,
) -> ApiResult<AgentProxyResponse> {
    match registry.set_proxy(proxy_enabled, proxy_url) {
        Ok(s) => ApiResult::ok(AgentProxyResponse {
            proxy_enabled: s.proxy_enabled,
            proxy_url: s.proxy_url,
        }),
        Err(e) => map_err(e),
    }
}

#[tauri::command]
pub fn agent_discover(
    registry: State<'_, AgentRegistry>,
    id: Option<String>,
) -> ApiResult<AgentListResponse> {
    match registry.discover(id.as_deref()) {
        Ok(_) => match registry.snapshot() {
            Ok(s) => ApiResult::ok(list_from_state(s)),
            Err(e) => map_err(e),
        },
        Err(e) => map_err(e),
    }
}

#[tauri::command]
pub async fn agent_probe(
    registry: State<'_, AgentRegistry>,
    id: String,
) -> Result<ApiResult<ProbeResult>, String> {
    let desc = match registry.get(&id) {
        Ok(d) => d,
        Err(e) => return Ok(map_err(e)),
    };
    if !desc.available {
        let result = ProbeResult {
            agent_id: id.clone(),
            available: false,
            agent_name: None,
            protocol_version: None,
            error: desc
                .last_error
                .or_else(|| Some(format!("command `{}` not found on PATH", desc.command))),
        };
        let _ = registry.apply_probe_result(&id, &result);
        return Ok(ApiResult::ok(result));
    }
    let result = if desc.template == AgentTemplate::CodexAcp {
        probe_codex(&desc).await
    } else {
        probe_agent(&desc).await
    };
    let _ = registry.apply_probe_result(&id, &result);
    Ok(ApiResult::ok(result))
}

/// Ensure catalog agent is registered, then run ACP initialize probe.
#[tauri::command]
pub async fn agent_probe_catalog(
    registry: State<'_, AgentRegistry>,
    template_id: String,
) -> Result<ApiResult<ProbeResult>, String> {
    let desc = match registry.ensure_catalog_agent(&template_id, false) {
        Ok(d) => d,
        Err(e) => return Ok(map_err(e)),
    };
    if !desc.available {
        let result = ProbeResult {
            agent_id: desc.id.clone(),
            available: false,
            agent_name: None,
            protocol_version: None,
            error: desc
                .last_error
                .or_else(|| Some(format!("command `{}` not found on PATH", desc.command))),
        };
        let _ = registry.apply_probe_result(&desc.id, &result);
        return Ok(ApiResult::ok(result));
    }
    let result = if desc.template == AgentTemplate::CodexAcp {
        probe_codex(&desc).await
    } else {
        probe_agent(&desc).await
    };
    let _ = registry.apply_probe_result(&desc.id, &result);
    Ok(ApiResult::ok(result))
}

#[tauri::command]
pub async fn agent_run_once(
    window: tauri::WebviewWindow,
    registry: State<'_, AgentRegistry>,
    runs: State<'_, AgentRunController>,
    request: RunOnceRequest,
) -> Result<ApiResult<RunOnceAccepted>, String> {
    if request.prompt.trim().is_empty() && request.images.is_empty() {
        return Ok(map_err(AppError::message("prompt or images are required")));
    }

    let desc = match registry.resolve_default(request.agent_id.as_deref()) {
        Ok(d) => d,
        Err(e) => return Ok(map_err(e)),
    };

    let (generated_session_id, message_id) = new_ids();
    let prepared_codex_thread = if desc.template == AgentTemplate::CodexAcp {
        match prepare_codex_thread(
            &desc,
            request.session_id.clone(),
            request.vault_path.clone(),
            request.model_id.clone(),
            request.auto_approve,
        )
        .await
        {
            Ok(thread) => Some(thread),
            Err(error) => return Ok(map_err(error)),
        }
    } else {
        None
    };
    let session_id = prepared_codex_thread
        .as_ref()
        .map(|thread| thread.thread_id().to_string())
        .unwrap_or(generated_session_id);
    let accepted = RunOnceAccepted {
        session_id: session_id.clone(),
        message_id: message_id.clone(),
        agent_id: desc.id.clone(),
    };

    let cancellation = match runs.register(&session_id) {
        Ok(cancellation) => cancellation,
        Err(error) => {
            if let Some(thread) = prepared_codex_thread {
                thread.shutdown().await;
            }
            return Ok(map_err(error));
        }
    };

    let app_handle = window.app_handle().clone();
    let events = AgentEventEmitter::new(app_handle.clone(), window.label());
    tauri::async_runtime::spawn(async move {
        if desc.template == AgentTemplate::CodexAcp {
            if let Some(prepared_codex_thread) = prepared_codex_thread {
                // Codex turn path is text-first; image bytes are not forwarded yet.
                run_codex_turn(
                    events.clone(),
                    prepared_codex_thread,
                    message_id,
                    request.prompt,
                    request.workflow,
                    request.target,
                    request.vault_path,
                    request.model_id,
                    request.reasoning_effort,
                    request.fast_mode,
                    request.skill_ids,
                    request.auto_approve,
                    request.response_language,
                    cancellation,
                )
                .await;
            }
        } else {
            let _ = run_once(
                events.clone(),
                desc,
                session_id.clone(),
                message_id,
                request.prompt,
                request.images,
                request.workflow,
                request.target,
                request.vault_path,
                request.model_id,
                request.reasoning_effort,
                request.fast_mode,
                request.skill_ids,
                request.auto_approve,
                request.response_language,
                cancellation,
            )
            .await;
        }
        let _ = app_handle.state::<AgentRunController>().finish(&session_id);
    });

    Ok(ApiResult::ok(accepted))
}

/// Read native Codex threads. The App Server owns the actual history; Motif only
/// filters it to the current Vault and renders it locally.
#[tauri::command]
pub async fn agent_codex_list_threads(
    registry: State<'_, AgentRegistry>,
    agent_id: Option<String>,
    vault_path: Option<String>,
    include_external: bool,
) -> Result<ApiResult<Vec<CodexThreadInfo>>, String> {
    let desc = match registry.resolve_default(agent_id.as_deref()) {
        Ok(desc) if desc.template == AgentTemplate::CodexAcp => desc,
        Ok(_) => {
            return Ok(map_err(AppError::message(
                "Codex history is only available for the Codex provider",
            )))
        }
        Err(error) => return Ok(map_err(error)),
    };
    match codex_list_threads(&desc, vault_path, include_external).await {
        Ok(threads) => Ok(ApiResult::ok(threads)),
        Err(error) => Ok(map_err(error)),
    }
}

/// Hydrate an existing Codex thread from its native JSONL transcript without
/// copying that transcript into the Vault.
#[tauri::command]
pub async fn agent_codex_read_thread(
    registry: State<'_, AgentRegistry>,
    agent_id: Option<String>,
    thread_id: String,
    vault_path: Option<String>,
    include_external: bool,
) -> Result<ApiResult<CodexThreadHistory>, String> {
    let desc = match registry.resolve_default(agent_id.as_deref()) {
        Ok(desc) if desc.template == AgentTemplate::CodexAcp => desc,
        Ok(_) => {
            return Ok(map_err(AppError::message(
                "Codex history is only available for the Codex provider",
            )))
        }
        Err(error) => return Ok(map_err(error)),
    };
    match codex_read_thread(&desc, thread_id, vault_path, include_external).await {
        Ok(thread) => Ok(ApiResult::ok(thread)),
        Err(error) => Ok(map_err(error)),
    }
}

/// Request cooperative cancellation for a currently streaming ACP session.
#[tauri::command]
pub fn agent_cancel_run(
    runs: State<'_, AgentRunController>,
    session_id: String,
) -> ApiResult<bool> {
    match runs.cancel(&session_id) {
        Ok(()) => ApiResult::ok(true),
        Err(e) => map_err(e),
    }
}

/// Background ACP start when Chat opens — loads models/context without a user prompt.
#[tauri::command]
pub async fn agent_warm(
    window: tauri::WebviewWindow,
    registry: State<'_, AgentRegistry>,
    request: WarmRequest,
) -> Result<ApiResult<WarmResult>, String> {
    let desc = match registry.resolve_default(request.agent_id.as_deref()) {
        Ok(d) => d,
        Err(e) => {
            return Ok(ApiResult::ok(WarmResult {
                agent_id: request.agent_id.unwrap_or_default(),
                ok: false,
                models: None,
                usage_used: None,
                usage_size: None,
                error: Some(e.to_string()),
            }));
        }
    };

    let events = AgentEventEmitter::new(window.app_handle().clone(), window.label());
    let result = if desc.template == AgentTemplate::CodexAcp {
        warm_codex(events, desc, request.vault_path, request.model_id).await
    } else {
        warm_agent(events, desc, request.vault_path, request.model_id).await
    };
    Ok(ApiResult::ok(result))
}
