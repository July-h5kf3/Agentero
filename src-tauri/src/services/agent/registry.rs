use crate::error::AppError;
use crate::models::agent::{
    default_agent_proxy_url, AgentDescriptor, AgentRegistryState, AgentTemplate, CatalogAcpStatus,
    CatalogEntry, CatalogScanResponse, ProbeResult, UpsertAgentRequest,
};
use crate::services::agent::discover::{probe_command, resolve_command};
use crate::services::agent::templates::{catalog_templates, template_from_id, template_info};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use uuid::Uuid;

pub struct AgentRegistry {
    inner: Mutex<AgentRegistryState>,
    path: PathBuf,
}

impl AgentRegistry {
    pub fn load() -> Self {
        let path = config_path();
        let mut state = read_state(&path).unwrap_or_default();
        state.enabled = true;
        Self {
            inner: Mutex::new(state),
            path,
        }
    }

    pub fn snapshot(&self) -> Result<AgentRegistryState, AppError> {
        let mut state = self
            .inner
            .lock()
            .map_err(|_| AppError::message("agent registry lock poisoned"))?
            .clone();
        refresh_availability(&mut state);
        apply_proxy_settings(&mut state);
        Ok(state)
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<AgentRegistryState, AppError> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| AppError::message("agent registry lock poisoned"))?;
        guard.enabled = enabled;
        persist(&self.path, &guard)?;
        Ok(guard.clone())
    }

    pub fn set_proxy(
        &self,
        proxy_enabled: bool,
        proxy_url: String,
    ) -> Result<AgentRegistryState, AppError> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| AppError::message("agent registry lock poisoned"))?;
        let proxy_url = normalize_proxy_url(&proxy_url);
        let changed = guard.proxy_enabled != proxy_enabled || guard.proxy_url != proxy_url;
        guard.proxy_enabled = proxy_enabled;
        guard.proxy_url = proxy_url;
        if changed {
            for agent in &mut guard.agents {
                if !matches!(agent.template, AgentTemplate::Custom) {
                    agent.last_probe_ok = None;
                    agent.last_probe_agent_name = None;
                    agent.last_probe_error = None;
                    agent.last_probed_at = None;
                }
            }
        }
        persist(&self.path, &guard)?;
        Ok(guard.clone())
    }

    pub fn set_default(&self, id: Option<String>) -> Result<AgentRegistryState, AppError> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| AppError::message("agent registry lock poisoned"))?;
        if let Some(ref agent_id) = id {
            if !guard.agents.iter().any(|a| a.id == *agent_id) {
                return Err(AppError::AgentNotFound(agent_id.clone()));
            }
        }
        guard.default_id = id;
        persist(&self.path, &guard)?;
        Ok(guard.clone())
    }

    pub fn upsert(&self, req: UpsertAgentRequest) -> Result<AgentDescriptor, AppError> {
        if req.command.trim().is_empty() {
            return Err(AppError::message("command is required"));
        }
        if req.name.trim().is_empty() {
            return Err(AppError::message("name is required"));
        }

        let mut guard = self
            .inner
            .lock()
            .map_err(|_| AppError::message("agent registry lock poisoned"))?;

        let template = req.template.unwrap_or_else(|| template_from_id("custom"));
        let id = req
            .id
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| stable_id_for(&template, req.command.trim(), &req.args));

        let (available, last_error) = match probe_command(req.command.trim()) {
            Ok(_) => (true, None),
            Err(e) => (false, Some(e)),
        };

        // Preserve probe history when re-saving the same id.
        let prev = guard.agents.iter().find(|a| a.id == id).cloned();

        let descriptor = AgentDescriptor {
            id: id.clone(),
            name: req.name.trim().to_string(),
            template,
            command: req.command.trim().to_string(),
            args: req.args,
            env: req.env,
            available,
            last_error,
            last_probe_ok: prev.as_ref().and_then(|p| p.last_probe_ok),
            last_probe_agent_name: prev.as_ref().and_then(|p| p.last_probe_agent_name.clone()),
            last_probe_error: prev.as_ref().and_then(|p| p.last_probe_error.clone()),
            last_probed_at: prev.as_ref().and_then(|p| p.last_probed_at.clone()),
        };

        if let Some(existing) = guard.agents.iter_mut().find(|a| a.id == id) {
            *existing = descriptor.clone();
        } else {
            guard.agents.push(descriptor.clone());
        }

        if req.set_default || guard.default_id.is_none() {
            guard.default_id = Some(id);
        }
        if !guard.agents.is_empty() {
            guard.enabled = true;
        }

        persist(&self.path, &guard)?;
        Ok(descriptor)
    }

    /// Ensure a catalog template is registered; return its descriptor.
    pub fn ensure_catalog_agent(
        &self,
        template_id: &str,
        set_default: bool,
    ) -> Result<AgentDescriptor, AppError> {
        let info = template_info(template_id)
            .filter(|t| t.id != "custom")
            .ok_or_else(|| AppError::message(format!("unknown catalog template: {template_id}")))?;

        // Prefer existing registration for this template.
        {
            let state = self.snapshot()?;
            if let Some(existing) = state.agents.iter().find(|a| {
                a.template.as_str() == template_id
                    || (a.command == info.command && a.args == info.args)
            }) {
                if set_default {
                    let _ = self.set_default(Some(existing.id.clone()));
                    return self.get(&existing.id);
                }
                return Ok(existing.clone());
            }
        }

        let agent = self.upsert(UpsertAgentRequest {
            id: Some(format!("catalog-{template_id}")),
            name: info.name,
            template: Some(template_from_id(template_id)),
            command: info.command,
            args: info.args,
            env: Default::default(),
            set_default,
        })?;
        self.get(&agent.id)
    }

    pub fn remove(&self, id: &str) -> Result<(), AppError> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| AppError::message("agent registry lock poisoned"))?;
        let before = guard.agents.len();
        guard.agents.retain(|a| a.id != id);
        if guard.agents.len() == before {
            return Err(AppError::AgentNotFound(id.to_string()));
        }
        if guard.default_id.as_deref() == Some(id) {
            guard.default_id = guard.agents.first().map(|a| a.id.clone());
        }
        persist(&self.path, &guard)?;
        Ok(())
    }

    pub fn discover(&self, id: Option<&str>) -> Result<Vec<AgentDescriptor>, AppError> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| AppError::message("agent registry lock poisoned"))?;

        for agent in guard.agents.iter_mut() {
            if id.is_some_and(|want| want != agent.id) {
                continue;
            }
            match probe_command(&agent.command) {
                Ok(_) => {
                    agent.available = true;
                    agent.last_error = None;
                }
                Err(e) => {
                    agent.available = false;
                    agent.last_error = Some(e);
                }
            }
        }
        persist(&self.path, &guard)?;
        Ok(if let Some(want) = id {
            guard
                .agents
                .iter()
                .filter(|a| a.id == want)
                .cloned()
                .collect()
        } else {
            guard.agents.clone()
        })
    }

    pub fn get(&self, id: &str) -> Result<AgentDescriptor, AppError> {
        let state = self.snapshot()?;
        state
            .agents
            .into_iter()
            .find(|a| a.id == id)
            .ok_or_else(|| AppError::AgentNotFound(id.to_string()))
    }

    pub fn apply_probe_result(&self, id: &str, result: &ProbeResult) -> Result<(), AppError> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| AppError::message("agent registry lock poisoned"))?;
        let agent = guard
            .agents
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| AppError::AgentNotFound(id.to_string()))?;
        let now = chrono_like_now();
        agent.last_probe_ok = Some(result.available);
        agent.last_probe_agent_name = result.agent_name.clone();
        agent.last_probe_error = result.error.clone();
        agent.last_probed_at = Some(now);
        if result.available {
            agent.available = true;
            agent.last_error = None;
        }
        persist(&self.path, &guard)?;
        Ok(())
    }

    pub fn scan_catalog(&self) -> Result<CatalogScanResponse, AppError> {
        let state = self.snapshot()?;
        let default_id = state.default_id.clone();

        let mut entries = Vec::new();
        for info in catalog_templates() {
            let detect = info
                .detect_command
                .as_deref()
                .unwrap_or(info.command.as_str());
            let detect_path = resolve_command(detect);
            let binary_available = detect_path.is_some();
            let acp_path = resolve_command(&info.command);
            let acp_command_available = acp_path.is_some();

            let registered = state.agents.iter().find(|a| {
                a.template.as_str() == info.id || (a.command == info.command && a.args == info.args)
            });

            let (acp_status, acp_agent_name, last_probe_error, last_probed_at) =
                if !acp_command_available && !binary_available {
                    (CatalogAcpStatus::Missing, None, None, None)
                } else if let Some(reg) = registered {
                    match reg.last_probe_ok {
                        Some(true) => (
                            CatalogAcpStatus::Ready,
                            reg.last_probe_agent_name.clone(),
                            None,
                            reg.last_probed_at.clone(),
                        ),
                        Some(false) => (
                            CatalogAcpStatus::Failed,
                            reg.last_probe_agent_name.clone(),
                            reg.last_probe_error.clone(),
                            reg.last_probed_at.clone(),
                        ),
                        None => {
                            if acp_command_available {
                                (CatalogAcpStatus::NotProbed, None, None, None)
                            } else {
                                (
                                    CatalogAcpStatus::Missing,
                                    None,
                                    Some(format!("ACP command `{}` not found", info.command)),
                                    None,
                                )
                            }
                        }
                    }
                } else if acp_command_available {
                    (CatalogAcpStatus::NotProbed, None, None, None)
                } else {
                    (
                        CatalogAcpStatus::Missing,
                        None,
                        Some(format!("command `{detect}` not found on PATH")),
                        None,
                    )
                };

            let registered_id = registered.map(|a| a.id.clone());
            let is_default = registered_id
                .as_ref()
                .zip(default_id.as_ref())
                .is_some_and(|(a, d)| a == d);

            entries.push(CatalogEntry {
                template_id: info.id,
                name: info.name,
                description: info.description,
                command: info.command,
                args: info.args,
                install_hint: info.install_hint,
                binary_available,
                resolved_path: detect_path.map(|p| p.display().to_string()),
                acp_command_available,
                acp_status,
                registered_id,
                is_default,
                acp_agent_name,
                last_probe_error,
                last_probed_at,
            });
        }

        let custom_agents = state
            .agents
            .into_iter()
            .filter(|a| matches!(a.template, AgentTemplate::Custom))
            .collect();

        Ok(CatalogScanResponse {
            entries,
            custom_agents,
            default_id,
            enabled: state.enabled,
            proxy_enabled: state.proxy_enabled,
            proxy_url: state.proxy_url,
        })
    }

    pub fn resolve_default(&self, preferred: Option<&str>) -> Result<AgentDescriptor, AppError> {
        let state = self.snapshot()?;
        if !state.enabled {
            return Err(AppError::message(
                "Agent is disabled. Enable it in Settings → Agent.",
            ));
        }
        let id = preferred
            .map(str::to_string)
            .or(state.default_id.clone())
            .ok_or_else(|| {
                AppError::message("No agent configured. Add one in Settings → Agent.")
            })?;
        let agent = state
            .agents
            .into_iter()
            .find(|a| a.id == id)
            .ok_or(AppError::AgentNotFound(id))?;
        if !agent.available {
            return Err(AppError::AgentUnavailable(agent.last_error.unwrap_or_else(
                || format!("command `{}` not available", agent.command),
            )));
        }
        Ok(agent)
    }
}

fn stable_id_for(template: &AgentTemplate, command: &str, args: &[String]) -> String {
    match template {
        AgentTemplate::Custom => Uuid::new_v4().to_string(),
        other => {
            let _ = (command, args);
            format!("catalog-{}", other.as_str())
        }
    }
}

fn chrono_like_now() -> String {
    // RFC3339-ish without extra deps: unix secs is enough for UI ordering.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn config_path() -> PathBuf {
    let base = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("motif");
    let _ = fs::create_dir_all(&base);
    base.join("agents.json")
}

fn read_state(path: &PathBuf) -> Result<AgentRegistryState, AppError> {
    if !path.exists() {
        return Ok(AgentRegistryState::default());
    }
    let raw = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&raw)?)
}

fn persist(path: &PathBuf, state: &AgentRegistryState) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(state)?;
    fs::write(path, raw)?;
    Ok(())
}

fn normalize_proxy_url(proxy_url: &str) -> String {
    let trimmed = proxy_url.trim();
    if trimmed.is_empty() {
        default_agent_proxy_url()
    } else {
        trimmed.to_string()
    }
}

fn apply_proxy_settings(state: &mut AgentRegistryState) {
    state.proxy_url = normalize_proxy_url(&state.proxy_url);
    let proxy_enabled = state.proxy_enabled;
    let proxy_url = state.proxy_url.clone();
    for agent in &mut state.agents {
        apply_proxy_to_agent(agent, proxy_enabled, &proxy_url);
    }
}

fn apply_proxy_to_agent(agent: &mut AgentDescriptor, proxy_enabled: bool, proxy_url: &str) {
    if matches!(agent.template, AgentTemplate::Custom) {
        return;
    }
    for key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] {
        agent.env.remove(key);
    }
    if proxy_enabled {
        let proxy_url = proxy_url.trim();
        if !proxy_url.is_empty() {
            for key in ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] {
                agent.env.insert(key.to_string(), proxy_url.to_string());
            }
        }
    }
}

fn refresh_availability(state: &mut AgentRegistryState) {
    for agent in &mut state.agents {
        match probe_command(&agent.command) {
            Ok(_) => {
                agent.available = true;
                agent.last_error = None;
            }
            Err(e) => {
                agent.available = false;
                agent.last_error = Some(e);
            }
        }
    }
}
