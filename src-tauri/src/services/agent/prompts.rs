/// Build a workflow-oriented prompt. Vault-relative guidance is progressive-disclosure oriented.
pub fn build_prompt(workflow: Option<&str>, user_prompt: &str, target: Option<&str>) -> String {
    let workflow = workflow.unwrap_or("free");
    let target_line = target
        .map(|t| format!("Target path (Vault-relative): `{t}`\n"))
        .unwrap_or_default();

    let system = match workflow {
        "summary" => {
            "You are helping with a research vault. Summarize the target paper using \
             progressive disclosure: AGENTS.md → PAPERS.md → NOTES.md → highlights.md → \
             PAPER.md → source/. Keep [[wikilinks]]. End with a `## Sources` list of Vault-relative paths you read."
        }
        "qa" => {
            "You are answering questions about a local research vault. Read only what you need \
             (AGENTS.md → PAPERS.md → NOTES.md → …). Cite local paths. End with `## Sources`."
        }
        "related_work" => {
            "Draft a Related Work section from local papers in this Vault. Prefer NOTES.md and \
             PAPERS.md; open PAPER.md/source only when needed. Keep [[wikilinks]] and end with `## Sources`."
        }
        _ => {
            "You are an assistant working inside a Motif research Vault (cwd is the vault root). \
             Prefer progressive disclosure of local Markdown. End substantial answers with `## Sources`."
        }
    };

    format!("{system}\n\n{target_line}User request:\n{user_prompt}")
}

/// Best-effort extraction of local paths from agent text (Sources section or bare paths).
pub fn extract_sources(content: &str) -> Vec<String> {
    let mut sources = Vec::new();
    let mut in_sources = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.eq_ignore_ascii_case("## sources")
            || trimmed.starts_with("读取文件")
            || trimmed.eq_ignore_ascii_case("sources:")
        {
            in_sources = true;
            continue;
        }
        if in_sources {
            if trimmed.starts_with('#') {
                break;
            }
            let cleaned = trimmed
                .trim_start_matches(['-', '*', '•', '`'])
                .trim_end_matches('`')
                .trim();
            if cleaned.is_empty() {
                continue;
            }
            if cleaned.contains('/') || cleaned.ends_with(".md") || cleaned.ends_with(".tex") {
                sources.push(cleaned.to_string());
            }
        }
    }
    sources
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_sources_section() {
        let text = "Answer here.\n\n## Sources\n- papers/a/NOTES.md\n- PAPERS.md\n";
        let s = extract_sources(text);
        assert!(s.iter().any(|p| p.contains("NOTES.md")));
        assert!(s.iter().any(|p| p == "PAPERS.md"));
    }

    #[test]
    fn build_prompt_includes_user() {
        let p = build_prompt(Some("qa"), "What is attention?", Some("papers/x/NOTES.md"));
        assert!(p.contains("What is attention?"));
        assert!(p.contains("papers/x/NOTES.md"));
    }
}
