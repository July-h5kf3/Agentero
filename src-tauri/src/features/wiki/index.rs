//! In-memory wikilink graph index (rebuildable from Vault Markdown).

use crate::features::wiki::embed::project_markdown;
use crate::features::wiki::extract::extract_document;
use crate::features::wiki::models::{
    BacklinksResponse, GraphEdge, GraphNode, GraphNodeType, GraphResponse, InternalLinkSyntax,
    LinkFragment, OutgoingLinksResponse, RebuildResult, ResolvedLink, WikiDocument,
    WikiEmbedContentKind, WikiEmbedResponse, WikiLinkEdge, WikiResolveResponse,
    WikiSearchCandidate, WikiSearchCandidateKind,
};
use crate::features::wiki::resolve::{normalize_rel, resolve_occurrence};
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

fn is_pdf(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "avif" | "ico"
            )
        })
}

fn is_wiki_target(path: &Path) -> bool {
    is_markdown(path) || is_pdf(path) || is_image(path)
}

fn without_markdown_extension(path: &str) -> String {
    let lower = path.to_ascii_lowercase();
    for extension in [".markdown", ".mdx", ".md"] {
        if lower.ends_with(extension) {
            return path[..path.len() - extension.len()].to_string();
        }
    }
    path.to_string()
}

fn document_stem(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string()
}

fn document_link_name(path: &str) -> String {
    if is_markdown(Path::new(path)) {
        return document_stem(path);
    }
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string()
}

fn should_skip_name(name: &str) -> bool {
    if IGNORE_NAMES.contains(&name) {
        return true;
    }
    // Hidden files/dirs except we still skip all dotfiles for index scan
    name.starts_with('.')
}

/// Collect vault-relative Markdown, image, and PDF targets (forward slashes).
pub fn collect_wiki_target_files(vault_root: &Path) -> std::io::Result<Vec<String>> {
    let mut out = Vec::new();
    walk_wiki_targets(vault_root, vault_root, 0, &mut out)?;
    out.sort();
    Ok(out)
}

fn walk_wiki_targets(
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
            walk_wiki_targets(vault_root, &path, depth + 1, out)?;
        } else if ft.is_file() && is_wiki_target(&path) {
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
    /// target_path → incoming occurrences
    reverse: HashMap<String, Vec<ResolvedLink>>,
    /// Indexed markdown relative paths.
    files: Vec<String>,
    /// File metadata and anchors, rebuilt entirely from Markdown source.
    documents: Vec<WikiDocument>,
}

impl WikiIndex {
    pub(crate) fn document(&self, path: &str) -> Option<&WikiDocument> {
        self.documents.iter().find(|document| document.path == path)
    }

    pub fn rebuild(&mut self, vault_path: &str) -> Result<RebuildResult, String> {
        let root = PathBuf::from(vault_path);
        if !root.is_dir() {
            return Err(format!("vault path is not a directory: {vault_path}"));
        }

        let files = collect_wiki_target_files(&root).map_err(|e| e.to_string())?;
        let mut parsed = Vec::new();
        let mut documents = Vec::new();
        for rel in &files {
            if !is_markdown(Path::new(rel)) {
                documents.push(WikiDocument {
                    path: rel.clone(),
                    aliases: Vec::new(),
                    headings: Vec::new(),
                    blocks: Vec::new(),
                });
                continue;
            }
            let abs = root.join(rel);
            let content = match fs::read_to_string(&abs) {
                Ok(content) => content,
                Err(_) => continue,
            };
            let (document, occurrences) = extract_document(rel, &content);
            documents.push(document);
            parsed.extend(occurrences);
        }

        let mut edges = Vec::new();
        let mut reverse: HashMap<String, Vec<ResolvedLink>> = HashMap::new();
        let mut nodes: HashSet<String> = HashSet::new();

        for rel in &files {
            nodes.insert(rel.clone());
        }
        for occurrence in parsed {
            let edge = resolve_occurrence(occurrence, &documents);
            if let Some(target_path) = &edge.target_path {
                nodes.insert(target_path.clone());
                reverse
                    .entry(target_path.clone())
                    .or_default()
                    .push(edge.clone());
            } else {
                nodes.insert(format!("stub:{}", edge.occurrence.target_raw));
            }
            edges.push(edge);
        }

        // Stable order for UI
        for list in reverse.values_mut() {
            list.sort_by(|a, b| a.occurrence.source.cmp(&b.occurrence.source));
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
        self.documents = documents;

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
        // Preserve every occurrence: different fragments on one line are distinct.
        backlinks.sort_by(|a, b| {
            a.occurrence
                .source
                .cmp(&b.occurrence.source)
                .then(a.occurrence.line.cmp(&b.occurrence.line))
                .then(
                    a.occurrence
                        .source_range
                        .start
                        .cmp(&b.occurrence.source_range.start),
                )
        });

        BacklinksResponse {
            path: rel,
            backlinks,
        }
    }

    pub fn get_outgoing(&self, vault_root: &str, path: &str) -> OutgoingLinksResponse {
        let rel = to_vault_rel(Path::new(vault_root), path);
        let outgoing = self
            .edges
            .iter()
            .filter(|edge| edge.occurrence.source == rel)
            .cloned()
            .collect();
        OutgoingLinksResponse {
            path: rel,
            outgoing,
        }
    }

    pub fn resolve_text(
        &self,
        vault_root: &str,
        source_path: &str,
        text: &str,
        syntax: InternalLinkSyntax,
    ) -> WikiResolveResponse {
        let source = to_vault_rel(Path::new(vault_root), source_path);
        let input = match syntax {
            InternalLinkSyntax::Wikilink if text.trim_start().starts_with("[[") => text.to_string(),
            InternalLinkSyntax::Wikilink => format!("[[{}]]", text.trim()),
            InternalLinkSyntax::Markdown => format!("[link]({})", text.trim()),
        };
        let (_, mut occurrences) = extract_document(&source, &input);
        let occurrence = occurrences.pop().unwrap_or_else(|| {
            crate::features::wiki::models::InternalLinkOccurrence {
                source,
                target_raw: text.trim().to_string(),
                syntax,
                embed: false,
                display_text: None,
                fragment: None,
                source_range: crate::features::wiki::models::SourceRange {
                    start: 0,
                    end: text.len(),
                },
                fragment_range: None,
                line: 1,
                context: None,
            }
        });
        WikiResolveResponse {
            link: resolve_occurrence(occurrence, &self.documents),
        }
    }

    pub fn read_embed(
        &self,
        vault_root: &str,
        source_path: &str,
        text: &str,
    ) -> Result<WikiEmbedResponse, String> {
        let mut link = self
            .resolve_text(vault_root, source_path, text, InternalLinkSyntax::Wikilink)
            .link;
        link.occurrence.embed = true;

        if !matches!(
            link.status,
            crate::features::wiki::models::LinkResolutionStatus::Resolved
        ) {
            return Ok(WikiEmbedResponse {
                link,
                content_kind: None,
                content: None,
            });
        }

        let Some(target_path) = link.target_path.as_deref() else {
            return Ok(WikiEmbedResponse {
                link,
                content_kind: None,
                content: None,
            });
        };
        let target = Path::new(vault_root).join(target_path);
        if is_image(&target) {
            return Ok(WikiEmbedResponse {
                link,
                content_kind: Some(WikiEmbedContentKind::Image),
                content: None,
            });
        }
        if is_pdf(&target) {
            return Ok(WikiEmbedResponse {
                link,
                content_kind: Some(WikiEmbedContentKind::Pdf),
                content: None,
            });
        }
        if !is_markdown(&target) {
            return Ok(WikiEmbedResponse {
                link,
                content_kind: Some(WikiEmbedContentKind::Unsupported),
                content: None,
            });
        }
        let markdown = fs::read_to_string(&target)
            .map_err(|error| format!("read embedded Markdown {target_path}: {error}"))?;
        let (document, _) = extract_document(target_path, &markdown);
        let content = project_markdown(&markdown, &document, link.occurrence.fragment.as_ref());
        if content.is_none() {
            link.status = crate::features::wiki::models::LinkResolutionStatus::InvalidFragment;
        }

        Ok(WikiEmbedResponse {
            link,
            content_kind: content.as_ref().map(|_| WikiEmbedContentKind::Markdown),
            content,
        })
    }

    pub fn search(&self, query: &str) -> Vec<WikiSearchCandidate> {
        self.search_scoped(query, None, None)
    }

    pub fn search_scoped(
        &self,
        query: &str,
        path: Option<&str>,
        kind: Option<&WikiSearchCandidateKind>,
    ) -> Vec<WikiSearchCandidate> {
        let query_key = query.trim().to_lowercase();
        let stem_counts =
            self.documents
                .iter()
                .fold(HashMap::<String, usize>::new(), |mut counts, document| {
                    *counts
                        .entry(document_link_name(&document.path).to_lowercase())
                        .or_default() += 1;
                    counts
                });
        let mut candidates = Vec::new();
        for document in &self.documents {
            if path.is_some_and(|path| !document.path.eq_ignore_ascii_case(path)) {
                continue;
            }
            let file_name = document_link_name(&document.path);
            let target = if stem_counts
                .get(&file_name.to_lowercase())
                .copied()
                .unwrap_or_default()
                > 1
            {
                if is_markdown(Path::new(&document.path)) {
                    without_markdown_extension(&document.path)
                } else {
                    document.path.clone()
                }
            } else {
                file_name.clone()
            };
            let file_match = query_key.is_empty()
                || document.path.to_lowercase().contains(&query_key)
                || document
                    .aliases
                    .iter()
                    .any(|alias| alias.to_lowercase().contains(&query_key));
            let include_file = kind.is_none_or(|kind| *kind == WikiSearchCandidateKind::File);
            let include_heading = kind.is_none_or(|kind| *kind == WikiSearchCandidateKind::Heading);
            let include_block = kind.is_none_or(|kind| *kind == WikiSearchCandidateKind::Block);
            if include_file && file_match {
                candidates.push(WikiSearchCandidate {
                    kind: WikiSearchCandidateKind::File,
                    path: document.path.clone(),
                    insert_text: target.clone(),
                    label: file_name.clone(),
                    detail: None,
                    alias: None,
                    fragment: None,
                });
            }
            if include_file {
                for alias in &document.aliases {
                    if query_key.is_empty() || alias.to_lowercase().contains(&query_key) {
                        candidates.push(WikiSearchCandidate {
                            kind: WikiSearchCandidateKind::File,
                            path: document.path.clone(),
                            insert_text: target.clone(),
                            label: alias.clone(),
                            detail: None,
                            alias: Some(alias.clone()),
                            fragment: None,
                        });
                    }
                }
            }
            if include_heading {
                for heading in &document.headings {
                    let label = heading.path.join(" › ");
                    if query_key.is_empty() || label.to_lowercase().contains(&query_key) {
                        candidates.push(WikiSearchCandidate {
                            kind: WikiSearchCandidateKind::Heading,
                            path: document.path.clone(),
                            insert_text: format!("{}#{}", target, heading.text),
                            label,
                            detail: Some(format!("H{}", heading.level)),
                            alias: None,
                            fragment: Some(LinkFragment::Heading {
                                path: heading.path.clone(),
                            }),
                        });
                    }
                }
            }
            if include_block {
                for block in &document.blocks {
                    if query_key.is_empty() || block.id.to_lowercase().contains(&query_key) {
                        candidates.push(WikiSearchCandidate {
                            kind: WikiSearchCandidateKind::Block,
                            path: document.path.clone(),
                            insert_text: format!("{}#^{}", target, block.id),
                            label: format!("^{}", block.id),
                            detail: (!block.preview.is_empty()).then(|| block.preview.clone()),
                            alias: None,
                            fragment: Some(LinkFragment::Block {
                                id: block.id.clone(),
                            }),
                        });
                    }
                }
            }
        }
        candidates.sort_by(|left, right| {
            left.path
                .cmp(&right.path)
                .then(left.label.cmp(&right.label))
        });
        candidates.truncate(100);
        candidates
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
            let source = collapse_graph_id(&e.occurrence.source, &paper_folders);
            let target = match &e.target_path {
                Some(tp) => collapse_graph_id(tp, &paper_folders),
                None => format!("stub:{}", e.occurrence.target_raw),
            };
            if source == target {
                continue; // self-loop after collapse (e.g. NOTES ↔ paper internals)
            }
            node_ids.insert(source.clone());
            node_ids.insert(target.clone());
            full_edges.push((source, target, e.occurrence.target_raw.clone()));
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::wiki::models::{BlockAnchor, HeadingAnchor, LinkResolutionStatus};
    use uuid::Uuid;

    fn test_vault() -> PathBuf {
        let root = std::env::temp_dir().join(format!("agentero-wiki-embed-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("notes")).expect("create embed fixture vault");
        root
    }

    #[test]
    fn reads_resolved_heading_and_block_embed_projections() {
        let root = test_vault();
        fs::write(
            root.join("notes/Target.md"),
            "# Root\nintro\n## Child\nchild\nBlock text ^focus\n## Sibling\nend\n",
        )
        .expect("write target");
        fs::write(root.join("notes/Source.md"), "![[Target#Child]]").expect("write source");

        let mut index = WikiIndex::default();
        index
            .rebuild(root.to_str().expect("utf-8 fixture path"))
            .expect("rebuild index");
        let heading = index
            .read_embed(
                root.to_str().expect("utf-8 fixture path"),
                "notes/Source.md",
                "Target#Child",
            )
            .expect("read heading embed");
        assert_eq!(
            heading.content.as_deref(),
            Some("## Child\nchild\nBlock text ^focus\n")
        );
        assert!(heading.link.occurrence.embed);

        let block = index
            .read_embed(
                root.to_str().expect("utf-8 fixture path"),
                "notes/Source.md",
                "Target#^focus",
            )
            .expect("read block embed");
        assert_eq!(block.content.as_deref(), Some("Block text ^focus\n"));

        fs::remove_dir_all(root).expect("remove fixture vault");
    }

    #[test]
    fn resolves_current_file_heading_and_block_through_the_command_path() {
        let root = test_vault();
        fs::write(
            root.join("notes/Current.md"),
            "# Overview\nCurrent block ^summary\n",
        )
        .expect("write current note");

        let vault = root.to_str().expect("utf-8 fixture path");
        let mut index = WikiIndex::default();
        index.rebuild(vault).expect("rebuild index");

        let current_file = index
            .resolve_text(vault, "notes/Current.md", "", InternalLinkSyntax::Wikilink)
            .link;
        assert_eq!(current_file.status, LinkResolutionStatus::Resolved);
        assert_eq!(
            current_file.target_path.as_deref(),
            Some("notes/Current.md")
        );

        for link_text in ["#Overview", "#^summary"] {
            let link = index
                .resolve_text(
                    vault,
                    "notes/Current.md",
                    link_text,
                    InternalLinkSyntax::Wikilink,
                )
                .link;
            assert_eq!(link.status, LinkResolutionStatus::Resolved, "{link_text}");
            assert_eq!(
                link.target_path.as_deref(),
                Some("notes/Current.md"),
                "{link_text}"
            );
            assert!(link.occurrence.target_raw.is_empty(), "{link_text}");
        }

        fs::remove_dir_all(root).expect("remove fixture vault");
    }

    #[test]
    fn resolves_and_projects_image_and_pdf_targets() {
        let root = test_vault();
        fs::create_dir_all(root.join("assets")).expect("create attachment directory");
        fs::write(root.join("assets/figure.png"), b"png fixture").expect("write image fixture");
        fs::write(root.join("assets/paper.pdf"), b"pdf fixture").expect("write pdf fixture");
        fs::write(
            root.join("notes/Source.md"),
            "[[figure.png]]\n[[paper.pdf]]\n![[figure.png]]\n![[paper.pdf]]\n",
        )
        .expect("write attachment links");

        let vault = root.to_str().expect("utf-8 fixture path");
        let mut index = WikiIndex::default();
        index.rebuild(vault).expect("rebuild attachment index");

        let image = index
            .resolve_text(
                vault,
                "notes/Source.md",
                "figure.png",
                InternalLinkSyntax::Wikilink,
            )
            .link;
        assert_eq!(image.status, LinkResolutionStatus::Resolved);
        assert_eq!(image.target_path.as_deref(), Some("assets/figure.png"));

        let pdf = index
            .resolve_text(
                vault,
                "notes/Source.md",
                "paper.pdf",
                InternalLinkSyntax::Wikilink,
            )
            .link;
        assert_eq!(pdf.status, LinkResolutionStatus::Resolved);
        assert_eq!(pdf.target_path.as_deref(), Some("assets/paper.pdf"));

        let image_embed = index
            .read_embed(vault, "notes/Source.md", "figure.png")
            .expect("read image embed");
        assert_eq!(image_embed.content_kind, Some(WikiEmbedContentKind::Image));
        assert_eq!(image_embed.content, None);

        let pdf_embed = index
            .read_embed(vault, "notes/Source.md", "paper.pdf")
            .expect("read pdf embed");
        assert_eq!(pdf_embed.content_kind, Some(WikiEmbedContentKind::Pdf));
        assert_eq!(pdf_embed.content, None);

        let file_targets = index
            .search("")
            .into_iter()
            .filter(|candidate| candidate.kind == WikiSearchCandidateKind::File)
            .map(|candidate| candidate.insert_text)
            .collect::<Vec<_>>();
        assert!(file_targets.contains(&"figure.png".to_string()));
        assert!(file_targets.contains(&"paper.pdf".to_string()));

        fs::remove_dir_all(root).expect("remove fixture vault");
    }

    #[test]
    fn duplicate_attachment_names_require_vault_relative_targets() {
        let root = test_vault();
        fs::create_dir_all(root.join("assets/first")).expect("create first asset directory");
        fs::create_dir_all(root.join("assets/second")).expect("create second asset directory");
        fs::write(root.join("assets/first/figure.png"), b"first image").expect("write first image");
        fs::write(root.join("assets/second/figure.png"), b"second image")
            .expect("write second image");

        let vault = root.to_str().expect("utf-8 fixture path");
        let mut index = WikiIndex::default();
        index.rebuild(vault).expect("rebuild attachment index");

        let ambiguous = index
            .resolve_text(
                vault,
                "notes/Source.md",
                "figure.png",
                InternalLinkSyntax::Wikilink,
            )
            .link;
        assert_eq!(ambiguous.status, LinkResolutionStatus::Ambiguous);

        let targets = index
            .search("figure.png")
            .into_iter()
            .filter(|candidate| candidate.kind == WikiSearchCandidateKind::File)
            .map(|candidate| candidate.insert_text)
            .collect::<Vec<_>>();
        assert_eq!(
            targets,
            vec![
                "assets/first/figure.png".to_string(),
                "assets/second/figure.png".to_string()
            ]
        );

        fs::remove_dir_all(root).expect("remove fixture vault");
    }

    #[test]
    fn search_keeps_alias_display_separate_from_canonical_target() {
        let index = WikiIndex {
            documents: vec![WikiDocument {
                path: "notes/Canonical.md".into(),
                aliases: vec!["Short name".into()],
                headings: vec![HeadingAnchor {
                    text: "Overview".into(),
                    path: vec!["Canonical".into(), "Overview".into()],
                    level: 2,
                    line: 4,
                }],
                blocks: vec![BlockAnchor {
                    id: "验收块".into(),
                    preview: "Canonical block preview".into(),
                    line: 8,
                }],
            }],
            ..Default::default()
        };

        let alias = index
            .search("Short")
            .into_iter()
            .find(|candidate| candidate.alias.as_deref() == Some("Short name"))
            .expect("alias candidate");
        assert_eq!(alias.insert_text, "Canonical");

        let heading = index
            .search("Overview")
            .into_iter()
            .find(|candidate| candidate.kind == WikiSearchCandidateKind::Heading)
            .expect("heading candidate");
        assert_eq!(heading.insert_text, "Canonical#Overview");
        assert_eq!(heading.detail.as_deref(), Some("H2"));

        let block = index
            .search("验收")
            .into_iter()
            .find(|candidate| candidate.kind == WikiSearchCandidateKind::Block)
            .expect("block candidate");
        assert_eq!(block.insert_text, "Canonical#^验收块");
        assert_eq!(block.detail.as_deref(), Some("Canonical block preview"));
    }

    #[test]
    fn search_uses_vault_relative_paths_for_duplicate_file_names() {
        let index = WikiIndex {
            documents: vec![
                WikiDocument {
                    path: "notes/Target.md".into(),
                    aliases: Vec::new(),
                    headings: Vec::new(),
                    blocks: Vec::new(),
                },
                WikiDocument {
                    path: "references/target.md".into(),
                    aliases: Vec::new(),
                    headings: Vec::new(),
                    blocks: Vec::new(),
                },
                WikiDocument {
                    path: "papers/Fara-1.5.md".into(),
                    aliases: Vec::new(),
                    headings: Vec::new(),
                    blocks: Vec::new(),
                },
            ],
            ..Default::default()
        };

        let duplicate_targets = index
            .search("Target")
            .into_iter()
            .filter(|candidate| candidate.kind == WikiSearchCandidateKind::File)
            .map(|candidate| candidate.insert_text)
            .collect::<Vec<_>>();
        assert_eq!(duplicate_targets, vec!["notes/Target", "references/target"]);

        let unique = index
            .search("Fara-1.5")
            .into_iter()
            .find(|candidate| candidate.kind == WikiSearchCandidateKind::File)
            .expect("unique file candidate");
        assert_eq!(unique.insert_text, "Fara-1.5");
    }

    #[test]
    fn scoped_search_filters_before_the_global_candidate_limit() {
        let mut documents = (0..101)
            .map(|index| WikiDocument {
                path: format!("early/{index:03}.md"),
                aliases: Vec::new(),
                headings: Vec::new(),
                blocks: Vec::new(),
            })
            .collect::<Vec<_>>();
        documents.push(WikiDocument {
            path: "notes/双链验收/目标笔记.md".into(),
            aliases: Vec::new(),
            headings: Vec::new(),
            blocks: vec![
                BlockAnchor {
                    id: "验收块".into(),
                    preview: "可精确定位到本段。".into(),
                    line: 17,
                },
                BlockAnchor {
                    id: "asb".into(),
                    preview: "请仅在 Agentero 内将本文件改名。".into(),
                    line: 21,
                },
            ],
        });
        let index = WikiIndex {
            documents,
            ..Default::default()
        };

        let blocks = index.search_scoped(
            "",
            Some("notes/双链验收/目标笔记.md"),
            Some(&WikiSearchCandidateKind::Block),
        );

        assert_eq!(blocks.len(), 2);
        assert!(blocks.iter().any(|candidate| {
            candidate.label == "^验收块"
                && candidate.detail.as_deref() == Some("可精确定位到本段。")
        }));
        assert!(blocks.iter().any(|candidate| {
            candidate.label == "^asb"
                && candidate.detail.as_deref() == Some("请仅在 Agentero 内将本文件改名。")
        }));
    }
}
