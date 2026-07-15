//! Vault create / scaffold helpers.

use crate::error::AppError;
use crate::services::catalog;
use serde::Serialize;
use std::fs;
use std::path::Path;

/// Default AGENTS.md template written on Create Vault (only if missing).
pub const AGENTS_MD_TEMPLATE: &str = r#"# AGENTS.md

This file is the L0 map for agents working in this Motif research vault.

## Layout

- `papers/` — paper folders (any depth). A **paper folder** is the minimal unit: it contains `NOTES.md`, optional `highlights.md` / `PAPER.md`, and `source/`.
- `notes/` — free-form concept notes and ideas (`[[wikilinks]]` welcome).
- `plans/` — research plans and drafts.
- `.motif/catalog.sqlite` — paper **catalog** (collection + metadata). There is usually **no** root `PAPERS.md` or `library.bib` unless the user exports them.

## Progressive disclosure

1. Start with this file and the paper list from the app catalog (or scan `papers/**/NOTES.md`).
2. Open `{paper}/NOTES.md` for a locked paper.
3. Then `highlights.md` → optional `PAPER.md` → `source/` only as needed.

## Rules

- Prefer short, structured notes (problem / method / results).
- Keep `[[wikilinks]]` as written; do not rewrite them to plain URLs.
- Cite Vault-relative paths you read; end substantial answers with `## Sources`.
- Never overwrite user notes without an explicit draft + confirmation path.
"#;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateVaultResult {
    pub path: String,
    pub created: Vec<String>,
    /// Relative path suggested for first open (e.g. `AGENTS.md`).
    pub open_path: String,
}

fn join_rel(root: &Path, rel: &str) -> std::path::PathBuf {
    let mut p = root.to_path_buf();
    for part in rel.split('/').filter(|s| !s.is_empty()) {
        p.push(part);
    }
    p
}

/// Create Motif vault skeleton under `path` without overwriting existing user files.
///
/// Creates: `papers/`, `notes/`, `plans/`, `.motif/`, `AGENTS.md` (if missing),
/// and initializes `.motif/catalog.sqlite`. Does **not** create `PAPERS.md` / `library.bib`.
pub fn create_vault(path: &Path) -> Result<CreateVaultResult, AppError> {
    if !path.exists() {
        fs::create_dir_all(path)?;
    }
    if !path.is_dir() {
        return Err(AppError::message(format!(
            "not a directory: {}",
            path.display()
        )));
    }

    let mut created: Vec<String> = Vec::new();

    for dir in ["papers", "notes", "plans", ".motif"] {
        let p = join_rel(path, dir);
        if !p.exists() {
            fs::create_dir_all(&p)?;
            created.push(format!("{dir}/"));
        }
    }

    let agents = join_rel(path, "AGENTS.md");
    if !agents.exists() {
        fs::write(&agents, AGENTS_MD_TEMPLATE)?;
        created.push("AGENTS.md".into());
    }

    // Catalog: always ensure schema (may create catalog.sqlite)
    let db_path = catalog::catalog_db_path(path);
    let db_existed = db_path.exists();
    let conn = catalog::ensure_catalog(path)?;
    drop(conn);
    if !db_existed && db_path.exists() {
        created.push(".motif/catalog.sqlite".into());
    }

    let path_str = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string();

    Ok(CreateVaultResult {
        path: path_str,
        created,
        open_path: "AGENTS.md".into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    #[test]
    fn create_vault_scaffolds_dirs_and_catalog() {
        let dir = env::temp_dir().join(format!("motif-vault-create-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let r = create_vault(&dir).expect("create");
        assert!(dir.join("papers").is_dir());
        assert!(dir.join("notes").is_dir());
        assert!(dir.join("plans").is_dir());
        assert!(dir.join(".motif").is_dir());
        assert!(dir.join("AGENTS.md").is_file());
        assert!(dir.join(".motif/catalog.sqlite").is_file());
        assert!(!dir.join("PAPERS.md").exists());
        assert!(!dir.join("library.bib").exists());
        assert!(r
            .created
            .iter()
            .any(|c| c.contains("catalog") || c == "AGENTS.md" || c.ends_with('/')));

        // Second call does not wipe AGENTS.md
        fs::write(dir.join("AGENTS.md"), "# custom\n").unwrap();
        let r2 = create_vault(&dir).expect("again");
        let content = fs::read_to_string(dir.join("AGENTS.md")).unwrap();
        assert!(content.starts_with("# custom"));
        assert!(!r2.created.iter().any(|c| c == "AGENTS.md"));

        let _ = fs::remove_dir_all(&dir);
    }

    /// Optional smoke write:
    /// `MOTIF_TEST_VAULT_PATH=$HOME/Downloads/motif-from-rust cargo test create_vault_at_env_path -- --ignored --nocapture`
    #[test]
    #[ignore = "set MOTIF_TEST_VAULT_PATH to write a real vault (e.g. under Downloads)"]
    fn create_vault_at_env_path() {
        let raw = env::var("MOTIF_TEST_VAULT_PATH").expect("set MOTIF_TEST_VAULT_PATH");
        let dir = Path::new(&raw);
        if dir.exists() {
            let _ = fs::remove_dir_all(dir);
        }
        fs::create_dir_all(dir).unwrap();
        let r = create_vault(dir).expect("create");
        assert!(dir.join(".motif/catalog.sqlite").is_file());
        assert!(dir.join("AGENTS.md").is_file());
        assert!(dir.join("papers").is_dir());
        assert!(!dir.join("PAPERS.md").exists());
        eprintln!(
            "create_vault wrote {} items to {}",
            r.created.len(),
            dir.display()
        );
    }
}
