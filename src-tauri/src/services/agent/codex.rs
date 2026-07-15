use crate::error::AppError;
use crate::models::agent::{
    AgentDescriptor, AgentEffortChoice, AgentEffortEvent, AgentFailedEvent, AgentFastModeEvent,
    AgentModelChoice, AgentModelsEvent, AgentResultPayload, AgentStreamEvent, AgentStreamKind,
    AgentTemplate, AgentToolEvent, ProbeResult, WarmResult,
};
use crate::services::agent::discover::{path_entries, resolve_command};
use crate::services::agent::prompts::{build_prompt, extract_sources};
use crate::services::agent::skills::load_skill_instructions;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::watch;

const CLIENT_INFO: &str = "motif";
const MOTIF_THREAD_INDEX_PATH: &str = ".motif/agent-sessions/codex.json";
const RPC_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MotifCodexThreadIndex {
    #[serde(default = "default_thread_index_version")]
    version: u8,
    #[serde(default)]
    thread_ids: Vec<String>,
}

fn default_thread_index_version() -> u8 {
    1
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexThreadInfo {
    pub id: String,
    pub title: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexHistoryLine {
    pub id: String,
    pub kind: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexThreadHistory {
    pub thread: CodexThreadInfo,
    pub lines: Vec<CodexHistoryLine>,
}

struct CodexClient {
    child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    next_id: u64,
    notifications: Vec<(String, Value)>,
}

/// A loaded native thread whose App Server process must stay alive until its
/// first (or resumed) turn begins. A new thread has no rollout on disk yet.
pub struct PreparedCodexThread {
    thread_id: String,
    client: CodexClient,
}

impl PreparedCodexThread {
    pub fn thread_id(&self) -> &str {
        &self.thread_id
    }

    pub async fn shutdown(self) {
        self.client.shutdown().await;
    }
}

impl CodexClient {
    async fn spawn(desc: &AgentDescriptor, cwd: Option<&str>) -> Result<Self, AppError> {
        // Registries created before the migration may still point at the retired
        // npx ACP adapter. Continue to recognize them, but always launch Codex.
        let use_legacy_adapter = desc.template == AgentTemplate::CodexAcp && desc.command == "npx";
        let command_name = if use_legacy_adapter {
            "codex"
        } else {
            &desc.command
        };
        let args = if use_legacy_adapter {
            vec!["app-server".to_string()]
        } else {
            desc.args.clone()
        };
        let command = resolve_command(command_name).unwrap_or_else(|| PathBuf::from(command_name));
        let mut process = Command::new(command);
        process
            .args(&args)
            .kill_on_drop(true)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());
        if let Some(cwd) = cwd.filter(|value| !value.trim().is_empty()) {
            process.current_dir(cwd);
        }
        for (key, value) in &desc.env {
            process.env(key, value);
        }
        if !desc.env.contains_key("PATH") {
            if let Ok(path) = std::env::join_paths(path_entries()) {
                process.env("PATH", path);
            }
        }
        let mut child = process.spawn().map_err(|error| {
            AppError::message(format!("failed to start Codex App Server: {error}"))
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::message("Codex App Server stdin unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::message("Codex App Server stdout unavailable"))?;
        let mut client = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout).lines(),
            next_id: 1,
            notifications: Vec::new(),
        };
        client.initialize().await?;
        Ok(client)
    }

    async fn initialize(&mut self) -> Result<(), AppError> {
        self.request(
            "initialize",
            json!({
                "clientInfo": { "name": CLIENT_INFO, "version": env!("CARGO_PKG_VERSION") },
                "capabilities": { "experimentalApi": true }
            }),
        )
        .await?;
        self.notify("initialized", Value::Null).await
    }

    async fn write(&mut self, value: Value) -> Result<(), AppError> {
        let line = serde_json::to_string(&value)
            .map_err(|error| AppError::message(format!("failed to encode Codex RPC: {error}")))?;
        self.stdin
            .write_all(format!("{line}\n").as_bytes())
            .await
            .map_err(|error| {
                AppError::message(format!("failed to write to Codex App Server: {error}"))
            })?;
        self.stdin.flush().await.map_err(|error| {
            AppError::message(format!("failed to flush Codex App Server input: {error}"))
        })
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), AppError> {
        let mut value = json!({ "jsonrpc": "2.0", "method": method });
        if !params.is_null() {
            value["params"] = params;
        }
        self.write(value).await
    }

    async fn request(&mut self, method: &str, params: Value) -> Result<Value, AppError> {
        match tokio::time::timeout(RPC_TIMEOUT, self.request_inner(method, params)).await {
            Ok(result) => result,
            Err(_) => Err(AppError::message(format!(
                "Codex App Server request `{method}` timed out after {}s",
                RPC_TIMEOUT.as_secs()
            ))),
        }
    }

    async fn request_inner(&mut self, method: &str, params: Value) -> Result<Value, AppError> {
        let id = self.next_id;
        self.next_id += 1;
        self.write(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await?;
        loop {
            let value = self.next_message().await?;
            if value.get("id").and_then(Value::as_u64) == Some(id) && value.get("method").is_none()
            {
                if let Some(error) = value.get("error") {
                    let message = error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("Codex App Server request failed");
                    return Err(AppError::message(message));
                }
                return Ok(value.get("result").cloned().unwrap_or(Value::Null));
            }
            self.handle_incoming(value).await?;
        }
    }

    async fn next_message(&mut self) -> Result<Value, AppError> {
        let line = self
            .stdout
            .next_line()
            .await
            .map_err(|error| {
                AppError::message(format!("failed to read Codex App Server output: {error}"))
            })?
            .ok_or_else(|| AppError::message("Codex App Server exited unexpectedly"))?;
        serde_json::from_str(&line)
            .map_err(|error| AppError::message(format!("invalid Codex App Server JSON: {error}")))
    }

    async fn handle_incoming(&mut self, value: Value) -> Result<(), AppError> {
        let method = value.get("method").and_then(Value::as_str);
        let id = value.get("id");
        match (method, id) {
            (Some(method), None) => {
                self.notifications.push((
                    method.to_string(),
                    value.get("params").cloned().unwrap_or(Value::Null),
                ));
            }
            (Some(method), Some(id)) => {
                // Motif has no per-request approval surface yet. Explicitly decline rather
                // than silently granting an escalation; YOLO uses approvalPolicy=never.
                self.write(json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": format!("Motif cannot handle Codex server request: {method}") }
                })).await?;
            }
            _ => {}
        }
        Ok(())
    }

    fn drain_notifications(&mut self) -> Vec<(String, Value)> {
        std::mem::take(&mut self.notifications)
    }

    async fn shutdown(mut self) {
        let _ = self.child.kill().await;
        let _ = self.child.wait().await;
    }
}

#[derive(Debug, Eq, PartialEq)]
enum TurnNotification {
    Continue,
    Completed,
    Interrupted,
    Failed(String),
}

fn turn_completion(params: &Value) -> TurnNotification {
    let turn = params.get("turn").unwrap_or(params);
    match string(turn, &["status"]).as_deref() {
        Some("failed") => TurnNotification::Failed(
            turn.get("error")
                .and_then(|error| string(error, &["message"]))
                .unwrap_or_else(|| "Codex turn failed".to_string()),
        ),
        Some("interrupted") => TurnNotification::Interrupted,
        Some("completed") | None => TurnNotification::Completed,
        Some(status) => TurnNotification::Failed(format!(
            "Codex turn ended with unexpected status `{status}`"
        )),
    }
}

fn approval_policy(auto_approve: bool) -> &'static str {
    if auto_approve {
        "never"
    } else {
        "on-request"
    }
}

fn sandbox(auto_approve: bool) -> &'static str {
    if auto_approve {
        "danger-full-access"
    } else {
        "workspace-write"
    }
}

fn string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str).map(str::to_string))
}

fn scalar_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| match value.get(*key) {
        Some(Value::String(value)) => Some(value.clone()),
        Some(Value::Number(value)) => Some(value.to_string()),
        _ => None,
    })
}

fn thread_info(value: &Value) -> Option<CodexThreadInfo> {
    let id = string(value, &["id", "threadId"])?;
    Some(CodexThreadInfo {
        title: string(value, &["name", "title", "summary", "preview"])
            .unwrap_or_else(|| id.clone()),
        created_at: scalar_string(value, &["createdAt", "created_at"]),
        updated_at: scalar_string(
            value,
            &["updatedAt", "updated_at", "recencyAt", "recency_at"],
        ),
        cwd: string(value, &["cwd"]),
        id,
    })
}

fn content_text(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Array(values) => values
            .iter()
            .map(content_text)
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(map) => {
            if let Some(text) = map.get("text").and_then(Value::as_str) {
                return text.to_string();
            }
            if let Some(content) = map.get("content") {
                return content_text(content);
            }
            if let Some(message) = map.get("message") {
                return content_text(message);
            }
            String::new()
        }
        _ => String::new(),
    }
}

fn history_from_jsonl(thread_id: &str) -> Vec<CodexHistoryLine> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let root = home.join(".codex").join("sessions");
    let Some(path) = find_transcript(&root, thread_id) else {
        return Vec::new();
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut lines = Vec::new();
    let mut pending_reasoning = String::new();
    for raw in contents.lines() {
        let Ok(record) = serde_json::from_str::<Value>(raw) else {
            continue;
        };
        if record.get("type").and_then(Value::as_str) != Some("response_item") {
            continue;
        }
        let Some(payload) = record.get("payload") else {
            continue;
        };
        match payload.get("type").and_then(Value::as_str) {
            Some("reasoning") => {
                let text = content_text(
                    payload
                        .get("summary")
                        .or_else(|| payload.get("content"))
                        .unwrap_or(&Value::Null),
                );
                if !text.is_empty() {
                    if !pending_reasoning.is_empty() {
                        pending_reasoning.push('\n');
                    }
                    pending_reasoning.push_str(&text);
                }
            }
            Some("message") => {
                let role = payload
                    .get("role")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if role != "user" && role != "assistant" {
                    continue;
                }
                let text = content_text(payload.get("content").unwrap_or(&Value::Null));
                if text.is_empty() {
                    continue;
                }
                let reasoning = (role == "assistant" && !pending_reasoning.is_empty())
                    .then(|| std::mem::take(&mut pending_reasoning));
                lines.push(CodexHistoryLine {
                    id: format!("{role}-{}", lines.len()),
                    kind: if role == "user" {
                        "user".to_string()
                    } else {
                        "agent".to_string()
                    },
                    text,
                    reasoning,
                });
            }
            _ => {}
        }
    }
    lines
}

fn find_transcript(root: &Path, thread_id: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_transcript(&path, thread_id) {
                return Some(found);
            }
        } else if path.extension().and_then(|extension| extension.to_str()) == Some("jsonl")
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.contains(thread_id))
        {
            return Some(path);
        }
    }
    None
}

fn motif_thread_index_path(vault_path: Option<&str>) -> Option<PathBuf> {
    vault_path
        .map(Path::new)
        .filter(|path| path.is_dir())
        .map(|path| path.join(MOTIF_THREAD_INDEX_PATH))
}

fn motif_thread_ids(vault_path: Option<&str>) -> HashSet<String> {
    let Some(path) = motif_thread_index_path(vault_path) else {
        return HashSet::new();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<MotifCodexThreadIndex>(&content).ok())
        .unwrap_or_default()
        .thread_ids
        .into_iter()
        .filter(|thread_id| !thread_id.trim().is_empty())
        .collect()
}

fn remember_motif_thread(vault_path: Option<&str>, thread_id: &str) -> Result<(), AppError> {
    let Some(path) = motif_thread_index_path(vault_path) else {
        return Ok(());
    };
    let mut index = fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str::<MotifCodexThreadIndex>(&content).ok())
        .unwrap_or_default();
    if !index.thread_ids.iter().any(|id| id == thread_id) {
        index.thread_ids.push(thread_id.to_string());
    }
    index.version = default_thread_index_version();
    let parent = path
        .parent()
        .ok_or_else(|| AppError::message("Motif Codex session path has no parent"))?;
    fs::create_dir_all(parent).map_err(AppError::Io)?;
    let content = serde_json::to_string_pretty(&index).map_err(|error| {
        AppError::message(format!("failed to encode Codex session metadata: {error}"))
    })?;
    fs::write(path, content).map_err(AppError::Io)
}

pub async fn probe_codex(desc: &AgentDescriptor) -> ProbeResult {
    match CodexClient::spawn(desc, None).await {
        Ok(client) => {
            client.shutdown().await;
            ProbeResult {
                agent_id: desc.id.clone(),
                available: true,
                agent_name: Some("Codex App Server".to_string()),
                protocol_version: Some("app-server".to_string()),
                error: None,
            }
        }
        Err(error) => ProbeResult {
            agent_id: desc.id.clone(),
            available: false,
            agent_name: None,
            protocol_version: None,
            error: Some(error.to_string()),
        },
    }
}

pub async fn prepare_codex_thread(
    desc: &AgentDescriptor,
    session_id: Option<String>,
    vault_path: Option<String>,
    model_id: Option<String>,
    auto_approve: bool,
) -> Result<PreparedCodexThread, AppError> {
    let mut client = CodexClient::spawn(desc, vault_path.as_deref()).await?;
    let params = if let Some(thread_id) = session_id.filter(|id| !id.trim().is_empty()) {
        json!({ "threadId": thread_id, "cwd": vault_path, "model": model_id, "approvalPolicy": approval_policy(auto_approve), "sandbox": sandbox(auto_approve) })
    } else {
        json!({ "cwd": vault_path, "model": model_id, "approvalPolicy": approval_policy(auto_approve), "sandbox": sandbox(auto_approve) })
    };
    let method = if params.get("threadId").is_some() {
        "thread/resume"
    } else {
        "thread/start"
    };
    let result = client.request(method, params).await;
    let thread_id = result.and_then(|result| {
        result
            .get("thread")
            .or(Some(&result))
            .and_then(|thread| string(thread, &["id", "threadId"]))
            .ok_or_else(|| AppError::message("Codex App Server did not return a thread id"))
    });
    match thread_id {
        Ok(thread_id) => {
            if let Err(error) = remember_motif_thread(vault_path.as_deref(), &thread_id) {
                eprintln!("[motif codex] failed to save native thread metadata: {error}");
            }
            Ok(PreparedCodexThread { thread_id, client })
        }
        Err(error) => {
            client.shutdown().await;
            Err(error)
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn run_codex_turn(
    app: AppHandle,
    prepared: PreparedCodexThread,
    message_id: String,
    prompt: String,
    workflow: Option<String>,
    target: Option<String>,
    vault_path: Option<String>,
    model_id: Option<String>,
    reasoning_effort: Option<String>,
    fast_mode: Option<bool>,
    skill_ids: Vec<String>,
    auto_approve: bool,
    mut cancellation: watch::Receiver<bool>,
) {
    let PreparedCodexThread {
        thread_id,
        mut client,
    } = prepared;
    let result = run_codex_turn_inner(
        &app,
        &mut client,
        &thread_id,
        &message_id,
        prompt,
        workflow,
        target,
        vault_path,
        model_id,
        reasoning_effort,
        fast_mode,
        skill_ids,
        auto_approve,
        &mut cancellation,
    )
    .await;
    client.shutdown().await;
    if let Err(error) = result {
        let _ = app.emit(
            "agent:failed",
            AgentFailedEvent {
                session_id: thread_id,
                error: error.to_string(),
            },
        );
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_codex_turn_inner(
    app: &AppHandle,
    client: &mut CodexClient,
    thread_id: &str,
    message_id: &str,
    prompt: String,
    workflow: Option<String>,
    target: Option<String>,
    vault_path: Option<String>,
    model_id: Option<String>,
    reasoning_effort: Option<String>,
    fast_mode: Option<bool>,
    skill_ids: Vec<String>,
    auto_approve: bool,
    cancellation: &mut watch::Receiver<bool>,
) -> Result<(), AppError> {
    let skill_instructions = load_skill_instructions(&skill_ids, vault_path.as_deref())?;
    let prompt = format!(
        "{}{}",
        build_prompt(workflow.as_deref(), &prompt, target.as_deref()),
        skill_instructions
    );
    let service_tier = if fast_mode == Some(true) {
        resolve_fast_tier(client, model_id.as_deref()).await?
    } else {
        None
    };
    let turn = client
        .request(
            "turn/start",
            json!({
                "threadId": thread_id,
                "input": [{ "type": "text", "text": prompt }],
                "model": model_id,
                "effort": reasoning_effort,
                "serviceTier": service_tier,
                "approvalPolicy": approval_policy(auto_approve),
                "cwd": vault_path,
            }),
        )
        .await?;
    let turn_id = turn
        .get("turn")
        .and_then(|turn| string(turn, &["id"]))
        .ok_or_else(|| AppError::message("Codex App Server did not return a turn id"))?;
    let mut content = String::new();
    let mut reasoning = String::new();
    let mut cancelled = false;
    let mut finished = false;
    loop {
        for (method, params) in client.drain_notifications() {
            match handle_notification(
                app,
                thread_id,
                &mut content,
                &mut reasoning,
                &method,
                &params,
            )? {
                TurnNotification::Continue => {}
                TurnNotification::Completed => {
                    finished = true;
                    break;
                }
                TurnNotification::Interrupted => {
                    cancelled = true;
                    finished = true;
                    break;
                }
                TurnNotification::Failed(error) => return Err(AppError::message(error)),
            }
        }
        if finished {
            break;
        }
        tokio::select! {
            changed = cancellation.changed(), if !*cancellation.borrow() => {
                if changed.is_ok() && *cancellation.borrow() {
                    cancelled = true;
                    // The server will finish the turn after the interrupt request.
                    let _ = client
                        .request(
                            "turn/interrupt",
                            json!({ "threadId": thread_id, "turnId": turn_id }),
                        )
                        .await?;
                }
            }
            message = client.next_message() => {
                let value = message?;
                client.handle_incoming(value).await?;
                for (method, params) in client.drain_notifications() {
                    match handle_notification(app, thread_id, &mut content, &mut reasoning, &method, &params)? {
                        TurnNotification::Continue => {}
                        TurnNotification::Completed => finished = true,
                        TurnNotification::Interrupted => {
                            cancelled = true;
                            finished = true;
                        }
                        TurnNotification::Failed(error) => return Err(AppError::message(error)),
                    }
                }
                if finished { break; }
            }
        }
    }
    app.emit(
        "agent:completed",
        AgentResultPayload {
            session_id: thread_id.to_string(),
            message_id: message_id.to_string(),
            sources: extract_sources(&content),
            content,
            reasoning: (!reasoning.is_empty()).then_some(reasoning),
            stop_reason: cancelled.then_some("cancelled".to_string()),
        },
    )
    .map_err(|error| AppError::message(error.to_string()))?;
    Ok(())
}

async fn resolve_fast_tier(
    client: &mut CodexClient,
    model_id: Option<&str>,
) -> Result<Option<String>, AppError> {
    let catalog = client.request("model/list", json!({})).await?;
    let models = catalog
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let model = model_id
        .and_then(|id| {
            models
                .iter()
                .find(|model| string(model, &["id"]).as_deref() == Some(id))
        })
        .or_else(|| {
            models
                .iter()
                .find(|model| model.get("isDefault").and_then(Value::as_bool) == Some(true))
        });
    Ok(model
        .and_then(|model| model.get("serviceTiers"))
        .and_then(Value::as_array)
        .and_then(|tiers| {
            tiers.iter().find_map(|tier| {
                let name = string(tier, &["name"])?;
                name.eq_ignore_ascii_case("fast")
                    .then(|| string(tier, &["id"]))
                    .flatten()
            })
        }))
}

fn handle_notification(
    app: &AppHandle,
    thread_id: &str,
    content: &mut String,
    reasoning: &mut String,
    method: &str,
    params: &Value,
) -> Result<TurnNotification, AppError> {
    match method {
        "item/agentMessage/delta" => {
            let delta = string(params, &["delta"]).unwrap_or_default();
            content.push_str(&delta);
            app.emit(
                "agent:stream",
                AgentStreamEvent {
                    session_id: thread_id.to_string(),
                    chunk: delta,
                    kind: AgentStreamKind::Message,
                },
            )
            .map_err(|error| AppError::message(error.to_string()))?;
        }
        "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta" => {
            let delta = string(params, &["delta"]).unwrap_or_default();
            reasoning.push_str(&delta);
            app.emit(
                "agent:stream",
                AgentStreamEvent {
                    session_id: thread_id.to_string(),
                    chunk: delta,
                    kind: AgentStreamKind::Thought,
                },
            )
            .map_err(|error| AppError::message(error.to_string()))?;
        }
        "item/started" | "item/completed" => {
            if let Some(item) = params.get("item") {
                let item_type = string(item, &["type"]);
                if matches!(
                    item_type.as_deref(),
                    Some("commandExecution") | Some("fileChange") | Some("mcpToolCall")
                ) {
                    let id = string(item, &["id"]).unwrap_or_else(|| {
                        format!("tool-{}", item_type.clone().unwrap_or_default())
                    });
                    app.emit(
                        "agent:tool",
                        AgentToolEvent {
                            session_id: thread_id.to_string(),
                            tool_call_id: id,
                            title: string(item, &["command", "server", "tool"]),
                            kind: item_type,
                            status: Some(if method == "item/started" {
                                "in_progress".to_string()
                            } else {
                                "completed".to_string()
                            }),
                            input: Some(item.clone()),
                            output: (method == "item/completed").then(|| item.clone()),
                            full: method == "item/completed",
                        },
                    )
                    .map_err(|error| AppError::message(error.to_string()))?;
                }
            }
        }
        "turn/completed" => return Ok(turn_completion(params)),
        _ => {}
    }
    Ok(TurnNotification::Continue)
}

pub async fn codex_list_threads(
    desc: &AgentDescriptor,
    vault_path: Option<String>,
    include_external: bool,
) -> Result<Vec<CodexThreadInfo>, AppError> {
    let motif_thread_ids = (!include_external).then(|| motif_thread_ids(vault_path.as_deref()));
    let mut client = CodexClient::spawn(desc, vault_path.as_deref()).await?;
    let result = client.request("thread/list", json!({ "cwd": vault_path, "limit": 100, "archived": false, "sortKey": "recency_at", "sortDirection": "desc" })).await?;
    client.shutdown().await;
    Ok(result
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(thread_info)
        .filter(|thread| {
            motif_thread_ids
                .as_ref()
                .is_none_or(|ids| ids.contains(&thread.id))
        })
        .collect())
}

pub async fn codex_read_thread(
    desc: &AgentDescriptor,
    thread_id: String,
    vault_path: Option<String>,
) -> Result<CodexThreadHistory, AppError> {
    let mut client = CodexClient::spawn(desc, vault_path.as_deref()).await?;
    let result = client
        .request("thread/read", json!({ "threadId": thread_id }))
        .await?;
    client.shutdown().await;
    let thread = result
        .get("thread")
        .and_then(thread_info)
        .unwrap_or(CodexThreadInfo {
            id: thread_id.clone(),
            title: thread_id,
            created_at: None,
            updated_at: None,
            cwd: vault_path,
        });
    Ok(CodexThreadHistory {
        lines: history_from_jsonl(&thread.id),
        thread,
    })
}

pub async fn warm_codex(
    app: AppHandle,
    desc: AgentDescriptor,
    vault_path: Option<String>,
) -> WarmResult {
    let response = async {
        let mut client = CodexClient::spawn(&desc, vault_path.as_deref()).await?;
        let result = client.request("model/list", json!({})).await?;
        client.shutdown().await;
        Ok::<Value, AppError>(result)
    }
    .await;
    match response {
        Ok(result) => {
            let data = result
                .get("data")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let models = data
                .iter()
                .filter(|model| {
                    !model
                        .get("hidden")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                })
                .filter_map(|model| {
                    let id = string(model, &["id"])?;
                    Some(AgentModelChoice {
                        id: id.clone(),
                        name: string(model, &["displayName", "model"]).unwrap_or(id),
                        group: None,
                    })
                })
                .collect::<Vec<_>>();
            let current = data
                .iter()
                .find(|model| model.get("isDefault").and_then(Value::as_bool) == Some(true))
                .and_then(|model| string(model, &["id"]))
                .or_else(|| models.first().map(|model| model.id.clone()))
                .unwrap_or_default();
            let selected = data
                .iter()
                .find(|model| string(model, &["id"]).as_deref() == Some(current.as_str()));
            let efforts = selected
                .and_then(|model| model.get("supportedReasoningEfforts"))
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|effort| {
                    Some(AgentEffortChoice {
                        id: string(effort, &["reasoningEffort"])?,
                        name: string(effort, &["reasoningEffort"]).unwrap_or_default(),
                        description: string(effort, &["description"]),
                    })
                })
                .collect::<Vec<_>>();
            let current_effort = selected
                .and_then(|model| string(model, &["defaultReasoningEffort"]))
                .unwrap_or_default();
            let fast = selected
                .and_then(|model| model.get("serviceTiers"))
                .and_then(Value::as_array)
                .is_some_and(|tiers| {
                    tiers.iter().any(|tier| {
                        string(tier, &["name"])
                            .is_some_and(|value| value.eq_ignore_ascii_case("fast"))
                    })
                });
            let model_event = AgentModelsEvent {
                session_id: "warm".to_string(),
                agent_id: desc.id.clone(),
                config_id: "codex-model".to_string(),
                current_id: current,
                models,
            };
            let _ = app.emit("agent:models", model_event.clone());
            let _ = app.emit(
                "agent:effort",
                AgentEffortEvent {
                    session_id: "warm".to_string(),
                    agent_id: desc.id.clone(),
                    config_id: "codex-effort".to_string(),
                    current_id: current_effort,
                    efforts,
                },
            );
            if fast {
                let _ = app.emit(
                    "agent:fast-mode",
                    AgentFastModeEvent {
                        session_id: "warm".to_string(),
                        agent_id: desc.id.clone(),
                        config_id: "codex-service-tier".to_string(),
                        enabled: false,
                    },
                );
            }
            WarmResult {
                agent_id: desc.id,
                ok: true,
                models: Some(model_event),
                usage_used: None,
                usage_size: None,
                error: None,
            }
        }
        Err(error) => WarmResult {
            agent_id: desc.id,
            ok: false,
            models: None,
            usage_used: None,
            usage_size: None,
            error: Some(error.to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{turn_completion, TurnNotification};
    use serde_json::json;

    #[test]
    fn maps_codex_turn_completion_statuses() {
        assert_eq!(
            turn_completion(&json!({ "turn": { "status": "completed" } })),
            TurnNotification::Completed
        );
        assert_eq!(
            turn_completion(&json!({ "turn": { "status": "interrupted" } })),
            TurnNotification::Interrupted
        );
        assert_eq!(
            turn_completion(&json!({
                "turn": { "status": "failed", "error": { "message": "boom" } }
            })),
            TurnNotification::Failed("boom".to_string())
        );
    }
}
