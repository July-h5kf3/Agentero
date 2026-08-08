//! Offline write-back: NOTES.md → Agentero-marked Zotero child note.
//!
//! Safety contract:
//! - Requires Zotero to be closed (write-lock probe via `BEGIN IMMEDIATE`).
//! - Mandatory timestamped backup of `zotero.sqlite` (+wal/shm) before any
//!   write; only the newest few backups are kept.
//! - Only creates/replaces Agentero-marked child notes (marker carries the
//!   paper id); user-written notes are never touched.
//! - One transaction for the whole pass; any failure rolls everything back.
//!
//! Known boundary (verified against a real Zotero 7 library): `items` /
//! `itemNotes` have no triggers feeding `syncQueue`, so pushed notes show up
//! in local Zotero but are not auto-queued for Zotero cloud sync until the
//! user edits them inside Zotero. Documented in identifier-lookup.md §17.

use super::codec;
use crate::core::error::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};

/// Keep at most this many Agentero backups of zotero.sqlite.
const MAX_BACKUPS: usize = 5;

/// One paper whose NOTES.md should be pushed (selected from the pre-pull
/// catalog snapshot; pull advances watermarks during the same run).
#[derive(Debug, Clone)]
pub struct PushCandidate {
    pub zotero_item_id: i64,
    /// Agentero paper id embedded in the sync marker.
    pub paper_id: String,
    /// Vault-relative paper path (for NOTES.md + error reporting).
    pub path: String,
}

#[derive(Debug, Default)]
pub struct PushReport {
    pub pushed: usize,
    pub backup_path: Option<String>,
}

/// Push vault notes into Zotero. See module docs for the safety contract.
pub fn push_notes(
    vault: &Path,
    zotero_dir: &Path,
    candidates: &[PushCandidate],
    progress: impl Fn(usize, usize),
) -> Result<PushReport, AppError> {
    if candidates.is_empty() {
        progress(0, 0);
        return Ok(PushReport::default());
    }

    let db_path = zotero_dir.join("zotero.sqlite");
    if !db_path.is_file() {
        return Err(AppError::message(
            "zotero.sqlite not found in the selected folder",
        ));
    }

    // Write-lock probe: fails with SQLITE_BUSY while Zotero is running.
    let conn = Connection::open(&db_path)
        .map_err(|e| AppError::message(format!("open zotero.sqlite for writing: {e}")))?;
    conn.execute_batch("BEGIN IMMEDIATE; ROLLBACK;")
        .map_err(|e| {
            AppError::message(format!(
                "zotero.sqlite is locked — close Zotero and retry: {e}"
            ))
        })?;

    // Mandatory backup before touching anything.
    let backup = backup_zotero_db(zotero_dir)?;

    let total = candidates.len();
    let tx = conn.unchecked_transaction()?;
    let mut failures: Vec<String> = Vec::new();
    for (idx, cand) in candidates.iter().enumerate() {
        progress(idx, total);
        let notes_md =
            fs::read_to_string(vault.join(&cand.path).join("NOTES.md")).unwrap_or_default();
        if notes_md.trim().is_empty() {
            continue;
        }
        let html =
            codec::wrap_sync_html(&cand.paper_id, &codec::markdown_to_zotero_html(&notes_md));
        if let Err(e) = upsert_marked_note(&tx, cand.zotero_item_id, &cand.paper_id, &html) {
            failures.push(format!("{}: {e}", cand.path));
        }
    }

    if !failures.is_empty() {
        let _ = tx.rollback();
        progress(total, total);
        return Err(AppError::message(format!(
            "push rolled back (backup at {}): {}",
            backup.display(),
            failures.join("; ")
        )));
    }
    tx.commit()
        .map_err(|e| AppError::message(format!("commit zotero writes: {e}")))?;
    progress(total, total);
    Ok(PushReport {
        pushed: total,
        backup_path: Some(backup.to_string_lossy().to_string()),
    })
}

/// Create or replace this parent item's Agentero-marked child note.
fn upsert_marked_note(
    tx: &Connection,
    parent_item_id: i64,
    paper_id: &str,
    html: &str,
) -> Result<(), AppError> {
    // The note row must live in the parent's library.
    let library_id: i64 = tx
        .query_row(
            "SELECT libraryID FROM items WHERE itemID = ?1",
            params![parent_item_id],
            |r| r.get(0),
        )
        .map_err(|_| AppError::message(format!("Zotero parent item {parent_item_id} not found")))?;

    // Existing Agentero note for exactly this paper under this parent?
    let marker_like = format!("%<!-- agentero:sync paper={paper_id} -->%");
    let existing: Option<i64> = tx
        .query_row(
            "SELECT n.itemID FROM itemNotes n
             WHERE n.parentItemID = ?1
               AND n.itemID NOT IN (SELECT itemID FROM deletedItems)
               AND n.note LIKE ?2
             ORDER BY n.itemID LIMIT 1",
            params![parent_item_id, marker_like],
            |r| r.get(0),
        )
        .optional()?;

    match existing {
        Some(note_id) => {
            tx.execute(
                "UPDATE itemNotes SET note = ?2 WHERE itemID = ?1",
                params![note_id, html],
            )
            .map_err(|e| AppError::message(format!("update note {note_id}: {e}")))?;
            tx.execute(
                "UPDATE items SET dateModified = CURRENT_TIMESTAMP,
                                   clientDateModified = CURRENT_TIMESTAMP
                 WHERE itemID = ?1",
                params![note_id],
            )
            .map_err(|e| AppError::message(format!("touch note item {note_id}: {e}")))?;
        }
        None => {
            let note_type_id: i64 = tx
                .query_row(
                    "SELECT itemTypeID FROM itemTypes WHERE typeName = 'note'",
                    [],
                    |r| r.get(0),
                )
                .map_err(|e| AppError::message(format!("note itemType missing: {e}")))?;
            let key = zotero_key();
            tx.execute(
                "INSERT INTO items (itemTypeID, libraryID, key, dateAdded, dateModified, clientDateModified)
                 VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                params![note_type_id, library_id, key],
            )
            .map_err(|e| AppError::message(format!("insert note item: {e}")))?;
            let note_id: i64 = tx
                .query_row("SELECT last_insert_rowid()", [], |r| r.get(0))
                .map_err(|e| AppError::message(format!("note item id: {e}")))?;
            tx.execute(
                "INSERT INTO itemNotes (itemID, parentItemID, note) VALUES (?1, ?2, ?3)",
                params![note_id, parent_item_id, html],
            )
            .map_err(|e| AppError::message(format!("insert itemNotes row: {e}")))?;
        }
    }

    // Touch the parent so Zotero's item list shows an updated timestamp.
    tx.execute(
        "UPDATE items SET dateModified = CURRENT_TIMESTAMP,
                           clientDateModified = CURRENT_TIMESTAMP
         WHERE itemID = ?1",
        params![parent_item_id],
    )
    .map_err(|e| AppError::message(format!("touch parent item {parent_item_id}: {e}")))?;
    Ok(())
}

/// Copy `zotero.sqlite` (+wal/shm) into `<zotero_dir>/agentero-backups/`,
/// keeping only the newest [`MAX_BACKUPS`] backups.
fn backup_zotero_db(zotero_dir: &Path) -> Result<PathBuf, AppError> {
    let backups_dir = zotero_dir.join("agentero-backups");
    fs::create_dir_all(&backups_dir)?;
    let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
    let dest = backups_dir.join(format!("zotero-{stamp}.sqlite"));
    fs::copy(zotero_dir.join("zotero.sqlite"), &dest)
        .map_err(|e| AppError::message(format!("backup zotero.sqlite: {e}")))?;
    for ext in ["-wal", "-shm"] {
        let src = zotero_dir.join(format!("zotero.sqlite{ext}"));
        if src.is_file() {
            let _ = fs::copy(
                &src,
                backups_dir.join(format!("zotero-{stamp}.sqlite{ext}")),
            );
        }
    }
    prune_old_backups(&backups_dir);
    Ok(dest)
}

fn prune_old_backups(backups_dir: &Path) {
    let Ok(entries) = fs::read_dir(backups_dir) else {
        return;
    };
    let mut bases: Vec<String> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.strip_prefix("zotero-")
                .and_then(|rest| rest.split(".sqlite").next())
                .map(str::to_string)
        })
        .collect();
    bases.sort();
    bases.dedup();
    if bases.len() <= MAX_BACKUPS {
        return;
    }
    for base in bases.iter().take(bases.len() - MAX_BACKUPS) {
        for suffix in ["", ".sqlite-wal", ".sqlite-shm"] {
            let p = backups_dir.join(format!("zotero-{base}.sqlite{suffix}"));
            if p.is_file() {
                let _ = fs::remove_file(&p);
            }
        }
        // The base file itself (pattern above covers it via suffix "").
        let main = backups_dir.join(format!("zotero-{base}.sqlite"));
        if main.is_file() {
            let _ = fs::remove_file(&main);
        }
    }
}

/// Fresh 8-char Zotero-style item key (base32 without 0/1/l/o).
fn zotero_key() -> String {
    const ALPHABET: &[u8; 32] = b"23456789abcdefghijkmnpqrstuvwxyz";
    uuid::Uuid::new_v4()
        .as_bytes()
        .iter()
        .take(8)
        .map(|b| ALPHABET[(b % 32) as usize] as char)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zotero_key_shape() {
        let key = zotero_key();
        assert_eq!(key.len(), 8);
        assert!(key
            .chars()
            .all(|c| "23456789abcdefghijkmnpqrstuvwxyz".contains(c)));
    }

    #[tokio::test]
    async fn push_creates_then_replaces_marked_note() {
        let base = std::env::temp_dir().join(format!(
            "motif-zpush-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ));
        let zdir = base.join("zotero");
        fs::create_dir_all(&zdir).unwrap();
        // Minimal Zotero-shaped schema.
        {
            let conn = Connection::open(zdir.join("zotero.sqlite")).unwrap();
            conn.execute_batch(
                "CREATE TABLE itemTypes (itemTypeID INTEGER PRIMARY KEY, typeName TEXT);
                 CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INT NOT NULL,
                     libraryID INT NOT NULL, key TEXT NOT NULL,
                     dateAdded TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                     dateModified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                     clientDateModified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
                 CREATE TABLE itemNotes (itemID INTEGER, parentItemID INT, note TEXT, title TEXT);
                 CREATE TABLE deletedItems (itemID INTEGER);
                 INSERT INTO itemTypes VALUES (14,'journalArticle'),(28,'note');
                 INSERT INTO items (itemID, itemTypeID, libraryID, key) VALUES (4, 14, 1, 'abcd2345');",
            )
            .unwrap();
        }
        let vault = base.join("vault");
        fs::create_dir_all(vault.join("papers/x")).unwrap();
        fs::write(vault.join("papers/x/NOTES.md"), "# My note\n\nhello world").unwrap();

        let cand = PushCandidate {
            zotero_item_id: 4,
            paper_id: "x".into(),
            path: "papers/x".into(),
        };

        // First push creates the marked child note.
        let r1 = push_notes(&vault, &zdir, std::slice::from_ref(&cand), |_, _| {}).unwrap();
        assert_eq!(r1.pushed, 1);
        assert!(r1.backup_path.is_some());
        let conn = Connection::open(zdir.join("zotero.sqlite")).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM itemNotes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let note: String = conn
            .query_row("SELECT note FROM itemNotes LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert!(note.contains("agentero:sync paper=x"));
        assert!(note.contains("hello world"));
        // Backup exists on disk.
        assert!(zdir.join("agentero-backups").is_dir());
        drop(conn);

        // Second push replaces in place (still exactly one note).
        fs::write(vault.join("papers/x/NOTES.md"), "# My note\n\nupdated body").unwrap();
        push_notes(&vault, &zdir, std::slice::from_ref(&cand), |_, _| {}).unwrap();
        let conn = Connection::open(zdir.join("zotero.sqlite")).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM itemNotes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
        let note: String = conn
            .query_row("SELECT note FROM itemNotes LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert!(note.contains("updated body"));

        // A user note without markers is never touched.
        conn.execute(
            "INSERT INTO items (itemID, itemTypeID, libraryID, key) VALUES (9, 28, 1, 'user1234')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO itemNotes VALUES (9, 4, 'user written', NULL)",
            [],
        )
        .unwrap();
        drop(conn);
        push_notes(&vault, &zdir, std::slice::from_ref(&cand), |_, _| {}).unwrap();
        let conn = Connection::open(zdir.join("zotero.sqlite")).unwrap();
        let user_note: String = conn
            .query_row("SELECT note FROM itemNotes WHERE itemID = 9", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(user_note, "user written");
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM itemNotes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(total, 2, "marked note replaced, user note untouched");

        let _ = fs::remove_dir_all(&base);
    }
}
