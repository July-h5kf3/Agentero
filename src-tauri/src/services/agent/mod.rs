pub mod acp;
#[cfg(test)]
mod acp_tests;
pub mod discover;
mod events;
pub mod permission;
pub mod prompts;
pub mod registry;
pub mod runtime;
pub mod skills;
pub mod templates;

pub use acp::{
    list_acp_sessions, load_acp_session, new_ids, probe_agent, run_once, warm_agent,
    PermissionPolicy,
};
pub use events::AgentEventEmitter;
pub use permission::PermissionGate;
pub use registry::AgentRegistry;
pub use runtime::AgentRunController;
pub use skills::list_agent_skills;
pub use templates::builtin_templates;
