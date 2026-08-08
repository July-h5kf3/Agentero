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
}
