//! MD↔HTML conversion and Agentero sync-marker blocks for Zotero note sync.
//!
//! Pushed notes are wrapped in HTML comment markers so subsequent syncs can
//! recognize (and replace) Agentero-owned content inside Zotero without ever
//! touching user-written notes.

/// Opening marker prefix: `<!-- agentero:sync paper=<id> -->`.
const MARKER_OPEN_PREFIX: &str = "<!-- agentero:sync paper=";
const MARKER_OPEN_SUFFIX: &str = " -->";
/// Closing marker.
pub const MARKER_CLOSE: &str = "<!-- /agentero:sync -->";

/// Wrap converted HTML with sync markers for the given paper id.
pub fn wrap_sync_html(paper_id: &str, html: &str) -> String {
    format!(
        "{MARKER_OPEN_PREFIX}{paper_id}{MARKER_OPEN_SUFFIX}\n{}\n{MARKER_CLOSE}",
        html.trim()
    )
}

/// True when the note HTML carries a complete Agentero sync marker pair.
pub fn is_sync_marked(html: &str) -> bool {
    html.contains(MARKER_OPEN_PREFIX) && html.contains(MARKER_CLOSE)
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
/// already stores as item fields. The shell always sits before the first `---`
/// separator written by the shell/append logic, so drop everything up to and
/// including that first separator. When there is no separator there is no
/// reading-note content yet, so leave the text untouched (never lose content).
fn strip_shell(md: &str) -> String {
    // Locate the first line that is exactly `---`.
    let mut offset = 0usize;
    for line in md.split_inclusive('\n') {
        if line.trim() == "---" {
            let after = offset + line.len();
            return md[after..].trim_start_matches(['\r', '\n']).to_string();
        }
        offset += line.len();
    }
    md.to_string()
}

/// Remove standalone `---` horizontal-rule lines (Agentero's internal note
/// separators) so they do not become `<hr />` clutter in the Zotero note.
fn strip_hr_separators(md: &str) -> String {
    let mut out = String::with_capacity(md.len());
    for line in md.split_inclusive('\n') {
        if line.trim() == "---" {
            continue;
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
fn convert_wikilinks(md: &str) -> String {
    let mut out = String::with_capacity(md.len());
    let mut rest = md;
    while let Some(start) = rest.find("[[") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find("]]") {
            Some(end) => {
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
        assert!(html.contains("<h1>Title</h1>"), "got: {html}");
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
}
