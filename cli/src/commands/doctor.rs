//! `agentero doctor`

use crate::error::{CliError, ExitCode};
use crate::output::{to_value, OutputFormat};
use crate::prompt;
use crate::resolve::{resolve_vault, GlobalOpts};
use agentero_lib::features::doctor::{
    apply_alias_repairs, diagnose, AliasRepairCandidate, AliasRepairChange, DoctorReport,
};
use clap::Subcommand;
use serde_json::{json, Value};

#[derive(Debug, Subcommand)]
pub enum DoctorCmd {
    /// Apply one explicitly selected class of safe repairs.
    Fix {
        #[command(subcommand)]
        cmd: DoctorFixCmd,
    },
}

#[derive(Debug, Subcommand)]
pub enum DoctorFixCmd {
    /// Add missing paper-note aliases while preserving existing aliases and YAML.
    Aliases,
}

pub fn run(cmd: Option<DoctorCmd>, globals: &GlobalOpts) -> Result<Value, CliError> {
    match cmd {
        None => check(globals),
        Some(DoctorCmd::Fix {
            cmd: DoctorFixCmd::Aliases,
        }) => fix_aliases(globals),
    }
}

fn check(globals: &GlobalOpts) -> Result<Value, CliError> {
    let vault = resolve_vault(globals)?;
    let report = diagnose(&vault).map_err(CliError::from)?;
    let value = report_value(&report)?;
    if report.ok {
        Ok(value)
    } else {
        Err(CliError::with_details(
            "doctor_issues",
            "Doctor found Vault issues",
            value,
            ExitCode::Business,
        ))
    }
}

fn fix_aliases(globals: &GlobalOpts) -> Result<Value, CliError> {
    let vault = resolve_vault(globals)?;
    let report = diagnose(&vault).map_err(CliError::from)?;
    let fixable = report
        .aliases
        .candidates
        .iter()
        .filter(|candidate| candidate.fixable)
        .collect::<Vec<_>>();
    if fixable.is_empty() {
        let mut value = report_value(&report)?;
        if let Some(object) = value.as_object_mut() {
            object.insert("updatedPaths".into(), json!([]));
            object.insert("lines".into(), json!(["no safe alias repairs available"]));
        }
        return Ok(value);
    }

    if matches!(globals.format, OutputFormat::Json) && !globals.yes {
        return Err(CliError::with_details(
            "needs_confirmation",
            "alias repair requires confirmation (pass --yes / -y to accept generated aliases)",
            json!({ "candidates": fixable }),
            ExitCode::NeedsConfirmation,
        ));
    }

    let changes = if globals.yes {
        fixable.into_iter().map(default_change).collect::<Vec<_>>()
    } else {
        edit_changes(&fixable, globals)?
    };
    if !prompt::confirm(
        globals,
        &format!("Rewrite aliases in {} paper note(s)?", changes.len()),
        false,
    )? {
        return Err(CliError::needs_confirmation("alias repair cancelled"));
    }

    let result = apply_alias_repairs(&vault, &changes, &[]).map_err(|error| {
        CliError::with_details(
            "alias_repair_failed",
            error.message.clone(),
            serde_json::to_value(error).unwrap_or_default(),
            ExitCode::Business,
        )
    })?;
    let mut value = to_value(&result)?;
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "lines".into(),
            json!([format!(
                "updated aliases in {} paper note(s)",
                result.updated_paths.len()
            )]),
        );
    }
    Ok(value)
}

fn default_change(candidate: &AliasRepairCandidate) -> AliasRepairChange {
    AliasRepairChange {
        path: candidate.path.clone(),
        title_alias: candidate.title_alias.clone(),
        short_alias: candidate.short_alias.clone(),
        expected_hash: candidate.expected_hash.clone(),
    }
}

fn edit_changes(
    candidates: &[&AliasRepairCandidate],
    globals: &GlobalOpts,
) -> Result<Vec<AliasRepairChange>, CliError> {
    let mut changes = Vec::new();
    for candidate in candidates {
        eprintln!("\n{}", candidate.path);
        if !candidate.current_aliases.is_empty() {
            eprintln!(
                "  preserved aliases: {}",
                candidate.current_aliases.join(", ")
            );
        }
        let title_alias = prompt::text(globals, "Title alias", &candidate.title_alias)?;
        let short_alias = prompt::text(globals, "Short alias", &candidate.short_alias)?;
        changes.push(AliasRepairChange {
            path: candidate.path.clone(),
            title_alias,
            short_alias,
            expected_hash: candidate.expected_hash.clone(),
        });
    }
    Ok(changes)
}

fn report_value(report: &DoctorReport) -> Result<Value, CliError> {
    let mut value = to_value(report)?;
    if let Some(object) = value.as_object_mut() {
        let link_issues = report.wikilinks.issues.len();
        object.insert(
            "lines".into(),
            json!([
                format!("vault: {}", if report.vault.ok { "ok" } else { "issues" }),
                format!(
                    "catalog: {}",
                    if report.catalog.ok { "ok" } else { "issues" }
                ),
                format!("wikilinks: {link_issues} issue(s)"),
                format!(
                    "paper aliases: {}/{} complete, {} repair candidate(s)",
                    report.aliases.complete_papers,
                    report.aliases.checked_papers,
                    report.aliases.candidates.len()
                ),
            ]),
        );
    }
    Ok(value)
}
