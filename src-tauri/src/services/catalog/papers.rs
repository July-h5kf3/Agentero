//! papers table CRUD. Catalog is the authority for paper metadata.
//! `metadata.json` is a projection written after SQLite upsert.

use super::schema::ensure_catalog;
use crate::error::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// API / frontend shape (snake_case, matches PaperMetadata).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaperRecord {
    /// Vault-relative paper folder path (primary key).
    pub path: String,
    pub id: String,
    #[serde(rename = "type")]
    pub paper_type: String,
    pub title: String,
    pub authors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creators: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "abstract")]
    pub abstract_text: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arxiv_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doi: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub isbn: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issn: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pmid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publication: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pages: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub place: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pdf_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_quality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bibtex_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub citation_count: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zotero_item_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub status: String,
    /// Whether paper-reader workflow has completed for this paper.
    #[serde(default)]
    pub is_read: bool,
    pub added_at: String,
    pub updated_at: String,
}

/// Upsert paper row, then sync `metadata.json` under the paper folder.
pub fn upsert_paper(vault_root: &Path, record: &PaperRecord) -> Result<PaperRecord, AppError> {
    let conn = ensure_catalog(vault_root)?;
    upsert_conn(&conn, record)?;
    sync_metadata_json(vault_root, record)?;
    Ok(record.clone())
}

pub fn get_by_path(vault_root: &Path, path: &str) -> Result<Option<PaperRecord>, AppError> {
    let conn = ensure_catalog(vault_root)?;
    let path = path.replace('\\', "/").trim_matches('/').to_string();
    get_conn(&conn, &path)
}

/// First paper with the given logical `id` (ordered by path). For ambiguity, use [`list_by_id`].
pub fn get_by_id(vault_root: &Path, id: &str) -> Result<Option<PaperRecord>, AppError> {
    Ok(list_by_id(vault_root, id)?.into_iter().next())
}

/// All catalog rows with the given logical `id` (may be multiple paths).
pub fn list_by_id(vault_root: &Path, id: &str) -> Result<Vec<PaperRecord>, AppError> {
    let conn = ensure_catalog(vault_root)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                path, id, type, title, authors_json, year, abstract, tags_json,
                arxiv_id, doi, pdf_url, html_url, source_url,
                body_source, body_quality, bibtex_key, citation_count, status, summary,
                added_at, updated_at,
                creators_json, date, isbn, issn, pmid, publication, volume, issue, pages,
                publisher, place, series, language, zotero_item_type, meta_source, extra,
                is_read
            FROM papers
            WHERE id = ?1
            ORDER BY path ASC
            "#,
        )
        .map_err(AppError::from)?;

    let rows = stmt
        .query_map(params![id], map_row)
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    Ok(rows)
}

/// List all papers for library table (newest first).
pub fn list_all(vault_root: &Path) -> Result<Vec<PaperRecord>, AppError> {
    let conn = ensure_catalog(vault_root)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                path, id, type, title, authors_json, year, abstract, tags_json,
                arxiv_id, doi, pdf_url, html_url, source_url,
                body_source, body_quality, bibtex_key, citation_count, status, summary,
                added_at, updated_at,
                creators_json, date, isbn, issn, pmid, publication, volume, issue, pages,
                publisher, place, series, language, zotero_item_type, meta_source, extra,
                is_read
            FROM papers
            ORDER BY updated_at DESC, title COLLATE NOCASE ASC
            "#,
        )
        .map_err(AppError::from)?;

    let rows = stmt
        .query_map([], map_row)
        .map_err(AppError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)?;
    Ok(rows)
}

/// Set `is_read` for a paper path; returns the updated row.
pub fn set_is_read(vault_root: &Path, path: &str, is_read: bool) -> Result<PaperRecord, AppError> {
    let path = path.replace('\\', "/").trim_matches('/').to_string();
    let Some(mut row) = get_by_path(vault_root, &path)? else {
        return Err(AppError::message("paper not found in catalog"));
    };
    row.is_read = is_read;
    row.updated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    upsert_paper(vault_root, &row)
}

/// Replace tags for a paper path; returns the updated row.
/// Tags are trimmed, empty strings dropped, and de-duplicated case-insensitively
/// (first occurrence keeps its original casing).
pub fn set_tags(vault_root: &Path, path: &str, tags: &[String]) -> Result<PaperRecord, AppError> {
    let path = path.replace('\\', "/").trim_matches('/').to_string();
    let Some(mut row) = get_by_path(vault_root, &path)? else {
        return Err(AppError::message("paper not found in catalog"));
    };
    row.tags = normalize_tags(tags);
    row.updated_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    upsert_paper(vault_root, &row)
}

fn normalize_tags(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in tags {
        let t = raw.trim();
        if t.is_empty() {
            continue;
        }
        if out.iter().any(|existing| existing.eq_ignore_ascii_case(t)) {
            continue;
        }
        out.push(t.to_string());
    }
    out
}

/// Delete a paper row and any papers nested under `path/` (org folder delete).
/// Returns the number of catalog rows removed.
pub fn delete_under_path(vault_root: &Path, path: &str) -> Result<usize, AppError> {
    let conn = ensure_catalog(vault_root)?;
    let path = path.replace('\\', "/").trim_matches('/').to_string();
    if path.is_empty() {
        return Err(AppError::message("path is required"));
    }
    let like = format!("{path}/%");
    let n = conn
        .execute(
            "DELETE FROM papers WHERE path = ?1 OR path LIKE ?2",
            params![path, like],
        )
        .map_err(AppError::from)?;
    Ok(n)
}

/// Remove catalog rows whose paper folder no longer exists on disk (orphans left
/// by deleting folders outside the app). Returns the number of rows removed.
pub fn prune_missing(vault_root: &Path) -> Result<usize, AppError> {
    let conn = ensure_catalog(vault_root)?;
    let mut stmt = conn
        .prepare("SELECT path FROM papers")
        .map_err(AppError::from)?;
    let paths = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(AppError::from)?
        .collect::<Result<Vec<String>, _>>()
        .map_err(AppError::from)?;
    drop(stmt);
    let mut removed = 0usize;
    for path in paths {
        if !vault_root.join(&path).is_dir() {
            removed += conn
                .execute("DELETE FROM papers WHERE path = ?1", params![path])
                .map_err(AppError::from)?;
        }
    }
    Ok(removed)
}

fn upsert_conn(conn: &Connection, r: &PaperRecord) -> Result<(), AppError> {
    let authors_json =
        serde_json::to_string(&r.authors).map_err(|e| AppError::message(e.to_string()))?;
    let tags_json = serde_json::to_string(&r.tags).map_err(|e| AppError::message(e.to_string()))?;
    let creators_json = r
        .creators
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| AppError::message(e.to_string()))?;

    conn.execute(
        r#"
        INSERT INTO papers (
            path, id, type, title, authors_json, year, abstract, tags_json,
            arxiv_id, doi, pdf_url, html_url, source_url,
            body_source, body_quality, bibtex_key, citation_count, status, summary,
            added_at, updated_at,
            creators_json, date, isbn, issn, pmid, publication, volume, issue, pages,
            publisher, place, series, language, zotero_item_type, meta_source, extra,
            is_read
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
            ?9, ?10, ?11, ?12, ?13,
            ?14, ?15, ?16, ?17, ?18, ?19,
            ?20, ?21,
            ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30,
            ?31, ?32, ?33, ?34, ?35, ?36, ?37,
            ?38
        )
        ON CONFLICT(path) DO UPDATE SET
            id = excluded.id,
            type = excluded.type,
            title = excluded.title,
            authors_json = excluded.authors_json,
            year = excluded.year,
            abstract = excluded.abstract,
            tags_json = excluded.tags_json,
            arxiv_id = excluded.arxiv_id,
            doi = excluded.doi,
            pdf_url = excluded.pdf_url,
            html_url = excluded.html_url,
            source_url = excluded.source_url,
            body_source = excluded.body_source,
            body_quality = excluded.body_quality,
            bibtex_key = excluded.bibtex_key,
            citation_count = excluded.citation_count,
            status = excluded.status,
            summary = excluded.summary,
            updated_at = excluded.updated_at,
            creators_json = excluded.creators_json,
            date = excluded.date,
            isbn = excluded.isbn,
            issn = excluded.issn,
            pmid = excluded.pmid,
            publication = excluded.publication,
            volume = excluded.volume,
            issue = excluded.issue,
            pages = excluded.pages,
            publisher = excluded.publisher,
            place = excluded.place,
            series = excluded.series,
            language = excluded.language,
            zotero_item_type = excluded.zotero_item_type,
            meta_source = excluded.meta_source,
            extra = excluded.extra,
            is_read = excluded.is_read
        "#,
        params![
            r.path,
            r.id,
            r.paper_type,
            r.title,
            authors_json,
            r.year,
            r.abstract_text,
            tags_json,
            r.arxiv_id,
            r.doi,
            r.pdf_url,
            r.html_url,
            r.source_url,
            r.body_source,
            r.body_quality,
            r.bibtex_key,
            r.citation_count,
            r.status,
            r.summary,
            r.added_at,
            r.updated_at,
            creators_json,
            r.date,
            r.isbn,
            r.issn,
            r.pmid,
            r.publication,
            r.volume,
            r.issue,
            r.pages,
            r.publisher,
            r.place,
            r.series,
            r.language,
            r.zotero_item_type,
            r.meta_source,
            r.extra,
            if r.is_read { 1i32 } else { 0i32 },
        ],
    )
    .map_err(AppError::from)?;
    Ok(())
}

fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<PaperRecord> {
    let authors_json: String = row.get(4)?;
    let tags_json: String = row.get(7)?;
    let creators_json: Option<String> = row.get(21)?;
    let is_read_i: i32 = row.get(37).unwrap_or(0);
    Ok(PaperRecord {
        path: row.get(0)?,
        id: row.get(1)?,
        paper_type: row.get(2)?,
        title: row.get(3)?,
        authors: serde_json::from_str(&authors_json).unwrap_or_default(),
        year: row.get(5)?,
        abstract_text: row.get(6)?,
        tags: serde_json::from_str(&tags_json).unwrap_or_default(),
        arxiv_id: row.get(8)?,
        doi: row.get(9)?,
        pdf_url: row.get(10)?,
        html_url: row.get(11)?,
        source_url: row.get(12)?,
        body_source: row.get(13)?,
        body_quality: row.get(14)?,
        bibtex_key: row.get(15)?,
        citation_count: row.get(16)?,
        status: row.get(17)?,
        summary: row.get(18)?,
        added_at: row.get(19)?,
        updated_at: row.get(20)?,
        creators: creators_json
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok()),
        date: row.get(22)?,
        isbn: row.get(23)?,
        issn: row.get(24)?,
        pmid: row.get(25)?,
        publication: row.get(26)?,
        volume: row.get(27)?,
        issue: row.get(28)?,
        pages: row.get(29)?,
        publisher: row.get(30)?,
        place: row.get(31)?,
        series: row.get(32)?,
        language: row.get(33)?,
        zotero_item_type: row.get(34)?,
        meta_source: row.get(35)?,
        extra: row.get(36)?,
        is_read: is_read_i != 0,
    })
}

fn get_conn(conn: &Connection, path: &str) -> Result<Option<PaperRecord>, AppError> {
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                path, id, type, title, authors_json, year, abstract, tags_json,
                arxiv_id, doi, pdf_url, html_url, source_url,
                body_source, body_quality, bibtex_key, citation_count, status, summary,
                added_at, updated_at,
                creators_json, date, isbn, issn, pmid, publication, volume, issue, pages,
                publisher, place, series, language, zotero_item_type, meta_source, extra,
                is_read
            FROM papers WHERE path = ?1
            "#,
        )
        .map_err(AppError::from)?;

    let row = stmt
        .query_row(params![path], map_row)
        .optional()
        .map_err(AppError::from)?;

    Ok(row)
}

/// Projection: write metadata.json next to NOTES after catalog change.
pub fn sync_metadata_json(vault_root: &Path, record: &PaperRecord) -> Result<(), AppError> {
    let paper_dir = vault_root.join(&record.path);
    if !paper_dir.exists() {
        fs::create_dir_all(&paper_dir)?;
    }
    // Omit vault-relative path from file copy (folder identity is the path itself)
    let mut file_copy =
        serde_json::to_value(record).map_err(|e| AppError::message(e.to_string()))?;
    if let Some(obj) = file_copy.as_object_mut() {
        obj.remove("path");
    }
    let json =
        serde_json::to_string_pretty(&file_copy).map_err(|e| AppError::message(e.to_string()))?;
    fs::write(paper_dir.join("metadata.json"), format!("{json}\n"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::normalize_tags;

    #[test]
    fn normalize_tags_trims_dedupes_case_insensitive() {
        let tags = normalize_tags(&[
            "  NLP ".into(),
            "nlp".into(),
            "".into(),
            "  ".into(),
            "RL".into(),
            "rl".into(),
            "CV".into(),
        ]);
        assert_eq!(tags, vec!["NLP", "RL", "CV"]);
    }
}
