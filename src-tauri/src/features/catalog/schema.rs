//! Catalog SQLite schema and ensure/open helpers.
//!
//! - v1: initial papers table
//! - v2: Translator / magic-wand fields (publication, volume, isbn, …)
//! - v3: `is_read` for paper-reader workflow

use crate::core::error::AppError;
use rusqlite::Connection;
use std::fs;
use std::path::Path;

/// Current catalog schema version written to `schema_meta`.
pub const SCHEMA_VERSION: i32 = 3;

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

/// Columns added in schema v2 (Translator → PaperMetadata).
const MIGRATE_V1_TO_V2: &str = r#"
ALTER TABLE papers ADD COLUMN creators_json TEXT;
ALTER TABLE papers ADD COLUMN date TEXT;
ALTER TABLE papers ADD COLUMN isbn TEXT;
ALTER TABLE papers ADD COLUMN issn TEXT;
ALTER TABLE papers ADD COLUMN pmid TEXT;
ALTER TABLE papers ADD COLUMN publication TEXT;
ALTER TABLE papers ADD COLUMN volume TEXT;
ALTER TABLE papers ADD COLUMN issue TEXT;
ALTER TABLE papers ADD COLUMN pages TEXT;
ALTER TABLE papers ADD COLUMN publisher TEXT;
ALTER TABLE papers ADD COLUMN place TEXT;
ALTER TABLE papers ADD COLUMN series TEXT;
ALTER TABLE papers ADD COLUMN language TEXT;
ALTER TABLE papers ADD COLUMN zotero_item_type TEXT;
ALTER TABLE papers ADD COLUMN meta_source TEXT;
ALTER TABLE papers ADD COLUMN extra TEXT;
CREATE INDEX IF NOT EXISTS idx_papers_pmid ON papers(pmid);
CREATE INDEX IF NOT EXISTS idx_papers_isbn ON papers(isbn);
"#;

/// Columns added in schema v3 (paper-reader read flag).
const MIGRATE_V2_TO_V3: &str = r#"
ALTER TABLE papers ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_papers_is_read ON papers(is_read);
"#;

/// Absolute path to `{vault}/.agentero/catalog.sqlite`.
pub fn catalog_db_path(vault_root: &Path) -> std::path::PathBuf {
    vault_root.join(".agentero").join("catalog.sqlite")
}

/// Ensure `.agentero/` exists, create/open catalog.sqlite, apply migrations.
pub fn ensure_catalog(vault_root: &Path) -> Result<Connection, AppError> {
    let agentero_dir = vault_root.join(".agentero");
    fs::create_dir_all(&agentero_dir)?;

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
            "catalog schema version {version} is newer than this app supports ({SCHEMA_VERSION}); upgrade Agentero"
        )));
    }

    if version < 1 {
        conn.execute_batch(DDL_V1)
            .map_err(|e| AppError::message(format!("catalog migrate v1: {e}")))?;
        set_schema_version(conn, 1)?;
    }

    let version = schema_version(conn).unwrap_or(0);
    if version < 2 {
        // SQLite ADD COLUMN is not fully batch-safe across existing cols; run one-by-one ignore dupes
        for stmt in MIGRATE_V1_TO_V2.split(';') {
            let s = stmt.trim();
            if s.is_empty() {
                continue;
            }
            match conn.execute_batch(&format!("{s};")) {
                Ok(()) => {}
                Err(e) => {
                    let msg = e.to_string();
                    // Idempotent re-run / partial migrate
                    if msg.contains("duplicate column name") {
                        continue;
                    }
                    return Err(AppError::message(format!("catalog migrate v2: {e}")));
                }
            }
        }
        set_schema_version(conn, 2)?;
    }

    let version = schema_version(conn).unwrap_or(0);
    if version < 3 {
        for stmt in MIGRATE_V2_TO_V3.split(';') {
            let s = stmt.trim();
            if s.is_empty() {
                continue;
            }
            match conn.execute_batch(&format!("{s};")) {
                Ok(()) => {}
                Err(e) => {
                    let msg = e.to_string();
                    if msg.contains("duplicate column name") {
                        continue;
                    }
                    return Err(AppError::message(format!("catalog migrate v3: {e}")));
                }
            }
        }
        set_schema_version(conn, 3)?;
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
        "INSERT INTO schema_meta(key, value) VALUES('agentero_app', 'agentero')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [],
    )
    .map_err(|e| AppError::message(format!("write agentero_app: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn ensure_catalog_creates_schema_current() {
        let dir = env::temp_dir().join(format!("agentero-catalog-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let conn = ensure_catalog(&dir).expect("ensure");
        assert_eq!(schema_version(&conn).unwrap(), SCHEMA_VERSION);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM papers", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);

        // v2 columns exist
        let has_pub: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('papers') WHERE name = 'publication'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_pub, 1);

        // v3 is_read exists
        let has_read: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('papers') WHERE name = 'is_read'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_read, 1);

        // Idempotent second open
        drop(conn);
        let conn2 = ensure_catalog(&dir).expect("reopen");
        assert_eq!(schema_version(&conn2).unwrap(), SCHEMA_VERSION);

        let _ = fs::remove_dir_all(&dir);
    }
}
