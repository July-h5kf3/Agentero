//! `agentero paper *`

use crate::error::CliError;
use crate::output::to_value;
use crate::resolve::{paper_dir, resolve_paper, resolve_vault, GlobalOpts};
use agentero_lib::services::catalog::papers::{self, PaperRecord};
use agentero_lib::services::lookup::{self, PaperDownloadAssetsArgs};
use agentero_lib::services::pdf_parse::{self, PaperParseBodyArgs};
use clap::Subcommand;
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;

#[derive(Debug, Subcommand)]
pub enum PaperCmd {
    /// List papers from catalog (L1 index).
    List {
        /// Substring filter on title / authors / id / path / tags.
        #[arg(long = "query")]
        query: Option<String>,
        /// Filter: paper must have this tag (repeatable, AND; case-insensitive exact).
        #[arg(long = "tag", value_name = "TAG")]
        tags: Vec<String>,
        /// Only unread (`is_read = false`).
        #[arg(long = "unread")]
        unread: bool,
        /// Filter by status field.
        #[arg(long = "status")]
        status: Option<String>,
    },
    /// List unique tags in the catalog with counts.
    Tags,
    /// Meta + asset flags + suggestedReads (no body dump).
    Get {
        /// Vault-relative path or paper id.
        r#ref: String,
    },
    /// Print related file paths only.
    Paths { r#ref: String },
    /// Delete catalog row(s). With `--files` also remove the folder (requires `-y`).
    Delete {
        /// Vault-relative path (paper or org folder under papers/).
        path: String,
        /// Also delete files on disk.
        #[arg(long = "files")]
        files: bool,
    },
    /// Set catalog `is_read` (does not run paper-reader).
    SetRead {
        r#ref: String,
        /// Set is_read to false.
        #[arg(long = "false")]
        set_false: bool,
    },
    /// Set catalog tags (does not run paper-reader).
    ///
    /// Default: replace the full tag list with `tags` (empty list clears).
    /// Use `--add` or `--remove` for incremental edits (mutually exclusive).
    SetTags {
        r#ref: String,
        /// Tag names (replace mode when neither --add nor --remove).
        tags: Vec<String>,
        /// Append tags (case-insensitive dedupe).
        #[arg(long = "add", conflicts_with = "remove")]
        add: bool,
        /// Remove tags (case-insensitive).
        #[arg(long = "remove", conflicts_with = "add")]
        remove: bool,
    },
    /// Download PDF / arXiv TeX for an existing paper.
    Download { r#ref: String },
    /// liteparse PDF → PAPER.md when no TeX.
    Parse {
        r#ref: String,
        #[arg(long = "force")]
        force: bool,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Assets {
    pdf: bool,
    tex: bool,
    paper_md: bool,
    notes_md: bool,
    highlights_md: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PaperGetData {
    paper: PaperRecord,
    assets: Assets,
    suggested_reads: Vec<String>,
}

#[derive(Debug, Serialize)]
struct TagCount {
    tag: String,
    count: usize,
}

pub async fn run(cmd: PaperCmd, globals: &GlobalOpts) -> Result<Value, CliError> {
    match cmd {
        PaperCmd::List {
            query,
            tags,
            unread,
            status,
        } => list(globals, query.as_deref(), &tags, unread, status.as_deref()),
        PaperCmd::Tags => list_tags(globals),
        PaperCmd::Get { r#ref } => get(globals, &r#ref),
        PaperCmd::Paths { r#ref } => paths(globals, &r#ref),
        PaperCmd::Delete { path, files } => delete(globals, &path, files),
        PaperCmd::SetRead { r#ref, set_false } => set_read(globals, &r#ref, !set_false),
        PaperCmd::SetTags {
            r#ref,
            tags,
            add,
            remove,
        } => set_tags(globals, &r#ref, &tags, add, remove),
        PaperCmd::Download { r#ref } => download(globals, &r#ref).await,
        PaperCmd::Parse { r#ref, force } => parse(globals, &r#ref, force).await,
    }
}

fn list(
    globals: &GlobalOpts,
    query: Option<&str>,
    filter_tags: &[String],
    unread: bool,
    status: Option<&str>,
) -> Result<Value, CliError> {
    let vault = resolve_vault(globals)?;
    let mut rows = papers::list_all(&vault)?;
    if unread {
        rows.retain(|r| !r.is_read);
    }
    if let Some(st) = status.map(str::trim).filter(|s| !s.is_empty()) {
        rows.retain(|r| r.status.eq_ignore_ascii_case(st));
    }
    let required_tags: Vec<String> = filter_tags
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    if !required_tags.is_empty() {
        rows.retain(|r| papers::paper_has_all_tags(r, &required_tags));
    }
    if let Some(q) = query.map(str::trim).filter(|s| !s.is_empty()) {
        let q = q.to_ascii_lowercase();
        rows.retain(|r| {
            r.title.to_ascii_lowercase().contains(&q)
                || r.id.to_ascii_lowercase().contains(&q)
                || r.path.to_ascii_lowercase().contains(&q)
                || r.authors
                    .iter()
                    .any(|a| a.to_ascii_lowercase().contains(&q))
                || r.tags.iter().any(|t| t.to_ascii_lowercase().contains(&q))
        });
    }

    // cli.md: JSON is PaperRecord[]. For text mode, attach human lines via wrapper
    // only when not pure array — emit_ok handles arrays poorly for columns, so we use
    // a small object with `items` + `lines`, and output layer prefers `items` for json.
    let lines: Vec<String> = rows
        .iter()
        .map(|r| {
            let year = r.year.map(|y| y.to_string()).unwrap_or_else(|| "-".into());
            let read = if r.is_read { "read" } else { "unread" };
            let tags = if r.tags.is_empty() {
                "-".into()
            } else {
                r.tags.join(",")
            };
            format!(
                "{}\t{}\t{}\t{}\t{}\t{}",
                r.path,
                r.id,
                truncate(&r.title, 60),
                year,
                tags,
                read
            )
        })
        .collect();

    Ok(json!({
        "items": rows,
        "lines": lines,
        "__paper_list": true,
    }))
}

fn list_tags(globals: &GlobalOpts) -> Result<Value, CliError> {
    let vault = resolve_vault(globals)?;
    let pairs = papers::list_all_tags(&vault)?;
    let items: Vec<TagCount> = pairs
        .into_iter()
        .map(|(tag, count)| TagCount { tag, count })
        .collect();
    let lines: Vec<String> = items
        .iter()
        .map(|t| format!("{}\t{}", t.tag, t.count))
        .collect();
    Ok(json!({
        "items": items,
        "lines": lines,
    }))
}

fn get(globals: &GlobalOpts, ref_: &str) -> Result<Value, CliError> {
    let vault = resolve_vault(globals)?;
    let paper = resolve_paper(&vault, ref_, globals)?;
    let dir = paper_dir(&vault, &paper.path);
    let assets = probe_assets(&dir);
    let suggested_reads = suggested_reads(&paper.path, &assets);

    let data = PaperGetData {
        paper: paper.clone(),
        assets,
        suggested_reads: suggested_reads.clone(),
    };
    let mut v = to_value(&data)?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert(
            "lines".into(),
            json!([
                format!("{} — {}", paper.path, paper.title),
                format!(
                    "assets: pdf={} tex={} paperMd={} notesMd={}",
                    data.assets.pdf, data.assets.tex, data.assets.paper_md, data.assets.notes_md
                ),
                format!("suggestedReads: {}", suggested_reads.join(", ")),
            ]),
        );
    }
    Ok(v)
}

fn paths(globals: &GlobalOpts, ref_: &str) -> Result<Value, CliError> {
    let vault = resolve_vault(globals)?;
    let paper = resolve_paper(&vault, ref_, globals)?;
    let dir = paper_dir(&vault, &paper.path);
    let assets = probe_assets(&dir);

    let mut paths = Vec::new();
    paths.push(paper.path.clone());
    for name in ["NOTES.md", "highlights.md", "PAPER.md"] {
        let rel = format!("{}/{}", paper.path, name);
        if vault.join(&rel).is_file() {
            paths.push(rel);
        }
    }
    if let Some(pdf) = pdf_parse::find_local_pdf(&dir) {
        if let Ok(rel) = pdf.strip_prefix(&vault) {
            paths.push(rel.to_string_lossy().replace('\\', "/"));
        }
    }
    if assets.tex {
        let src = format!("{}/source", paper.path);
        if vault.join(&src).is_dir() {
            paths.push(src);
        }
    }

    Ok(json!(paths))
}

fn delete(globals: &GlobalOpts, path: &str, files: bool) -> Result<Value, CliError> {
    let vault = resolve_vault(globals)?;
    let path = path.trim().trim_matches('/').replace('\\', "/");
    if path.is_empty() {
        return Err(CliError::usage("path is required"));
    }
    if files {
        let msg = format!("Delete paper files on disk for '{path}'? This cannot be undone.");
        let ok = crate::prompt::confirm(globals, &msg, false)?;
        if !ok {
            return Err(CliError::needs_confirmation("deletion cancelled"));
        }
    }

    let removed = papers::delete_under_path(&vault, &path)?;
    let mut deleted_files = false;
    if files {
        let dir = paper_dir(&vault, &path);
        if dir.is_dir() {
            fs::remove_dir_all(&dir)?;
            deleted_files = true;
        }
    }

    Ok(json!({
        "removed": removed,
        "path": path,
        "deletedFiles": deleted_files,
        "lines": [format!("removed {removed} catalog row(s) for {path}")]
    }))
}

fn set_read(globals: &GlobalOpts, ref_: &str, is_read: bool) -> Result<Value, CliError> {
    let vault = resolve_vault(globals)?;
    let paper = resolve_paper(&vault, ref_, globals)?;
    let row = papers::set_is_read(&vault, &paper.path, is_read)?;
    let mut v = to_value(&row)?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert(
            "lines".into(),
            json!([format!("is_read={} path={}", row.is_read, row.path)]),
        );
    }
    Ok(v)
}

fn set_tags(
    globals: &GlobalOpts,
    ref_: &str,
    tags: &[String],
    add: bool,
    remove: bool,
) -> Result<Value, CliError> {
    let vault = resolve_vault(globals)?;
    let paper = resolve_paper(&vault, ref_, globals)?;
    if add && remove {
        return Err(CliError::message(
            "--add and --remove are mutually exclusive",
        ));
    }
    let row = if add {
        if tags.is_empty() {
            return Err(CliError::message("--add requires at least one tag"));
        }
        papers::add_tags(&vault, &paper.path, tags)?
    } else if remove {
        if tags.is_empty() {
            return Err(CliError::message("--remove requires at least one tag"));
        }
        papers::remove_tags(&vault, &paper.path, tags)?
    } else {
        papers::set_tags(&vault, &paper.path, tags)?
    };
    let tags_disp = if row.tags.is_empty() {
        "[]".into()
    } else {
        format!("[{}]", row.tags.join(", "))
    };
    let mut v = to_value(&row)?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert(
            "lines".into(),
            json!([format!("tags={} path={}", tags_disp, row.path)]),
        );
    }
    Ok(v)
}

async fn download(globals: &GlobalOpts, ref_: &str) -> Result<Value, CliError> {
    let vault = resolve_vault(globals)?;
    let paper = resolve_paper(&vault, ref_, globals)?;
    let result = lookup::download_paper_assets(PaperDownloadAssetsArgs {
        vault_path: vault.to_string_lossy().to_string(),
        path: paper.path.clone(),
    })
    .await?;
    let mut v = to_value(&result)?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert(
            "lines".into(),
            json!([format!(
                "download path={} pdf={} tex={} paperMd={}",
                paper.path, result.pdf, result.tex, result.paper_md
            )]),
        );
        obj.insert("path".into(), json!(paper.path));
    }
    Ok(v)
}

async fn parse(globals: &GlobalOpts, ref_: &str, force: bool) -> Result<Value, CliError> {
    let vault = resolve_vault(globals)?;
    let paper = resolve_paper(&vault, ref_, globals)?;
    let dir = paper_dir(&vault, &paper.path);
    if lookup::has_local_tex(&dir) {
        return Err(CliError::message(
            "paper has TeX source; PAPER.md is optional — not forcing liteparse",
        ));
    }
    if !lookup::has_local_pdf(&dir) {
        return Err(CliError::asset_missing(
            "no local PDF to parse; run paper download first",
        ));
    }
    let result = pdf_parse::parse_paper_body(PaperParseBodyArgs {
        vault_path: vault.to_string_lossy().to_string(),
        path: paper.path.clone(),
        force,
    })
    .await?;
    let mut v = to_value(&result)?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert(
            "lines".into(),
            json!([format!(
                "parse path={} paperMd={}",
                paper.path, result.paper_md
            )]),
        );
        obj.insert("path".into(), json!(paper.path));
    }
    Ok(v)
}

fn probe_assets(dir: &std::path::Path) -> Assets {
    Assets {
        pdf: lookup::has_local_pdf(dir),
        tex: lookup::has_local_tex(dir),
        paper_md: pdf_parse::has_paper_md(dir),
        notes_md: dir.join("NOTES.md").is_file(),
        highlights_md: dir.join("highlights.md").is_file(),
    }
}

fn suggested_reads(path: &str, assets: &Assets) -> Vec<String> {
    let mut out = Vec::new();
    if assets.notes_md {
        out.push(format!("{path}/NOTES.md"));
    }
    if assets.highlights_md {
        out.push(format!("{path}/highlights.md"));
    }
    if assets.paper_md {
        out.push(format!("{path}/PAPER.md"));
    }
    out
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let t: String = s.chars().take(max.saturating_sub(1)).collect();
    format!("{t}…")
}
