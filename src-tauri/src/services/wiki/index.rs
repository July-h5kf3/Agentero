//! In-memory wikilink graph index (rebuildable from Vault Markdown).

use crate::models::wiki::{Backlink, BacklinksResponse, RebuildResult, WikiLinkEdge};
use crate::services::wiki::extract::extract_wikilinks;
use crate::services::wiki::resolve::{normalize_rel, resolve_target};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const IGNORE_NAMES: &[&str] = &[
    ".git",
    ".DS_Store",
    "node_modules",
    "target",
    "dist",
    ".motif",
];

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let e = e.to_ascii_lowercase();
            e == "md" || e == "mdx" || e == "markdown"
        })
        .unwrap_or(false)
}

fn should_skip_name(name: &str) -> bool {
    if IGNORE_NAMES.contains(&name) {
        return true;
    }
    // Hidden files/dirs except we still skip all dotfiles for index scan
    name.starts_with('.')
}

/// Collect vault-relative Markdown paths (forward slashes).
pub fn collect_markdown_files(vault_root: &Path) -> std::io::Result<Vec<String>> {
    let mut out = Vec::new();
    walk_md(vault_root, vault_root, 0, &mut out)?;
    out.sort();
    Ok(out)
}

fn walk_md(
    vault_root: &Path,
    dir: &Path,
    depth: usize,
    out: &mut Vec<String>,
) -> std::io::Result<()> {
    if depth > 24 {
        return Ok(());
    }
    let entries = fs::read_dir(dir)?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if should_skip_name(&name) {
            continue;
        }
        let path = entry.path();
        let ft = entry.file_type()?;
        if ft.is_dir() {
            walk_md(vault_root, &path, depth + 1, out)?;
        } else if ft.is_file() && is_markdown(&path) {
            if let Ok(rel) = path.strip_prefix(vault_root) {
                out.push(normalize_rel(&rel.to_string_lossy()));
            }
        }
    }
    Ok(())
}

fn to_vault_rel(vault_root: &Path, path: &str) -> String {
    let p = PathBuf::from(path);
    if let Ok(rel) = p.strip_prefix(vault_root) {
        return normalize_rel(&rel.to_string_lossy());
    }
    normalize_rel(path)
}

#[derive(Debug, Default)]
pub struct WikiIndex {
    /// Absolute vault root last indexed.
    pub vault_path: Option<String>,
    /// All outgoing edges.
    pub edges: Vec<WikiLinkEdge>,
    /// target_path → backlinks
    reverse: HashMap<String, Vec<Backlink>>,
    /// Indexed markdown relative paths.
    files: Vec<String>,
}

impl WikiIndex {
    pub fn rebuild(&mut self, vault_path: &str) -> Result<RebuildResult, String> {
        let root = PathBuf::from(vault_path);
        if !root.is_dir() {
            return Err(format!("vault path is not a directory: {vault_path}"));
        }

        let files = collect_markdown_files(&root).map_err(|e| e.to_string())?;
        let mut edges = Vec::new();
        let mut reverse: HashMap<String, Vec<Backlink>> = HashMap::new();
        let mut nodes: HashSet<String> = HashSet::new();

        for rel in &files {
            nodes.insert(rel.clone());
            let abs = root.join(rel);
            let content = match fs::read_to_string(&abs) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let links = extract_wikilinks(&content);
            for link in links {
                let target_path = resolve_target(&link.target_raw, &files);
                if let Some(ref tp) = target_path {
                    nodes.insert(tp.clone());
                } else {
                    // dangling concept still a node id by raw target
                    nodes.insert(format!("stub:{}", link.target_raw));
                }

                let edge = WikiLinkEdge {
                    source: rel.clone(),
                    target_raw: link.target_raw.clone(),
                    target_path: target_path.clone(),
                    alias: link.alias.clone(),
                    heading: link.heading.clone(),
                    line: link.line,
                    context: link.context.clone(),
                };

                if let Some(tp) = &target_path {
                    reverse.entry(tp.clone()).or_default().push(Backlink {
                        source: rel.clone(),
                        target_raw: link.target_raw.clone(),
                        alias: link.alias.clone(),
                        context: link.context.clone(),
                        line: link.line,
                    });
                }

                edges.push(edge);
            }
        }

        // Stable order for UI
        for list in reverse.values_mut() {
            list.sort_by(|a, b| a.source.cmp(&b.source));
        }

        let result = RebuildResult {
            indexed_files: files.len() as u32,
            edges: edges.len() as u32,
            nodes: nodes.len() as u32,
        };

        self.vault_path = Some(vault_path.to_string());
        self.edges = edges;
        self.reverse = reverse;
        self.files = files;

        Ok(result)
    }

    pub fn ensure_vault(&mut self, vault_path: &str) -> Result<(), String> {
        if self.vault_path.as_deref() != Some(vault_path) {
            self.rebuild(vault_path)?;
        }
        Ok(())
    }

    pub fn get_backlinks(&self, vault_root: &str, path: &str) -> BacklinksResponse {
        let root = Path::new(vault_root);
        let rel = to_vault_rel(root, path);
        // Also try with/without .md for lookup
        let mut keys = vec![rel.clone()];
        if !rel.ends_with(".md") && !rel.ends_with(".mdx") && !rel.ends_with(".markdown") {
            keys.push(format!("{rel}.md"));
        }
        // Match any reverse key equal ignore case
        let mut backlinks = Vec::new();
        for (k, list) in &self.reverse {
            if keys.iter().any(|q| q == k || q.eq_ignore_ascii_case(k)) {
                backlinks.extend(list.iter().cloned());
            }
        }
        // Dedupe by source+line+target_raw
        backlinks.sort_by(|a, b| {
            a.source
                .cmp(&b.source)
                .then(a.line.cmp(&b.line))
                .then(a.target_raw.cmp(&b.target_raw))
        });
        backlinks.dedup_by(|a, b| {
            a.source == b.source && a.line == b.line && a.target_raw == b.target_raw
        });

        BacklinksResponse {
            path: rel,
            backlinks,
        }
    }
}

/// Thread-safe index managed by Tauri.
pub struct WikiIndexState {
    pub inner: Mutex<WikiIndex>,
}

impl WikiIndexState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(WikiIndex::default()),
        }
    }
}

impl Default for WikiIndexState {
    fn default() -> Self {
        Self::new()
    }
}
