use std::path::{Path, PathBuf};

/// Extra directories GUI apps often miss when launched outside a login shell.
fn extra_path_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".cargo/bin"));
        dirs.push(home.join("bin"));
        // fnm / nvm common locations (best-effort)
        dirs.push(home.join(".fnm"));
    }
    // Windows: a GUI app often starts without the user's full PATH, and npm/pnpm
    // global bins plus package-manager shims (.cmd) live outside the default PATH.
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            dirs.push(PathBuf::from(appdata).join("npm")); // npm i -g shims
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let local = PathBuf::from(local);
            dirs.push(local.join("pnpm")); // pnpm global bin
            dirs.push(local.join("Microsoft").join("WinGet").join("Links")); // winget
        }
        if let Some(home) = dirs::home_dir() {
            dirs.push(home.join("scoop").join("shims")); // scoop
        }
    }
    #[cfg(not(windows))]
    {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/usr/bin"));
        dirs.push(PathBuf::from("/bin"));
    }
    dirs
}

pub fn path_entries() -> Vec<PathBuf> {
    let mut entries = Vec::new();
    if let Ok(path) = std::env::var("PATH") {
        for part in std::env::split_paths(&path) {
            if !part.as_os_str().is_empty() {
                entries.push(part);
            }
        }
    }
    for extra in extra_path_dirs() {
        if !entries.iter().any(|e| e == &extra) {
            entries.push(extra);
        }
    }
    entries
}

fn is_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Resolve `command` on PATH (and common extra dirs). Absolute paths are checked as-is.
pub fn resolve_command(command: &str) -> Option<PathBuf> {
    let path = Path::new(command);
    if path.is_absolute() || command.contains('/') || command.contains('\\') {
        return if is_executable(path) {
            Some(path.to_path_buf())
        } else {
            None
        };
    }

    // Prefer `which` with current PATH first.
    if let Ok(found) = which::which(command) {
        return Some(found);
    }

    for dir in path_entries() {
        // On Windows, `npm i -g` drops BOTH a bare shell script (for Git Bash)
        // and a `.cmd`/`.exe` shim of the same name. The bare file is not a valid
        // Win32 executable, yet `is_executable` treats any file as runnable, so we
        // must probe the real Windows entrypoints (PATHEXT-style) FIRST — otherwise
        // we'd hand the sh script to CreateProcess and the ACP spawn/probe fails
        // (e.g. `codex-acp`, `claude-agent-acp`).
        #[cfg(windows)]
        for ext in ["exe", "cmd", "bat", "ps1"] {
            let with_ext = dir.join(format!("{command}.{ext}"));
            if is_executable(&with_ext) {
                return Some(with_ext);
            }
        }
        let candidate = dir.join(command);
        if is_executable(&candidate) {
            return Some(candidate);
        }
    }
    None
}

pub fn probe_command(command: &str) -> Result<PathBuf, String> {
    resolve_command(command).ok_or_else(|| {
        format!("command `{command}` not found on PATH (or common install locations)")
    })
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::*;

    #[cfg(unix)]
    #[test]
    fn finds_sh_on_unix() {
        let p = resolve_command("sh");
        assert!(p.is_some());
    }
}
