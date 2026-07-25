//! Resolve parsed local-link occurrences against a rebuildable Vault document index.

use crate::models::wiki::{
    InternalLinkOccurrence, InternalLinkSyntax, LinkFragment, LinkResolutionStatus, ResolvedLink,
    WikiDocument,
};
use std::path::Path;

/// Normalize a Vault-relative forward-slash path without allowing it to escape the root.
pub fn normalize_rel(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let mut parts = Vec::new();
    for component in normalized.split('/') {
        match component {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    parts.push("..");
                }
            }
            value => parts.push(value),
        }
    }
    parts.join("/")
}

fn normalize_key(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn stem_of(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string()
}

fn add_extensions(value: &str) -> Vec<String> {
    let value = normalize_rel(value);
    if value.is_empty() {
        return Vec::new();
    }
    let has_markdown_extension = [".md", ".mdx", ".markdown"]
        .iter()
        .any(|extension| value.to_ascii_lowercase().ends_with(extension));
    let mut candidates = vec![value.clone()];
    if !has_markdown_extension {
        candidates.extend([
            format!("{value}.md"),
            format!("{value}.mdx"),
            format!("{value}.markdown"),
        ]);
    }
    candidates
}

fn source_relative(source: &str, target: &str) -> String {
    let parent = Path::new(source).parent().unwrap_or_else(|| Path::new(""));
    normalize_rel(&parent.join(target).to_string_lossy())
}

fn unique(mut candidates: Vec<String>) -> Result<String, Vec<String>> {
    candidates.sort();
    candidates.dedup();
    if candidates.len() == 1 {
        Ok(candidates.remove(0))
    } else {
        Err(candidates)
    }
}

fn resolve_document(
    occurrence: &InternalLinkOccurrence,
    documents: &[WikiDocument],
) -> Result<String, Vec<String>> {
    if occurrence.target_raw.trim().is_empty() {
        return documents
            .iter()
            .find(|document| document.path == occurrence.source)
            .map(|document| document.path.clone())
            .ok_or_else(Vec::new);
    }

    let raw = occurrence.target_raw.trim();
    // Markdown destinations without a leading slash are relative to the source
    // document, including bare `Target.md`. Try that location before the
    // vault-root spelling so a nearby same-named document keeps its Markdown
    // meaning instead of being shadowed by a root-level file.
    let mut exact_candidates = Vec::new();
    if matches!(occurrence.syntax, InternalLinkSyntax::Markdown) && !raw.starts_with('/') {
        let relative = source_relative(&occurrence.source, raw);
        // A Markdown destination is source-relative. If resolving it would
        // escape the Vault, do not fall through to a root/suffix/stem match:
        // `../../Target.md` must never silently become `Target.md` in Vault.
        if relative == ".." || relative.starts_with("../") {
            return Err(Vec::new());
        }
        exact_candidates.extend(add_extensions(&relative));
    }
    exact_candidates.extend(add_extensions(raw));
    for candidate in &exact_candidates {
        let hits = documents
            .iter()
            .filter(|document| document.path == *candidate)
            .map(|document| document.path.clone())
            .collect::<Vec<_>>();
        if !hits.is_empty() {
            return unique(hits);
        }
    }
    for candidate in &exact_candidates {
        let hits = documents
            .iter()
            .filter(|document| document.path.eq_ignore_ascii_case(candidate))
            .map(|document| document.path.clone())
            .collect::<Vec<_>>();
        if !hits.is_empty() {
            return unique(hits);
        }
    }

    let suffixes = add_extensions(raw);
    let suffix_hits = documents
        .iter()
        .filter(|document| {
            suffixes.iter().any(|candidate| {
                document.path == *candidate || document.path.ends_with(&format!("/{candidate}"))
            })
        })
        .map(|document| document.path.clone())
        .collect::<Vec<_>>();
    match unique(suffix_hits) {
        Ok(path) => return Ok(path),
        Err(candidates) if candidates.len() > 1 => return Err(candidates),
        Err(_) => {}
    }

    let wanted_stem = normalize_key(&stem_of(raw));
    let stem_hits = documents
        .iter()
        .filter(|document| normalize_key(&stem_of(&document.path)) == wanted_stem)
        .map(|document| document.path.clone())
        .collect::<Vec<_>>();
    match unique(stem_hits) {
        Ok(path) => return Ok(path),
        Err(candidates) if candidates.len() > 1 => return Err(candidates),
        Err(_) => {}
    }

    let wanted_alias = normalize_key(raw);
    let alias_hits = documents
        .iter()
        .filter(|document| {
            document
                .aliases
                .iter()
                .any(|alias| normalize_key(alias) == wanted_alias)
        })
        .map(|document| document.path.clone())
        .collect::<Vec<_>>();
    unique(alias_hits)
}

fn fragment_candidates(document: &WikiDocument, fragment: &LinkFragment) -> Vec<String> {
    match fragment {
        LinkFragment::Heading { path } => {
            let wanted = path
                .iter()
                .map(|part| normalize_key(part))
                .collect::<Vec<_>>();
            document
                .headings
                .iter()
                .filter(|heading| {
                    let current = heading
                        .path
                        .iter()
                        .map(|part| normalize_key(part))
                        .collect::<Vec<_>>();
                    if wanted.len() == 1 {
                        current.last() == wanted.last()
                    } else {
                        current == wanted
                    }
                })
                .map(|heading| heading.path.join("#"))
                .collect()
        }
        LinkFragment::Block { id } if crate::services::wiki::extract::is_valid_block_id(id) => {
            document
                .blocks
                .iter()
                .filter(|block| block.id == *id)
                .map(|block| block.id.clone())
                .collect()
        }
        LinkFragment::Block { .. } => Vec::new(),
    }
}

/// Resolve one occurrence. Missing/ambiguous paths and invalid/ambiguous anchors
/// are explicit states; callers must never turn them into a best-effort jump.
pub fn resolve_occurrence(
    occurrence: InternalLinkOccurrence,
    documents: &[WikiDocument],
) -> ResolvedLink {
    let path = match resolve_document(&occurrence, documents) {
        Ok(path) => path,
        Err(candidates) if candidates.is_empty() => {
            return ResolvedLink {
                occurrence,
                status: LinkResolutionStatus::Missing,
                target_path: None,
                candidates,
            };
        }
        Err(candidates) => {
            return ResolvedLink {
                occurrence,
                status: LinkResolutionStatus::Ambiguous,
                target_path: None,
                candidates,
            };
        }
    };

    if let Some(fragment) = &occurrence.fragment {
        let document = documents.iter().find(|document| document.path == path);
        let candidates = document
            .map(|document| fragment_candidates(document, fragment))
            .unwrap_or_default();
        return match candidates.len() {
            1 => ResolvedLink {
                occurrence,
                status: LinkResolutionStatus::Resolved,
                target_path: Some(path),
                candidates: Vec::new(),
            },
            0 => ResolvedLink {
                occurrence,
                status: LinkResolutionStatus::InvalidFragment,
                target_path: Some(path),
                candidates,
            },
            _ => ResolvedLink {
                occurrence,
                status: LinkResolutionStatus::Ambiguous,
                target_path: Some(path),
                candidates,
            },
        };
    }

    ResolvedLink {
        occurrence,
        status: LinkResolutionStatus::Resolved,
        target_path: Some(path),
        candidates: Vec::new(),
    }
}

/// Compatibility helper for callers that only have file paths and no source context.
pub fn resolve_target(target_raw: &str, vault_files: &[String]) -> Option<String> {
    let documents = vault_files
        .iter()
        .map(|path| WikiDocument {
            path: path.clone(),
            aliases: Vec::new(),
            headings: Vec::new(),
            blocks: Vec::new(),
        })
        .collect::<Vec<_>>();
    let occurrence = InternalLinkOccurrence {
        source: String::new(),
        target_raw: target_raw.to_string(),
        syntax: InternalLinkSyntax::Wikilink,
        embed: false,
        display_text: None,
        fragment: None,
        source_range: crate::models::wiki::SourceRange { start: 0, end: 0 },
        line: 0,
        context: None,
    };
    let resolved = resolve_occurrence(occurrence, &documents);
    matches!(resolved.status, LinkResolutionStatus::Resolved)
        .then_some(resolved.target_path)
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::wiki::{HeadingAnchor, SourceRange};
    use crate::services::wiki::extract::extract_document;
    use serde::Deserialize;

    fn occurrence(
        source: &str,
        target: &str,
        fragment: Option<LinkFragment>,
    ) -> InternalLinkOccurrence {
        InternalLinkOccurrence {
            source: source.to_string(),
            target_raw: target.to_string(),
            syntax: InternalLinkSyntax::Wikilink,
            embed: false,
            display_text: None,
            fragment,
            source_range: SourceRange {
                start: 0,
                end: target.len(),
            },
            line: 1,
            context: None,
        }
    }

    fn documents() -> Vec<WikiDocument> {
        vec![
            WikiDocument {
                path: "notes/a.md".into(),
                aliases: vec!["Alpha".into()],
                headings: vec![HeadingAnchor {
                    text: "Root".into(),
                    path: vec!["Root".into()],
                    line: 1,
                }],
                blocks: Vec::new(),
            },
            WikiDocument {
                path: "notes/b.md".into(),
                aliases: vec!["Beta".into()],
                headings: Vec::new(),
                blocks: Vec::new(),
            },
        ]
    }

    #[test]
    fn resolves_alias_and_same_file_heading() {
        let docs = documents();
        let alias = resolve_occurrence(occurrence("notes/b.md", "Alpha", None), &docs);
        assert_eq!(alias.target_path.as_deref(), Some("notes/a.md"));
        let same_file = resolve_occurrence(
            occurrence(
                "notes/a.md",
                "",
                Some(LinkFragment::Heading {
                    path: vec!["Root".into()],
                }),
            ),
            &docs,
        );
        assert!(matches!(same_file.status, LinkResolutionStatus::Resolved));
    }

    #[test]
    fn never_silently_resolves_duplicate_names() {
        let mut docs = documents();
        docs.push(WikiDocument {
            path: "other/a.md".into(),
            aliases: Vec::new(),
            headings: Vec::new(),
            blocks: Vec::new(),
        });
        let link = resolve_occurrence(occurrence("notes/b.md", "a", None), &docs);
        assert!(matches!(link.status, LinkResolutionStatus::Ambiguous));
    }

    #[test]
    fn resolves_markdown_relative_path() {
        let docs = documents();
        let mut link = occurrence("folder/source.md", "../notes/a.md", None);
        link.syntax = InternalLinkSyntax::Markdown;
        let link = resolve_occurrence(link, &docs);
        assert_eq!(link.target_path.as_deref(), Some("notes/a.md"));
    }

    #[test]
    fn resolves_bare_markdown_destination_relative_to_source_before_vault_root() {
        let mut docs = documents();
        docs.extend([
            WikiDocument {
                path: "Target.md".into(),
                aliases: Vec::new(),
                headings: Vec::new(),
                blocks: Vec::new(),
            },
            WikiDocument {
                path: "folder/Target.md".into(),
                aliases: Vec::new(),
                headings: Vec::new(),
                blocks: Vec::new(),
            },
        ]);
        let mut link = occurrence("folder/source.md", "Target.md", None);
        link.syntax = InternalLinkSyntax::Markdown;

        let link = resolve_occurrence(link, &docs);

        assert_eq!(link.target_path.as_deref(), Some("folder/Target.md"));
    }

    #[test]
    fn reports_invalid_block_fragments_for_same_and_cross_file_links() {
        let (source, mut links) =
            extract_document("notes/source.md", "[[#^bad id]] and [[Target#^also-bad!]]");
        let (target, _) = extract_document("notes/Target.md", "# Target\nBlock ^valid\n");
        let documents = vec![source, target];

        let cross_file = resolve_occurrence(links.pop().expect("cross-file link"), &documents);
        let same_file = resolve_occurrence(links.pop().expect("same-file link"), &documents);

        assert_eq!(same_file.status, LinkResolutionStatus::InvalidFragment);
        assert_eq!(same_file.target_path.as_deref(), Some("notes/source.md"));
        assert_eq!(cross_file.status, LinkResolutionStatus::InvalidFragment);
        assert_eq!(cross_file.target_path.as_deref(), Some("notes/Target.md"));
    }

    #[test]
    fn resolves_unicode_block_fragments() {
        let (source, links) = extract_document("notes/source.md", "[[Target#^验收块]]");
        let (target, _) =
            extract_document("notes/Target.md", "# Target\n可精确定位到本段。 ^验收块\n");
        let link = resolve_occurrence(
            links.into_iter().next().expect("unicode block link"),
            &[source, target],
        );

        assert_eq!(link.status, LinkResolutionStatus::Resolved);
        assert_eq!(link.target_path.as_deref(), Some("notes/Target.md"));
    }

    #[test]
    fn never_resolves_markdown_paths_outside_the_vault() {
        let mut docs = documents();
        docs.push(WikiDocument {
            path: "Target.md".into(),
            aliases: Vec::new(),
            headings: Vec::new(),
            blocks: Vec::new(),
        });
        let mut link = occurrence("notes/source.md", "../../Target.md", None);
        link.syntax = InternalLinkSyntax::Markdown;

        let link = resolve_occurrence(link, &docs);

        assert_eq!(link.status, LinkResolutionStatus::Missing);
        assert_eq!(link.target_path, None);
    }

    #[derive(Deserialize)]
    struct SemanticFixture {
        documents: Vec<FixtureDocument>,
        cases: Vec<FixtureCase>,
    }

    #[derive(Deserialize)]
    struct FixtureDocument {
        path: String,
        content: String,
    }

    #[derive(Deserialize)]
    struct FixtureCase {
        source: String,
        link: String,
        #[serde(default)]
        syntax: Option<InternalLinkSyntax>,
        status: String,
        path: Option<String>,
    }

    #[test]
    fn shared_semantic_fixture_has_deterministic_results() {
        let fixture: SemanticFixture = serde_json::from_str(include_str!(
            "../../../../test/fixtures/wikilinks/semantic-cases.json"
        ))
        .expect("semantic fixture must be valid JSON");
        let documents = fixture
            .documents
            .iter()
            .map(|document| extract_document(&document.path, &document.content).0)
            .collect::<Vec<_>>();

        for case in fixture.cases {
            let syntax = case.syntax.unwrap_or(InternalLinkSyntax::Wikilink);
            let input = match syntax {
                InternalLinkSyntax::Wikilink => format!("[[{}]]", case.link),
                InternalLinkSyntax::Markdown => format!("[link]({})", case.link),
            };
            let (_, mut occurrences) = extract_document(&case.source, &input);
            let resolved = resolve_occurrence(
                occurrences.pop().expect("fixture link must parse"),
                &documents,
            );
            assert_eq!(
                serde_json::to_value(&resolved.status)
                    .expect("status serializes")
                    .as_str(),
                Some(case.status.as_str()),
                "{}",
                case.link
            );
            assert_eq!(resolved.target_path, case.path, "{}", case.link);
        }
    }
}
