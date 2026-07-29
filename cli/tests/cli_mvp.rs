//! Integration tests for agentero CLI MVP (offline; no Translator).

use assert_cmd::cargo::cargo_bin_cmd;
use predicates::prelude::*;
use serde_json::Value;
use std::fs;
use std::path::Path;
use tempfile::tempdir;

fn agentero() -> assert_cmd::Command {
    cargo_bin_cmd!("agentero")
}

fn create_vault(dir: &Path) {
    agentero()
        .args(["vault", "create", dir.to_str().unwrap(), "--json"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"ok\": true"));
}

#[test]
fn vault_create_which_info_check() {
    let tmp = tempdir().unwrap();
    let vault = tmp.path().join("v");
    create_vault(&vault);

    assert!(vault.join("papers").is_dir());
    assert!(vault.join(".agentero").join("catalog.sqlite").is_file());
    assert!(vault.join("AGENTS.md").is_file());
    assert!(vault.join(".agents/skills/agentero-cli/SKILL.md").is_file());
    assert!(vault.join(".agents/skills/paper-reader/SKILL.md").is_file());
    assert!(vault
        .join(".agents/skills/idea-evaluator/SKILL.md")
        .is_file());
    assert!(vault
        .join(".agents/skills/deep-research/SKILL.md")
        .is_file());
    assert!(vault.join(".agents/skills/README.md").is_file());

    let which = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "vault",
            "which",
            "--json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let v: Value = serde_json::from_slice(&which).unwrap();
    assert_eq!(v["ok"], true);
    assert!(v["data"]["path"].as_str().unwrap().contains("v"));

    let info = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "vault",
            "info",
            "--json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let v: Value = serde_json::from_slice(&info).unwrap();
    assert_eq!(v["ok"], true);
    assert_eq!(v["data"]["counts"]["papers"], 0);

    agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "vault",
            "check",
            "--json",
        ])
        .assert()
        .success();
}

#[test]
fn paper_list_empty_and_set_read_not_found() {
    let tmp = tempdir().unwrap();
    let vault = tmp.path().join("v");
    create_vault(&vault);

    let out = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "list",
            "--json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let v: Value = serde_json::from_slice(&out).unwrap();
    assert_eq!(v["ok"], true);
    assert!(v["data"].as_array().unwrap().is_empty());

    agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "get",
            "nope",
            "--json",
        ])
        .assert()
        .failure()
        .stdout(predicate::str::contains("paper_not_found"));
}

#[test]
fn paper_crud_catalog_only() {
    let tmp = tempdir().unwrap();
    let vault = tmp.path().join("v");
    create_vault(&vault);

    // Seed a catalog row via service path: write minimal paper folder + use SQL through second create
    // Insert via agentero is only import (network). Seed with direct SQLite for unit-ish coverage.
    let paper = vault.join("papers").join("demo");
    fs::create_dir_all(&paper).unwrap();
    fs::write(paper.join("NOTES.md"), "# Demo\n").unwrap();

    // Use `agentero` only for operations that hit services — seed with rusqlite in-process via
    // creating through vault is enough if we call paper list after manual catalog upsert.
    // Here we shell out to a tiny approach: open catalog and insert like Host would.
    seed_paper(&vault, "papers/demo", "demo", "Demo Paper");

    let list = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "list",
            "--json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let v: Value = serde_json::from_slice(&list).unwrap();
    assert_eq!(v["data"].as_array().unwrap().len(), 1);
    assert_eq!(v["data"][0]["id"], "demo");

    let get = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "get",
            "demo",
            "--json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let v: Value = serde_json::from_slice(&get).unwrap();
    assert_eq!(v["data"]["paper"]["title"], "Demo Paper");
    assert!(v["data"]["assets"]["notesMd"].as_bool().unwrap());
    assert_eq!(v["data"]["assets"]["marksDir"], false);
    let reads = v["data"]["suggestedReads"].as_array().unwrap();
    assert!(reads
        .iter()
        .any(|r| r.as_str() == Some("papers/demo/NOTES.md")));

    // Reader marks dir → assets.marksDir + suggestedReads / paths
    fs::create_dir_all(paper.join("marks")).unwrap();
    fs::write(
        paper.join("marks").join("hl-1.json"),
        r#"{"version":1,"kind":"highlight","id":"hl-1"}"#,
    )
    .unwrap();

    let get_marks = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "get",
            "demo",
            "--json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let v: Value = serde_json::from_slice(&get_marks).unwrap();
    assert!(v["data"]["assets"]["marksDir"].as_bool().unwrap());
    let reads = v["data"]["suggestedReads"].as_array().unwrap();
    assert!(reads
        .iter()
        .any(|r| r.as_str() == Some("papers/demo/marks")));

    let paths = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "paths",
            "demo",
            "--json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let v: Value = serde_json::from_slice(&paths).unwrap();
    let path_list = v["data"].as_array().unwrap();
    assert!(path_list
        .iter()
        .any(|p| p.as_str() == Some("papers/demo/NOTES.md")));
    assert!(path_list
        .iter()
        .any(|p| p.as_str() == Some("papers/demo/marks")));

    agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "set-read",
            "demo",
            "--json",
        ])
        .assert()
        .success();

    let get2 = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "get",
            "papers/demo",
            "--json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let v: Value = serde_json::from_slice(&get2).unwrap();
    assert_eq!(v["data"]["paper"]["is_read"], true);

    // Tags: replace → list filter → add → rm → tag list inventory
    agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "tag",
            "set",
            "demo",
            "nlp",
            "survey",
            "--json",
        ])
        .assert()
        .success();

    let tagged = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "list",
            "--tag",
            "NLP",
            "--json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let v: Value = serde_json::from_slice(&tagged).unwrap();
    assert_eq!(v["data"].as_array().unwrap().len(), 1);
    assert_eq!(v["data"][0]["tags"][0], "nlp");
    assert_eq!(v["data"][0]["tags"][1], "survey");

    let no_tag = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "list",
            "--tag",
            "missing",
            "--json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let v: Value = serde_json::from_slice(&no_tag).unwrap();
    assert!(v["data"].as_array().unwrap().is_empty());

    agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "tag",
            "add",
            "demo",
            "draft",
            "--json",
        ])
        .assert()
        .success();
    agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "tag",
            "rm",
            "demo",
            "survey",
            "--json",
        ])
        .assert()
        .success();

    let get_tags = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "get",
            "demo",
            "--json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let v: Value = serde_json::from_slice(&get_tags).unwrap();
    let tags = v["data"]["paper"]["tags"].as_array().unwrap();
    assert!(tags.iter().any(|t| t.as_str() == Some("nlp")));
    assert!(tags.iter().any(|t| t.as_str() == Some("draft")));
    assert!(!tags.iter().any(|t| t.as_str() == Some("survey")));

    let tags_idx = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "tag",
            "list",
            "--json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let v: Value = serde_json::from_slice(&tags_idx).unwrap();
    let items = v["data"]["items"].as_array().unwrap();
    assert!(items
        .iter()
        .any(|it| { it["tag"].as_str() == Some("nlp") && it["count"].as_u64() == Some(1) }));
    assert!(items
        .iter()
        .any(|it| { it["tag"].as_str() == Some("draft") && it["count"].as_u64() == Some(1) }));

    // clear requires --clear (empty args alone is a usage error)
    agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "tag",
            "set",
            "demo",
            "--json",
        ])
        .assert()
        .failure();
    agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "tag",
            "set",
            "demo",
            "--clear",
            "--json",
        ])
        .assert()
        .success();

    agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "delete",
            "papers/demo",
            "--json",
        ])
        .assert()
        .success();
    // files remain without --files
    assert!(paper.join("NOTES.md").is_file());

    let list2 = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "list",
            "--json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let v: Value = serde_json::from_slice(&list2).unwrap();
    assert!(v["data"].as_array().unwrap().is_empty());
}

#[test]
fn tree_and_vault_resolve_from_cwd() {
    let tmp = tempdir().unwrap();
    let vault = tmp.path().join("v");
    create_vault(&vault);
    fs::write(vault.join("notes").join("a.md"), "hi").unwrap();

    agentero()
        .current_dir(&vault)
        .args(["tree", "--json"])
        .assert()
        .success()
        .stdout(predicate::str::contains("notes"));

    agentero()
        .current_dir(&vault)
        .args(["vault", "which", "--json"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"ok\": true"));
}

#[test]
fn wiki_check_reports_semantic_issues_and_honors_file_scope() {
    let tmp = tempdir().unwrap();
    let vault = tmp.path().join("v");
    create_vault(&vault);
    fs::create_dir_all(vault.join("notes/a")).unwrap();
    fs::create_dir_all(vault.join("notes/b")).unwrap();
    fs::write(vault.join("notes/Target.md"), "# Existing\n").unwrap();
    fs::write(vault.join("notes/a/Topic.md"), "# A\n").unwrap();
    fs::write(vault.join("notes/b/Topic.md"), "# B\n").unwrap();
    fs::write(vault.join("notes/Clean.md"), "[[Target]]\n").unwrap();
    let broken_source = "[[Target]]\n[[Missing]]\n[[Topic]]\n[[Target#Gone]]\n";
    fs::write(vault.join("notes/Broken.md"), broken_source).unwrap();
    fs::create_dir_all(vault.join("papers/demo")).unwrap();
    fs::write(
        vault.join("papers/demo/PAPER.md"),
        "[web](chat.openai.com)\n[[MissingFromPaper]]\n",
    )
    .unwrap();

    let clean = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "wiki",
            "check",
            "notes/Clean.md",
            "--json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let clean: Value = serde_json::from_slice(&clean).unwrap();
    assert_eq!(clean["ok"], true);
    assert_eq!(clean["data"]["checkedFiles"], 1);
    assert_eq!(clean["data"]["counts"]["resolved"], 1);
    assert!(clean["data"]["issues"].as_array().unwrap().is_empty());

    let broken = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "wiki",
            "check",
            "notes/Broken.md",
            "--json",
        ])
        .assert()
        .failure()
        .get_output()
        .stdout
        .clone();
    let broken: Value = serde_json::from_slice(&broken).unwrap();
    assert_eq!(broken["ok"], false);
    assert_eq!(broken["error"]["code"], "wikilink_check_failed");
    assert_eq!(broken["error"]["details"]["checkedFiles"], 1);
    assert_eq!(broken["error"]["details"]["counts"]["resolved"], 1);
    assert_eq!(broken["error"]["details"]["counts"]["missing"], 1);
    assert_eq!(broken["error"]["details"]["counts"]["ambiguous"], 1);
    assert_eq!(broken["error"]["details"]["counts"]["invalidFragment"], 1);
    assert_eq!(
        broken["error"]["details"]["issues"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    assert_eq!(
        fs::read_to_string(vault.join("notes/Broken.md")).unwrap(),
        broken_source
    );

    let paper = agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "wiki",
            "check",
            "papers/demo/PAPER.md",
            "--json",
        ])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let paper: Value = serde_json::from_slice(&paper).unwrap();
    assert_eq!(paper["data"]["checkedFiles"], 0);
    assert!(paper["data"]["issues"].as_array().unwrap().is_empty());
}

#[test]
fn delete_files_requires_yes() {
    let tmp = tempdir().unwrap();
    let vault = tmp.path().join("v");
    create_vault(&vault);
    let paper = vault.join("papers").join("x");
    fs::create_dir_all(&paper).unwrap();
    seed_paper(&vault, "papers/x", "x", "X");

    agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "paper",
            "delete",
            "papers/x",
            "--files",
            "--json",
        ])
        .assert()
        .failure()
        .stdout(predicate::str::contains("needs_confirmation"));

    agentero()
        .args([
            "--vault",
            vault.to_str().unwrap(),
            "-y",
            "paper",
            "delete",
            "papers/x",
            "--files",
            "--json",
        ])
        .assert()
        .success();
    assert!(!paper.exists());
}

/// Minimal catalog seed without Translator (mirrors papers table columns used by list/get).
fn seed_paper(vault: &Path, path: &str, id: &str, title: &str) {
    use std::process::Command;
    // Prefer embedding via agentero_lib in a helper binary — for tests, call sqlite3 if present,
    // else use a tiny Rust approach: write through the same ensure_catalog by invoking a one-off.
    // We use the `agentero` crate isn't linked in tests, so open with rusqlite via shell to the CLI's
    // dependency is awkward. Use `sqlite3` CLI if available; otherwise write SQL with a small rustc —
    // simplest: use the fact that catalog is created and insert with `rusqlite` as a build-dep.
    //
    // assert_cmd tests cannot depend on agentero_lib easily without [dev-dependencies] path.
    // Add rusqlite as dev-dep... already only assert_cmd. Use std::process + python?
    // Fastest robust approach: add agentero_lib as dev-dependency — already transitive.
    // We'll use raw SQL via the `sqlite3` binary, with fallback to writing a metadata-only approach.
    let db = vault.join(".agentero").join("catalog.sqlite");
    let now = "2020-01-01T00:00:00.000Z";
    let sql = format!(
        "INSERT INTO papers (path, id, type, title, authors_json, tags_json, status, added_at, updated_at, is_read)
         VALUES ('{path}', '{id}', 'article', '{title}', '[]', '[]', 'completed', '{now}', '{now}', 0);"
    );
    let status = Command::new("sqlite3").arg(&db).arg(&sql).status();
    if status.map(|s| s.success()).unwrap_or(false) {
        return;
    }
    // Fallback: use Python sqlite3 stdlib
    let py = format!(
        r#"import sqlite3; c=sqlite3.connect(r"{db}"); c.execute({sql:?}); c.commit()"#,
        db = db.display(),
        sql = sql
    );
    let status = Command::new("python3").args(["-c", &py]).status().unwrap();
    assert!(status.success(), "failed to seed catalog");
}
