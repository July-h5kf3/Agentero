use crate::services::agent::skills::{format_skill_mention, SkillMentionStyle};

/// Build a workflow-oriented prompt. Vault-relative guidance is progressive-disclosure oriented.
///
/// `skill_style` / `skill_ids` shape wording for skill activation — different CLIs use
/// different triggers (Codex `$id`, Claude `/id`, others Motif-injected body only).
pub fn build_prompt(
    workflow: Option<&str>,
    user_prompt: &str,
    target: Option<&str>,
    skill_style: SkillMentionStyle,
    skill_ids: &[String],
    response_language: Option<&str>,
) -> String {
    let workflow = workflow.unwrap_or("free");
    let target_line = target
        .map(|t| format!("Target path (Vault-relative): `{t}`\n"))
        .unwrap_or_default();

    let skill_hint = skill_follow_hint(skill_style, skill_ids);

    let system = match workflow {
        "summary" => {
            format!(
                "You are helping with a research vault. Summarize the target paper using \
                 progressive disclosure: AGENTS.md → papers/<id>/NOTES.md → highlights.md → \
                 PAPER.md → source/ (there is usually no root PAPERS.md; paper list lives in the app catalog). \
                 Keep [[wikilinks]]. End with a `## Sources` list of Vault-relative paths you read.{skill_hint}"
            )
        }
        "paper_reader" => {
            let skill_line = paper_reader_skill_line(skill_style, skill_ids);
            format!(
                "You are running the Motif paper-reader workflow. {skill_line} \
                 Target is a paper folder under papers/. Prefer TeX under source/, else PAPER.md, \
                 else local PDF. Write structured lecture notes into that paper's NOTES.md. Keep [[wikilinks]]. \
                 End with `## Sources` of Vault-relative paths you read."
            )
        }
        "qa" => {
            format!(
                "You are answering questions about a local research vault. Read only what you need \
                 (AGENTS.md → papers/*/NOTES.md → …; root PAPERS.md is optional export only). \
                 Cite local paths. End with `## Sources`.{skill_hint}"
            )
        }
        "related_work" => {
            format!(
                "Draft a Related Work section from local papers in this Vault. Prefer each paper's NOTES.md \
                 under papers/; open PAPER.md/source only when needed. Keep [[wikilinks]] and end with `## Sources`.{skill_hint}"
            )
        }
        _ => {
            format!(
                "You are an assistant working inside a Motif research Vault (cwd is the vault root). \
                 Prefer progressive disclosure of local Markdown. End substantial answers with `## Sources`.{skill_hint}"
            )
        }
    };

    let system = format!("{system}{}", language_directive(response_language));

    format!("{system}\n\n{target_line}User request:\n{user_prompt}")
}

/// A trailing system instruction forcing the response/notes language.
/// Empty for unknown / `None` codes so `auto` keeps current behavior.
fn language_directive(code: Option<&str>) -> String {
    let name = match code {
        Some("zh-CN") => "Simplified Chinese (简体中文)",
        Some("en") => "English",
        _ => return String::new(),
    };
    format!(
        " Always write your entire response, including any notes saved to files, in {name}, \
         regardless of the language of the source material or this prompt."
    )
}

fn skill_follow_hint(style: SkillMentionStyle, skill_ids: &[String]) -> String {
    if skill_ids.is_empty() {
        return String::new();
    }
    let list = skill_ids
        .iter()
        .map(|id| format_skill_mention(id, style))
        .collect::<Vec<_>>()
        .join(", ");
    match style {
        SkillMentionStyle::Dollar => format!(
            " Active skills use the $ trigger on this agent ({list}); also honor any Motif-injected SKILL.md body."
        ),
        SkillMentionStyle::Slash => format!(
            " Active skills use the / trigger on this agent ({list}); also honor any Motif-injected SKILL.md body."
        ),
        SkillMentionStyle::InjectedOnly => format!(
            " Motif injects skill instructions for ({list}) into this prompt — follow them; do not expect a separate $ or / activation."
        ),
    }
}

fn paper_reader_skill_line(style: SkillMentionStyle, skill_ids: &[String]) -> String {
    let id = skill_ids
        .first()
        .map(|s| s.as_str())
        .unwrap_or("paper-reader");
    let mention = format_skill_mention(id, style);
    match style {
        SkillMentionStyle::Dollar => format!(
            "Activate the skill with `{mention}` (this agent uses the **$skill-id** syntax). \
             Follow that skill strictly; Motif also injects the full SKILL.md below if the runtime does not resolve it natively."
        ),
        SkillMentionStyle::Slash => format!(
            "Activate the skill with `{mention}` (this agent uses the **/skill-id** syntax). \
             Follow that skill strictly; Motif also injects the full SKILL.md below if the runtime does not resolve it natively."
        ),
        SkillMentionStyle::InjectedOnly => format!(
            "Follow the **paper-reader** skill instructions Motif injects in this prompt (label `{mention}`). \
             This agent does not use Motif Composer `$` as a runtime skill trigger — do not wait for a separate $ or / command."
        ),
    }
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
    use crate::services::agent::skills::SkillMentionStyle;

    #[test]
    fn extracts_sources_section() {
        let text = "Answer here.\n\n## Sources\n- papers/a/NOTES.md\n- PAPERS.md\n";
        let s = extract_sources(text);
        assert!(s.iter().any(|p| p.contains("NOTES.md")));
        assert!(s.iter().any(|p| p == "PAPERS.md"));
    }

    #[test]
    fn build_prompt_includes_user() {
        let p = build_prompt(
            Some("qa"),
            "What is attention?",
            Some("papers/x/NOTES.md"),
            SkillMentionStyle::InjectedOnly,
            &[],
            None,
        );
        assert!(p.contains("What is attention?"));
        assert!(p.contains("papers/x/NOTES.md"));
    }

    #[test]
    fn paper_reader_prompt_uses_dollar_for_codex_style() {
        let p = build_prompt(
            Some("paper_reader"),
            "Read this paper",
            Some("papers/1706.03762"),
            SkillMentionStyle::Dollar,
            &["paper-reader".into()],
            None,
        );
        assert!(p.contains("$paper-reader"));
        assert!(p.contains("$skill-id"));
        assert!(!p.contains("/paper-reader"));
    }

    #[test]
    fn paper_reader_prompt_uses_slash_for_claude_style() {
        let p = build_prompt(
            Some("paper_reader"),
            "Read this paper",
            Some("papers/1706.03762"),
            SkillMentionStyle::Slash,
            &["paper-reader".into()],
            None,
        );
        assert!(p.contains("/paper-reader"));
        assert!(p.contains("**/skill-id**") || p.contains("/skill-id"));
    }

    #[test]
    fn paper_reader_prompt_injected_only_avoids_false_dollar() {
        let p = build_prompt(
            Some("paper_reader"),
            "Read this paper",
            Some("papers/1706.03762"),
            SkillMentionStyle::InjectedOnly,
            &["paper-reader".into()],
            None,
        );
        assert!(p.contains("Motif injects") || p.contains("does not use Motif Composer `$`"));
        // Should not tell the agent to activate with $paper-reader as a runtime command
        assert!(!p.contains("Activate the skill with `$paper-reader`"));
    }

    #[test]
    fn response_language_injects_directive() {
        let p = build_prompt(
            Some("paper_reader"),
            "Read this paper",
            Some("papers/1706.03762"),
            SkillMentionStyle::InjectedOnly,
            &["paper-reader".into()],
            Some("zh-CN"),
        );
        assert!(p.contains("Simplified Chinese"));
        assert!(p.contains("Always write your entire response"));
    }

    #[test]
    fn response_language_none_adds_no_directive() {
        let p = build_prompt(
            Some("free"),
            "Hello",
            None,
            SkillMentionStyle::InjectedOnly,
            &[],
            None,
        );
        assert!(!p.contains("Always write your entire response"));
    }
}
