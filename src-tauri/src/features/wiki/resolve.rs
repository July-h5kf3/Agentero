//! Resolve wikilink targets to vault-relative paths (Obsidian-ish).

use std::path::Path;

/// Normalize to vault-relative forward-slash path (no leading `./`).
pub fn normalize_rel(path: &str) -> String {
    let p = path.replace('\\', "/");
    let p = p.trim_start_matches("./");
    p.trim_matches('/').to_string()
}

fn stem_of(path: &str) -> String {
    Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

fn file_name_of(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

/// Resolve `target_raw` against the set of vault-relative Markdown paths.
///
/// Order:
/// 1. Exact path (with optional `.md` / `.mdx` / `.markdown`)
/// 2. Case-insensitive exact
/// 3. Unique path-suffix match (`…/target` or `…/target.md`)
/// 4. Unique file-stem match (note name)
pub fn resolve_target(target_raw: &str, vault_files: &[String]) -> Option<String> {
    let t = normalize_rel(target_raw.trim());
    if t.is_empty() || vault_files.is_empty() {
        return None;
    }

    let candidates = [
        t.clone(),
        format!("{t}.md"),
        format!("{t}.mdx"),
        format!("{t}.markdown"),
    ];

    // 1. Exact
    for c in &candidates {
        if let Some(f) = vault_files.iter().find(|f| *f == c) {
            return Some(f.clone());
        }
    }

    // 2. Case-insensitive exact
    for c in &candidates {
        if let Some(f) = vault_files.iter().find(|f| f.eq_ignore_ascii_case(c)) {
            return Some(f.clone());
        }
    }

    // 3. Suffix: ends with /target or /target.md etc.
    let mut suffix_hits: Vec<&String> = Vec::new();
    for c in &candidates {
        let needle = format!("/{c}");
        for f in vault_files {
            if (f == c || f.ends_with(&needle)) && !suffix_hits.contains(&f) {
                suffix_hits.push(f);
            }
        }
    }
    if suffix_hits.len() == 1 {
        return Some(suffix_hits[0].clone());
    }
    if suffix_hits.len() > 1 {
        // Ambiguous (e.g. two NOTES.md) — require a more specific path.
        return None;
    }

    // 4. Unique stem match (basename without extension)
    let want_stem = stem_of(&t);
    let want_name = file_name_of(&t);
    let mut stem_hits: Vec<&String> = Vec::new();
    for f in vault_files {
        let fs = stem_of(f);
        let fnm = file_name_of(f);
        if fs.eq_ignore_ascii_case(&want_stem)
            || fnm.eq_ignore_ascii_case(&want_name)
            || fnm.eq_ignore_ascii_case(&format!("{want_stem}.md"))
        {
            stem_hits.push(f);
        }
    }
    if stem_hits.len() == 1 {
        return Some(stem_hits[0].clone());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files() -> Vec<String> {
        vec![
            "PAPERS.md".into(),
            "notes/idea.md".into(),
            "papers/1706.03762/NOTES.md".into(),
            "papers/other/NOTES.md".into(),
        ]
    }

    #[test]
    fn resolve_explicit_path() {
        let f = files();
        assert_eq!(
            resolve_target("papers/1706.03762/NOTES", &f).as_deref(),
            Some("papers/1706.03762/NOTES.md")
        );
        assert_eq!(
            resolve_target("papers/1706.03762/NOTES.md", &f).as_deref(),
            Some("papers/1706.03762/NOTES.md")
        );
    }

    #[test]
    fn resolve_unique_stem() {
        let f = files();
        assert_eq!(resolve_target("idea", &f).as_deref(), Some("notes/idea.md"));
        assert_eq!(resolve_target("PAPERS", &f).as_deref(), Some("PAPERS.md"));
    }

    #[test]
    fn resolve_ambiguous_stem_is_none() {
        let f = files();
        // two NOTES.md
        assert!(resolve_target("NOTES", &f).is_none());
    }
}
