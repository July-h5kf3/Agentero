use crate::error::AppError;
use crate::models::agent::{
    AgentDescriptor, AgentFailedEvent, AgentModelChoice, AgentModelsEvent, AgentPlanEntry,
    AgentPlanEvent, AgentResultPayload, AgentStreamEvent, AgentStreamKind, AgentToolEvent,
    AgentUsageEvent, ProbeResult,
};
use crate::services::agent::prompts::{build_prompt, extract_sources};
use agent_client_protocol::schema::v1::{
    ContentBlock, EnvVariable, InitializeRequest, McpServer, McpServerStdio, NewSessionRequest,
    PlanEntryPriority, PlanEntryStatus, PromptRequest, RequestPermissionOutcome,
    RequestPermissionRequest, RequestPermissionResponse, SelectedPermissionOutcome,
    SessionConfigId, SessionConfigKind, SessionConfigOption, SessionConfigOptionCategory,
    SessionConfigOptionValue, SessionConfigSelectOptions, SessionNotification, SessionUpdate,
    SetSessionConfigOptionRequest, TextContent, ToolCallStatus, ToolKind,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{util, AcpAgent, Agent, ConnectionTo};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

fn to_acp_agent(desc: &AgentDescriptor) -> Result<AcpAgent, AppError> {
    let env: Vec<EnvVariable> = desc
        .env
        .iter()
        .map(|(k, v)| EnvVariable::new(k.clone(), v.clone()))
        .collect();

    let stdio = McpServerStdio::new(desc.name.clone(), PathBuf::from(&desc.command))
        .args(desc.args.clone())
        .env(env);
    Ok(AcpAgent::new(McpServer::Stdio(stdio)))
}

fn text_from_content_block(block: &ContentBlock) -> Option<String> {
    match block {
        ContentBlock::Text(t) => Some(t.text.clone()),
        _ => None,
    }
}

fn stream_from_update(update: &SessionUpdate) -> Option<(String, AgentStreamKind)> {
    match update {
        SessionUpdate::AgentMessageChunk(chunk) => {
            text_from_content_block(&chunk.content).map(|t| (t, AgentStreamKind::Message))
        }
        SessionUpdate::AgentThoughtChunk(chunk) => {
            text_from_content_block(&chunk.content).map(|t| (t, AgentStreamKind::Thought))
        }
        _ => None,
    }
}

fn tool_status_str(s: ToolCallStatus) -> &'static str {
    match s {
        ToolCallStatus::Pending => "pending",
        ToolCallStatus::InProgress => "in_progress",
        ToolCallStatus::Completed => "completed",
        ToolCallStatus::Failed => "failed",
        _ => "pending",
    }
}

fn tool_kind_str(k: ToolKind) -> &'static str {
    match k {
        ToolKind::Read => "read",
        ToolKind::Edit => "edit",
        ToolKind::Delete => "delete",
        ToolKind::Move => "move",
        ToolKind::Search => "search",
        ToolKind::Execute => "execute",
        ToolKind::Think => "think",
        ToolKind::Fetch => "fetch",
        ToolKind::SwitchMode => "switch_mode",
        ToolKind::Other => "other",
        _ => "other",
    }
}

fn plan_status_str(s: &PlanEntryStatus) -> &'static str {
    match s {
        PlanEntryStatus::Pending => "pending",
        PlanEntryStatus::InProgress => "in_progress",
        PlanEntryStatus::Completed => "completed",
        _ => "pending",
    }
}

fn plan_priority_str(p: &PlanEntryPriority) -> &'static str {
    match p {
        PlanEntryPriority::High => "high",
        PlanEntryPriority::Medium => "medium",
        PlanEntryPriority::Low => "low",
        _ => "medium",
    }
}

fn is_model_config(opt: &SessionConfigOption) -> bool {
    matches!(
        opt.category.as_ref(),
        Some(SessionConfigOptionCategory::Model)
    ) || opt.name.to_ascii_lowercase().contains("model")
}

/// Extract model selector catalog from ACP session config options.
fn models_from_config_options(
    session_id: &str,
    agent_id: &str,
    opts: &[SessionConfigOption],
) -> Option<AgentModelsEvent> {
    for opt in opts {
        if !is_model_config(opt) {
            continue;
        }
        let SessionConfigKind::Select(sel) = &opt.kind else {
            continue;
        };
        let mut models = Vec::new();
        match &sel.options {
            SessionConfigSelectOptions::Ungrouped(list) => {
                for o in list {
                    models.push(AgentModelChoice {
                        id: o.value.to_string(),
                        name: o.name.clone(),
                        group: None,
                    });
                }
            }
            SessionConfigSelectOptions::Grouped(groups) => {
                for g in groups {
                    for o in &g.options {
                        models.push(AgentModelChoice {
                            id: o.value.to_string(),
                            name: o.name.clone(),
                            group: Some(g.name.clone()),
                        });
                    }
                }
            }
            _ => {}
        }
        if models.is_empty() {
            continue;
        }
        return Some(AgentModelsEvent {
            session_id: session_id.to_string(),
            agent_id: agent_id.to_string(),
            config_id: opt.id.to_string(),
            current_id: sel.current_value.to_string(),
            models,
        });
    }
    None
}

fn emit_rich_session_update(
    app: &AppHandle,
    session_id: &str,
    agent_id: &str,
    update: &SessionUpdate,
) {
    match update {
        SessionUpdate::ConfigOptionUpdate(upd) => {
            if let Some(ev) = models_from_config_options(session_id, agent_id, &upd.config_options)
            {
                let _ = app.emit("agent:models", ev);
            }
        }
        SessionUpdate::ToolCall(tc) => {
            let _ = app.emit(
                "agent:tool",
                AgentToolEvent {
                    session_id: session_id.to_string(),
                    tool_call_id: tc.tool_call_id.to_string(),
                    title: Some(tc.title.clone()),
                    kind: Some(tool_kind_str(tc.kind).to_string()),
                    status: Some(tool_status_str(tc.status).to_string()),
                    input: tc.raw_input.clone(),
                    output: tc.raw_output.clone(),
                    full: true,
                },
            );
        }
        SessionUpdate::ToolCallUpdate(upd) => {
            let f = &upd.fields;
            let _ = app.emit(
                "agent:tool",
                AgentToolEvent {
                    session_id: session_id.to_string(),
                    tool_call_id: upd.tool_call_id.to_string(),
                    title: f.title.clone(),
                    kind: f.kind.map(tool_kind_str).map(str::to_string),
                    status: f.status.map(tool_status_str).map(str::to_string),
                    input: f.raw_input.clone(),
                    output: f.raw_output.clone(),
                    full: false,
                },
            );
        }
        SessionUpdate::Plan(plan) => {
            let entries = plan
                .entries
                .iter()
                .map(|e| AgentPlanEntry {
                    content: e.content.clone(),
                    status: plan_status_str(&e.status).to_string(),
                    priority: plan_priority_str(&e.priority).to_string(),
                })
                .collect();
            let _ = app.emit(
                "agent:plan",
                AgentPlanEvent {
                    session_id: session_id.to_string(),
                    entries,
                },
            );
        }
        SessionUpdate::UsageUpdate(u) => {
            let _ = app.emit(
                "agent:usage",
                AgentUsageEvent {
                    session_id: session_id.to_string(),
                    used: u.used,
                    size: u.size,
                },
            );
        }
        _ => {}
    }
}

fn acp_err(msg: impl ToString) -> agent_client_protocol::Error {
    util::internal_error(msg)
}

/// Spawn agent, initialize ACP, report agent info. Does not send a user prompt.
pub async fn probe_agent(desc: &AgentDescriptor) -> ProbeResult {
    let agent_id = desc.id.clone();
    let acp = match to_acp_agent(desc) {
        Ok(a) => a,
        Err(e) => {
            return ProbeResult {
                agent_id,
                available: false,
                agent_name: None,
                protocol_version: None,
                error: Some(e.to_string()),
            };
        }
    };

    let captured: Arc<Mutex<Option<(String, String)>>> = Arc::new(Mutex::new(None));
    let captured_clone = captured.clone();

    let result = agent_client_protocol::Client
        .builder()
        .name("motif")
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _cx| {
                if let Some(opt) = request.options.first() {
                    let _ = responder.respond(RequestPermissionResponse::new(
                        RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                            opt.option_id.clone(),
                        )),
                    ));
                } else {
                    let _ = responder.respond(RequestPermissionResponse::new(
                        RequestPermissionOutcome::Cancelled,
                    ));
                }
                Ok(())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(acp, {
            let captured = captured_clone;
            move |connection: ConnectionTo<Agent>| async move {
                let init = connection
                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                    .block_task()
                    .await
                    .map_err(|e| acp_err(format!("initialize failed: {e}")))?;

                let name = init
                    .agent_info
                    .as_ref()
                    .map(|i| i.name.clone())
                    .unwrap_or_else(|| "unknown".into());
                let version = format!("{:?}", init.protocol_version);
                if let Ok(mut g) = captured.lock() {
                    *g = Some((name, version));
                }
                Ok(())
            }
        })
        .await;

    match result {
        Ok(()) => {
            let info = captured.lock().ok().and_then(|g| g.clone());
            match info {
                Some((name, version)) => ProbeResult {
                    agent_id,
                    available: true,
                    agent_name: Some(name),
                    protocol_version: Some(version),
                    error: None,
                },
                None => ProbeResult {
                    agent_id,
                    available: false,
                    agent_name: None,
                    protocol_version: None,
                    error: Some("no initialize response".into()),
                },
            }
        }
        Err(e) => ProbeResult {
            agent_id,
            available: false,
            agent_name: None,
            protocol_version: None,
            error: Some(e.to_string()),
        },
    }
}

/// One-shot prompt: spawn → initialize → session → prompt → stream events → completed/failed.
#[allow(clippy::too_many_arguments)]
pub async fn run_once(
    app: AppHandle,
    desc: AgentDescriptor,
    session_id: String,
    message_id: String,
    prompt: String,
    workflow: Option<String>,
    target: Option<String>,
    vault_path: Option<String>,
    preferred_model_id: Option<String>,
) -> Result<AgentResultPayload, AppError> {
    let full_prompt = build_prompt(workflow.as_deref(), &prompt, target.as_deref());
    let cwd = vault_path
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let acp = to_acp_agent(&desc)?;
    let content_buf: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let thought_buf: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let content_for_notif = content_buf.clone();
    let thought_for_notif = thought_buf.clone();
    let app_for_notif = app.clone();
    let session_for_notif = session_id.clone();
    let agent_id_for_notif = desc.id.clone();

    let stop_reason: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let stop_for_conn = stop_reason.clone();
    let content_for_conn = content_buf.clone();
    let thought_for_conn = thought_buf.clone();
    let session_for_conn = session_id.clone();
    let message_for_conn = message_id.clone();
    let app_for_conn = app.clone();

    let run_result = agent_client_protocol::Client
        .builder()
        .name("motif")
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                if let Some((chunk, kind)) = stream_from_update(&notification.update) {
                    match kind {
                        AgentStreamKind::Message => {
                            if let Ok(mut buf) = content_for_notif.lock() {
                                buf.push_str(&chunk);
                            }
                        }
                        AgentStreamKind::Thought => {
                            if let Ok(mut buf) = thought_for_notif.lock() {
                                buf.push_str(&chunk);
                            }
                        }
                    }
                    let _ = app_for_notif.emit(
                        "agent:stream",
                        AgentStreamEvent {
                            session_id: session_for_notif.clone(),
                            chunk,
                            kind,
                        },
                    );
                }
                emit_rich_session_update(
                    &app_for_notif,
                    &session_for_notif,
                    &agent_id_for_notif,
                    &notification.update,
                );
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _cx| {
                if let Some(opt) = request.options.first() {
                    let _ = responder.respond(RequestPermissionResponse::new(
                        RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                            opt.option_id.clone(),
                        )),
                    ));
                } else {
                    let _ = responder.respond(RequestPermissionResponse::new(
                        RequestPermissionOutcome::Cancelled,
                    ));
                }
                Ok(())
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(acp, {
            let full_prompt = full_prompt.clone();
            let preferred_model = preferred_model_id.clone();
            let app_for_models = app_for_conn.clone();
            let session_for_models = session_for_conn.clone();
            let agent_id_for_models = desc.id.clone();
            move |connection: ConnectionTo<Agent>| async move {
                connection
                    .send_request(InitializeRequest::new(ProtocolVersion::V1))
                    .block_task()
                    .await
                    .map_err(|e| acp_err(format!("initialize: {e}")))?;

                let new_session = connection
                    .send_request(NewSessionRequest::new(cwd))
                    .block_task()
                    .await
                    .map_err(|e| acp_err(format!("new_session: {e}")))?;

                let acp_session_id = new_session.session_id;
                if let Some(opts) = new_session.config_options.as_ref() {
                    if let Some(ev) =
                        models_from_config_options(&session_for_models, &agent_id_for_models, opts)
                    {
                        // Apply preferred model before prompt when it differs from current.
                        if let Some(pref) = preferred_model.clone() {
                            if pref != ev.current_id && ev.models.iter().any(|m| m.id == pref) {
                                let _ = connection
                                    .send_request(SetSessionConfigOptionRequest::new(
                                        acp_session_id.clone(),
                                        SessionConfigId::new(ev.config_id.as_str()),
                                        SessionConfigOptionValue::value_id(pref),
                                    ))
                                    .block_task()
                                    .await;
                            }
                        }
                        let _ = app_for_models.emit("agent:models", ev);
                    }
                }

                let prompt_response = connection
                    .send_request(PromptRequest::new(
                        acp_session_id,
                        vec![ContentBlock::Text(TextContent::new(full_prompt))],
                    ))
                    .block_task()
                    .await
                    .map_err(|e| acp_err(format!("prompt: {e}")))?;

                if let Ok(mut s) = stop_for_conn.lock() {
                    *s = Some(format!("{:?}", prompt_response.stop_reason));
                }

                let content = content_for_conn
                    .lock()
                    .map(|g| g.clone())
                    .unwrap_or_default();
                let reasoning = thought_for_conn
                    .lock()
                    .map(|g| g.clone())
                    .unwrap_or_default();
                let sources = extract_sources(&content);
                let payload = AgentResultPayload {
                    session_id: session_for_conn.clone(),
                    message_id: message_for_conn.clone(),
                    content,
                    reasoning: if reasoning.is_empty() {
                        None
                    } else {
                        Some(reasoning)
                    },
                    sources,
                    stop_reason: stop_for_conn.lock().ok().and_then(|g| g.clone()),
                };
                let _ = app_for_conn.emit("agent:completed", payload.clone());
                Ok(payload)
            }
        })
        .await;

    match run_result {
        Ok(payload) => Ok(payload),
        Err(e) => {
            let msg = e.to_string();
            let _ = app.emit(
                "agent:failed",
                AgentFailedEvent {
                    session_id: session_id.clone(),
                    error: msg.clone(),
                },
            );
            Err(AppError::Acp(msg))
        }
    }
}

pub fn new_ids() -> (String, String) {
    (Uuid::new_v4().to_string(), Uuid::new_v4().to_string())
}
