use crate::models::agent::{AgentTemplate, AgentTemplateInfo};

/// Preset command templates only — binaries are never bundled with Agentero.
///
/// `detect_command` is used for "installed on PATH" status when the ACP entrypoint
/// differs (e.g. Claude/Codex via npx adapters still want to show the host CLI).
pub fn builtin_templates() -> Vec<AgentTemplateInfo> {
    vec![
        AgentTemplateInfo {
            id: AgentTemplate::Opencode.as_str().to_string(),
            name: "OpenCode".to_string(),
            description: "Multi-provider coding agent with native ACP (`opencode acp`)."
                .to_string(),
            command: "opencode".to_string(),
            args: vec!["acp".to_string()],
            detect_command: Some("opencode".to_string()),
            install_hint: "brew install opencode  ·  https://opencode.ai".to_string(),
        },
        AgentTemplateInfo {
            id: AgentTemplate::ClaudeAcp.as_str().to_string(),
            name: "Claude".to_string(),
            description: "Claude Code via official ACP adapter (`claude-agent-acp`).".to_string(),
            // Prefer global install: npm i -g @agentclientprotocol/claude-agent-acp
            command: "claude-agent-acp".to_string(),
            args: vec![],
            detect_command: Some("claude-agent-acp".to_string()),
            install_hint:
                "npm i -g @agentclientprotocol/claude-agent-acp  (needs Claude Code auth)"
                    .to_string(),
        },
        AgentTemplateInfo {
            id: AgentTemplate::CodexAcp.as_str().to_string(),
            name: "Codex".to_string(),
            description: "OpenAI Codex through its native App Server runtime.".to_string(),
            // Keep the historical template id for registry compatibility. Codex is not
            // launched through ACP: its App Server owns native threads and history.
            command: "codex".to_string(),
            args: vec!["app-server".to_string()],
            detect_command: Some("codex".to_string()),
            install_hint: "Install Codex CLI and sign in; Agentero starts `codex app-server`."
                .to_string(),
        },
        AgentTemplateInfo {
            id: AgentTemplate::Gemini.as_str().to_string(),
            name: "Gemini CLI".to_string(),
            description: "Google Gemini CLI with experimental ACP mode.".to_string(),
            command: "gemini".to_string(),
            args: vec!["--experimental-acp".to_string()],
            detect_command: Some("gemini".to_string()),
            install_hint: "Install Google Gemini CLI (with ACP support).".to_string(),
        },
        AgentTemplateInfo {
            id: AgentTemplate::QoderCli.as_str().to_string(),
            name: "Qoder CLI".to_string(),
            description: "Qoder CLI with native ACP (`qodercli --acp`).".to_string(),
            command: "qodercli".to_string(),
            args: vec!["--acp".to_string()],
            detect_command: Some("qodercli".to_string()),
            install_hint:
                "Install Qoder CLI, then `qodercli login`  ·  https://docs.qoder.com/en/cli/acp"
                    .to_string(),
        },
        AgentTemplateInfo {
            id: AgentTemplate::GrokBuild.as_str().to_string(),
            name: "Grok Build".to_string(),
            description:
                "xAI Grok Build via ACP (`npx @xai-official/grok@0.2.100 agent stdio`)."
                    .to_string(),
            command: "npx".to_string(),
            args: vec![
                "@xai-official/grok@0.2.100".to_string(),
                "agent".to_string(),
                "stdio".to_string(),
            ],
            detect_command: Some("npx".to_string()),
            install_hint:
                "Run with `npx @xai-official/grok@0.2.100 agent stdio`  ·  https://zed.dev/acp/agent/grok-build"
                    .to_string(),
        },
        AgentTemplateInfo {
            id: AgentTemplate::Custom.as_str().to_string(),
            name: "Custom".to_string(),
            description: "Any ACP-compatible command + args.".to_string(),
            command: String::new(),
            args: vec![],
            detect_command: None,
            install_hint: "Provide command and args for your local ACP agent.".to_string(),
        },
    ]
}

/// Built-in catalog shown in Settings (excludes free-form custom).
pub fn catalog_templates() -> Vec<AgentTemplateInfo> {
    builtin_templates()
        .into_iter()
        .filter(|t| t.id != "custom")
        .collect()
}

pub fn template_from_id(id: &str) -> AgentTemplate {
    match id {
        "opencode" => AgentTemplate::Opencode,
        "gemini" => AgentTemplate::Gemini,
        "claude-acp" => AgentTemplate::ClaudeAcp,
        "codex-acp" => AgentTemplate::CodexAcp,
        "qodercli" => AgentTemplate::QoderCli,
        "grok-build" => AgentTemplate::GrokBuild,
        _ => AgentTemplate::Custom,
    }
}

pub fn template_info(id: &str) -> Option<AgentTemplateInfo> {
    builtin_templates().into_iter().find(|t| t.id == id)
}
