//! Parse explicit Vault-local links and document anchors from Markdown.
//!
//! This scanner deliberately keeps byte ranges aligned with the original source.
//! It ignores fenced and inline code and does not try to interpret arbitrary
//! Markdown extensions; the resulting data is a rebuildable input to the wiki
//! resolver and rename planner.

use crate::models::wiki::{
    BlockAnchor, HeadingAnchor, InternalLinkOccurrence, InternalLinkSyntax, LinkFragment,
    SourceRange, WikiDocument,
};

fn normalise_fragment_part(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn parse_fragment(value: &str) -> Option<LinkFragment> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    if let Some(id) = value.strip_prefix('^') {
        // Retain malformed block fragments for the resolver. It can then return
        // `invalidFragment` instead of silently degrading `[[Target#^bad id]]`
        // into a file-only link.
        return Some(LinkFragment::Block { id: id.to_string() });
    }
    let path: Vec<String> = value
        .split('#')
        .map(normalise_fragment_part)
        .filter(|part| !part.is_empty())
        .collect();
    (!path.is_empty()).then_some(LinkFragment::Heading { path })
}

pub fn is_valid_block_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|character| character.is_alphanumeric() || character == '-')
}

fn mask_inline_code(line: &str) -> Vec<u8> {
    let mut masked = line.as_bytes().to_vec();
    let mut index = 0;
    while index < masked.len() {
        if masked[index] != b'`' {
            index += 1;
            continue;
        }
        let start = index;
        index += 1;
        while index < masked.len() && masked[index] != b'`' {
            index += 1;
        }
        if index >= masked.len() {
            for byte in &mut masked[start..] {
                *byte = b' ';
            }
            break;
        }
        for byte in &mut masked[start..=index] {
            *byte = b' ';
        }
        index += 1;
    }
    masked
}

fn line_context(line: &str) -> Option<String> {
    let text = line.trim();
    (!text.is_empty()).then_some(text.to_string())
}

fn trim_bounds(value: &str) -> (usize, usize) {
    let start = value.len() - value.trim_start().len();
    let end = value.trim_end().len();
    (start, end)
}

fn parse_wikilink(
    source: &str,
    source_path: &str,
    body_start: usize,
    body_end: usize,
    embed: bool,
    line: u32,
    context: Option<String>,
) -> Option<InternalLinkOccurrence> {
    let body = &source[body_start..body_end];
    let alias_split = body.find('|').unwrap_or(body.len());
    let main = &body[..alias_split];
    let (main_start, main_end) = trim_bounds(main);
    let main = &main[main_start..main_end];
    if main.is_empty() {
        return None;
    }
    let alias = if alias_split == body.len() {
        None
    } else {
        let value = body[alias_split + 1..].trim();
        (!value.is_empty()).then_some(value.to_string())
    };
    let (target_part, fragment_raw) = match main.find('#') {
        Some(index) => (&main[..index], Some(&main[index + 1..])),
        None => (main, None),
    };
    let (target_start, target_end) = trim_bounds(target_part);
    let target_raw = target_part[target_start..target_end].to_string();
    let fragment = fragment_raw.and_then(parse_fragment);
    if target_raw.is_empty() && fragment.is_none() {
        return None;
    }
    let target_offset = body_start + main_start + target_start;
    Some(InternalLinkOccurrence {
        source: source_path.to_string(),
        target_raw,
        syntax: InternalLinkSyntax::Wikilink,
        embed,
        display_text: alias,
        fragment,
        source_range: SourceRange {
            start: target_offset,
            end: target_offset + target_part[target_start..target_end].len(),
        },
        line,
        context,
    })
}

fn looks_external_markdown_target(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    lower.starts_with("//")
        || lower.starts_with("mailto:")
        || lower.starts_with("data:")
        || lower.contains("://")
}

struct LinkOccurrenceContext<'a> {
    source_path: &'a str,
    embed: bool,
    line: u32,
    context: Option<String>,
}

fn parse_markdown_link(
    source: &str,
    label_start: usize,
    label_end: usize,
    destination_start: usize,
    destination_end: usize,
    occurrence_context: &LinkOccurrenceContext<'_>,
) -> Option<InternalLinkOccurrence> {
    let label = source[label_start..label_end].trim();
    let destination = source[destination_start..destination_end].trim();
    let (angle_offset, destination) = if destination.starts_with('<') && destination.ends_with('>')
    {
        (1, &destination[1..destination.len() - 1])
    } else {
        (
            0,
            destination.split_whitespace().next().unwrap_or(destination),
        )
    };
    if destination.is_empty() || looks_external_markdown_target(destination) {
        return None;
    }
    let (target_part, fragment_raw) = match destination.find('#') {
        Some(index) => (&destination[..index], Some(&destination[index + 1..])),
        None => (destination, None),
    };
    let fragment = fragment_raw.and_then(parse_fragment);
    if target_part.trim().is_empty() && fragment.is_none() {
        return None;
    }
    let raw_dest = source[destination_start..destination_end].trim();
    let leading = raw_dest.len() - raw_dest.trim_start().len();
    let target_offset = destination_start + leading + angle_offset;
    Some(InternalLinkOccurrence {
        source: occurrence_context.source_path.to_string(),
        target_raw: target_part.trim().to_string(),
        syntax: InternalLinkSyntax::Markdown,
        embed: occurrence_context.embed,
        display_text: (!label.is_empty()).then_some(label.to_string()),
        fragment,
        source_range: SourceRange {
            start: target_offset,
            end: target_offset + target_part.len(),
        },
        line: occurrence_context.line,
        context: occurrence_context.context.clone(),
    })
}

fn parse_frontmatter_aliases(markdown: &str) -> (usize, Vec<String>) {
    let mut lines = markdown.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (0, Vec::new());
    }
    let mut byte_offset = 4.min(markdown.len());
    let mut aliases = Vec::new();
    let mut reading_aliases = false;
    for line in lines {
        let trimmed = line.trim();
        byte_offset += line.len() + 1;
        if trimmed == "---" || trimmed == "..." {
            return (byte_offset, aliases);
        }
        if let Some(value) = trimmed.strip_prefix("aliases:") {
            reading_aliases = true;
            let value = value.trim();
            if value.starts_with('[') && value.ends_with(']') {
                aliases.extend(
                    value[1..value.len() - 1]
                        .split(',')
                        .map(|item| item.trim().trim_matches(['\'', '"']))
                        .filter(|item| !item.is_empty())
                        .map(str::to_string),
                );
                reading_aliases = false;
            }
            continue;
        }
        if reading_aliases && trimmed.starts_with('-') {
            let value = trimmed
                .trim_start_matches('-')
                .trim()
                .trim_matches(['\'', '"']);
            if !value.is_empty() {
                aliases.push(value.to_string());
            }
        } else if !trimmed.is_empty() && !line.starts_with(char::is_whitespace) {
            reading_aliases = false;
        }
    }
    (0, Vec::new())
}

fn parse_heading(line: &str) -> Option<(usize, String)> {
    let trimmed = line.trim_start();
    let hashes = trimmed.bytes().take_while(|byte| *byte == b'#').count();
    if !(1..=6).contains(&hashes) || trimmed.as_bytes().get(hashes) != Some(&b' ') {
        return None;
    }
    let text = trimmed[hashes..].trim().trim_end_matches('#').trim();
    (!text.is_empty()).then_some((hashes, text.to_string()))
}

fn collect_block_ids(line: &str, line_no: u32, blocks: &mut Vec<BlockAnchor>) {
    let trimmed = line.trim_end();
    let Some(caret) = trimmed.rfind('^') else {
        return;
    };
    if caret > 0
        && !trimmed[..caret]
            .chars()
            .next_back()
            .is_some_and(char::is_whitespace)
    {
        return;
    }
    let id = &trimmed[caret + 1..];
    if is_valid_block_id(id) {
        blocks.push(BlockAnchor {
            id: id.to_string(),
            line: line_no,
        });
    }
}

fn extract_line_links(
    source: &str,
    source_path: &str,
    line_start: usize,
    line: &str,
    line_no: u32,
    out: &mut Vec<InternalLinkOccurrence>,
) {
    let masked = mask_inline_code(line);
    let bytes = masked.as_slice();
    let context = line_context(line);
    let mut index = 0;
    while index < bytes.len() {
        let (embed, wiki_start) = if bytes.get(index..index + 3) == Some(b"![[") {
            (true, index + 1)
        } else if bytes.get(index..index + 2) == Some(b"[[") {
            (false, index)
        } else {
            (false, usize::MAX)
        };
        if wiki_start != usize::MAX {
            let body_start = line_start + wiki_start + 2;
            let mut close = wiki_start + 2;
            while close + 1 < bytes.len() && bytes[close..close + 2] != *b"]]" {
                close += 1;
            }
            if close + 1 < bytes.len() {
                if let Some(link) = parse_wikilink(
                    source,
                    source_path,
                    body_start,
                    line_start + close,
                    embed,
                    line_no,
                    context.clone(),
                ) {
                    out.push(link);
                }
                index = close + 2;
                continue;
            }
        }

        let (embed, open) = if bytes.get(index..index + 2) == Some(b"![") {
            (true, index + 1)
        } else if bytes.get(index..index + 1) == Some(b"[") {
            (false, index)
        } else {
            index += 1;
            continue;
        };
        if bytes.get(open + 1) == Some(&b'[') {
            index += 1;
            continue;
        }
        let mut label_end = open + 1;
        while label_end < bytes.len() && bytes[label_end] != b']' {
            label_end += 1;
        }
        if label_end + 1 >= bytes.len() || bytes[label_end + 1] != b'(' {
            index += 1;
            continue;
        }
        let mut destination_end = label_end + 2;
        while destination_end < bytes.len() && bytes[destination_end] != b')' {
            destination_end += 1;
        }
        if destination_end >= bytes.len() {
            index += 1;
            continue;
        }
        let occurrence_context = LinkOccurrenceContext {
            source_path,
            embed,
            line: line_no,
            context: context.clone(),
        };
        if let Some(link) = parse_markdown_link(
            source,
            line_start + open + 1,
            line_start + label_end,
            line_start + label_end + 2,
            line_start + destination_end,
            &occurrence_context,
        ) {
            out.push(link);
        }
        index = destination_end + 1;
    }
}

/// Parse one Markdown document into anchors plus explicit internal link occurrences.
pub fn extract_document(
    source_path: &str,
    markdown: &str,
) -> (WikiDocument, Vec<InternalLinkOccurrence>) {
    let (frontmatter_end, aliases) = parse_frontmatter_aliases(markdown);
    let mut headings = Vec::new();
    let mut blocks = Vec::new();
    let mut occurrences = Vec::new();
    let mut heading_stack: Vec<Option<String>> = vec![None; 6];
    let mut in_fence = false;
    let mut byte_start = 0;

    for (line_index, line) in markdown.split_inclusive('\n').enumerate() {
        let content = line
            .strip_suffix('\n')
            .unwrap_or(line)
            .strip_suffix('\r')
            .unwrap_or(line);
        let line_no = (line_index + 1) as u32;
        let trimmed = content.trim_start();
        if byte_start < frontmatter_end {
            byte_start += line.len();
            continue;
        }
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            byte_start += line.len();
            continue;
        }
        if !in_fence {
            if let Some((level, text)) = parse_heading(content) {
                heading_stack.truncate(level);
                while heading_stack.len() < level {
                    heading_stack.push(None);
                }
                heading_stack[level - 1] = Some(text.clone());
                let path = heading_stack.iter().flatten().cloned().collect::<Vec<_>>();
                headings.push(HeadingAnchor {
                    text,
                    path,
                    line: line_no,
                });
            }
            collect_block_ids(content, line_no, &mut blocks);
            extract_line_links(
                markdown,
                source_path,
                byte_start,
                content,
                line_no,
                &mut occurrences,
            );
        }
        byte_start += line.len();
    }

    (
        WikiDocument {
            path: source_path.to_string(),
            aliases,
            headings,
            blocks,
        },
        occurrences,
    )
}

/// Legacy helper kept for focused callers/tests that only need link extraction.
pub fn extract_wikilinks(markdown: &str) -> Vec<InternalLinkOccurrence> {
    extract_document("", markdown).1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_semantic_wikilinks_and_markdown_links() {
        let source = "---\naliases:\n  - Research note\n---\n# Root\n## Child\nText [[#Root#Child|jump]] and ![[other#^summary]].\n[relative](../notes/a.md#Root).\nBlock ^summary\n中文块 ^验收块\n";
        let (document, links) = extract_document("notes/source.md", source);
        assert_eq!(document.aliases, vec!["Research note"]);
        assert_eq!(document.headings[1].path, vec!["Root", "Child"]);
        assert_eq!(document.blocks[0].id, "summary");
        assert_eq!(document.blocks[1].id, "验收块");
        assert_eq!(links.len(), 3);
        assert!(matches!(
            links[0].fragment,
            Some(LinkFragment::Heading { .. })
        ));
        assert!(links[1].embed);
        assert!(matches!(links[2].syntax, InternalLinkSyntax::Markdown));
    }

    #[test]
    fn skips_code_and_external_links() {
        let source = "`[[inline]]` [web](https://example.com)\n```md\n[[fenced]]\n```\n[[live]] [same](#Heading)\n";
        let (_, links) = extract_document("notes/source.md", source);
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].target_raw, "live");
        assert!(links[1].target_raw.is_empty());
    }

    #[test]
    fn accepts_same_file_block_fragments() {
        let (_, links) = extract_document("notes/source.md", "[[#^summary]]");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target_raw, "");
        assert!(matches!(
            links[0].fragment,
            Some(LinkFragment::Block { .. })
        ));
    }

    #[test]
    fn preserves_invalid_block_fragments_for_resolution() {
        let (_, links) =
            extract_document("notes/source.md", "[[#^bad id]] and [[Target#^also-bad!]]");

        assert_eq!(links.len(), 2);
        assert_eq!(links[0].target_raw, "");
        assert_eq!(links[1].target_raw, "Target");
        assert!(matches!(
            links[0].fragment,
            Some(LinkFragment::Block { ref id }) if id == "bad id"
        ));
        assert!(matches!(
            links[1].fragment,
            Some(LinkFragment::Block { ref id }) if id == "also-bad!"
        ));
    }

    #[test]
    fn accepts_unicode_letters_and_numbers_in_block_ids() {
        assert!(is_valid_block_id("验收块-2"));
        assert!(is_valid_block_id("résumé-3"));
        assert!(!is_valid_block_id("bad id"));
        assert!(!is_valid_block_id("emoji-🔗"));
    }
}
