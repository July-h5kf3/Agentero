use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentTemplate {
    Opencode,
    Gemini,
    ClaudeAcp,
    CodexAcp,
    Custom,
}

impl AgentTemplate {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Opencode => "opencode",
            Self::Gemini => "gemini",
            Self::ClaudeAcp => "claude-acp",
            Self::CodexAcp => "codex-acp",
            Self::Custom => "custom",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDescriptor {
    pub id: String,
    pub name: String,
    pub template: AgentTemplate,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    /// Last ACP probe succeeded (None = never probed).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_probe_ok: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_probe_agent_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_probe_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_probed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentRegistryState {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_id: Option<String>,
    #[serde(default)]
    pub agents: Vec<AgentDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentListResponse {
    pub agents: Vec<AgentDescriptor>,
    pub default_id: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTemplateInfo {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub command: String,
    pub args: Vec<String>,
    /// Binary checked for "installed" badge (may differ from ACP command).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detect_command: Option<String>,
    pub install_hint: String,
}

/// Status for a common agent row in Settings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CatalogAcpStatus {
    /// Detect binary missing.
    Missing,
    /// Binary found, ACP not probed yet.
    NotProbed,
    /// ACP initialize succeeded.
    Ready,
    /// ACP initialize failed.
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub template_id: String,
    pub name: String,
    pub description: String,
    pub command: String,
    pub args: Vec<String>,
    pub install_hint: String,
    /// Primary CLI found on PATH (detect_command or command).
    pub binary_available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_path: Option<String>,
    /// ACP entrypoint command found (e.g. npx / opencode).
    pub acp_command_available: bool,
    pub acp_status: CatalogAcpStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub registered_id: Option<String>,
    pub is_default: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acp_agent_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_probe_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_probed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogScanResponse {
    pub entries: Vec<CatalogEntry>,
    pub custom_agents: Vec<AgentDescriptor>,
    pub default_id: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertAgentRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    #[serde(default)]
    pub template: Option<AgentTemplate>,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub set_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub agent_id: String,
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOnceRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    pub prompt: String,
    /// Vault root used as ACP session cwd. Falls back to process cwd when omitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vault_path: Option<String>,
    #[serde(default)]
    pub workflow: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOnceAccepted {
    pub session_id: String,
    pub message_id: String,
    pub agent_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResultPayload {
    pub session_id: String,
    pub message_id: String,
    pub content: String,
    /// ACP agent thought / reasoning (from AgentThoughtChunk), if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    pub sources: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_reason: Option<String>,
}

/// Stream chunk kind: assistant message body vs internal thought/reasoning.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AgentStreamKind {
    Message,
    Thought,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStreamEvent {
    pub session_id: String,
    pub chunk: String,
    pub kind: AgentStreamKind,
}

/// ACP tool call create/update for UI (`Tool` element).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolEvent {
    pub session_id: String,
    pub tool_call_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// pending | in_progress | completed | failed
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<serde_json::Value>,
    /// When true, fields are a full snapshot (ToolCall); false = patch (ToolCallUpdate).
    #[serde(default)]
    pub full: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanEntry {
    pub content: String,
    /// pending | in_progress | completed
    pub status: String,
    /// high | medium | low
    pub priority: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanEvent {
    pub session_id: String,
    pub entries: Vec<AgentPlanEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentUsageEvent {
    pub session_id: String,
    pub used: u64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFailedEvent {
    pub session_id: String,
    pub error: String,
}
