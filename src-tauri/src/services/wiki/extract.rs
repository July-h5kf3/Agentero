//! Extract `[[wikilink]]` tokens from Markdown, skipping fenced and inline code.

use crate::models::wiki::ExtractedWikilink;

/// Parse one `[[...]]` body into target / optional heading / optional alias.
///
/// Obsidian order: `target#heading|alias`
fn parse_link_body(body: &str) -> Option<(String, Option<String>, Option<String>)> {
    let body = body.trim();
    if body.is_empty() {
        return None;
    }

    let (main, alias) = match body.split_once('|') {
        Some((m, a)) => {
            let a = a.trim();
            (
                m.trim(),
                if a.is_empty() {
                    None
                } else {
                    Some(a.to_string())
                },
            )
        }
        None => (body, None),
    };

    if main.is_empty() {
        return None;
    }

    let (target, heading) = match main.split_once('#') {
        Some((t, h)) => {
            let t = t.trim();
            let h = h.trim();
            if t.is_empty() {
                return None;
            }
            (
                t.to_string(),
                if h.is_empty() {
                    None
                } else {
                    Some(h.to_string())
                },
            )
        }
        None => (main.to_string(), None),
    };

    Some((target, heading, alias))
}

/// Replace inline `` `code` `` spans with spaces (same char count) so indices stay aligned.
fn mask_inline_code(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '`' {
            let start = i;
            i += 1;
            while i < chars.len() && chars[i] != '`' {
                i += 1;
            }
            if i < chars.len() {
                for _ in start..=i {
                    out.push(' ');
                }
                i += 1;
            } else {
                for _ in start..chars.len() {
                    out.push(' ');
                }
                break;
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

/// Extract all wikilinks from Markdown source text.
pub fn extract_wikilinks(md: &str) -> Vec<ExtractedWikilink> {
    let mut results = Vec::new();
    let mut in_fence = false;

    for (idx, line) in md.lines().enumerate() {
        let line_no = (idx + 1) as u32;
        let trimmed = line.trim_start();

        // Fenced code blocks (``` or ~~~)
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }

        let searchable = mask_inline_code(line);
        let chars: Vec<char> = searchable.chars().collect();
        let orig: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i + 1 < chars.len() {
            if chars[i] == '[' && chars[i + 1] == '[' {
                let mut j = i + 2;
                while j + 1 < chars.len() {
                    if chars[j] == ']' && chars[j + 1] == ']' {
                        let body: String = orig[i + 2..j].iter().collect();
                        if let Some((target_raw, heading, alias)) = parse_link_body(&body) {
                            let context = {
                                let t = line.trim();
                                if t.is_empty() {
                                    None
                                } else {
                                    Some(t.to_string())
                                }
                            };
                            results.push(ExtractedWikilink {
                                target_raw,
                                alias,
                                heading,
                                line: Some(line_no),
                                context,
                            });
                        }
                        i = j + 2;
                        break;
                    }
                    j += 1;
                }
                if j + 1 >= chars.len() {
                    // unclosed [[ — stop scanning this line
                    break;
                }
            } else {
                i += 1;
            }
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_simple_link() {
        let links = extract_wikilinks("See [[Note]] today.");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target_raw, "Note");
        assert!(links[0].alias.is_none());
        assert_eq!(links[0].line, Some(1));
    }

    #[test]
    fn extracts_path_alias_heading() {
        let links = extract_wikilinks("[[papers/1706.03762/NOTES#Summary|Attention]]");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target_raw, "papers/1706.03762/NOTES");
        assert_eq!(links[0].heading.as_deref(), Some("Summary"));
        assert_eq!(links[0].alias.as_deref(), Some("Attention"));
    }

    #[test]
    fn skips_fenced_code() {
        let md = "Before [[A]]\n```\n[[B]]\n```\nAfter [[C]]\n";
        let links = extract_wikilinks(md);
        let targets: Vec<_> = links.iter().map(|l| l.target_raw.as_str()).collect();
        assert_eq!(targets, vec!["A", "C"]);
    }

    #[test]
    fn skips_inline_code() {
        let links = extract_wikilinks("Use `[[fake]]` but keep [[real]].");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].target_raw, "real");
    }

    #[test]
    fn multiple_on_same_line() {
        let links = extract_wikilinks("[[one]] and [[two]]");
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].target_raw, "one");
        assert_eq!(links[1].target_raw, "two");
    }

    #[test]
    fn empty_body_ignored() {
        assert!(extract_wikilinks("[[]] [[  ]]").is_empty());
    }
}
