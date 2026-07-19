//! Discover and ACP-probe agents on a remote vault host (SSH).

use super::agent_exec;
use super::launch::{resolve_remote_target, RemoteAgentTarget};
use super::session::{RemoteRegistry, RemoteSession, LOCAL_SIM_HOST};
use crate::error::AppError;
use crate::models::agent::{
    AgentDescriptor, AgentTemplate, CatalogAcpStatus, CatalogEntry, ProbeResult,
};
use crate::services::agent::probe_agent;
use crate::services::agent::templates::{catalog_templates, template_from_id, template_info};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAgentScanResponse {
    pub session_id: String,
    pub destination: String,
    pub entries: Vec<CatalogEntry>,
}

/// List catalog templates with remote PATH presence (`command -v` / local which for sim).
pub async fn scan_remote_agents(
    registry: &RemoteRegistry,
    session_id: &str,
) -> Result<RemoteAgentScanResponse, AppError> {
    let session = registry.get(session_id).await?;
    let destination = session_destination(&session);
    let mut entries = Vec::new();

    for tmpl in catalog_templates() {
        let detect = tmpl
            .detect_command
            .as_deref()
            .unwrap_or(tmpl.command.as_str());
        let detect_path = remote_or_local_which(&session, &destination, detect).await?;
        let acp_path = if tmpl.command == detect {
            detect_path.clone()
        } else {
            remote_or_local_which(&session, &destination, &tmpl.command).await?
        };

        let binary_available = detect_path.is_some();
        let acp_command_available = acp_path.is_some();
        let offer_install = binary_available
            && !acp_command_available
            && tmpl.install_command.as_ref().is_some_and(|c| !c.is_empty());

        let acp_status = if !binary_available && !acp_command_available {
            CatalogAcpStatus::Missing
        } else {
            CatalogAcpStatus::NotProbed
        };

        entries.push(CatalogEntry {
            template_id: tmpl.id.clone(),
            name: tmpl.name,
            description: tmpl.description,
            command: tmpl.command,
            args: tmpl.args,
            install_hint: tmpl.install_hint,
            install_command: tmpl.install_command,
            offer_install,
            binary_available,
            resolved_path: detect_path.or(acp_path),
            acp_command_available,
            acp_status,
            registered_id: None,
            is_default: false,
            acp_agent_name: None,
            last_probe_error: None,
            last_probed_at: None,
        });
    }

    Ok(RemoteAgentScanResponse {
        session_id: session_id.to_string(),
        destination,
        entries,
    })
}

/// ACP initialize probe for one catalog template on the remote host.
pub async fn probe_remote_template(
    registry: &RemoteRegistry,
    session_id: &str,
    template_id: &str,
) -> Result<ProbeResult, AppError> {
    let info = template_info(template_id)
        .ok_or_else(|| AppError::message(format!("unknown catalog template: {template_id}")))?;

    let handle = format!("remote:{session_id}");
    let remote = resolve_remote_target(registry, Some(&handle))
        .await?
        .ok_or_else(|| AppError::message("remote session not found"))?;

    let desc = descriptor_from_template(&info.id, &info.name, &info.command, &info.args);
    if desc.template == AgentTemplate::CodexAcp && remote.is_ssh() {
        return Ok(ProbeResult {
            agent_id: desc.id,
            available: false,
            agent_name: None,
            protocol_version: None,
            error: Some(
                "Codex on remote SSH vault is not supported yet; use an ACP agent installed on the server"
                    .into(),
            ),
        });
    }

    // Ensure binary exists before full ACP handshake (faster fail).
    let which_bin = info
        .detect_command
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(info.command.as_str());
    let destination = if remote.is_ssh() {
        remote.destination.clone()
    } else {
        String::new()
    };
    if remote.is_ssh() {
        if agent_exec::remote_which(&destination, which_bin)
            .await?
            .is_none()
        {
            return Ok(ProbeResult {
                agent_id: desc.id,
                available: false,
                agent_name: None,
                protocol_version: None,
                error: Some(format!("`{which_bin}` not found on remote PATH")),
            });
        }
    } else if which::which(which_bin).is_err() && which::which(&info.command).is_err() {
        return Ok(ProbeResult {
            agent_id: desc.id,
            available: false,
            agent_name: None,
            protocol_version: None,
            error: Some(format!("`{which_bin}` not found on PATH")),
        });
    }

    Ok(probe_agent(&desc, Some(&remote)).await)
}

fn descriptor_from_template(
    template_id: &str,
    name: &str,
    command: &str,
    args: &[String],
) -> AgentDescriptor {
    AgentDescriptor {
        id: format!("remote-catalog-{template_id}"),
        name: name.to_string(),
        template: template_from_id(template_id),
        command: command.to_string(),
        args: args.to_vec(),
        env: HashMap::new(),
        available: true,
        last_error: None,
        last_probe_ok: None,
        last_probe_agent_name: None,
        last_probe_error: None,
        last_probed_at: None,
    }
}

fn session_destination(session: &RemoteSession) -> String {
    if session.kind == "local-sim" || session.host == LOCAL_SIM_HOST {
        "local-sim".into()
    } else {
        session.host.clone()
    }
}

async fn remote_or_local_which(
    session: &Arc<RemoteSession>,
    destination: &str,
    bin: &str,
) -> Result<Option<String>, AppError> {
    if session.kind == "local-sim" || session.host == LOCAL_SIM_HOST {
        return Ok(which::which(bin).ok().map(|p| p.display().to_string()));
    }
    agent_exec::remote_which(destination, bin).await
}

/// Resolve RemoteAgentTarget for an open remote vault handle (tests / callers).
#[allow(dead_code)]
pub async fn target_for_session(
    registry: &RemoteRegistry,
    session_id: &str,
) -> Result<RemoteAgentTarget, AppError> {
    let handle = format!("remote:{session_id}");
    resolve_remote_target(registry, Some(&handle))
        .await?
        .ok_or_else(|| AppError::message("remote session not found"))
}
