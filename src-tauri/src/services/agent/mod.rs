pub mod acp;
#[cfg(test)]
mod acp_tests;
pub mod discover;
pub mod prompts;
pub mod registry;
pub mod templates;

pub use acp::{new_ids, probe_agent, run_once, warm_agent};
pub use registry::AgentRegistry;
pub use templates::builtin_templates;
