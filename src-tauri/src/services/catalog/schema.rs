//! Catalog SQLite schema (v1) and ensure/open helpers.

use crate::error::AppError;
use rusqlite::Connection;
use std::fs;
use std::path::Path;

/// Current catalog schema version written to `schema_meta`.
pub const SCHEMA_VERSION: i32 = 1;

const DDL_V1: &str = r#"
CREATE TABLE IF NOT EXISTS schema_meta (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS papers (
    path            TEXT PRIMARY KEY NOT NULL,
    id              TEXT NOT NULL,
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    authors_json    TEXT NOT NULL DEFAULT '[]',
    year            INTEGER,
    abstract        TEXT,
    tags_json       TEXT NOT NULL DEFAULT '[]',
    arxiv_id        TEXT,
    doi             TEXT,
    pdf_url         TEXT,
    html_url        TEXT,
    source_url      TEXT,
    body_source     TEXT,
    body_quality    TEXT,
    bibtex_key      TEXT,
    citation_count  INTEGER,
    status          TEXT NOT NULL DEFAULT 'completed',
    summary         TEXT,
    added_at        TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_papers_id ON papers(id);
CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year);
CREATE INDEX IF NOT EXISTS idx_papers_type ON papers(type);
CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(status);
CREATE INDEX IF NOT EXISTS idx_papers_arxiv ON papers(arxiv_id);
CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi);
CREATE INDEX IF NOT EXISTS idx_papers_bibtex ON papers(bibtex_key);
"#;

/// Absolute path to `{vault}/.motif/catalog.sqlite`.
pub fn catalog_db_path(vault_root: &Path) -> std::path::PathBuf {
    vault_root.join(".motif").join("catalog.sqlite")
}

/// Ensure `.motif/` exists, create/open catalog.sqlite, apply migrations.
pub fn ensure_catalog(vault_root: &Path) -> Result<Connection, AppError> {
    let motif_dir = vault_root.join(".motif");
    fs::create_dir_all(&motif_dir)?;

    let db_path = catalog_db_path(vault_root);
    let conn = Connection::open(&db_path)
        .map_err(|e| AppError::message(format!("open catalog {}: {e}", db_path.display())))?;

    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| AppError::message(format!("pragma: {e}")))?;

    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), AppError> {
    let version = schema_version(conn).unwrap_or(0);

    if version > SCHEMA_VERSION {
        return Err(AppError::message(format!(
            "catalog schema version {version} is newer than this app supports ({SCHEMA_VERSION}); upgrade Motif"
        )));
    }

    if version < 1 {
        conn.execute_batch(DDL_V1)
            .map_err(|e| AppError::message(format!("catalog migrate v1: {e}")))?;
        set_schema_version(conn, 1)?;
    }

    Ok(())
}

pub fn schema_version(conn: &Connection) -> Result<i32, AppError> {
    // Table may not exist yet
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_meta'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if !exists {
        return Ok(0);
    }
    conn.query_row(
        "SELECT value FROM schema_meta WHERE key = 'schema_version'",
        [],
        |row| {
            let v: String = row.get(0)?;
            Ok(v.parse::<i32>().unwrap_or(0))
        },
    )
    .map_err(|e| AppError::message(format!("read schema_version: {e}")))
}

fn set_schema_version(conn: &Connection, version: i32) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO schema_meta(key, value) VALUES('schema_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [version.to_string()],
    )
    .map_err(|e| AppError::message(format!("write schema_version: {e}")))?;
    conn.execute(
        "INSERT INTO schema_meta(key, value) VALUES('motif_app', 'motif')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [],
    )
    .map_err(|e| AppError::message(format!("write motif_app: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn ensure_catalog_creates_schema_v1() {
        let dir = env::temp_dir().join(format!("motif-catalog-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let conn = ensure_catalog(&dir).expect("ensure");
        assert_eq!(schema_version(&conn).unwrap(), SCHEMA_VERSION);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM papers", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);

        // Idempotent second open
        drop(conn);
        let conn2 = ensure_catalog(&dir).expect("reopen");
        assert_eq!(schema_version(&conn2).unwrap(), SCHEMA_VERSION);

        let _ = fs::remove_dir_all(&dir);
    }
}
