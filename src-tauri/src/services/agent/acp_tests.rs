#[cfg(test)]
mod acp_live {
    use crate::models::agent::{AgentDescriptor, AgentTemplate, CatalogAcpStatus};
    use crate::services::agent::acp::permission_response;
    use crate::services::agent::discover::resolve_command;
    use crate::services::agent::probe_agent;
    use crate::services::agent::templates::catalog_templates;
    use crate::services::agent::AgentRegistry;
    use agent_client_protocol::schema::v1::{
        PermissionOption, PermissionOptionId, PermissionOptionKind, RequestPermissionOutcome,
        RequestPermissionRequest, ToolCallUpdate, ToolCallUpdateFields,
    };
    use std::collections::HashMap;

    fn desc(
        id: &str,
        name: &str,
        template: AgentTemplate,
        command: &str,
        args: Vec<String>,
    ) -> AgentDescriptor {
        AgentDescriptor {
            id: id.into(),
            name: name.into(),
            template,
            command: command.into(),
            args,
            env: HashMap::new(),
            available: true,
            last_error: None,
            last_probe_ok: None,
            last_probe_agent_name: None,
            last_probe_error: None,
            last_probed_at: None,
        }
    }

    #[tokio::test]
    async fn probe_opencode_acp_if_installed() {
        if resolve_command("opencode").is_none() {
            eprintln!("skip: opencode not on PATH");
            return;
        }
        let d = desc(
            "test-opencode",
            "OpenCode",
            AgentTemplate::Opencode,
            "opencode",
            vec!["acp".into()],
        );
        let result = probe_agent(&d).await;
        eprintln!("probe result: {:?}", result);
        assert!(
            result.available,
            "opencode acp probe should succeed: {:?}",
            result.error
        );
    }

    #[test]
    fn catalog_has_common_agents() {
        let cats = catalog_templates();
        let ids: Vec<_> = cats.iter().map(|c| c.id.as_str()).collect();
        assert!(ids.contains(&"opencode"));
        assert!(ids.contains(&"claude-acp"));
        assert!(ids.contains(&"codex-acp"));
        assert!(ids.contains(&"gemini"));
        assert!(ids.contains(&"qodercli"));
        assert!(ids.contains(&"grok-build"));
        assert!(!ids.contains(&"custom"));
    }

    #[test]
    fn codex_template_uses_the_native_app_server() {
        let codex = catalog_templates()
            .into_iter()
            .find(|entry| entry.id == "codex-acp")
            .expect("Codex template");

        assert_eq!(codex.command, "codex");
        assert_eq!(codex.args, vec!["app-server"]);
        assert_eq!(codex.detect_command.as_deref(), Some("codex"));
    }

    #[test]
    fn permission_requests_are_cancelled_unless_yolo_is_enabled() {
        let request = RequestPermissionRequest::new(
            "session",
            ToolCallUpdate::new("tool-call", ToolCallUpdateFields::new()),
            vec![
                PermissionOption::new(
                    "reject-once",
                    "Reject once",
                    PermissionOptionKind::RejectOnce,
                ),
                PermissionOption::new(
                    "allow-always",
                    "Allow always",
                    PermissionOptionKind::AllowAlways,
                ),
                PermissionOption::new("allow-once", "Allow once", PermissionOptionKind::AllowOnce),
            ],
        );

        assert!(matches!(
            permission_response(&request, false).outcome,
            RequestPermissionOutcome::Cancelled
        ));
        assert!(matches!(
            permission_response(&request, true).outcome,
            RequestPermissionOutcome::Selected(selected)
                if selected.option_id == PermissionOptionId::new("allow-once")
        ));
    }

    #[test]
    fn scan_catalog_reflects_local_binaries() {
        let reg = AgentRegistry::load();
        let scan = reg.scan_catalog().expect("scan");
        for e in &scan.entries {
            eprintln!(
                "catalog {} binary={} acp_cmd={} status={:?} path={:?}",
                e.template_id,
                e.binary_available,
                e.acp_command_available,
                e.acp_status,
                e.resolved_path
            );
        }
        let by_id = |id: &str| {
            scan.entries
                .iter()
                .find(|e| e.template_id == id)
                .unwrap_or_else(|| panic!("missing catalog entry {id}"))
        };
        if resolve_command("opencode").is_some() {
            assert!(by_id("opencode").binary_available);
            assert_ne!(by_id("opencode").acp_status, CatalogAcpStatus::Missing);
        }
        if resolve_command("claude").is_some() {
            assert!(by_id("claude-acp").binary_available);
        }
        if resolve_command("qodercli").is_some() {
            assert!(by_id("qodercli").binary_available);
            assert_ne!(by_id("qodercli").acp_status, CatalogAcpStatus::Missing);
        }
        if resolve_command("npx").is_some() {
            assert!(by_id("grok-build").binary_available);
            assert_ne!(by_id("grok-build").acp_status, CatalogAcpStatus::Missing);
        }
        if resolve_command("codex").is_some() {
            assert!(by_id("codex-acp").binary_available);
        }
        if resolve_command("gemini").is_none() {
            assert!(!by_id("gemini").binary_available);
            assert_eq!(by_id("gemini").acp_status, CatalogAcpStatus::Missing);
        }
    }
}
