//! Best-effort persistent snapshot for the rebuildable Wiki index.
//!
//! Markdown and Vault target files remain the only facts. A snapshot is restored
//! only when its schema, parser, vault identity, and integrity hash match; the
//! caller compares per-file stat fingerprints (size + mtime) to decide between a
//! full restore and an incremental rebuild of changed files.

use crate::core::paths::agentero_cache_dir;
use crate::features::wiki::models::{ResolvedLink, WikiDocument};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) const WIKI_CACHE_SCHEMA_VERSION: i64 = 2;
pub(crate) const WIKI_PARSER_VERSION: &str = "wiki-parser-2026-07-25-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct WikiFileFingerprint {
    pub relative_path: String,
    pub size: i64,
    pub modified_time_ns: i64,
}

#[derive(Debug)]
pub(crate) struct WikiCacheSnapshot {
    pub fingerprints: Vec<WikiFileFingerprint>,
    pub documents: Vec<WikiDocument>,
    pub edges: Vec<ResolvedLink>,
}

#[derive(Debug)]
pub(crate) enum WikiCacheLoad {
    Hit(WikiCacheSnapshot),
    Miss,
    Stale,
    Invalid(String),
}

fn vault_identity(vault_root: &Path) -> String {
    fs::canonicalize(vault_root)
        .unwrap_or_else(|_| vault_root.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/")
}

fn vault_key(vault_root: &Path) -> String {
    hex::encode(Sha256::digest(vault_identity(vault_root).as_bytes()))
}

pub(crate) fn wiki_cache_path(vault_root: &Path) -> PathBuf {
    agentero_cache_dir()
        .join("wiki")
        .join(format!("{}.sqlite", vault_key(vault_root)))
}

fn modified_time_ns(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| i64::try_from(duration.as_nanos()).ok())
        .unwrap_or(0)
}

fn hash_bytes(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub(crate) fn fingerprint_file(
    relative_path: &str,
    absolute_path: &Path,
) -> io::Result<WikiFileFingerprint> {
    let metadata = fs::metadata(absolute_path)?;
    Ok(WikiFileFingerprint {
        relative_path: relative_path.to_string(),
        size: i64::try_from(metadata.len()).unwrap_or(i64::MAX),
        modified_time_ns: modified_time_ns(&metadata),
    })
}

pub(crate) fn fingerprint_files(
    vault_root: &Path,
    files: &[String],
) -> io::Result<Vec<WikiFileFingerprint>> {
    files
        .iter()
        .map(|relative_path| fingerprint_file(relative_path, &vault_root.join(relative_path)))
        .collect()
}

fn snapshot_hash(
    fingerprints: &[WikiFileFingerprint],
    documents: &[WikiDocument],
    edges: &[ResolvedLink],
) -> Result<String, String> {
    let bytes = serde_json::to_vec(&(fingerprints, documents, edges))
        .map_err(|error| format!("serialize wiki cache integrity payload: {error}"))?;
    Ok(hash_bytes(&bytes))
}

fn open_read_only(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| format!("open wiki cache {}: {error}", path.display()))?;
    connection
        .busy_timeout(Duration::from_millis(250))
        .map_err(|error| format!("configure wiki cache timeout: {error}"))?;
    Ok(connection)
}

pub(crate) fn load_snapshot(cache_path: &Path, vault_root: &Path) -> WikiCacheLoad {
    if !cache_path.is_file() {
        return WikiCacheLoad::Miss;
    }
    let result = (|| -> Result<WikiCacheSnapshot, String> {
        let connection = open_read_only(cache_path)?;
        let metadata = connection
            .query_row(
                "SELECT schema_version, parser_version, vault_key, vault_path, snapshot_hash
                 FROM cache_metadata WHERE id = 1",
                [],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("read wiki cache metadata: {error}"))?
            .ok_or_else(|| "wiki cache metadata is missing".to_string())?;
        let identity = vault_identity(vault_root);
        if metadata.0 != WIKI_CACHE_SCHEMA_VERSION
            || metadata.1 != WIKI_PARSER_VERSION
            || metadata.2 != vault_key(vault_root)
            || metadata.3 != identity
        {
            return Err("wiki cache version or vault identity is stale".to_string());
        }

        let mut file_statement = connection
            .prepare(
                "SELECT relative_path, size, modified_time_ns
                 FROM files ORDER BY relative_path",
            )
            .map_err(|error| format!("prepare wiki cache fingerprints: {error}"))?;
        let fingerprints = file_statement
            .query_map([], |row| {
                Ok(WikiFileFingerprint {
                    relative_path: row.get(0)?,
                    size: row.get(1)?,
                    modified_time_ns: row.get(2)?,
                })
            })
            .map_err(|error| format!("read wiki cache fingerprints: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("decode wiki cache fingerprints: {error}"))?;

        let mut document_statement = connection
            .prepare(
                "SELECT path, aliases_json, headings_json, blocks_json
                 FROM documents ORDER BY path",
            )
            .map_err(|error| format!("prepare wiki cache documents: {error}"))?;
        let document_rows = document_statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|error| format!("read wiki cache documents: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("decode wiki cache document rows: {error}"))?;
        let documents = document_rows
            .into_iter()
            .map(|(path, aliases, headings, blocks)| {
                Ok(WikiDocument {
                    path,
                    aliases: serde_json::from_str(&aliases)
                        .map_err(|error| format!("decode wiki aliases: {error}"))?,
                    headings: serde_json::from_str(&headings)
                        .map_err(|error| format!("decode wiki headings: {error}"))?,
                    blocks: serde_json::from_str(&blocks)
                        .map_err(|error| format!("decode wiki blocks: {error}"))?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;

        let mut occurrence_statement = connection
            .prepare("SELECT resolved_link_json FROM occurrences ORDER BY ordinal")
            .map_err(|error| format!("prepare wiki cache occurrences: {error}"))?;
        let occurrence_rows = occurrence_statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("read wiki cache occurrences: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("decode wiki cache occurrence rows: {error}"))?;
        let edges = occurrence_rows
            .into_iter()
            .map(|value| {
                serde_json::from_str(&value)
                    .map_err(|error| format!("decode wiki resolved occurrence: {error}"))
            })
            .collect::<Result<Vec<ResolvedLink>, String>>()?;

        let calculated_hash = snapshot_hash(&fingerprints, &documents, &edges)?;
        if metadata.4 != calculated_hash {
            return Err("wiki cache snapshot integrity hash does not match".to_string());
        }
        Ok(WikiCacheSnapshot {
            fingerprints,
            documents,
            edges,
        })
    })();

    match result {
        Ok(snapshot) => WikiCacheLoad::Hit(snapshot),
        Err(error) if error == "wiki cache version or vault identity is stale" => {
            WikiCacheLoad::Stale
        }
        Err(error) => WikiCacheLoad::Invalid(error),
    }
}

fn initialize_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA journal_mode = DELETE;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS cache_metadata (
               id INTEGER PRIMARY KEY CHECK (id = 1),
               schema_version INTEGER NOT NULL,
               parser_version TEXT NOT NULL,
               vault_key TEXT NOT NULL,
               vault_path TEXT NOT NULL,
               built_at INTEGER NOT NULL,
               snapshot_hash TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS files (
               relative_path TEXT PRIMARY KEY,
               size INTEGER NOT NULL,
               modified_time_ns INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS documents (
               path TEXT PRIMARY KEY,
               aliases_json TEXT NOT NULL,
               headings_json TEXT NOT NULL,
               blocks_json TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS occurrences (
               ordinal INTEGER PRIMARY KEY,
               resolved_link_json TEXT NOT NULL
             );",
        )
        .map_err(|error| format!("initialize wiki cache schema: {error}"))
}

pub(crate) fn store_snapshot(
    cache_path: &Path,
    vault_root: &Path,
    fingerprints: &[WikiFileFingerprint],
    documents: &[WikiDocument],
    edges: &[ResolvedLink],
) -> Result<(), String> {
    let parent = cache_path
        .parent()
        .ok_or_else(|| "wiki cache path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create wiki cache directory {}: {error}", parent.display()))?;
    let mut connection = Connection::open(cache_path)
        .map_err(|error| format!("open wiki cache {}: {error}", cache_path.display()))?;
    connection
        .busy_timeout(Duration::from_millis(250))
        .map_err(|error| format!("configure wiki cache timeout: {error}"))?;
    initialize_schema(&connection)?;
    let integrity_hash = snapshot_hash(fingerprints, documents, edges)?;
    let built_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_secs()).ok())
        .unwrap_or(0);
    let transaction = connection
        .transaction()
        .map_err(|error| format!("begin wiki cache transaction: {error}"))?;
    transaction
        .execute_batch(
            "DELETE FROM occurrences;
             DELETE FROM documents;
             DELETE FROM files;
             DELETE FROM cache_metadata;",
        )
        .map_err(|error| format!("clear wiki cache snapshot: {error}"))?;
    transaction
        .execute(
            "INSERT INTO cache_metadata
             (id, schema_version, parser_version, vault_key, vault_path, built_at, snapshot_hash)
             VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                WIKI_CACHE_SCHEMA_VERSION,
                WIKI_PARSER_VERSION,
                vault_key(vault_root),
                vault_identity(vault_root),
                built_at,
                integrity_hash
            ],
        )
        .map_err(|error| format!("write wiki cache metadata: {error}"))?;
    for fingerprint in fingerprints {
        transaction
            .execute(
                "INSERT INTO files (relative_path, size, modified_time_ns)
                 VALUES (?1, ?2, ?3)",
                params![
                    fingerprint.relative_path,
                    fingerprint.size,
                    fingerprint.modified_time_ns
                ],
            )
            .map_err(|error| format!("write wiki cache fingerprint: {error}"))?;
    }
    for document in documents {
        transaction
            .execute(
                "INSERT INTO documents (path, aliases_json, headings_json, blocks_json)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    document.path,
                    serde_json::to_string(&document.aliases)
                        .map_err(|error| format!("encode wiki aliases: {error}"))?,
                    serde_json::to_string(&document.headings)
                        .map_err(|error| format!("encode wiki headings: {error}"))?,
                    serde_json::to_string(&document.blocks)
                        .map_err(|error| format!("encode wiki blocks: {error}"))?
                ],
            )
            .map_err(|error| format!("write wiki cache document: {error}"))?;
    }
    for (ordinal, edge) in edges.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO occurrences (ordinal, resolved_link_json) VALUES (?1, ?2)",
                params![
                    i64::try_from(ordinal).unwrap_or(i64::MAX),
                    serde_json::to_string(edge)
                        .map_err(|error| format!("encode wiki occurrence: {error}"))?
                ],
            )
            .map_err(|error| format!("write wiki cache occurrence: {error}"))?;
    }
    transaction
        .commit()
        .map_err(|error| format!("commit wiki cache snapshot: {error}"))
}

pub(crate) fn discard_snapshot(cache_path: &Path) -> Result<(), String> {
    for path in [
        cache_path.to_path_buf(),
        PathBuf::from(format!("{}-wal", cache_path.to_string_lossy())),
        PathBuf::from(format!("{}-shm", cache_path.to_string_lossy())),
    ] {
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|error| format!("remove stale wiki cache {}: {error}", path.display()))?;
        }
    }
    Ok(())
}
