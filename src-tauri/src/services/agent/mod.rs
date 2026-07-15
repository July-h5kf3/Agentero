pub mod acp;
#[cfg(test)]
mod acp_tests;
pub mod discover;
pub mod prompts;
pub mod registry;
pub mod runtime;
pub mod skills;
pub mod templates;

pub use acp::{new_ids, probe_agent, run_once, warm_agent};
pub use registry::AgentRegistry;
pub use runtime::AgentRunController;
pub use skills::list_agent_skills;
pub use templates::builtin_templates;
