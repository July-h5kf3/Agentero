//! Open the system default terminal at a local path.

use crate::error::AppError;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Resolve the directory to open: folders stay as-is; files use their parent.
pub fn terminal_cwd_for_path(path: &Path) -> Result<PathBuf, AppError> {
    if path.as_os_str().is_empty() {
        return Err(AppError::message("path is required"));
    }
    let meta = std::fs::metadata(path)
        .map_err(|e| AppError::message(format!("path not found ({}): {e}", path.display())))?;
    if meta.is_dir() {
        return Ok(path.to_path_buf());
    }
    path.parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .ok_or_else(|| AppError::message("cannot resolve parent directory"))
}

/// Open the system default terminal with cwd at `path` (or its parent if a file).
pub fn open_in_terminal(path: &Path) -> Result<PathBuf, AppError> {
    let cwd = terminal_cwd_for_path(path)?;
    open_terminal_at(&cwd)?;
    Ok(cwd)
}

#[cfg(target_os = "macos")]
fn open_terminal_at(cwd: &Path) -> Result<(), AppError> {
    // Terminal.app is the system default terminal on macOS.
    // `open -a Terminal <dir>` opens a new window with that directory as cwd.
    let status = Command::new("open")
        .args(["-a", "Terminal"])
        .arg(cwd)
        .status()
        .map_err(|e| AppError::message(format!("failed to open Terminal: {e}")))?;
    if !status.success() {
        return Err(AppError::message(format!(
            "failed to open Terminal (exit {status})"
        )));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn open_terminal_at(cwd: &Path) -> Result<(), AppError> {
    // Prefer Windows Terminal when available (often the system default on Win11).
    if Command::new("wt").arg("-d").arg(cwd).spawn().is_ok() {
        return Ok(());
    }
    // Fallback: classic cmd in a new window, cwd set via /K cd.
    let cd = format!("cd /d {}", cwd.display());
    Command::new("cmd")
        .args(["/C", "start", "", "cmd", "/K", &cd])
        .spawn()
        .map_err(|e| AppError::message(format!("failed to open terminal: {e}")))?;
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_terminal_at(cwd: &Path) -> Result<(), AppError> {
    // FreeDesktop default terminal launcher (when installed).
    if Command::new("xdg-terminal-exec")
        .current_dir(cwd)
        .spawn()
        .is_ok()
    {
        return Ok(());
    }

    // $TERMINAL if the user set it.
    if let Ok(term) = std::env::var("TERMINAL") {
        if !term.is_empty() && Command::new(&term).current_dir(cwd).spawn().is_ok() {
            return Ok(());
        }
    }

    // Common desktop terminals.
    let candidates: &[(&str, &[&str])] = &[
        ("gnome-terminal", &["--working-directory"]),
        ("konsole", &["--workdir"]),
        ("xfce4-terminal", &["--working-directory"]),
        ("mate-terminal", &["--working-directory"]),
        ("tilix", &["--working-directory"]),
        ("alacritty", &["--working-directory"]),
        ("kitty", &["--directory"]),
    ];
    for (bin, flag) in candidates {
        let mut cmd = Command::new(bin);
        if flag.len() == 1 {
            cmd.arg(flag[0]).arg(cwd);
        }
        if cmd.spawn().is_ok() {
            return Ok(());
        }
    }

    // Debian/Ubuntu alternative; cwd via process current_dir when supported.
    if Command::new("x-terminal-emulator")
        .current_dir(cwd)
        .spawn()
        .is_ok()
    {
        return Ok(());
    }

    Err(AppError::message(
        "no terminal emulator found (install xdg-terminal-exec or set $TERMINAL)",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn cwd_for_directory_is_self() {
        let dir = std::env::temp_dir().join(format!("agentero-term-dir-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let got = terminal_cwd_for_path(&dir).unwrap();
        assert_eq!(got, dir);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cwd_for_file_is_parent() {
        let dir = std::env::temp_dir().join(format!("agentero-term-file-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        fs::write(&file, "x").unwrap();
        let got = terminal_cwd_for_path(&file).unwrap();
        assert_eq!(got, dir);
        let _ = fs::remove_dir_all(&dir);
    }
}
