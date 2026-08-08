//! Bundled headless CLI discovery, PATH install, and uninstall.
//!
//! The desktop package may ship `agentero-cli` next to the GUI binary (Tauri
//! `externalBin`). Settings offers an explicit install into a user bin dir
//! without editing shell rc files.

use crate::core::error::{map_err, ApiResult, AppError};
use crate::core::install_dirs::{ABS_BIN_DIRS, HOME_BIN_DIRS};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager, Runtime};

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

/// Locate the bundled CLI next to the GUI executable (Tauri externalBin layout).
pub fn resolve_bundled_cli<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = app.path().executable_dir() {
        candidates.push(exe.join(BUNDLED_CLI_NAME));
        // macOS: sometimes resources live under Contents/MacOS already via executable_dir.
        candidates.push(exe.join("binaries").join(BUNDLED_CLI_NAME));
    }
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join(BUNDLED_CLI_NAME));
        candidates.push(res.join("binaries").join(BUNDLED_CLI_NAME));
        // macOS Contents/Resources vs MacOS
        if let Some(parent) = res.parent() {
            candidates.push(parent.join("MacOS").join(BUNDLED_CLI_NAME));
        }
    }
    // Dev: workspace release / debug binary named `agentero`
    if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
        let root = PathBuf::from(manifest);
        let workspace = root.parent().unwrap_or(&root);
        candidates.push(workspace.join("target/debug/agentero"));
        candidates.push(workspace.join("target/release/agentero"));
        candidates.push(
            root.join("../target/debug/agentero")
                .canonicalize()
                .unwrap_or_else(|_| root.join("../target/debug/agentero")),
        );
        candidates.push(
            root.join("../target/release/agentero")
                .canonicalize()
                .unwrap_or_else(|_| root.join("../target/release/agentero")),
        );
    }

    candidates.into_iter().find(|p| p.is_file())
}

fn read_cli_version(bin: &Path) -> Option<String> {
    let output = Command::new(bin).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    // `agentero 0.5.1` or similar
    let line = text.lines().next()?.trim();
    let ver = line
        .split_whitespace()
        .last()
        .unwrap_or(line)
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

fn managed_shim_path() -> PathBuf {
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
    // Windows .cmd shim or copied binary: compare contents / path heuristics.
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
            "Bundled CLI not found in this build. Use a desktop installer release, or install agentero-cli separately."
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

fn install_shim(bundled: &Path, shim: &Path) -> Result<(), AppError> {
    if let Some(parent) = shim.parent() {
        fs::create_dir_all(parent)?;
    }
    // Remove stale shim first.
    if shim.exists() {
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
        // Ensure executable bit on bundled if needed
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
        // .cmd shim that invokes the absolute bundled path.
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

fn uninstall_shim(shim: &Path, bundled: Option<&Path>) -> Result<bool, AppError> {
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

#[tauri::command]
pub fn cli_install_status<R: Runtime>(app: AppHandle<R>) -> ApiResult<CliInstallStatus> {
    ApiResult::ok(collect_status(&app))
}

#[tauri::command]
pub fn cli_install_command<R: Runtime>(app: AppHandle<R>) -> ApiResult<CliInstallResult> {
    let bundled = match resolve_bundled_cli(&app) {
        Some(p) => p,
        None => {
            return map_err(AppError::message(
                "Bundled CLI not found. Install a full desktop build or build agentero-cli.",
            ));
        }
    };
    let shim = managed_shim_path();
    if let Err(e) = install_shim(&bundled, &shim) {
        return map_err(e);
    }
    let mut status = collect_status(&app);
    if !status.preferred_bin_on_path {
        status.message = Some(format!(
            "Installed to {}. Add that directory to PATH if `agentero` is not found in new terminals.",
            status.preferred_bin_dir
        ));
    } else {
        status.message = Some("Installed. Run `agentero --version` in a new terminal.".to_string());
    }
    ApiResult::ok(CliInstallResult {
        status,
        action: "install".into(),
    })
}

#[tauri::command]
pub fn cli_uninstall_command<R: Runtime>(app: AppHandle<R>) -> ApiResult<CliInstallResult> {
    let bundled = resolve_bundled_cli(&app);
    let shim = managed_shim_path();
    match uninstall_shim(&shim, bundled.as_deref()) {
        Ok(_) => {}
        Err(e) => return map_err(e),
    }
    let mut status = collect_status(&app);
    status.message = Some("Removed the Agentero-managed CLI shim.".into());
    ApiResult::ok(CliInstallResult {
        status,
        action: "uninstall".into(),
    })
}

/// Optional helper: list user bin candidates (for diagnostics).
#[allow(dead_code)]
pub fn user_bin_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(home) = dirs::home_dir() {
        for rel in HOME_BIN_DIRS {
            out.push(home.join(rel));
        }
    }
    for abs in ABS_BIN_DIRS {
        out.push(PathBuf::from(abs));
    }
    out
}
