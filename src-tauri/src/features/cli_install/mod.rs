//! Bundled headless CLI discovery, PATH install, and uninstall.
//!
//! The desktop package may ship `agentero-cli` next to the GUI binary (Tauri
//! `externalBin`). Settings offers an explicit install into a user bin dir
//! without editing shell rc files.
//!
//! Dev note: the cargo bin is named `agentero-cli` so it never collides with
//! the GUI binary `agentero` in `target/{debug,release}/`.

use crate::core::error::AppError;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager, Runtime};

pub mod commands;

const SHIM_NAME: &str = if cfg!(windows) {
    "agentero.cmd"
} else {
    "agentero"
};

const BUNDLED_CLI_NAME: &str = if cfg!(windows) {
    "agentero-cli.exe"
} else {
    "agentero-cli"
};

/// Reject empty externalBin stubs (0-byte placeholders from prepare --stub).
const MIN_CLI_BYTES: u64 = 1;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallStatus {
    /// App package version (from Cargo / Tauri).
    pub app_version: String,
    /// Version reported by the bundled CLI binary, if present.
    pub bundled_version: Option<String>,
    /// Absolute path to the bundled CLI binary inside the App.
    pub bundled_path: Option<String>,
    /// Whether a user-level shim/link we manage is installed.
    pub installed: bool,
    /// Where the managed shim lives.
    pub install_path: Option<String>,
    /// Whether the shim still points at (or is) the current bundled binary.
    pub shim_current: bool,
    /// Preferred install directory for new installs.
    pub preferred_bin_dir: String,
    /// Whether the preferred bin dir is currently on PATH.
    pub preferred_bin_on_path: bool,
    /// Human-readable note (e.g. PATH hint).
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallResult {
    pub status: CliInstallStatus,
    pub action: String,
}

fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn is_plausible_cli_file(path: &Path) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    // Size alone is not enough (dev shell scripts are small); empty stubs are.
    meta.is_file() && meta.len() >= MIN_CLI_BYTES
}

/// True when the file looks real and can report a version.
fn is_runnable_cli(path: &Path) -> bool {
    is_plausible_cli_file(path) && read_cli_version(path).is_some()
}

/// Locate a real, version-reporting bundled CLI (never empty stubs).
pub fn resolve_bundled_cli<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // `executable_dir` is desktop-only (PathResolver). Mobile never ships the CLI.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    if let Ok(exe_dir) = app.path().executable_dir() {
        candidates.push(exe_dir.join(BUNDLED_CLI_NAME));
        candidates.push(exe_dir.join("binaries").join(BUNDLED_CLI_NAME));
    }
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join(BUNDLED_CLI_NAME));
        candidates.push(res.join("binaries").join(BUNDLED_CLI_NAME));
        if let Some(parent) = res.parent() {
            candidates.push(parent.join("MacOS").join(BUNDLED_CLI_NAME));
        }
    }

    // Runtime discovery from the running GUI binary (dev + release).
    // `CARGO_MANIFEST_DIR` is only set at compile time, not when the app runs.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(BUNDLED_CLI_NAME));
            // target/debug/agentero (GUI) → sibling agentero-cli
            candidates.push(dir.join(BUNDLED_CLI_NAME));
            // Walk up looking for workspace target/{debug,release}/agentero-cli
            for ancestor in dir.ancestors().take(6) {
                candidates.push(ancestor.join("target/debug").join(BUNDLED_CLI_NAME));
                candidates.push(ancestor.join("target/release").join(BUNDLED_CLI_NAME));
                if ancestor.ends_with("debug") || ancestor.ends_with("release") {
                    candidates.push(ancestor.join(BUNDLED_CLI_NAME));
                }
            }
        }
    }

    // src-tauri/binaries/agentero-cli-$TRIPLE from prepare-bundled-cli.mjs
    if let Ok(cwd) = std::env::current_dir() {
        for ancestor in cwd.ancestors().take(6) {
            let bin_dir = ancestor.join("src-tauri/binaries");
            if let Ok(rd) = fs::read_dir(&bin_dir) {
                for entry in rd.flatten() {
                    let name = entry.file_name();
                    let s = name.to_string_lossy();
                    if s.starts_with("agentero-cli-") {
                        candidates.push(entry.path());
                    }
                }
            }
        }
    }

    // First candidate that reports a version (never empty stubs).
    for path in candidates {
        if is_runnable_cli(&path) {
            return path.canonicalize().ok().or(Some(path));
        }
    }
    None
}

fn read_cli_version(bin: &Path) -> Option<String> {
    let output = Command::new(bin).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    // clap: `agentero-cli 0.5.1` or `agentero 0.5.1`
    let line = text.lines().next()?.trim();
    if line.is_empty() {
        return None;
    }
    // Prefer the last whitespace-separated token that looks like a version.
    let ver = line
        .split_whitespace()
        .rev()
        .find(|t| t.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .unwrap_or_else(|| line.split_whitespace().last().unwrap_or(line))
        .trim()
        .to_string();
    if ver.is_empty() {
        None
    } else {
        Some(ver)
    }
}

fn preferred_bin_dir() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        let local = home.join(".local").join("bin");
        if local.is_dir() || !cfg!(windows) {
            return local;
        }
    }
    #[cfg(windows)]
    {
        if let Some(base) = dirs::data_local_dir() {
            return base.join("Agentero").join("bin");
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local")
        .join("bin")
}

pub(crate) fn managed_shim_path() -> PathBuf {
    preferred_bin_dir().join(SHIM_NAME)
}

fn path_env_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(path) = std::env::var("PATH") {
        for part in std::env::split_paths(&path) {
            dirs.push(part);
        }
    }
    dirs
}

fn is_on_path(dir: &Path) -> bool {
    let dir_canon = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    path_env_dirs().iter().any(|p| {
        p.canonicalize()
            .map(|c| c == dir_canon)
            .unwrap_or_else(|_| p == dir)
    })
}

/// Whether `shim` is a managed Agentero CLI entry pointing at `bundled` (or same file).
fn shim_points_to(shim: &Path, bundled: Option<&Path>) -> bool {
    if !shim.exists() {
        return false;
    }
    let Some(bundled) = bundled else {
        return is_agentero_shim(shim);
    };
    #[cfg(unix)]
    {
        if let Ok(target) = fs::read_link(shim) {
            let resolved = if target.is_absolute() {
                target
            } else {
                shim.parent().unwrap_or_else(|| Path::new(".")).join(target)
            };
            let a = resolved.canonicalize().unwrap_or(resolved);
            let b = bundled
                .canonicalize()
                .unwrap_or_else(|_| bundled.to_path_buf());
            return a == b;
        }
    }
    if let (Ok(a), Ok(b)) = (shim.canonicalize(), bundled.canonicalize()) {
        if a == b {
            return true;
        }
    }
    is_agentero_shim(shim)
}

fn is_agentero_shim(shim: &Path) -> bool {
    #[cfg(unix)]
    {
        if let Ok(target) = fs::read_link(shim) {
            let s = target.to_string_lossy();
            return s.contains("agentero-cli") || s.contains("Agentero") || s.ends_with("agentero");
        }
    }
    #[cfg(windows)]
    {
        if let Ok(text) = fs::read_to_string(shim) {
            return text.contains("agentero-cli") || text.contains("Agentero");
        }
    }
    false
}

pub fn collect_status<R: Runtime>(app: &AppHandle<R>) -> CliInstallStatus {
    let bundled = resolve_bundled_cli(app);
    let bundled_version = bundled.as_ref().and_then(|p| read_cli_version(p));
    let shim = managed_shim_path();
    let installed =
        shim.exists() && (is_agentero_shim(&shim) || shim_points_to(&shim, bundled.as_deref()));
    let shim_current = installed && shim_points_to(&shim, bundled.as_deref());
    let bin_dir = preferred_bin_dir();
    let preferred_bin_on_path = is_on_path(&bin_dir);

    let mut message = None;
    if bundled.is_none() {
        message = Some(
            "Bundled CLI not found. In dev: run `pnpm cli:bundle` (or `cargo build -p agentero-cli`), then reinstall from Settings."
                .into(),
        );
    } else if installed && !preferred_bin_on_path {
        message = Some(format!(
            "CLI installed at {} but that directory is not on PATH. Add it to your shell PATH (do not edit rc from Agentero).",
            bin_dir.display()
        ));
    } else if !installed {
        message = Some(format!(
            "Install places `agentero` in {}{}",
            bin_dir.display(),
            if preferred_bin_on_path {
                "."
            } else {
                " (then ensure that directory is on PATH)."
            }
        ));
    }

    CliInstallStatus {
        app_version: app_version(),
        bundled_version,
        bundled_path: bundled.map(|p| p.to_string_lossy().into_owned()),
        installed,
        install_path: if installed {
            Some(shim.to_string_lossy().into_owned())
        } else {
            None
        },
        shim_current,
        preferred_bin_dir: bin_dir.to_string_lossy().into_owned(),
        preferred_bin_on_path,
        message,
    }
}

pub(crate) fn install_shim(bundled: &Path, shim: &Path) -> Result<(), AppError> {
    if !is_plausible_cli_file(bundled) {
        return Err(AppError::message(format!(
            "bundled CLI is missing or empty: {}",
            bundled.display()
        )));
    }
    if read_cli_version(bundled).is_none() {
        return Err(AppError::message(format!(
            "bundled CLI does not run (`--version` failed): {}. Rebuild with `pnpm cli:bundle`.",
            bundled.display()
        )));
    }
    if let Some(parent) = shim.parent() {
        fs::create_dir_all(parent)?;
    }
    // Never clobber a user-owned binary/symlink that we did not create.
    if shim.exists() {
        if !is_agentero_shim(shim) && !shim_points_to(shim, Some(bundled)) {
            return Err(AppError::message(format!(
                "refusing to overwrite {}: not an Agentero-managed CLI entry",
                shim.display()
            )));
        }
        fs::remove_file(shim)?;
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(bundled, shim).map_err(|e| {
            AppError::message(format!(
                "failed to create symlink {} → {}: {e}",
                shim.display(),
                bundled.display()
            ))
        })?;
        #[allow(clippy::permissions_set_readonly_false)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(meta) = fs::metadata(bundled) {
                let mut perms = meta.permissions();
                let mode = perms.mode();
                if mode & 0o111 == 0 {
                    perms.set_mode(mode | 0o755);
                    let _ = fs::set_permissions(bundled, perms);
                }
            }
        }
        Ok(())
    }
    #[cfg(windows)]
    {
        let body = format!(
            "@echo off\r\n\"{}\" %*\r\n",
            bundled.display().to_string().replace('"', "")
        );
        fs::write(shim, body)?;
        Ok(())
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (bundled, shim);
        Err(AppError::message(
            "CLI install not supported on this platform",
        ))
    }
}

pub(crate) fn uninstall_shim(shim: &Path, bundled: Option<&Path>) -> Result<bool, AppError> {
    if !shim.exists() {
        return Ok(false);
    }
    if !shim_points_to(shim, bundled) && !is_agentero_shim(shim) {
        return Err(AppError::message(format!(
            "refusing to remove {}: not an Agentero-managed shim",
            shim.display()
        )));
    }
    fs::remove_file(shim)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("agentero-cli-install-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn rejects_empty_files_as_cli() {
        let dir = test_dir("tiny");
        let tiny = dir.join(BUNDLED_CLI_NAME);
        fs::write(&tiny, b"").unwrap();
        assert!(!is_plausible_cli_file(&tiny));
        assert!(!is_runnable_cli(&tiny));
        fs::write(&tiny, b"x").unwrap();
        assert!(is_plausible_cli_file(&tiny));
        // Still not runnable without a working --version.
        assert!(!is_runnable_cli(&tiny));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn install_refuses_non_managed_file() {
        let dir = test_dir("refuse");
        let foreign = dir.join(SHIM_NAME);
        let bundled = dir.join(BUNDLED_CLI_NAME);
        fs::write(&foreign, b"not-agentero").unwrap();
        // Passes size check but --version fails → install_shim errors first.
        fs::write(&bundled, b"not-a-real-binary").unwrap();
        let err = install_shim(&bundled, &foreign).unwrap_err();
        assert!(
            err.to_string().contains("does not run") || err.to_string().contains("refusing"),
            "{err}"
        );
        assert_eq!(fs::read(&foreign).unwrap(), b"not-agentero");
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn install_replaces_managed_symlink_when_version_ok() {
        let dir = test_dir("replace");
        let bundled_old = dir.join("agentero-cli-old");
        let bundled_new = dir.join(BUNDLED_CLI_NAME);
        let shim = dir.join(SHIM_NAME);
        // Shell scripts that implement --version.
        let script = "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 'agentero-cli 9.9.9'; exit 0; fi\nexit 0\n";
        fs::write(&bundled_old, script).unwrap();
        fs::write(&bundled_new, script).unwrap();
        use std::os::unix::fs::PermissionsExt;
        for p in [&bundled_old, &bundled_new] {
            let mut perms = fs::metadata(p).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(p, perms).unwrap();
        }
        std::os::unix::fs::symlink(&bundled_old, &shim).unwrap();
        install_shim(&bundled_new, &shim).unwrap();
        let target = fs::read_link(&shim).unwrap();
        assert_eq!(target, bundled_new);
        let _ = fs::remove_dir_all(&dir);
    }
}
