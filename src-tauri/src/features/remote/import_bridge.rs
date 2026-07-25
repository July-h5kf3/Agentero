//! Magic-wand / asset import into a remote vault (stage locally → SFTP → catalog push).

use super::session::RemoteSession;
use crate::core::error::AppError;
use crate::core::fs::{VaultFs, WriteOpts};
use crate::features::catalog::papers;
use crate::features::import::parse::{extract_arxiv_id, extract_primary_identifier};
use crate::features::import::{
    enrich_remote_urls, ensure_paper_assets, identifier_kind_column, identifier_kind_str,
    map_zotero_item, normalize_parent_dir, paper_record_from_meta, resolve_metadata,
    slug_from_stem, title_from_stem, write_paper_shell, AssetDownloadResult, ImportLocalPdfArgs,
    ImportLocalPdfResult, LocalPdfImportEntry, LookupImportArgs, LookupImportBatchArgs,
    LookupImportBatchResult, LookupImportResult, PaperDownloadAssetsArgs, PaperImportArgs,
    PaperImportResult, SkippedImport, DEFAULT_TRANSLATOR_BASE_URL,
};
use std::fs;
use std::path::{Path, PathBuf};
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

    let parse = crate::features::import::pdf_parse::maybe_generate_paper_md_after_download(
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

/// Batch import by identifier into a remote vault session.
pub async fn import_by_identifier_batch_remote(
    session: Arc<RemoteSession>,
    args: LookupImportBatchArgs,
) -> Result<LookupImportBatchResult, AppError> {
    let mut imported: Vec<LookupImportResult> = Vec::new();
    let mut skipped: Vec<SkippedImport> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut seen: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for raw in &args.texts {
        let raw = raw.trim();
        if raw.is_empty() {
            continue;
        }
        let Some((kind, value)) = extract_primary_identifier(raw) else {
            errors.push(format!("{raw}: unrecognized identifier"));
            continue;
        };

        let kind_str = identifier_kind_str(kind);
        let dedup_key = format!("{kind_str}:{value}");
        if seen.contains_key(&dedup_key) {
            skipped.push(SkippedImport {
                raw: raw.to_string(),
                kind: kind_str,
                value: value.clone(),
                reason: "duplicate_in_batch".to_string(),
            });
            continue;
        }
        seen.insert(dedup_key.clone(), raw.to_string());

        if let Some(column) = identifier_kind_column(kind) {
            match papers::find_by_identifier(&session.work_root, column, &value) {
                Ok(Some(_record)) => {
                    skipped.push(SkippedImport {
                        raw: raw.to_string(),
                        kind: kind_str,
                        value: value.clone(),
                        reason: "already_in_library".to_string(),
                    });
                    continue;
                }
                Ok(None) => {}
                Err(e) => {
                    log::warn!("remote catalog lookup failed for {value}: {e}");
                }
            }
        }

        let single = LookupImportArgs {
            vault_path: args.vault_path.clone(),
            parent_dir: args.parent_dir.clone(),
            text: raw.to_string(),
            translator_base_url: args.translator_base_url.clone(),
            task_id: args.task_id.clone(),
        };
        match import_by_identifier_remote(session.clone(), single).await {
            Ok(r) => imported.push(r),
            Err(e) => errors.push(format!("{raw}: {e}")),
        }
    }

    Ok(LookupImportBatchResult {
        imported,
        skipped,
        errors,
    })
}

/// Download missing PDF/TeX for an existing remote paper folder.
pub async fn download_paper_assets_remote(
    session: Arc<RemoteSession>,
    args: PaperDownloadAssetsArgs,
) -> Result<AssetDownloadResult, AppError> {
    let path_rel = crate::core::fs::sanitize_vault_rel(&args.path)
        .map_err(|_| AppError::message("invalid paper path"))?;
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

    let parse = crate::features::import::pdf_parse::maybe_generate_paper_md_after_download(
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

/// Import local PDF files into a remote vault (copy from user machine → stage → SFTP).
/// Filename-derived title/id by default; optional per-file metadata overrides via `entries`.
pub async fn import_local_pdfs_remote(
    session: Arc<RemoteSession>,
    args: ImportLocalPdfArgs,
) -> Result<ImportLocalPdfResult, AppError> {
    let parent_rel = normalize_parent_dir(&args.parent_dir)?;
    let entries: Vec<LocalPdfImportEntry> = if !args.entries.is_empty() {
        args.entries
    } else {
        args.file_paths
            .into_iter()
            .map(|file_path| LocalPdfImportEntry {
                file_path,
                title: None,
                authors: None,
                year: None,
                id: None,
            })
            .collect()
    };

    let mut papers_out = Vec::new();
    let mut errors = Vec::new();
    for entry in &entries {
        match import_one_local_pdf_remote(session.clone(), &parent_rel, entry).await {
            Ok(r) => papers_out.push(r),
            Err(e) => {
                let name = Path::new(entry.file_path.trim())
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or(entry.file_path.as_str());
                errors.push(format!("{name}: {e}"));
            }
        }
    }
    if papers_out.is_empty() && !errors.is_empty() {
        return Err(AppError::message(errors.join("; ")));
    }
    {
        let mut cat = session.catalog.lock().await;
        cat.push(session.fs.clone()).await?;
    }
    Ok(ImportLocalPdfResult {
        papers: papers_out,
        errors,
    })
}

async fn import_one_local_pdf_remote(
    session: Arc<RemoteSession>,
    parent_rel: &str,
    entry: &LocalPdfImportEntry,
) -> Result<LookupImportResult, AppError> {
    let src = PathBuf::from(entry.file_path.trim());
    if !src.is_file() {
        return Err(AppError::message("file not found"));
    }
    let is_pdf = src
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
    if !is_pdf {
        return Err(AppError::message("not a PDF file"));
    }

    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("paper");
    let title = entry
        .title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| title_from_stem(stem));
    let base_id = entry
        .id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(slug_from_stem)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| slug_from_stem(stem));
    let (id, path_rel) =
        unique_remote_paper_path(session.fs.as_ref(), parent_rel, &base_id).await?;

    let staging = session.work_root.join(&path_rel);
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    fs::create_dir_all(&staging)?;
    fs::copy(&src, staging.join(format!("{id}.pdf")))
        .map_err(|e| AppError::message(format!("copy PDF failed: {e}")))?;

    let mut meta = crate::features::import::local_pdf_meta_for_import(id.clone(), title);
    if let Some(authors) = &entry.authors {
        meta.authors = authors
            .iter()
            .map(|a| a.trim())
            .filter(|a| !a.is_empty())
            .map(|a| a.to_string())
            .collect();
    }
    if let Some(year) = entry.year {
        meta.year = Some(year);
    }
    write_paper_shell(&staging, &meta).await?;
    let record = paper_record_from_meta(&path_rel, &meta);
    papers::upsert_paper(&session.work_root, &record)?;

    let parse = crate::features::import::pdf_parse::maybe_generate_paper_md_after_download(
        &session.work_root,
        &path_rel,
        &staging,
    )
    .await;

    upload_tree(session.fs.as_ref(), &staging, &path_rel).await?;

    Ok(LookupImportResult {
        paper_dir: format!("remote:{}/{}", session.id, path_rel),
        path: path_rel,
        id: meta.id,
        title: meta.title,
        used_translator: false,
        translator_base_url: String::new(),
        pdf: true,
        tex: false,
        paper_md: parse.paper_md,
        asset_messages: parse.messages,
    })
}

/// BibTeX / RIS / … import via Translator into remote vault.
pub async fn import_catalog_remote(
    session: Arc<RemoteSession>,
    args: PaperImportArgs,
) -> Result<PaperImportResult, AppError> {
    let content = args.content.trim();
    if content.is_empty() {
        return Err(AppError::message("import content is empty"));
    }
    let parent_rel = normalize_parent_dir(args.parent_dir.as_deref().unwrap_or("papers"))?;
    let items = crate::features::import::zotero_io::translator_import_items(
        content,
        args.translator_base_url.as_deref(),
    )
    .await?;

    let mut imported = 0usize;
    let mut skipped = 0usize;
    let mut paths = Vec::new();
    let mut titles = Vec::new();
    let mut errors = Vec::new();

    for item in items {
        match import_one_zotero_item_remote(session.clone(), &parent_rel, &item).await {
            Ok(Some((path, title))) => {
                imported += 1;
                paths.push(path);
                titles.push(title);
            }
            Ok(None) => skipped += 1,
            Err(e) => errors.push(e.to_string()),
        }
    }

    {
        let mut cat = session.catalog.lock().await;
        cat.push(session.fs.clone()).await?;
    }

    Ok(PaperImportResult {
        imported,
        skipped,
        paths,
        titles,
        errors,
    })
}

async fn import_one_zotero_item_remote(
    session: Arc<RemoteSession>,
    parent_rel: &str,
    item: &serde_json::Value,
) -> Result<Option<(String, String)>, AppError> {
    let mut meta = map_zotero_item(item)?;
    enrich_remote_urls(&mut meta);
    let base_id = meta.id.clone();
    if base_id.is_empty() {
        return Err(AppError::message("imported item has empty id"));
    }

    // Skip if catalog already has this path or NOTES exists remotely
    let candidate = format!("{parent_rel}/{base_id}");
    if papers::get_by_path(&session.work_root, &candidate)?.is_some()
        || session
            .fs
            .exists(&format!("{candidate}/NOTES.md"))
            .await
            .unwrap_or(false)
    {
        return Ok(None);
    }

    let (id, path_rel) =
        unique_remote_paper_path(session.fs.as_ref(), parent_rel, &base_id).await?;
    meta.id = id.clone();

    let staging = session.work_root.join(&path_rel);
    if staging.exists() {
        let _ = fs::remove_dir_all(&staging);
    }
    fs::create_dir_all(&staging)?;
    write_paper_shell(&staging, &meta).await?;
    let record = paper_record_from_meta(&path_rel, &meta);
    papers::upsert_paper(&session.work_root, &record)?;

    let _ = ensure_paper_assets(
        &staging,
        &id,
        meta.arxiv_id.as_deref(),
        meta.pdf_url.as_deref(),
        meta.doi.as_deref(),
    )
    .await;
    let _ = crate::features::import::pdf_parse::maybe_generate_paper_md_after_download(
        &session.work_root,
        &path_rel,
        &staging,
    )
    .await;

    upload_tree(session.fs.as_ref(), &staging, &path_rel).await?;
    Ok(Some((path_rel, meta.title)))
}

pub async fn unique_remote_paper_path(
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

/// Upload a local directory tree to a vault-relative remote path (SFTP / local-sim).
pub async fn upload_tree(
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
