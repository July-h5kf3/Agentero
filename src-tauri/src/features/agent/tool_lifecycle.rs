//! Silent install / update for catalog Agent CLIs.
//!
//! Ported from CC Switch's tool-lifecycle patterns (official installer first,
//! npm fallback; login-shell PATH for GUI apps; no `curl | bash` pipes).
//! Scoped to Motif catalog templates (not openclaw/hermes).

use crate::features::agent::discover::resolve_command;
use crate::features::agent::templates::{template_info, CLAUDE_ACP_INSTALL_COMMAND};
use std::process::{Command, Output};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Catalog template ids that support silent install/update.
pub const LIFECYCLE_TEMPLATES: &[&str] = &[
    "opencode",
    "claude-acp",
    "codex-acp",
    "gemini",
    "grok-build",
];

/// Official shell installers download to a temp file then exec (never `curl | bash`),
/// so curl failures propagate under WSL/subshells without relying on pipefail.
/// Windows builds use npm / PowerShell installers instead — keep these out of that target.
#[cfg(not(target_os = "windows"))]
const CLAUDE_INSTALL_UNIX: &str = "bash -c 'tmp=$(mktemp) && curl -fsSL https://claude.ai/install.sh -o $tmp && bash $tmp; status=$?; rm -f $tmp; exit $status'";
#[cfg(not(target_os = "windows"))]
const OPENCODE_INSTALL_UNIX: &str = "bash -c 'tmp=$(mktemp) && curl -fsSL https://opencode.ai/install -o $tmp && bash $tmp; status=$?; rm -f $tmp; exit $status'";
#[cfg(not(target_os = "windows"))]
const GROK_INSTALL_UNIX: &str = "bash -c 'tmp=$(mktemp) && curl -fsSL https://x.ai/cli/install.sh -o $tmp && bash $tmp; status=$?; rm -f $tmp; exit $status'";

#[cfg(target_os = "windows")]
const GROK_INSTALL_WINDOWS_SCRIPT: &str = "irm https://x.ai/cli/install.ps1 | iex";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolLifecycleAction {
    Install,
    Update,
}

impl ToolLifecycleAction {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "install" => Ok(Self::Install),
            "update" => Ok(Self::Update),
            _ => Err(format!("unsupported tool action: {value}")),
        }
    }
}

pub fn supports_lifecycle(template_id: &str) -> bool {
    LIFECYCLE_TEMPLATES.contains(&template_id)
}

/// Build and run install/update for a catalog template. Host decides host-vs-adapter
/// scope from current PATH state (not from free-form UI strings).
pub fn run_template_lifecycle(
    template_id: &str,
    action: ToolLifecycleAction,
) -> Result<(), String> {
    if !supports_lifecycle(template_id) {
        return Err(format!(
            "no silent install support for template: {template_id}"
        ));
    }
    let info = template_info(template_id)
        .ok_or_else(|| format!("unknown catalog template: {template_id}"))?;

    let detect = info
        .detect_command
        .as_deref()
        .unwrap_or(info.command.as_str());
    let host_present = resolve_command(detect).is_some();
    let acp_present = resolve_command(&info.command).is_some();
    // Same binary for host and ACP (opencode, gemini, grok via npx).
    let needs_separate_adapter = info
        .detect_command
        .as_ref()
        .is_some_and(|d| d != &info.command);

    let command = match action {
        ToolLifecycleAction::Install => {
            if needs_separate_adapter {
                if host_present && !acp_present {
                    adapter_install_command(template_id)?
                } else if !host_present {
                    chain_host_and_adapter(
                        host_install_command(template_id)?,
                        adapter_install_command(template_id)?,
                    )
                } else {
                    // Host + adapter both present — treat install as update.
                    update_command(
                        template_id,
                        host_present,
                        acp_present,
                        needs_separate_adapter,
                    )?
                }
            } else if host_present {
                host_update_command(template_id)?
            } else {
                host_install_command(template_id)?
            }
        }
        ToolLifecycleAction::Update => update_command(
            template_id,
            host_present,
            acp_present,
            needs_separate_adapter,
        )?,
    };

    if command.trim().is_empty() {
        return Err(format!("empty lifecycle command for {template_id}"));
    }

    log::info!(
        target: "agentero::agent",
        "tool_lifecycle template={template_id} action={:?} cmd_len={}",
        action,
        command.len()
    );
    run_tool_lifecycle_silently(&command)
}

fn update_command(
    template_id: &str,
    host_present: bool,
    acp_present: bool,
    needs_separate_adapter: bool,
) -> Result<String, String> {
    if needs_separate_adapter {
        let mut parts = Vec::new();
        if host_present {
            parts.push(host_update_command(template_id)?);
        } else {
            parts.push(host_install_command(template_id)?);
        }
        if !acp_present || host_present {
            // Always refresh adapter on update when host path exists; install if missing.
            parts.push(adapter_install_command(template_id)?);
        }
        Ok(chain_commands(&parts))
    } else if host_present {
        host_update_command(template_id)
    } else {
        host_install_command(template_id)
    }
}

fn adapter_install_command(template_id: &str) -> Result<String, String> {
    match template_id {
        "claude-acp" => Ok(CLAUDE_ACP_INSTALL_COMMAND.to_string()),
        "codex-acp" => Ok("npm i -g @agentclientprotocol/codex-acp@latest".to_string()),
        _ => Err(format!("no ACP adapter install for {template_id}")),
    }
}

fn host_install_command(template_id: &str) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        match template_id {
            "claude-acp" => Ok("npm i -g @anthropic-ai/claude-code@latest".to_string()),
            "codex-acp" => Ok("npm i -g @openai/codex@latest".to_string()),
            "gemini" => Ok("npm i -g @google/gemini-cli@latest".to_string()),
            "opencode" => Ok("npm i -g opencode-ai@latest".to_string()),
            "grok-build" => Ok(chain_or(
                &grok_install_windows_command(),
                "npm i -g @xai-official/grok@latest",
            )),
            _ => Err(format!("no host install for {template_id}")),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        match template_id {
            "claude-acp" => Ok(chain_or(
                CLAUDE_INSTALL_UNIX,
                "npm i -g @anthropic-ai/claude-code@latest",
            )),
            "codex-acp" => Ok("npm i -g @openai/codex@latest".to_string()),
            "gemini" => Ok("npm i -g @google/gemini-cli@latest".to_string()),
            "opencode" => Ok(chain_or(
                OPENCODE_INSTALL_UNIX,
                "npm i -g opencode-ai@latest",
            )),
            "grok-build" => Ok(chain_or(
                GROK_INSTALL_UNIX,
                "npm i -g @xai-official/grok@latest",
            )),
            _ => Err(format!("no host install for {template_id}")),
        }
    }
}

fn host_update_command(template_id: &str) -> Result<String, String> {
    // Prefer official self-update where safe; fall back to reinstall chain.
    // Codex self-update can report success without refreshing platform bins — use npm.
    // OpenCode upgrade on Windows may prompt interactively — use npm only.
    match template_id {
        "claude-acp" => {
            #[cfg(target_os = "windows")]
            {
                Ok(chain_or(
                    "claude update",
                    "npm i -g @anthropic-ai/claude-code@latest",
                ))
            }
            #[cfg(not(target_os = "windows"))]
            {
                Ok(chain_or(
                    "claude update",
                    &chain_or(
                        CLAUDE_INSTALL_UNIX,
                        "npm i -g @anthropic-ai/claude-code@latest",
                    ),
                ))
            }
        }
        "codex-acp" => Ok("npm i -g @openai/codex@latest".to_string()),
        "gemini" => Ok("npm i -g @google/gemini-cli@latest".to_string()),
        "opencode" => {
            #[cfg(target_os = "windows")]
            {
                Ok("npm i -g opencode-ai@latest".to_string())
            }
            #[cfg(not(target_os = "windows"))]
            {
                Ok(chain_or(
                    "opencode upgrade",
                    &chain_or(OPENCODE_INSTALL_UNIX, "npm i -g opencode-ai@latest"),
                ))
            }
        }
        "grok-build" => {
            #[cfg(target_os = "windows")]
            {
                Ok(chain_or(
                    "grok update",
                    &chain_or(
                        &grok_install_windows_command(),
                        "npm i -g @xai-official/grok@latest",
                    ),
                ))
            }
            #[cfg(not(target_os = "windows"))]
            {
                Ok(chain_or(
                    "grok update",
                    &chain_or(GROK_INSTALL_UNIX, "npm i -g @xai-official/grok@latest"),
                ))
            }
        }
        _ => host_install_command(template_id),
    }
}

fn chain_or(primary: &str, fallback: &str) -> String {
    format!("{primary} || {fallback}")
}

fn chain_host_and_adapter(host: String, adapter: String) -> String {
    chain_commands(&[host, adapter])
}

fn chain_commands(parts: &[String]) -> String {
    #[cfg(target_os = "windows")]
    {
        // Sequential in a bat: first fails → exit; use `&&` via separate errorlevel checks
        // built by wrap_windows_script.
        parts.join("\r\n")
    }
    #[cfg(not(target_os = "windows"))]
    {
        parts.join(" && ")
    }
}

#[cfg(target_os = "windows")]
fn powershell_encoded_command(script: &str) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let mut bytes = Vec::with_capacity(script.len() * 2);
    for unit in script.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    STANDARD.encode(bytes)
}

#[cfg(target_os = "windows")]
fn grok_install_windows_command() -> String {
    format!(
        "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand {}",
        powershell_encoded_command(GROK_INSTALL_WINDOWS_SCRIPT)
    )
}

/// Manual one-click install text for Settings (copyable). Matches backend install chains.
pub fn manual_install_commands_text() -> String {
    #[cfg(target_os = "windows")]
    {
        format!(
            r#"# Claude Code + ACP adapter
npm i -g @anthropic-ai/claude-code@latest
{claude_acp}
# Codex + ACP adapter
npm i -g @openai/codex@latest
npm i -g @agentclientprotocol/codex-acp@latest
# Gemini CLI
npm i -g @google/gemini-cli@latest
# OpenCode
npm i -g opencode-ai@latest
# Grok Build
{grok}
# (or) npm i -g @xai-official/grok@latest"#,
            claude_acp = CLAUDE_ACP_INSTALL_COMMAND,
            grok = grok_install_windows_command(),
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        format!(
            r#"# Claude Code + ACP adapter
{claude_host} || npm i -g @anthropic-ai/claude-code@latest
{claude_acp}
# Codex + ACP adapter
npm i -g @openai/codex@latest
npm i -g @agentclientprotocol/codex-acp@latest
# Gemini CLI
npm i -g @google/gemini-cli@latest
# OpenCode
{opencode} || npm i -g opencode-ai@latest
# Grok Build
{grok} || npm i -g @xai-official/grok@latest"#,
            claude_host = CLAUDE_INSTALL_UNIX,
            claude_acp = CLAUDE_ACP_INSTALL_COMMAND,
            opencode = OPENCODE_INSTALL_UNIX,
            grok = GROK_INSTALL_UNIX,
        )
    }
}

fn run_tool_lifecycle_silently(command_line: &str) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let script = format!("set -e\nset -o pipefail\n{command_line}\n");
        let mut cmd = Command::new("bash");
        cmd.arg("-c").arg(script);
        if let Some(login_path) = login_shell_path() {
            let inherited = std::env::var("PATH").unwrap_or_default();
            cmd.env("PATH", merge_path_segments(&login_path, &inherited));
        }
        let output = cmd
            .output()
            .map_err(|e| format!("failed to start install process: {e}"))?;
        finish_lifecycle_output(&output)
    }

    #[cfg(target_os = "windows")]
    {
        // Wrap each logical line with `call` so .cmd shims don't replace the batch.
        let mut bat = String::from("@echo off\r\n");
        for line in command_line.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('@') {
                continue;
            }
            // Lines already containing `||` stay as-is but get call on the left-most command.
            if line.starts_with("call ") || line.starts_with("powershell ") {
                bat.push_str(line);
            } else {
                bat.push_str("call ");
                bat.push_str(line);
            }
            bat.push_str("\r\nif errorlevel 1 exit /b %errorlevel%\r\n");
        }
        let bat_file =
            std::env::temp_dir().join(format!("agentero_tool_{}.bat", std::process::id()));
        std::fs::write(&bat_file, &bat).map_err(|e| format!("failed to write batch file: {e}"))?;
        let output = Command::new("cmd")
            .arg("/C")
            .arg(&bat_file)
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        let _ = std::fs::remove_file(&bat_file);
        finish_lifecycle_output(
            &output.map_err(|e| format!("failed to start install process: {e}"))?,
        )
    }
}

fn finish_lifecycle_output(output: &Output) -> Result<(), String> {
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let raw = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    let detail = last_lines(raw, 8);
    Err(if detail.is_empty() {
        format!("command failed (exit code: {:?})", output.status.code())
    } else {
        detail
    })
}

fn last_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

/// GUI apps inherit a narrow PATH; install scripts need the login shell PATH
/// so bare `npm` / `brew` resolve like a normal terminal session.
#[cfg(not(target_os = "windows"))]
fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let output = Command::new(&shell)
        .args(["-lic", "printf '%s' \"$PATH\""])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        None
    } else {
        Some(path)
    }
}

#[cfg(not(target_os = "windows"))]
fn merge_path_segments(primary: &str, extra: &str) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut parts = Vec::new();
    for segment in primary
        .split(':')
        .chain(extra.split(':'))
        .filter(|s| !s.is_empty())
    {
        if seen.insert(segment.to_string()) {
            parts.push(segment.to_string());
        }
    }
    parts.join(":")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lifecycle_templates_match_catalog() {
        for id in LIFECYCLE_TEMPLATES {
            assert!(template_info(id).is_some(), "missing template {id}");
            assert!(supports_lifecycle(id));
        }
        assert!(!supports_lifecycle("qodercli"));
        assert!(!supports_lifecycle("custom"));
    }

    #[test]
    fn host_install_nonempty() {
        for id in LIFECYCLE_TEMPLATES {
            let cmd = host_install_command(id).expect(id);
            assert!(!cmd.is_empty(), "{id}");
            assert!(
                !cmd.contains("curl | bash"),
                "{id} must not pipe curl to bash"
            );
            assert!(!cmd.contains("curl|bash"), "{id}");
        }
    }

    #[test]
    fn adapter_commands_for_acp_templates() {
        assert!(adapter_install_command("claude-acp")
            .unwrap()
            .contains("claude-agent-acp"));
        assert!(adapter_install_command("codex-acp")
            .unwrap()
            .contains("codex-acp"));
        assert!(adapter_install_command("gemini").is_err());
    }

    #[test]
    fn manual_text_lists_agents() {
        let text = manual_install_commands_text();
        assert!(text.contains("Claude"));
        assert!(text.contains("Gemini"));
        assert!(text.contains("OpenCode"));
        assert!(text.contains("Grok"));
    }

    #[test]
    fn last_lines_trims() {
        let t = "a\nb\nc\nd\ne";
        assert_eq!(last_lines(t, 2), "d\ne");
    }
}
