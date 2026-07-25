//! Agentero Host library (`agentero_lib`).
//!
//! - [`run`] — Tauri app entry (desktop / mobile).
//! - [`core`] / [`services`] — shared with the headless CLI (`agentero-cli`).
//!
//! Assembly lives in [`app`]; domain logic in [`services`] + [`commands`].

mod app;
mod commands;
/// Cross-cutting foundations (error, fs, paths, logging helpers).
pub mod core;
mod models;
/// Domain services (Vault / Catalog / Lookup / Wiki / …).
/// The CLI path-depends on this crate and may `use agentero_lib::services::{vault,catalog,…}`;
/// it must **not** use `services::agent` (BYOA is desktop-only).
pub mod services;

pub use app::run;
