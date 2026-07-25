//! In-memory wikilink graph index (rebuildable from Vault Markdown).

use crate::features::wiki::extract::extract_wikilinks;
use crate::features::wiki::models::{
    Backlink, BacklinksResponse, GraphEdge, GraphNode, GraphNodeType, GraphResponse, RebuildResult,
    WikiLinkEdge,
};
use crate::features::wiki::resolve::{normalize_rel, resolve_target};
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const IGNORE_NAMES: &[&str] = &[
    ".git",
    ".DS_Store",
    "node_modules",
    "target",
    "dist",
    ".agentero",
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

    /// Full graph or undirected BFS neighborhood around `center`.
    ///
    /// Paper folders (minimal unit under `papers/` at any depth) collapse: any path
    /// under a paper folder becomes one node at that folder path (e.g.
    /// `papers/nlp/1706.03762`), labeled with `metadata.json` title when present.
    pub fn get_graph(
        &self,
        vault_root: &str,
        center: Option<&str>,
        depth: Option<u32>,
    ) -> GraphResponse {
        let depth = depth.unwrap_or(2);
        let root = Path::new(vault_root);
        let paper_folders = discover_paper_folders(root, &self.files);

        // Build full edge list as (source_id, target_id, target_raw) after paper collapse
        let mut full_edges: Vec<(String, String, String)> = Vec::new();
        let mut node_ids: HashSet<String> = HashSet::new();

        for f in &self.files {
            node_ids.insert(collapse_graph_id(f, &paper_folders));
        }

        for e in &self.edges {
            let source = collapse_graph_id(&e.source, &paper_folders);
            let target = match &e.target_path {
                Some(tp) => collapse_graph_id(tp, &paper_folders),
                None => format!("stub:{}", e.target_raw),
            };
            if source == target {
                continue; // self-loop after collapse (e.g. NOTES ↔ paper internals)
            }
            node_ids.insert(source.clone());
            node_ids.insert(target.clone());
            full_edges.push((source, target, e.target_raw.clone()));
        }

        // Dedupe edges by (source, target)
        full_edges.sort();
        full_edges.dedup_by(|a, b| a.0 == b.0 && a.1 == b.1);

        let center_rel = center.and_then(|c| {
            if c.trim().is_empty() {
                return None;
            }
            let rel = collapse_graph_id(&to_vault_rel(root, c), &paper_folders);
            if node_ids.contains(&rel) {
                return Some(rel);
            }
            let with_md = if rel.ends_with(".md") {
                rel.clone()
            } else {
                format!("{rel}.md")
            };
            if node_ids.contains(&with_md) {
                return Some(with_md);
            }
            for id in &node_ids {
                if id.eq_ignore_ascii_case(&rel) || id.eq_ignore_ascii_case(&with_md) {
                    return Some(id.clone());
                }
            }
            Some(rel)
        });

        let (keep_nodes, keep_edges, out_center) = if let Some(ref c) = center_rel {
            if !node_ids.contains(c) && !full_edges.iter().any(|(s, t, _)| s == c || t == c) {
                let mut ids = HashSet::new();
                ids.insert(c.clone());
                (ids, Vec::new(), Some(c.clone()))
            } else {
                let mut adj: HashMap<String, HashSet<String>> = HashMap::new();
                for (s, t, _) in &full_edges {
                    adj.entry(s.clone()).or_default().insert(t.clone());
                    adj.entry(t.clone()).or_default().insert(s.clone());
                }
                let mut dist: HashMap<String, u32> = HashMap::new();
                let mut q = VecDeque::new();
                dist.insert(c.clone(), 0);
                q.push_back(c.clone());
                while let Some(u) = q.pop_front() {
                    let d = dist[&u];
                    if d >= depth {
                        continue;
                    }
                    if let Some(neis) = adj.get(&u) {
                        for v in neis {
                            if !dist.contains_key(v) {
                                dist.insert(v.clone(), d + 1);
                                q.push_back(v.clone());
                            }
                        }
                    }
                }
                let ids: HashSet<String> = dist.keys().cloned().collect();
                let edges: Vec<(String, String, String)> = full_edges
                    .into_iter()
                    .filter(|(s, t, _)| ids.contains(s) && ids.contains(t))
                    .collect();
                (ids, edges, Some(c.clone()))
            }
        } else {
            (node_ids, full_edges, None)
        };

        let mut nodes: Vec<GraphNode> = keep_nodes
            .iter()
            .map(|id| graph_node_from_id(root, id))
            .collect();
        nodes.sort_by(|a, b| a.id.cmp(&b.id));

        let mut edges: Vec<GraphEdge> = keep_edges
            .into_iter()
            .enumerate()
            .map(|(i, (s, t, raw))| GraphEdge {
                id: format!("e{i}:{s}->{t}"),
                source: s,
                target: t,
                target_raw: Some(raw),
            })
            .collect();
        edges.sort_by(|a, b| a.id.cmp(&b.id));

        GraphResponse {
            nodes,
            edges,
            center: out_center,
            depth,
        }
    }
}

/// Discover paper folder roots under `papers/` (any depth).
///
/// A paper folder is the parent of marker files (`NOTES.md`, `PAPER.md`,
/// `metadata.json`) or of `source/` / `assets/` / `marks/` path segments.
fn discover_paper_folders(vault_root: &Path, md_files: &[String]) -> Vec<String> {
    let mut set: HashSet<String> = HashSet::new();

    let markers = [
        "NOTES.md",
        "PAPER.md",
        "metadata.json",
        "notes.md",
        "paper.md",
    ];

    for f in md_files {
        let n = normalize_rel(f);
        if !n.starts_with("papers/") {
            continue;
        }
        let lower = n.to_ascii_lowercase();
        for m in markers {
            let suffix = format!("/{m}");
            if lower.ends_with(&suffix.to_ascii_lowercase()) || lower == m.to_ascii_lowercase() {
                if let Some(parent) = n.rsplit_once('/').map(|(p, _)| p.to_string()) {
                    if parent.starts_with("papers/") {
                        set.insert(parent);
                    }
                }
            }
        }
        // …/source/… or …/assets/… inside papers
        for seg in ["source", "assets"] {
            let needle = format!("/{seg}/");
            if let Some(idx) = lower.find(&needle) {
                let parent = &n[..idx];
                if parent.starts_with("papers/") {
                    set.insert(parent.to_string());
                }
            }
            let needle_end = format!("/{seg}");
            if lower.ends_with(&needle_end) {
                if let Some(parent) = n.rsplit_once('/').map(|(p, _)| p) {
                    if parent.starts_with("papers/") {
                        set.insert(parent.to_string());
                    }
                }
            }
        }
    }

    // Also scan disk under papers/ for directories that contain markers but no md yet
    let papers_root = vault_root.join("papers");
    if papers_root.is_dir() {
        discover_paper_folders_walk(vault_root, &papers_root, &mut set);
    }

    let mut out: Vec<String> = set.into_iter().collect();
    // Longest first for prefix matching
    out.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
    out
}

fn discover_paper_folders_walk(vault_root: &Path, dir: &Path, out: &mut HashSet<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut names: Vec<String> = Vec::new();
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for ent in entries.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        if should_skip_name(&name) {
            continue;
        }
        let path = ent.path();
        if path.is_dir() {
            names.push(name.clone());
            subdirs.push(path);
        } else {
            names.push(name);
        }
    }
    if dir_has_paper_markers(&names) {
        if let Ok(rel) = path_to_rel(vault_root, dir) {
            if rel.starts_with("papers/") {
                out.insert(rel);
            }
        }
        // Do not recurse into paper internals
        return;
    }
    for sub in subdirs {
        discover_paper_folders_walk(vault_root, &sub, out);
    }
}

fn dir_has_paper_markers(names: &[String]) -> bool {
    for n in names {
        let lower = n.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "notes.md" | "paper.md" | "metadata.json" | "source" | "assets" | "marks"
        ) {
            return true;
        }
    }
    false
}

fn path_to_rel(vault_root: &Path, path: &Path) -> Result<String, ()> {
    let rel = path.strip_prefix(vault_root).map_err(|_| ())?;
    Ok(normalize_rel(&rel.to_string_lossy()))
}

/// Collapse paths under a paper folder to that folder node id.
fn collapse_graph_id(path: &str, paper_folders: &[String]) -> String {
    let n = normalize_rel(path);
    if n.starts_with("stub:") {
        return n;
    }
    for folder in paper_folders {
        if n == *folder || n.starts_with(&format!("{folder}/")) {
            return folder.clone();
        }
    }
    n
}

fn paper_title_from_metadata(vault_root: &Path, paper_rel: &str) -> Option<String> {
    let meta_path = vault_root.join(paper_rel).join("metadata.json");
    let raw = fs::read_to_string(meta_path).ok()?;
    // Lightweight parse: "title": "..."
    let key = "\"title\"";
    let idx = raw.find(key)?;
    let after = &raw[idx + key.len()..];
    let colon = after.find(':')?;
    let rest = after[colon + 1..].trim_start();
    if !rest.starts_with('"') {
        return None;
    }
    let mut out = String::new();
    let mut chars = rest[1..].chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(n) = chars.next() {
                out.push(n);
            }
        } else if c == '"' {
            break;
        } else {
            out.push(c);
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn graph_node_from_id(vault_root: &Path, id: &str) -> GraphNode {
    if let Some(raw) = id.strip_prefix("stub:") {
        return GraphNode {
            id: id.to_string(),
            label: raw.to_string(),
            node_type: GraphNodeType::Stub,
            path: None,
        };
    }
    let node_type = classify_node_path(id);
    let label = if node_type == GraphNodeType::Paper {
        paper_title_from_metadata(vault_root, id)
            .unwrap_or_else(|| id.rsplit('/').next().unwrap_or(id).to_string())
    } else {
        id.rsplit('/')
            .next()
            .unwrap_or(id)
            .trim_end_matches(".md")
            .trim_end_matches(".mdx")
            .trim_end_matches(".markdown")
            .to_string()
    };
    GraphNode {
        id: id.to_string(),
        label,
        node_type,
        path: Some(id.to_string()),
    }
}

fn classify_node_path(path: &str) -> GraphNodeType {
    let n = path.replace('\\', "/");
    // Collapsed paper nodes live under papers/ at any depth (not the papers root alone)
    if let Some(rest) = n.strip_prefix("papers/") {
        if !rest.is_empty() {
            // Org-only folders without paper markers still get Note if they appear;
            // discovered paper folders always collapse to paths under papers/.
            return GraphNodeType::Paper;
        }
    }
    let base = n.rsplit('/').next().unwrap_or(&n);
    let base_lower = base.to_ascii_lowercase();
    if base_lower == "papers.md"
        || base_lower == "agents.md"
        || base_lower == "readme.md"
        || base_lower == "library.bib"
    {
        return GraphNodeType::Index;
    }
    if n.contains("/notes/") || n.starts_with("notes/") {
        return GraphNodeType::Note;
    }
    GraphNodeType::Note
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
