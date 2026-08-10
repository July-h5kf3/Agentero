//! Unified paper commit: the single authoritative dedupe → path → shell →
//! catalog → assets pipeline behind every local import entry (magic wand,
//! Zotero Connector, local PDF, Bib/RIS). Entries stay thin source adapters
//! that produce a mapped [`PaperMeta`] and pick policies here.
//!
//! @see docs/backend/paper-import-pipeline.md

use crate::core::error::AppError;
use crate::features::catalog::papers;
use crate::features::import::{
    allocate_paper_path, ensure_paper_assets_with_progress, has_local_pdf, has_local_tex,
    normalize_parent_dir, paper_record_from_meta, write_paper_shell_opts, AssetDownloadResult,
    AssetProgressContext, PaperMeta,
};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CommitStatus {
    /// New paper folder + catalog row were written.
    Created,
    /// Catalog already had this paper; existing path returned, nothing touched.
    Deduped,
    /// `{parent}/{id}` already holds a paper (dir + NOTES or catalog row).
    Skipped,
}

/// How to detect "this paper is already in the library" before writing.
pub enum DedupePolicy {
    /// Catalog has a row with the same `id` → `Deduped` (single-item entries).
    ByCatalogId,
    /// `{parent}/{id}` exists with NOTES.md, or catalog has that path →
    /// `Skipped` (batch Bib/RIS compatibility).
    ByPathOrNotes,
    /// No dedupe; the path allocator still avoids folder collisions.
    None,
}

/// How the paper body/PDF is produced after shell + catalog are written.
pub enum AssetsPolicy<'a> {
    /// Await `ensure_paper_assets` (+ liteparse). Asset flags in the result
    /// are final. Errors become `asset_messages`, never a failed commit.
    SyncDownload {
        cookies: Option<&'a str>,
        progress: AssetProgressContext<'a>,
    },
    /// Copy a local PDF into the folder root as `{id}.pdf` (+ liteparse).
    CopyPdf {
        src: &'a Path,
        progress: AssetProgressContext<'a>,
    },
    /// Shell + catalog only; the adapter downloads in the background
    /// (Connector must answer inside the browser extension's ~15s timeout).
    Deferred,
}

pub struct PaperCommitOptions<'a> {
    pub vault: &'a Path,
    /// Raw parent dir (normalized here), e.g. `papers` or `papers/nlp`.
    pub parent_dir: &'a str,
    pub dedupe: DedupePolicy,
    pub assets: AssetsPolicy<'a>,
    /// zh-CN abstract MT in the NOTES shell (Connector passes `false`).
    pub translate_abstract: bool,
    /// Stamp `added_at` / `updated_at` with now (Connector semantics).
    pub fresh_timestamps: bool,
}

/// Uniform result shape for every entry (camelCase matches the frontend).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperCommitResult {
    pub status: CommitStatus,
    /// Vault-relative paper folder.
    pub path: String,
    pub id: String,
    pub title: String,
    /// Absolute paper folder.
    pub paper_dir: String,
    pub pdf: bool,
    pub tex: bool,
    pub paper_md: bool,
    pub asset_messages: Vec<String>,
    /// True when assets are still downloading in the background (`Deferred`).
    pub assets_pending: bool,
}

/// Commit one paper draft to the vault. Fixed step order:
/// normalize parent → id check → dedupe early-return → allocate path
/// (adopting the possibly suffixed folder id into `meta.id`) → shell →
/// catalog upsert → assets/liteparse → uniform result.
pub async fn paper_commit(
    mut meta: PaperMeta,
    opts: PaperCommitOptions<'_>,
) -> Result<PaperCommitResult, AppError> {
    let vault = opts.vault;
    if !vault.is_dir() {
        return Err(AppError::message("vault path is not a directory"));
    }
    let parent_rel = normalize_parent_dir(opts.parent_dir)?;
    if meta.id.is_empty() {
        return Err(AppError::message("resolved metadata has empty id"));
    }

    match opts.dedupe {
        DedupePolicy::ByCatalogId => {
            if let Ok(Some(existing)) = papers::get_by_id(vault, &meta.id) {
                let dir = vault.join(&existing.path);
                return Ok(existing_result(CommitStatus::Deduped, existing, dir));
            }
        }
        DedupePolicy::ByPathOrNotes => {
            let candidate = format!("{parent_rel}/{}", meta.id).replace('\\', "/");
            let dir = vault.join(&candidate);
            if dir.is_dir()
                && (dir.join("NOTES.md").is_file()
                    || papers::get_by_path(vault, &candidate)?.is_some())
            {
                return Ok(PaperCommitResult {
                    status: CommitStatus::Skipped,
                    path: candidate,
                    id: meta.id,
                    title: meta.title,
                    paper_dir: dir.to_string_lossy().to_string(),
                    pdf: has_local_pdf(&dir),
                    tex: has_local_tex(&dir),
                    paper_md: dir.join("PAPER.md").is_file(),
                    asset_messages: Vec::new(),
                    assets_pending: false,
                });
            }
        }
        DedupePolicy::None => {}
    }

    let (folder_id, path_rel, paper_dir) = allocate_paper_path(vault, &parent_rel, &meta.id);
    meta.id = folder_id;
    if opts.fresh_timestamps {
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        meta.added_at = now.clone();
        meta.updated_at = now;
    }
    fs::create_dir_all(&paper_dir)?;

    if let AssetsPolicy::CopyPdf { src, .. } = &opts.assets {
        // PDF lives in the folder root as `{id}.pdf` (same as downloaded PDFs).
        fs::copy(src, paper_dir.join(format!("{}.pdf", meta.id)))
            .map_err(|e| AppError::message(format!("copy PDF failed: {e}")))?;
    }

    write_paper_shell_opts(&paper_dir, &meta, opts.translate_abstract).await?;

    // Catalog SQLite is authoritative; metadata.json is a projection.
    let record = paper_record_from_meta(&path_rel, &meta);
    papers::upsert_paper(vault, &record)?;

    let (assets, assets_pending) = match opts.assets {
        AssetsPolicy::SyncDownload { cookies, progress } => {
            let assets = ensure_paper_assets_with_progress(
                &paper_dir,
                &meta.id,
                meta.arxiv_id.as_deref(),
                meta.pdf_url.as_deref(),
                meta.doi.as_deref(),
                cookies,
                progress,
            )
            .await
            .unwrap_or_else(|e| {
                let mut r = AssetDownloadResult::default();
                r.messages.push(format!("asset download error: {e}"));
                r
            });
            (assets, false)
        }
        AssetsPolicy::CopyPdf { .. } => {
            let assets = AssetDownloadResult {
                pdf: true,
                ..Default::default()
            };
            (assets, false)
        }
        AssetsPolicy::Deferred => (AssetDownloadResult::default(), true),
    };

    // Background reference parse so the citation graph / References panel have
    // a sidecar soon after import (fingerprint-cached; safe if callers also spawn).
    crate::features::refs::spawn_parse_after_import(None, vault, &path_rel);

    Ok(PaperCommitResult {
        status: CommitStatus::Created,
        path: path_rel,
        id: meta.id,
        title: meta.title,
        paper_dir: paper_dir.to_string_lossy().to_string(),
        pdf: assets.pdf,
        tex: assets.tex,
        paper_md: assets.paper_md,
        asset_messages: assets.messages,
        assets_pending,
    })
}

fn existing_result(
    status: CommitStatus,
    existing: papers::PaperRecord,
    dir: PathBuf,
) -> PaperCommitResult {
    PaperCommitResult {
        status,
        pdf: has_local_pdf(&dir),
        tex: has_local_tex(&dir),
        paper_md: dir.join("PAPER.md").is_file(),
        paper_dir: dir.to_string_lossy().to_string(),
        path: existing.path,
        id: existing.id,
        title: existing.title,
        asset_messages: Vec::new(),
        assets_pending: false,
    }
}
