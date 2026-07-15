use crate::error::AppError;
use crate::models::agent::AgentSkill;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_SKILL_BYTES: u64 = 64 * 1024;
const MAX_SELECTED_SKILLS: usize = 5;

fn skill_roots(vault_path: Option<&str>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".agents/skills"));
        roots.push(
            std::env::var_os("CODEX_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".codex"))
                .join("skills"),
        );
    }
    if let Some(vault) = vault_path.map(Path::new).filter(|path| path.is_dir()) {
        roots.push(vault.join(".agents/skills"));
    }
    roots
}

fn parse_skill_metadata(content: &str, fallback_name: &str) -> (String, String) {
    let Some(rest) = content.strip_prefix("---\n") else {
        return (fallback_name.to_string(), String::new());
    };
    let Some((front_matter, _)) = rest.split_once("\n---") else {
        return (fallback_name.to_string(), String::new());
    };
    let mut name = fallback_name.to_string();
    let mut description = String::new();
    for line in front_matter.lines() {
        if let Some(value) = line.strip_prefix("name:") {
            name = value.trim().trim_matches(['\"', '\'']).to_string();
        }
        if let Some(value) = line.strip_prefix("description:") {
            description = value.trim().trim_matches(['\"', '\'']).to_string();
        }
    }
    (name, description)
}

fn skill_candidates(vault_path: Option<&str>) -> Vec<(String, PathBuf)> {
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();
    for root in skill_roots(vault_path) {
        let Ok(entries) = fs::read_dir(root) else {
            continue;
        };
        let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }
            let id = entry.file_name().to_string_lossy().to_string();
            if id.is_empty() || !seen.insert(id.clone()) {
                continue;
            }
            let path = entry.path().join("SKILL.md");
            if path.is_file() {
                candidates.push((id, path));
            }
        }
    }
    candidates
}

pub fn list_agent_skills(vault_path: Option<&str>) -> Vec<AgentSkill> {
    skill_candidates(vault_path)
        .into_iter()
        .filter_map(|(id, path)| {
            let content = fs::read_to_string(path).ok()?;
            let (name, description) = parse_skill_metadata(&content, &id);
            Some(AgentSkill {
                id,
                name,
                description,
            })
        })
        .collect()
}

pub fn load_skill_instructions(
    skill_ids: &[String],
    vault_path: Option<&str>,
) -> Result<String, AppError> {
    if skill_ids.len() > MAX_SELECTED_SKILLS {
        return Err(AppError::message(format!(
            "at most {MAX_SELECTED_SKILLS} skills can be used in one prompt"
        )));
    }
    let candidates = skill_candidates(vault_path);
    let mut blocks = Vec::new();
    for skill_id in skill_ids {
        let Some((_, path)) = candidates.iter().find(|(id, _)| id == skill_id) else {
            return Err(AppError::message(format!(
                "local skill `{skill_id}` was not found"
            )));
        };
        let metadata = fs::metadata(path).map_err(AppError::Io)?;
        if metadata.len() > MAX_SKILL_BYTES {
            return Err(AppError::message(format!(
                "local skill `{skill_id}` exceeds {MAX_SKILL_BYTES} bytes"
            )));
        }
        let content = fs::read_to_string(path).map_err(AppError::Io)?;
        blocks.push(format!("### ${skill_id}\n{content}"));
    }
    if blocks.is_empty() {
        Ok(String::new())
    } else {
        Ok(format!(
            "\n\n## Active local skills\nFollow the selected local skill instructions below when they apply.\n\n{}",
            blocks.join("\n\n")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::parse_skill_metadata;

    #[test]
    fn parses_skill_front_matter() {
        let (name, description) = parse_skill_metadata(
            "---\nname: example\ndescription: Useful instructions\n---\n# Body",
            "fallback",
        );
        assert_eq!(name, "example");
        assert_eq!(description, "Useful instructions");
    }
}
