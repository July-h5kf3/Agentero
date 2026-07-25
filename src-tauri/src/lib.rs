//! Agentero Host library (`agentero_lib`).
//!
//! - [`run`] — Tauri app entry (desktop / mobile).
//! - [`error`] / [`services`] — shared with the headless CLI (`agentero-cli`).
//!
//! Assembly lives in [`app`]; domain logic in [`services`] + [`commands`].

mod app;
mod commands;
/// Shared error types (used by Host commands and the headless CLI).
pub mod error;
/// Operation start/end helpers (`docs/development/logging.md`).
mod log_util;
mod models;
/// Domain services (Vault / Catalog / Lookup / Wiki / …).
/// The CLI path-depends on this crate and may `use agentero_lib::services::{vault,catalog,…}`;
/// it must **not** use `services::agent` (BYOA is desktop-only).
pub mod services;

pub use app::run;
