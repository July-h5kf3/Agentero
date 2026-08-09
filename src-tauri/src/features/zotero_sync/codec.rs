//! MD↔HTML conversion and Agentero sync-marker blocks for Zotero note sync.
//!
//! Pushed notes are wrapped in HTML comment markers so subsequent syncs can
//! recognize (and replace) Agentero-owned content inside Zotero without ever
//! touching user-written notes.
//!
//! Zotero 7 format requirement (verified against a real library): rich-text
//! notes must carry the `<div class="zotero-note znv1">` wrapper, otherwise
//! Zotero treats the content as a legacy *plain-text* note — displaying our
//! HTML tags literally and escaping them (`&lt;p&gt;`) on the next save,
//! which destroys the markers.

/// Opening marker prefix: `<!-- agentero:sync paper=<id> -->`.
const MARKER_OPEN_PREFIX: &str = "<!-- agentero:sync paper=";
const MARKER_OPEN_SUFFIX: &str = " -->";
/// Closing marker.
pub const MARKER_CLOSE: &str = "<!-- /agentero:sync -->";

/// Signature shared by every marker form — raw HTML, Zotero-escaped
/// (`&lt;!-- agentero:sync paper=…`), Markdown-escaped (`\<!-- …`) or worse:
/// only angle brackets and dashes ever get escaped, the paper-id part stays
/// intact. Anything containing this signature is Agentero sync content.
pub const SYNC_SIGNATURE: &str = "agentero:sync paper=";

/// Wrap converted HTML with sync markers for the given paper id, inside the
/// Zotero 7 rich-note wrapper so the editor renders (and preserves) it as
/// HTML instead of treating it as legacy plain text.
pub fn wrap_sync_html(paper_id: &str, html: &str) -> String {
    format!(
        "<div class=\"zotero-note znv1\"><div data-schema-version=\"9\">\
         {MARKER_OPEN_PREFIX}{paper_id}{MARKER_OPEN_SUFFIX}\n{}\n{MARKER_CLOSE}\
         </div></div>",
        html.trim()
    )
}

/// True when the note HTML carries a complete Agentero sync marker pair.
pub fn is_sync_marked(html: &str) -> bool {
    html.contains(MARKER_OPEN_PREFIX) && html.contains(MARKER_CLOSE)
}

/// True for anything that is (or was) Agentero sync content, in any damage
/// state: intact markers, Zotero-escaped markers, or Markdown-escaped leaked
/// blocks inside NOTES.md. Used to never re-import our own pushed notes.
pub fn looks_like_sync_note(text: &str) -> bool {
    text.contains(SYNC_SIGNATURE)
}

/// Remove leaked sync blocks from a NOTES.md. A leaked block is a
/// `---`-separated segment carrying the sync signature (our own pushed note
/// pulled back in a previous, broken round). Frontmatter and every segment
/// without the signature are preserved verbatim. No-op on clean files.
pub fn strip_leaked_sync_blocks(md: &str) -> String {
    if !looks_like_sync_note(md) {
        return md.to_string();
    }
    // Keep frontmatter verbatim; only the body is segmented.
    let (front, body) = split_off_frontmatter(md);
    let mut segments: Vec<String> = vec![String::new()];
    let mut in_fence = false;
    for line in body.split_inclusive('\n') {
        let trimmed = line.trim();
        let is_fence = trimmed.starts_with("```") || trimmed.starts_with("~~~");
        if is_fence {
            in_fence = !in_fence;
        }
        if !in_fence && !is_fence && trimmed == "---" {
            segments.push(String::new());
        } else if let Some(last) = segments.last_mut() {
            last.push_str(line);
        }
    }
    let kept: Vec<&str> = segments
        .iter()
        .map(|s| s.trim_matches(['\r', '\n']))
        .filter(|s| !s.is_empty() && !looks_like_sync_note(s))
        .collect();
    let mut out = front;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    if !kept.is_empty() {
        out.push_str(&kept.join("\n\n---\n\n"));
        out.push('\n');
    }
    out
}

/// Split a document into (frontmatter including fences, rest). When there is
/// no frontmatter the first element is empty.
fn split_off_frontmatter(md: &str) -> (String, String) {
    let trimmed = md.trim_start_matches('\u{feff}');
    let lead = &md[..md.len() - trimmed.len()];
    let Some(rest) = trimmed.strip_prefix("---") else {
        return (String::new(), md.to_string());
    };
    let Some(rest2) = rest.strip_prefix(['\n', '\r']) else {
        return (String::new(), md.to_string());
    };
    let mut search = rest2;
    loop {
        if let Some(after) = search.strip_prefix("---") {
            if after.is_empty() || after.starts_with('\n') || after.starts_with('\r') {
                let split = md.len() - after.len();
                let (front, body) = md.split_at(split);
                return (
                    format!("{lead}{front}"),
                    body.trim_start_matches(['\r', '\n']).to_string(),
                );
            }
        }
        let Some(idx) = search.find("\n---") else {
            return (String::new(), md.to_string());
        };
        let after = &search[idx + 4..];
        if after.is_empty() || after.starts_with('\n') || after.starts_with('\r') {
            let split = md.len() - after.len();
            let (front, body) = md.split_at(split);
            return (
                format!("{lead}{front}"),
                body.trim_start_matches(['\r', '\n']).to_string(),
            );
        }
        search = &search[idx + 1..];
    }
}

/// Extract the paper id embedded in a marked note, if any.
pub fn marked_paper_id(html: &str) -> Option<String> {
    let start = html.find(MARKER_OPEN_PREFIX)? + MARKER_OPEN_PREFIX.len();
    let rest = &html[start..];
    let end = rest.find(MARKER_OPEN_SUFFIX)?;
    let id = rest[..end].trim();
    if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    }
}

/// Inner HTML between the markers (for idempotent replace decisions).
pub fn marked_inner_html(html: &str) -> Option<String> {
    let start = html.find(MARKER_OPEN_PREFIX)?;
    let open_end = html[start..].find(MARKER_OPEN_SUFFIX)? + start + MARKER_OPEN_SUFFIX.len();
    let close_start = html[open_end..].find(MARKER_CLOSE)? + open_end;
    Some(html[open_end..close_start].trim().to_string())
}

/// Markdown → HTML fragment (basic blocks + tables + strikethrough; wikilinks
/// and math stay plain text, which is acceptable inside a Zotero note).
pub fn markdown_to_html(md: &str) -> String {
    use pulldown_cmark::{html, Options, Parser};
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    let parser = Parser::new_ext(md, opts);
    let mut out = String::new();
    html::push_html(&mut out, parser);
    out
}

/// Vault Markdown → Zotero-friendly HTML. Zotero notes are rich-text HTML and
/// already carry title/abstract as item fields, so the vault note must be
/// cleaned before conversion or it reads as garbage: the paper shell (title +
/// abstract) and the `---` separators would render as a redundant heading,
/// blockquote and horizontal rules; YAML frontmatter, callout markers,
/// wikilinks and htmd's zero-width spaces would stay literal.
pub fn markdown_to_zotero_html(md: &str) -> String {
    let body = strip_frontmatter(md);
    let body = strip_shell(&body);
    let body = strip_hr_separators(&body);
    let body = strip_invisible(&body);
    let body = convert_callouts(&body);
    let body = convert_wikilinks(&body);
    let body = body.trim().to_string();
    markdown_to_html(&body)
}

/// Drop the paper shell — the title heading + abstract blockquote that Zotero
/// already stores as item fields. Prefer the first `---` separator written by
/// the shell/append logic as the shell boundary; when there is none, strip the
/// intact shell shape (leading `# ` title + the blockquote right after it).
/// Anything that does not match the shell shape is left untouched.
fn strip_shell(md: &str) -> String {
    // Case 1: first `---` line outside code fences ends the shell.
    let mut offset = 0usize;
    let mut in_fence = false;
    for line in md.split_inclusive('\n') {
        let trimmed = line.trim();
        let is_fence = trimmed.starts_with("```") || trimmed.starts_with("~~~");
        if !in_fence && !is_fence && trimmed == "---" {
            let after = offset + line.len();
            return md[after..].trim_start_matches(['\r', '\n']).to_string();
        }
        if is_fence {
            in_fence = !in_fence;
        }
        offset += line.len();
    }
    // Case 2: no separator — strip the intact shell (leading title heading and
    // the abstract blockquote directly following it). Never touch anything
    // that does not start with the title heading.
    let lines: Vec<&str> = md.split_inclusive('\n').collect();
    let mut i = 0;
    while i < lines.len() && lines[i].trim().is_empty() {
        i += 1;
    }
    if i < lines.len() && lines[i].trim_start().starts_with("# ") {
        i += 1;
        while i < lines.len() && lines[i].trim().is_empty() {
            i += 1;
        }
        if i < lines.len() && lines[i].trim_start().starts_with('>') {
            while i < lines.len() && lines[i].trim_start().starts_with('>') {
                i += 1;
            }
        }
        let consumed: usize = lines[..i].iter().map(|l| l.len()).sum();
        return md[consumed..].trim_start_matches(['\r', '\n']).to_string();
    }
    md.to_string()
}

/// Remove standalone `---` horizontal-rule lines (Agentero's internal note
/// separators) so they do not become `<hr />` clutter in the Zotero note.
/// Lines inside code fences are preserved.
fn strip_hr_separators(md: &str) -> String {
    let mut out = String::with_capacity(md.len());
    let mut in_fence = false;
    for line in md.split_inclusive('\n') {
        let trimmed = line.trim();
        let is_fence = trimmed.starts_with("```") || trimmed.starts_with("~~~");
        if !in_fence && !is_fence && trimmed == "---" {
            continue;
        }
        if is_fence {
            in_fence = !in_fence;
        }
        out.push_str(line);
    }
    out
}

/// Strip invisible characters htmd and friends leave behind (zero-width space,
/// BOM, zero-width non-joiner/joiner, word joiner) — they show up as empty
/// `<p></p>` noise in Zotero.
fn strip_invisible(md: &str) -> String {
    md.chars()
        .filter(|c| {
            !matches!(
                c,
                '\u{200b}' | '\u{feff}' | '\u{200c}' | '\u{200d}' | '\u{2060}'
            )
        })
        .collect()
}

/// Drop a leading YAML frontmatter block (`---\n…\n---`).
fn strip_frontmatter(md: &str) -> String {
    let trimmed = md.trim_start_matches('\u{feff}');
    let Some(rest) = trimmed.strip_prefix("---") else {
        return md.to_string();
    };
    // The opening fence must be on its own line.
    let Some(rest) = rest.strip_prefix(['\n', '\r']) else {
        return md.to_string();
    };
    // Find the next fence that sits at the start of its own line.
    let mut search = rest;
    loop {
        // A fence right at the start covers the empty-frontmatter case.
        if let Some(after) = search.strip_prefix("---") {
            if after.is_empty() || after.starts_with('\n') || after.starts_with('\r') {
                return after.trim_start_matches(['\r', '\n']).to_string();
            }
        }
        let Some(idx) = search.find("\n---") else {
            return md.to_string();
        };
        let after = &search[idx + 4..];
        if after.is_empty() || after.starts_with('\n') || after.starts_with('\r') {
            return after.trim_start_matches(['\r', '\n']).to_string();
        }
        // `---` with content on the same line is not a closing fence.
        search = &search[idx + 1..];
    }
}

/// `> [!type] Optional title` → `> **Type** Optional title` (plain bold
/// label reads naturally in Zotero; foldable +/- markers are dropped).
fn convert_callouts(md: &str) -> String {
    let mut out = String::with_capacity(md.len());
    for line in md.split_inclusive('\n') {
        let stripped = line.trim_end_matches(['\n', '\r']);
        let rest = match stripped.strip_prefix('>') {
            Some(r) => r.trim_start(),
            None => {
                out.push_str(line);
                continue;
            }
        };
        let Some(marker) = rest.strip_prefix("[!") else {
            out.push_str(line);
            continue;
        };
        let Some(end) = marker.find(']') else {
            out.push_str(line);
            continue;
        };
        let ty = &marker[..end];
        if ty.is_empty() || !ty.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            out.push_str(line);
            continue;
        }
        let tail = marker[end + 1..]
            .trim_start_matches(['+', '-'])
            .trim_start();
        let mut label = ty.to_ascii_lowercase();
        if let Some(first) = label.get_mut(0..1) {
            first.make_ascii_uppercase();
        }
        let newline = &line[stripped.len()..];
        if tail.is_empty() {
            out.push_str(&format!("> **{label}**{newline}"));
        } else {
            out.push_str(&format!("> **{label}** {tail}{newline}"));
        }
    }
    out
}

/// `[[Target|Label]]` → `Label`; `[[Target#Heading]]` / `[[Target]]` → `Target`.
/// Embed syntax `![[file]]` loses its dangling `!` too.
fn convert_wikilinks(md: &str) -> String {
    let mut out = String::with_capacity(md.len());
    let mut rest = md;
    while let Some(start) = rest.find("[[") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find("]]") {
            Some(end) => {
                // `![[embed]]` → drop the embed prefix's `!` as well.
                if out.ends_with('!') {
                    out.pop();
                }
                let inner = &after[..end];
                let display = inner
                    .split('|')
                    .next_back()
                    .unwrap_or(inner)
                    .split('#')
                    .next()
                    .unwrap_or(inner)
                    .trim();
                if display.is_empty() {
                    out.push_str(inner.trim());
                } else {
                    out.push_str(display);
                }
                rest = &after[end + 2..];
            }
            None => {
                out.push_str("[[");
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// HTML → Markdown (same converter as migration, keeps pull/push symmetric).
pub fn html_to_markdown(html: &str) -> String {
    htmd::convert(html)
        .unwrap_or_else(|_| html.to_string())
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_round_trip() {
        let html = wrap_sync_html("1706.03762", "<p>hello</p>");
        assert!(is_sync_marked(&html));
        assert_eq!(marked_paper_id(&html).as_deref(), Some("1706.03762"));
        assert_eq!(marked_inner_html(&html).as_deref(), Some("<p>hello</p>"));
    }

    #[test]
    fn wrap_uses_zotero7_rich_note_format() {
        // Without the znv1 wrapper Zotero treats the note as legacy plain
        // text and displays/escapes our HTML literally (verified against a
        // real library). This format is load-bearing — do not remove.
        let html = wrap_sync_html("x", "<p>hello</p>");
        assert!(
            html.starts_with("<div class=\"zotero-note znv1\"><div data-schema-version=\"9\">"),
            "got: {html}"
        );
        assert!(html.ends_with("</div></div>"), "got: {html}");
        assert!(looks_like_sync_note(&html));
    }

    #[test]
    fn sync_signature_survives_every_escape_form() {
        // Raw markers.
        assert!(looks_like_sync_note(
            "<!-- agentero:sync paper=2210.03629 -->\n<p>x</p>"
        ));
        // Zotero-escaped (legacy plain-text treatment).
        assert!(looks_like_sync_note(
            "<div class=\"zotero-note znv1\"><p>&lt;!-- agentero:sync paper=2210.03629 --&gt;</p></div>"
        ));
        // Markdown-escaped leak inside NOTES.md (htmd output).
        assert!(looks_like_sync_note(
            "\\<!-- agentero:sync paper=2210.03629 -->\n\n\\<h1>Title\\</h1>"
        ));
        // Double-escaped recursion.
        assert!(looks_like_sync_note(
            "&amp;lt;!-- agentero:sync paper=2210.03629 --&amp;gt;"
        ));
        // Genuine user notes never match.
        assert!(!looks_like_sync_note("my reading notes about sync paper=1"));
    }

    #[test]
    fn strip_leaked_blocks_keeps_user_content_and_frontmatter() {
        let md = "---\naliases: [x]\n---\n\n# T\n\n> abs\n\n---\n\nmy real note\n\n---\n\n\\<!-- agentero:sync paper=2210.03629 -->\n\n\\<h1>ReAct\\</h1>\n\n\\<blockquote>\n\n\\<p>garbage\\</p>\n";
        let cleaned = strip_leaked_sync_blocks(md);
        assert!(!looks_like_sync_note(&cleaned), "got: {cleaned}");
        assert!(
            cleaned.starts_with("---\naliases: [x]\n---"),
            "got: {cleaned}"
        );
        assert!(cleaned.contains("# T"), "got: {cleaned}");
        assert!(cleaned.contains("my real note"), "got: {cleaned}");
        assert!(!cleaned.contains("garbage"), "got: {cleaned}");
    }

    #[test]
    fn strip_leaked_blocks_is_noop_on_clean_files() {
        let md = "---\naliases: [x]\n---\n\n# T\n\n> abs\n\n---\n\nnote with --- dashes\n";
        assert_eq!(strip_leaked_sync_blocks(md), md);
    }

    #[test]
    fn strip_leaked_blocks_handles_multi_segment_garbage() {
        // Garbage whose own round-trips contain `---` lines: every segment
        // still carries the signature, so all of it goes.
        let md = "# T\n\nuser\n\n---\n\n\\<!-- agentero:sync paper=a -->\n\npart1\n\n---\n\nagentero:sync paper=a part2\n";
        let cleaned = strip_leaked_sync_blocks(md);
        assert!(cleaned.contains("user"), "got: {cleaned}");
        assert!(!cleaned.contains("part1"), "got: {cleaned}");
        assert!(!cleaned.contains("part2"), "got: {cleaned}");
    }

    #[test]
    fn unmarked_notes_are_not_ours() {
        assert!(!is_sync_marked("<p>user note</p>"));
        assert!(marked_paper_id("<p>user note</p>").is_none());
        // Partial markers are not treated as ours.
        assert!(!is_sync_marked("<!-- agentero:sync paper=x -->"));
    }

    #[test]
    fn markdown_to_html_basic_blocks() {
        let html = markdown_to_html("## Title\n\nsome **bold** text\n\n- item");
        assert!(html.contains("<h2>Title</h2>"), "got: {html}");
        assert!(html.contains("<strong>bold</strong>"), "got: {html}");
        assert!(html.contains("<li>item</li>"), "got: {html}");
    }

    #[test]
    fn html_to_markdown_preserves_text() {
        let md = html_to_markdown("<p>keep <strong>this</strong></p>");
        assert!(md.contains("keep"), "got: {md}");
        assert!(md.contains("this"), "got: {md}");
    }

    #[test]
    fn push_pull_content_round_trip() {
        // What push writes, pull must be able to read back as equivalent MD.
        let source = "## Notes\n\n- a finding\n- another one";
        let html = wrap_sync_html("x", &markdown_to_html(source));
        let back = html_to_markdown(&marked_inner_html(&html).unwrap());
        assert!(back.contains("a finding"), "got: {back}");
        assert!(back.contains("another one"), "got: {back}");
    }

    #[test]
    fn zotero_html_drops_frontmatter() {
        let md = "---\naliases: [foo, bar]\ntags: [nlp]\n---\n\n# Title\n\nbody";
        let html = markdown_to_zotero_html(md);
        assert!(!html.contains("aliases"), "got: {html}");
        assert!(!html.contains("<hr"), "got: {html}");
        // The leading title heading is shell (Zotero has a title field).
        assert!(!html.contains("<h1>Title</h1>"), "got: {html}");
        assert!(html.contains("body"), "got: {html}");
    }

    #[test]
    fn zotero_html_converts_callouts_and_wikilinks() {
        let md =
            "> [!abstract] My summary\n> more\n\nsee [[Other Paper]] and [[P|别名]] and [[P#Sec]]";
        let html = markdown_to_zotero_html(md);
        assert!(
            html.contains("<strong>Abstract</strong> My summary"),
            "got: {html}"
        );
        assert!(!html.contains("[!"), "got: {html}");
        assert!(html.contains("Other Paper"), "got: {html}");
        assert!(html.contains("别名"), "got: {html}");
        assert!(!html.contains("[["), "got: {html}");
        assert!(!html.contains("#Sec"), "got: {html}");
    }

    #[test]
    fn zotero_html_drops_shell_and_separators() {
        // Real NOTES.md shape: frontmatter + title + abstract, then `---`,
        // then reading notes separated by more `---`.
        let md = "---\naliases: [x]\n---\n\n# Some Paper\n\n> the abstract\n\n---\n\nfirst note\n\n---\n\nsecond note";
        let html = markdown_to_zotero_html(md);
        // Shell (title + abstract) and every separator must be gone.
        assert!(!html.contains("Some Paper"), "got: {html}");
        assert!(!html.contains("the abstract"), "got: {html}");
        assert!(!html.contains("<hr"), "got: {html}");
        assert!(!html.contains("aliases"), "got: {html}");
        // The actual reading notes survive.
        assert!(html.contains("first note"), "got: {html}");
        assert!(html.contains("second note"), "got: {html}");
    }

    #[test]
    fn zotero_html_keeps_content_when_no_separator() {
        // No `---` separator: nothing is dropped (never lose user content).
        let md = "# Title\n\njust a note";
        let html = markdown_to_zotero_html(md);
        assert!(html.contains("just a note"), "got: {html}");
    }

    #[test]
    fn zotero_html_strips_invisible_chars() {
        let md = "---\n\nnote with\u{200b}zero-width\u{feff}spaces";
        let html = markdown_to_zotero_html(md);
        assert!(!html.contains('\u{200b}'), "got: {html}");
        assert!(!html.contains('\u{feff}'), "got: {html}");
        assert!(html.contains("note withzero-widthspaces"), "got: {html}");
    }

    #[test]
    fn realistic_notes_md_end_to_end() {
        let md = "---\naliases: [Attention, 注意力]\ntags: [nlp]\n---\n\n\
# Attention Is All You Need\n\n\
> 提出了 Transformer 架构。\n\n\
---\n\n\
> [!note] 精读\n> 自注意力避免了循环。\n\n\
参见 [[BERT]] 与 ![[fig1.png]]。\n\n\
---\n\n\
第二段笔记\u{200b}。";
        let html = markdown_to_zotero_html(md);
        // Shell and separators gone.
        assert!(!html.contains("Attention Is All You Need"), "got: {html}");
        assert!(!html.contains("提出了 Transformer"), "got: {html}");
        assert!(!html.contains("aliases"), "got: {html}");
        assert!(!html.contains("<hr"), "got: {html}");
        // Content kept and cleaned.
        assert!(html.contains("<strong>Note</strong>"), "got: {html}");
        assert!(html.contains("自注意力避免了循环"), "got: {html}");
        assert!(html.contains("BERT"), "got: {html}");
        assert!(!html.contains("[["), "got: {html}");
        assert!(!html.contains("!fig1"), "got: {html}");
        assert!(html.contains("fig1.png"), "got: {html}");
        assert!(!html.contains('\u{200b}'), "got: {html}");
        assert!(html.contains("第二段笔记。"), "got: {html}");
    }

    #[test]
    fn crlf_line_endings() {
        let md = "---\r\naliases: [a]\r\n---\r\n\r\n# T\r\n\r\n> abs\r\n\r\n---\r\n\r\nnote body";
        let html = markdown_to_zotero_html(md);
        assert!(!html.contains("aliases"), "got: {html}");
        assert!(!html.contains("<h1>T</h1>"), "got: {html}");
        assert!(!html.contains("abs"), "got: {html}");
        assert!(html.contains("note body"), "got: {html}");
    }

    #[test]
    fn code_fence_protects_separators() {
        // `---` inside a fenced code block must survive both the shell strip and
        // the hr removal.
        let md = "# T\n\n> abs\n\n```yaml\nkey: value\n---\nother: 1\n```\n\nafter fence";
        let html = markdown_to_zotero_html(md);
        // Shell stripped via the intact-shell fallback (no real separator).
        assert!(!html.contains("<h1>T</h1>"), "got: {html}");
        assert!(!html.contains("abs"), "got: {html}");
        // Code block content incl. its `---` survives.
        assert!(html.contains("key: value"), "got: {html}");
        assert!(html.contains("---"), "got: {html}");
        assert!(html.contains("other: 1"), "got: {html}");
        assert!(html.contains("after fence"), "got: {html}");
    }

    #[test]
    fn no_separator_strips_intact_shell_only() {
        // User typed notes directly after the abstract (no `---` yet).
        let md = "# Title\n\n> the abstract\n\nmy handwritten note";
        let html = markdown_to_zotero_html(md);
        assert!(!html.contains("<h1>Title</h1>"), "got: {html}");
        assert!(!html.contains("the abstract"), "got: {html}");
        assert!(html.contains("my handwritten note"), "got: {html}");
    }

    #[test]
    fn broken_shell_is_left_alone() {
        // User deleted the title: do not strip their leading blockquote.
        let md = "> my quote\n\nrest";
        let html = markdown_to_zotero_html(md);
        assert!(html.contains("my quote"), "got: {html}");
        assert!(html.contains("rest"), "got: {html}");
    }

    #[test]
    fn shell_only_cleans_to_empty() {
        // Fresh paper, no reading notes: push skips empty inner html.
        let md = "---\naliases: [x]\n---\n\n# Title\n\n> abstract only";
        let html = markdown_to_zotero_html(md);
        assert!(html.trim().is_empty(), "got: {html}");
    }

    #[test]
    fn embed_keeps_filename_without_bang() {
        let html = markdown_to_zotero_html("see ![[figure-2.png]] here");
        assert!(html.contains("figure-2.png"), "got: {html}");
        assert!(!html.contains("!figure"), "got: {html}");
        assert!(!html.contains("[["), "got: {html}");
    }
}
