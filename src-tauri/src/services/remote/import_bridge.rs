//! Magic-wand / asset import into a remote vault (stage locally → SFTP → catalog push).

use super::session::RemoteSession;
use crate::error::AppError;
use crate::services::catalog::papers::{self, PaperRecord};
use crate::services::fs::{VaultFs, WriteOpts};
use crate::services::lookup::parse::extract_arxiv_id;
use crate::services::lookup::{
    enrich_remote_urls, ensure_paper_assets, normalize_parent_dir, paper_record_from_meta,
    resolve_metadata, write_paper_shell, AssetDownloadResult, LookupImportArgs, LookupImportResult,
    PaperDownloadAssetsArgs, DEFAULT_TRANSLATOR_BASE_URL,
};
use std::fs;
use std::path::Path;
use std::sync::Arc;
use walkdir::WalkDir;

/// Import by identifier into a remote vault session.
pub async fn import_by_identifier_remote(
    session: Arc<RemoteSession>,
    args: LookupImportArgs,
) -> Result<LookupImportResult, AppError> {
    let parent_rel = normalize_parent_dir(&args.parent_dir)?;
    let base = args
        .translator_base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_TRANSLATOR_BASE_URL)
        .trim_end_matches('/')
        .to_string();

    let text = args.text.trim();
    if text.is_empty() {
        return Err(AppError::message("identifier text is empty"));
    }

    let (mut meta, used_translator) = resolve_metadata(text, &base).await?;
    enrich_remote_urls(&mut meta);

    let id = meta.id.clone();
    if id.is_empty() {
        return Err(AppError::message("resolved metadata has empty id"));
    }

    let (id, path_rel) = unique_remote_paper_path(session.fs.as_ref(), &parent_rel, &id).await?;
    meta.id = id.clone();
    let staging = session.work_root.join(&path_rel);
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    fs::create_dir_all(&staging)?;

    write_paper_shell(&staging, &meta).await?;

    let mut assets = ensure_paper_assets(
        &staging,
        &id,
        meta.arxiv_id.as_deref(),
        meta.pdf_url.as_deref(),
        meta.doi.as_deref(),
    )
    .await
    .unwrap_or_else(|e| {
        let mut r = AssetDownloadResult::default();
        r.messages.push(format!("asset download error: {e}"));
        r
    });

    let parse = crate::services::pdf_parse::maybe_generate_paper_md_after_download(
        &session.work_root,
        &path_rel,
        &staging,
    )
    .await;
    assets.paper_md = parse.paper_md;
    for m in parse.messages {
        assets.messages.push(m);
    }

    // Upload staged tree to remote (source of truth)
    upload_tree(session.fs.as_ref(), &staging, &path_rel).await?;

    let record = paper_record_from_meta(&path_rel, &meta);
    papers::upsert_paper(&session.work_root, &record)?;
    {
        let mut cat = session.catalog.lock().await;
        cat.push(session.fs.clone()).await?;
    }

    let paper_dir = format!("remote:{}/{}", session.id, path_rel);
    Ok(LookupImportResult {
        paper_dir,
        path: path_rel,
        id: meta.id,
        title: meta.title,
        used_translator,
        translator_base_url: base,
        pdf: assets.pdf,
        tex: assets.tex,
        paper_md: assets.paper_md,
        asset_messages: assets.messages,
    })
}

/// Download missing PDF/TeX for an existing remote paper folder.
pub async fn download_paper_assets_remote(
    session: Arc<RemoteSession>,
    args: PaperDownloadAssetsArgs,
) -> Result<AssetDownloadResult, AppError> {
    let path_rel = args
        .path
        .trim()
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    if path_rel.is_empty() || path_rel.split('/').any(|p| p == ".." || p.is_empty()) {
        return Err(AppError::message("invalid paper path"));
    }
    if !session.fs.exists(&path_rel).await? {
        return Err(AppError::message("paper folder not found"));
    }

    // Materialize existing remote paper into work_root (for asset helpers)
    let staging = session.work_root.join(&path_rel);
    fs::create_dir_all(&staging)?;
    // Pull NOTES etc. best-effort so we don't clobber — only need dir for downloads
    let _ = pull_if_exists(session.fs.as_ref(), &path_rel, &staging, "NOTES.md").await;
    let _ = pull_if_exists(session.fs.as_ref(), &path_rel, &staging, "highlights.md").await;

    let (id, arxiv_id, pdf_url, doi) =
        if let Ok(Some(row)) = papers::get_by_path(&session.work_root, &path_rel) {
            (row.id, row.arxiv_id, row.pdf_url, row.doi)
        } else {
            let name = path_rel.rsplit('/').next().unwrap_or("paper").to_string();
            let arxiv = extract_arxiv_id(&name);
            let pdf = arxiv.as_ref().map(|a| format!("https://arxiv.org/pdf/{a}"));
            (name, arxiv, pdf, None)
        };

    let mut result = ensure_paper_assets(
        &staging,
        &id,
        arxiv_id.as_deref(),
        pdf_url.as_deref(),
        doi.as_deref(),
    )
    .await?;

    let parse = crate::services::pdf_parse::maybe_generate_paper_md_after_download(
        &session.work_root,
        &path_rel,
        &staging,
    )
    .await;
    result.paper_md = parse.paper_md;
    for m in parse.messages {
        result.messages.push(m);
    }

    // Upload new assets (and PAPER.md) — don't re-upload whole tree if huge; upload all staged
    upload_tree(session.fs.as_ref(), &staging, &path_rel).await?;

    // Touch catalog updated_at if row exists
    if let Ok(Some(mut row)) = papers::get_by_path(&session.work_root, &path_rel) {
        row.updated_at = chrono::Utc::now().to_rfc3339();
        let _ = papers::upsert_paper(&session.work_root, &row);
        let mut cat = session.catalog.lock().await;
        let _ = cat.push(session.fs.clone()).await;
    }

    Ok(result)
}

async fn unique_remote_paper_path(
    fs: &dyn VaultFs,
    parent_rel: &str,
    base_id: &str,
) -> Result<(String, String), AppError> {
    let mut id = base_id.to_string();
    let mut n = 2;
    loop {
        let path_rel = format!("{parent_rel}/{id}");
        if !fs.exists(&path_rel).await? || n > 999 {
            return Ok((id, path_rel));
        }
        id = format!("{base_id}-{n}");
        n += 1;
    }
}

async fn upload_tree(
    fs: &dyn VaultFs,
    local_root: &Path,
    remote_rel: &str,
) -> Result<(), AppError> {
    if !local_root.is_dir() {
        return Ok(());
    }
    // Ensure remote paper dir exists
    fs.mkdir(remote_rel).await?;

    for entry in WalkDir::new(local_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let rel = match path.strip_prefix(local_root) {
            Ok(r) => r,
            Err(_) => continue,
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        let rel_s = rel.to_string_lossy().replace('\\', "/");
        let remote = format!("{remote_rel}/{rel_s}");
        if path.is_dir() {
            let _ = fs.mkdir(&remote).await;
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let bytes = fs::read(path)
            .map_err(|e| AppError::message(format!("read staged {}: {e}", path.display())))?;
        fs.write(
            &remote,
            &bytes,
            WriteOpts {
                create_parents: true,
            },
        )
        .await?;
    }
    Ok(())
}

async fn pull_if_exists(
    fs: &dyn VaultFs,
    remote_paper: &str,
    local_paper: &Path,
    name: &str,
) -> Result<(), AppError> {
    let remote = format!("{remote_paper}/{name}");
    if !fs.exists(&remote).await? {
        return Ok(());
    }
    let bytes = fs.read(&remote).await?;
    fs::write(local_paper.join(name), bytes)?;
    Ok(())
}

/// Allow catalog helpers to silence unused import warnings if PaperRecord used only via upsert.
#[allow(dead_code)]
fn _paper_record_type(_: &PaperRecord) {}
