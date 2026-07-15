//! Vault paper catalog: `.motif/catalog.sqlite`.
//!
//! Authoritative store for paper set + structured metadata.
//! See `docs/backend/catalog.md`.

mod schema;

#[allow(unused_imports)] // public API for future paper/list/import commands
pub use schema::{catalog_db_path, ensure_catalog, schema_version, SCHEMA_VERSION};
