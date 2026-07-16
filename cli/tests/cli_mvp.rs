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
    let reads = v["data"]["suggestedReads"].as_array().unwrap();
    assert!(reads
        .iter()
        .any(|r| r.as_str() == Some("papers/demo/NOTES.md")));

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
    assert!(v["data"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p.as_str() == Some("papers/demo/NOTES.md")));

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
