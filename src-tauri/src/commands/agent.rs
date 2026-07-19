use crate::error::{map_err, ApiResult, AppError};
use crate::models::agent::{
    AgentDescriptor, AgentListResponse, AgentSkill, AgentTemplate, AgentTemplateInfo,
    CatalogScanResponse, ProbeResult, RunOnceAccepted, RunOnceRequest, UpsertAgentRequest,
    WarmRequest, WarmResult,
};
use crate::services::agent::codex::{CodexThreadHistory, CodexThreadInfo};
use crate::services::agent::templates::template_info;
use crate::services::agent::{
    builtin_templates, codex_list_threads, codex_read_thread, list_agent_skills, new_ids,
    prepare_codex_thread, probe_agent, probe_codex, run_codex_turn, run_once, warm_agent,
    warm_codex, AgentEventEmitter, AgentRegistry, AgentRunController, PermissionGate,
    PermissionPolicy,
};
use crate::services::remote::{
    notes_rel_from_target, read_remote_note, resolve_remote_target, RemoteRegistry,
};
use crate::services::terminal;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
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
        probe_agent(&desc, None).await
    };
    let _ = registry.apply_probe_result(&id, &result);
    Ok(ApiResult::ok(result))
}

/// Open a system terminal that shows the template's install command and waits for
/// the user to press Enter before running it. Only templates with a registered
/// `install_command` are allowed (no free-form shell from the UI).
#[tauri::command]
pub fn agent_open_install_terminal(template_id: String) -> ApiResult<serde_json::Value> {
    let info = match template_info(&template_id) {
        Some(t) => t,
        None => {
            return map_err(AppError::message(format!(
                "unknown catalog template: {template_id}"
            )));
        }
    };
    let command = match info.install_command {
        Some(c) if !c.trim().is_empty() => c,
        _ => {
            return map_err(AppError::message(format!(
                "no install command for template: {template_id}"
            )));
        }
    };
    match terminal::open_terminal_confirm_command(&command) {
        Ok(()) => ApiResult::ok(serde_json::Value::Null),
        Err(e) => map_err(e),
    }
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
        probe_agent(&desc, None).await
    };
    let _ = registry.apply_probe_result(&desc.id, &result);
    Ok(ApiResult::ok(result))
}

#[tauri::command]
pub async fn agent_run_once(
    window: tauri::WebviewWindow,
    registry: State<'_, AgentRegistry>,
    runs: State<'_, AgentRunController>,
    gate: State<'_, PermissionGate>,
    remote_registry: State<'_, Arc<RemoteRegistry>>,
    request: RunOnceRequest,
) -> Result<ApiResult<RunOnceAccepted>, String> {
    use crate::log_util::{trunc, OpTimer};

    let op = OpTimer::start_with(
        "agent_run_once",
        format!(
            "agent_id={} prompt_len={} images={}",
            request.agent_id.as_deref().unwrap_or("default"),
            request.prompt.chars().count(),
            request.images.len()
        ),
    );
    if request.prompt.trim().is_empty() && request.images.is_empty() {
        let err = AppError::message("prompt or images are required");
        op.finish_err(&err);
        return Ok(map_err(err));
    }

    let desc = match registry.resolve_default(request.agent_id.as_deref()) {
        Ok(d) => d,
        Err(e) => {
            op.finish_err(&e);
            return Ok(map_err(e));
        }
    };

    let remote_target_early =
        match resolve_remote_target(remote_registry.inner(), request.vault_path.as_deref()).await {
            Ok(t) => t,
            Err(e) => {
                op.finish_err(&e);
                return Ok(map_err(e));
            }
        };
    if desc.template == AgentTemplate::CodexAcp
        && remote_target_early.as_ref().is_some_and(|r| r.is_ssh())
    {
        let err = AppError::message(
            "Codex on remote SSH vault is not supported yet; use an ACP agent installed on the server",
        );
        op.finish_err(&err);
        return Ok(map_err(err));
    }
    // local-sim: Codex sees the real local directory path
    let codex_vault_path = remote_target_early
        .as_ref()
        .filter(|r| !r.is_ssh())
        .map(|r| r.remote_cwd.clone())
        .or_else(|| request.vault_path.clone());

    let (generated_session_id, message_id) = new_ids();
    let prepared_codex_thread = if desc.template == AgentTemplate::CodexAcp {
        match prepare_codex_thread(
            &desc,
            request.session_id.clone(),
            codex_vault_path,
            request.model_id.clone(),
            request.auto_approve,
            !request.hide_from_chat_history,
        )
        .await
        {
            Ok(thread) => Some(thread),
            Err(error) => {
                op.finish_err(&error);
                return Ok(map_err(error));
            }
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
            op.finish_err(&error);
            return Ok(map_err(error));
        }
    };

    let app_handle = window.app_handle().clone();
    let events = AgentEventEmitter::new(app_handle.clone(), window.label());
    let permission_gate = gate.inner().clone();
    let permission_policy = match request.permission_mode.as_deref() {
        Some("auto") => PermissionPolicy::Auto,
        Some("ask") => PermissionPolicy::Ask,
        // Back-compat: older clients only send `auto_approve`.
        _ if request.auto_approve => PermissionPolicy::Auto,
        _ => PermissionPolicy::Restricted,
    };
    let log_session_id = session_id.clone();
    let log_agent_id = desc.id.clone();
    let session_agent_id = log_agent_id.clone();
    // Trust loop: snapshot the target note before the run so we can offer a
    // keep / revert review if the agent rewrites it.
    let remote_target = remote_target_early;
    let remote_for_spawn = remote_target.clone();
    let snapshot_path = if remote_target.is_some() {
        None
    } else {
        request
            .vault_path
            .as_deref()
            .zip(request.target.as_deref())
            .and_then(|(v, t)| snapshot_notes_path(v, t))
    };
    let notes_before = snapshot_path.as_ref().and_then(|p| read_note_snapshot(p));
    let remote_notes_rel = request
        .target
        .as_deref()
        .filter(|_| remote_target.is_some())
        .map(notes_rel_from_target);
    let notes_before_remote =
        if let (Some(rt), Some(rel)) = (remote_target.as_ref(), remote_notes_rel.as_ref()) {
            read_remote_note(&rt.session, rel).await.ok().flatten()
        } else {
            None
        };
    // Codex native path still expects a real local cwd; remote SSH uses ACP-style
    // ssh wrap only for generic ACP agents. For Codex + remote, rewrite vault_path
    // to work_root for thread index and remote_cwd for process (via remote target).
    tauri::async_runtime::spawn(async move {
        if desc.template == AgentTemplate::CodexAcp {
            if let Some(prepared_codex_thread) = prepared_codex_thread {
                // Codex turn path is text-first; image bytes are not forwarded yet.
                // Remote vaults: codex still runs only for local-sim (local path);
                // pure SSH remote is rejected earlier if prepare failed.
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
                request.target.clone(),
                request.vault_path,
                request.model_id,
                request.reasoning_effort,
                request.fast_mode,
                request.skill_ids,
                permission_policy,
                permission_gate.clone(),
                request.response_language,
                cancellation,
                remote_for_spawn,
            )
            .await;
        }
        let _ = app_handle.state::<AgentRunController>().finish(&session_id);
        // Trust loop: if the run rewrote the target note, offer keep / revert.
        if let (Some(path), Some(before)) = (&snapshot_path, &notes_before) {
            if let Some(after) = read_note_snapshot(path) {
                if &after != before {
                    let _ = events.emit(
                        "agent:notes-review",
                        NotesReviewEvent {
                            path: path.to_string_lossy().to_string(),
                            before: before.clone(),
                            after,
                        },
                    );
                }
            }
        } else if let (Some(rt), Some(rel), Some(before)) = (
            remote_target.as_ref(),
            remote_notes_rel.as_ref(),
            notes_before_remote.as_ref(),
        ) {
            if let Ok(Some(after)) = read_remote_note(&rt.session, rel).await {
                if &after != before {
                    let _ = events.emit(
                        "agent:notes-review",
                        NotesReviewEvent {
                            path: rel.clone(),
                            before: before.clone(),
                            after,
                        },
                    );
                }
            }
        }
        log::info!(
            target: "agentero::op",
            "op end agent_run_session session_id={} agent_id={}",
            trunc(&session_id, 48),
            trunc(&session_agent_id, 48)
        );
    });

    op.finish_ok_extra(format!(
        "session_id={} agent_id={} accepted=true",
        trunc(&log_session_id, 48),
        trunc(&log_agent_id, 48)
    ));
    Ok(ApiResult::ok(accepted))
}

/// Read native Codex threads. The App Server owns the actual history; Agentero only
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

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponseRequest {
    pub request_id: String,
    /// Chosen option id; `None` cancels the request.
    #[serde(default)]
    pub option_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionResponded {
    pub resolved: bool,
}

/// Answer a pending ACP permission request (ask mode). `option_id = None` cancels.
#[tauri::command]
pub fn agent_respond_permission(
    gate: State<'_, PermissionGate>,
    request: PermissionResponseRequest,
) -> ApiResult<PermissionResponded> {
    let resolved = gate.resolve(&request.request_id, request.option_id);
    ApiResult::ok(PermissionResponded { resolved })
}

/// Payload for the `agent:notes-review` event: a note the agent modified this
/// run, offered to the user for keep / revert (trust loop).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotesReviewEvent {
    path: String,
    before: String,
    after: String,
}

/// Resolve the note file a run may edit: the target itself when it is a `.md`
/// file, or the paper folder's `NOTES.md` when the target is a folder.
fn snapshot_notes_path(vault: &str, target: &str) -> Option<PathBuf> {
    let t = target.trim().trim_matches('/');
    if t.is_empty() || t.contains("..") {
        return None;
    }
    let abs = PathBuf::from(vault).join(t);
    if abs.extension().and_then(|e| e.to_str()) == Some("md") {
        Some(abs)
    } else {
        Some(abs.join("NOTES.md"))
    }
}

/// Read a note's current content (None when missing / unreadable).
fn read_note_snapshot(path: &std::path::Path) -> Option<String> {
    std::fs::read_to_string(path).ok()
}

/// Background ACP start when Chat opens — loads models/context without a user prompt.
#[tauri::command]
pub async fn agent_warm(
    window: tauri::WebviewWindow,
    registry: State<'_, AgentRegistry>,
    remote_registry: State<'_, Arc<RemoteRegistry>>,
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

    let remote =
        match resolve_remote_target(remote_registry.inner(), request.vault_path.as_deref()).await {
            Ok(t) => t,
            Err(e) => {
                return Ok(ApiResult::ok(WarmResult {
                    agent_id: desc.id,
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
        if remote.as_ref().is_some_and(|r| r.is_ssh()) {
            WarmResult {
                agent_id: desc.id,
                ok: false,
                models: None,
                usage_used: None,
                usage_size: None,
                error: Some(
                    "Codex on remote SSH vault is not supported yet; use an ACP agent (OpenCode / Claude) installed on the server"
                        .into(),
                ),
            }
        } else {
            // local-sim: use real local path as vault
            let vault = remote
                .as_ref()
                .map(|r| r.remote_cwd.clone())
                .or(request.vault_path);
            warm_codex(events, desc, vault, request.model_id).await
        }
    } else {
        warm_agent(events, desc, request.vault_path, request.model_id, remote).await
    };
    Ok(ApiResult::ok(result))
}
