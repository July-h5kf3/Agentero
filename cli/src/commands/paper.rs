//! `agentero paper *`

use crate::error::CliError;
use crate::output::to_value;
use crate::resolve::{paper_dir, resolve_paper, resolve_vault, GlobalOpts};
use crate::style::{format_table, truncate_chars};
use agentero_lib::services::catalog::papers::{self, PaperRecord, PaperTag};
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
    /// Tag inventory and per-paper tag edits.
    Tag {
        #[command(subcommand)]
        cmd: TagCmd,
    },
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
    /// Download PDF / arXiv TeX for an existing paper.
    Download { r#ref: String },
    /// liteparse PDF → PAPER.md when no TeX.
    Parse {
        r#ref: String,
        #[arg(long = "force")]
        force: bool,
    },
}

#[derive(Debug, Subcommand)]
pub enum TagCmd {
    /// List unique tags in the catalog with counts (and colors when set).
    List,
    /// Replace the full tag list for a paper.
    ///
    /// Pass tag names as arguments, or use `--clear` to remove all tags.
    Set {
        /// Vault-relative path or paper id.
        r#ref: String,
        /// Tag names (replace entire list).
        tags: Vec<String>,
        /// Clear all tags (do not pass tag names with this flag).
        #[arg(long = "clear")]
        clear: bool,
    },
    /// Append tags to a paper (case-insensitive dedupe).
    Add {
        r#ref: String,
        /// Tag names to append (at least one).
        #[arg(required = true)]
        tags: Vec<String>,
    },
    /// Remove tags from a paper (case-insensitive).
    Rm {
        r#ref: String,
        /// Tag names to remove (at least one).
        #[arg(required = true)]
        tags: Vec<String>,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Assets {
    pdf: bool,
    tex: bool,
    paper_md: bool,
    notes_md: bool,
    /// Reader annotations dir: `{paper}/marks/*.json`.
    marks_dir: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PaperGetData {
    paper: PaperRecord,
    assets: Assets,
    suggested_reads: Vec<String>,
}

#[derive(Debug, Serialize)]
struct TagCountOut {
    tag: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
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
        PaperCmd::Tag { cmd } => run_tag(cmd, globals),
        PaperCmd::Get { r#ref } => get(globals, &r#ref),
        PaperCmd::Paths { r#ref } => paths(globals, &r#ref),
        PaperCmd::Delete { path, files } => delete(globals, &path, files),
        PaperCmd::SetRead { r#ref, set_false } => set_read(globals, &r#ref, !set_false),
        PaperCmd::Download { r#ref } => download(globals, &r#ref).await,
        PaperCmd::Parse { r#ref, force } => parse(globals, &r#ref, force).await,
    }
}

fn run_tag(cmd: TagCmd, globals: &GlobalOpts) -> Result<Value, CliError> {
    match cmd {
        TagCmd::List => list_tags(globals),
        TagCmd::Set { r#ref, tags, clear } => {
            if clear && !tags.is_empty() {
                return Err(CliError::usage("--clear cannot be combined with tag names"));
            }
            if clear {
                set_tags(globals, &r#ref, &[], TagMode::Replace)
            } else if tags.is_empty() {
                Err(CliError::usage(
                    "pass tag names to replace, or use --clear to remove all tags",
                ))
            } else {
                set_tags(globals, &r#ref, &tags, TagMode::Replace)
            }
        }
        TagCmd::Add { r#ref, tags } => set_tags(globals, &r#ref, &tags, TagMode::Add),
        TagCmd::Rm { r#ref, tags } => set_tags(globals, &r#ref, &tags, TagMode::Remove),
    }
}

#[derive(Debug, Clone, Copy)]
enum TagMode {
    Replace,
    Add,
    Remove,
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
                || r.tags
                    .iter()
                    .any(|t| t.name.to_ascii_lowercase().contains(&q))
        });
    }

    let style = globals.style;
    let table_rows: Vec<Vec<String>> = rows
        .iter()
        .map(|r| {
            let year = r.year.map(|y| y.to_string()).unwrap_or_else(|| "-".into());
            let tags =
                style.tags_join(r.tags.iter().map(|t| (t.name.as_str(), t.color.as_deref())));
            vec![
                style.path(&truncate_chars(&r.path, 40)),
                style.id(&truncate_chars(&r.id, 16)),
                style.title(&truncate_chars(&r.title, 48)),
                style.dim(&year),
                tags,
                style.read_status(r.is_read),
            ]
        })
        .collect();
    let lines = if rows.is_empty() {
        vec![style.dim("(no papers)")]
    } else {
        format_table(
            style,
            &["PATH", "ID", "TITLE", "YEAR", "TAGS", "STATUS"],
            &table_rows,
        )
    };

    Ok(json!({
        "items": rows,
        "lines": lines,
        "__paper_list": true,
    }))
}

fn list_tags(globals: &GlobalOpts) -> Result<Value, CliError> {
    let vault = resolve_vault(globals)?;
    let pairs = papers::list_all_tags(&vault)?;
    let items: Vec<TagCountOut> = pairs
        .into_iter()
        .map(|t| TagCountOut {
            tag: t.name,
            color: t.color,
            count: t.count,
        })
        .collect();
    let style = globals.style;
    let table_rows: Vec<Vec<String>> = items
        .iter()
        .map(|t| {
            vec![
                style.tag(&t.tag, t.color.as_deref()),
                style.dim(&t.count.to_string()),
            ]
        })
        .collect();
    let lines = if items.is_empty() {
        vec![style.dim("(no tags)")]
    } else {
        format_table(style, &["TAG", "COUNT"], &table_rows)
    };
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
    let style = globals.style;
    let tags = style.tags_join(
        paper
            .tags
            .iter()
            .map(|t| (t.name.as_str(), t.color.as_deref())),
    );
    let year = paper
        .year
        .map(|y| y.to_string())
        .unwrap_or_else(|| "-".into());
    let asset_bits = [
        ("pdf", data.assets.pdf),
        ("tex", data.assets.tex),
        ("paperMd", data.assets.paper_md),
        ("notesMd", data.assets.notes_md),
        ("marksDir", data.assets.marks_dir),
    ]
    .into_iter()
    .map(|(k, on)| {
        if on {
            style.bright_green(k)
        } else {
            style.dim(k)
        }
    })
    .collect::<Vec<_>>()
    .join(" ");

    let mut lines = vec![
        format!("{}  {}", style.path(&paper.path), style.title(&paper.title)),
        format!(
            "{} {}  {} {}  {} {}  {} {}",
            style.key("id"),
            style.id(&paper.id),
            style.key("year"),
            style.dim(&year),
            style.key("status"),
            style.read_status(paper.is_read),
            style.key("tags"),
            tags
        ),
        format!("{} {}", style.key("assets"), asset_bits),
    ];
    if suggested_reads.is_empty() {
        lines.push(format!("{} {}", style.key("reads"), style.dim("(none)")));
    } else {
        lines.push(format!(
            "{} {}",
            style.key("reads"),
            suggested_reads
                .iter()
                .map(|p| style.path(p))
                .collect::<Vec<_>>()
                .join(&style.dim(", "))
        ));
    }

    let mut v = to_value(&data)?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert("lines".into(), json!(lines));
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
    for name in ["NOTES.md", "PAPER.md"] {
        let rel = format!("{}/{}", paper.path, name);
        if vault.join(&rel).is_file() {
            paths.push(rel);
        }
    }
    if assets.marks_dir {
        paths.push(format!("{}/marks", paper.path));
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

    // Text mode: colorize paths when painting lines wrapper would be skipped for
    // pure string arrays — emit via lines when color is on so path tint applies.
    let style = globals.style;
    if style.enabled() {
        let lines: Vec<String> = paths.iter().map(|p| style.path(p)).collect();
        return Ok(json!({ "items": paths, "lines": lines, "__path_list": true }));
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

    let style = globals.style;
    Ok(json!({
        "removed": removed,
        "path": path,
        "deletedFiles": deleted_files,
        "lines": [format!(
            "{} removed {} catalog row(s) for {}",
            style.ok("✓"),
            removed,
            style.path(&path)
        )]
    }))
}

fn set_read(globals: &GlobalOpts, ref_: &str, is_read: bool) -> Result<Value, CliError> {
    let vault = resolve_vault(globals)?;
    let paper = resolve_paper(&vault, ref_, globals)?;
    let row = papers::set_is_read(&vault, &paper.path, is_read)?;
    let style = globals.style;
    let mut v = to_value(&row)?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert(
            "lines".into(),
            json!([format!(
                "{} {}  {} {}",
                style.key("is_read"),
                style.read_status(row.is_read),
                style.key("path"),
                style.path(&row.path)
            )]),
        );
    }
    Ok(v)
}

fn set_tags(
    globals: &GlobalOpts,
    ref_: &str,
    tags: &[String],
    mode: TagMode,
) -> Result<Value, CliError> {
    let vault = resolve_vault(globals)?;
    let paper = resolve_paper(&vault, ref_, globals)?;
    let tag_objs: Vec<PaperTag> = tags.iter().map(PaperTag::new).collect();
    let row = match mode {
        TagMode::Add => {
            if tags.is_empty() {
                return Err(CliError::usage("tag add requires at least one tag"));
            }
            papers::add_tags(&vault, &paper.path, &tag_objs)?
        }
        TagMode::Remove => {
            if tags.is_empty() {
                return Err(CliError::usage("tag rm requires at least one tag"));
            }
            papers::remove_tags(&vault, &paper.path, tags)?
        }
        TagMode::Replace => papers::set_tags(&vault, &paper.path, &tag_objs)?,
    };
    let style = globals.style;
    let tags_disp = style.tags_join(
        row.tags
            .iter()
            .map(|t| (t.name.as_str(), t.color.as_deref())),
    );
    let mut v = to_value(&row)?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert(
            "lines".into(),
            json!([format!(
                "{} {}  {} {}",
                style.key("tags"),
                tags_disp,
                style.key("path"),
                style.path(&row.path)
            )]),
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
    let style = globals.style;
    let mut v = to_value(&result)?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert(
            "lines".into(),
            json!([format!(
                "{} {}  pdf={} tex={} paperMd={}",
                style.ok("download"),
                style.path(&paper.path),
                result.pdf,
                result.tex,
                result.paper_md
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
    let style = globals.style;
    let mut v = to_value(&result)?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert(
            "lines".into(),
            json!([format!(
                "{} {}  paperMd={}",
                style.ok("parse"),
                style.path(&paper.path),
                result.paper_md
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
        marks_dir: dir.join("marks").is_dir(),
    }
}

fn suggested_reads(path: &str, assets: &Assets) -> Vec<String> {
    let mut out = Vec::new();
    if assets.notes_md {
        out.push(format!("{path}/NOTES.md"));
    }
    if assets.marks_dir {
        out.push(format!("{path}/marks"));
    }
    if assets.paper_md {
        out.push(format!("{path}/PAPER.md"));
    }
    out
}
