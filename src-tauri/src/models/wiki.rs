use serde::{Deserialize, Serialize};

/// Byte range of the target portion of an internal-link token in its source file.
/// It deliberately excludes aliases, fragments and Markdown labels so a rename can
/// replace only the target while preserving the user's surrounding text.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceRange {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InternalLinkSyntax {
    Wikilink,
    Markdown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LinkFragment {
    Heading { path: Vec<String> },
    Block { id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LinkResolutionStatus {
    Resolved,
    Missing,
    Ambiguous,
    InvalidFragment,
}

/// A parsed explicit Vault-local link. Markdown remains the source of truth; this
/// is only an in-memory, rebuildable occurrence projection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InternalLinkOccurrence {
    pub source: String,
    pub target_raw: String,
    pub syntax: InternalLinkSyntax,
    pub embed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fragment: Option<LinkFragment>,
    pub source_range: SourceRange,
    pub line: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
}

/// Document-local anchors and aliases used by the resolver.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiDocument {
    pub path: String,
    pub aliases: Vec<String>,
    pub headings: Vec<HeadingAnchor>,
    pub blocks: Vec<BlockAnchor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HeadingAnchor {
    pub text: String,
    pub path: Vec<String>,
    pub line: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlockAnchor {
    pub id: String,
    pub line: u32,
}

/// A parsed occurrence enriched with one deterministic resolution result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedLink {
    #[serde(flatten)]
    pub occurrence: InternalLinkOccurrence,
    pub status: LinkResolutionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_path: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub candidates: Vec<String>,
}

/// Compatibility/public graph edge. It preserves occurrence semantics so callers
/// that need navigation or a later rewrite never have to reconstruct it from the
/// file-level graph projection.
pub type WikiLinkEdge = ResolvedLink;

/// One incoming occurrence for a selected target file.
pub type Backlink = ResolvedLink;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinksResponse {
    pub path: String,
    pub backlinks: Vec<Backlink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingLinksResponse {
    pub path: String,
    pub outgoing: Vec<ResolvedLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WikiResolveResponse {
    pub link: ResolvedLink,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WikiSearchCandidateKind {
    File,
    Heading,
    Block,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WikiSearchCandidate {
    pub kind: WikiSearchCandidateKind,
    pub path: String,
    pub insert_text: String,
    pub label: String,
    /// A human-facing alias selected by the user. The editor writes this as a
    /// display alias while preserving `insert_text` as the canonical target.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alias: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fragment: Option<LinkFragment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildResult {
    pub indexed_files: u32,
    pub edges: u32,
    pub nodes: u32,
}

/// Graph node type inferred from vault-relative path.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GraphNodeType {
    Paper,
    Note,
    Index,
    Stub,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    /// Stable id: vault-relative path, or `stub:<raw>` for unresolved targets.
    pub id: String,
    pub label: String,
    #[serde(rename = "type")]
    pub node_type: GraphNodeType,
    /// Vault-relative path when resolved; null for stubs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_raw: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphResponse {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    /// Normalized center path when neighborhood mode; null for full graph.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub center: Option<String>,
    pub depth: u32,
}
