use std::path::{Path, PathBuf};

/// Extra directories GUI apps often miss when launched outside a login shell.
fn extra_path_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = dirs::home_dir() {
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".cargo/bin"));
        dirs.push(home.join("bin"));
        dirs.push(home.join(".npm-global/bin"));
        dirs.push(home.join(".volta/bin"));
        dirs.extend(nvm_bin_dirs(&home));
        // fnm keeps node versions under its data dir; the `default` alias points
        // at the active one (session multishell dirs are ephemeral, skip them).
        for fnm_dir in [
            home.join("Library/Application Support/fnm"),
            home.join(".local/share/fnm"),
            home.join(".fnm"),
        ] {
            dirs.push(fnm_dir.join("aliases/default/bin"));
        }
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

/// nvm installs binaries under `~/.nvm/versions/node/<ver>/bin`, which GUI apps
/// never see (nvm only mutates PATH in interactive shells). Prefer the version
/// pinned by `~/.nvm/alias/default`, then the rest newest-first.
fn nvm_bin_dirs(home: &Path) -> Vec<PathBuf> {
    let versions_dir = home.join(".nvm/versions/node");
    let Ok(entries) = std::fs::read_dir(&versions_dir) else {
        return Vec::new();
    };
    let mut versions: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    versions.sort_by_key(|v| std::cmp::Reverse(version_key(v)));
    if let Ok(alias) = std::fs::read_to_string(home.join(".nvm/alias/default")) {
        let alias = alias.trim();
        if let Some(pos) = versions
            .iter()
            .position(|v| v == alias || v.strip_prefix('v') == Some(alias))
        {
            let default = versions.remove(pos);
            versions.insert(0, default);
        }
    }
    versions
        .into_iter()
        .map(|v| versions_dir.join(v).join("bin"))
        .collect()
}

fn version_key(name: &str) -> Vec<u64> {
    name.trim_start_matches('v')
        .split('.')
        .map(|p| p.parse::<u64>().unwrap_or(0))
        .collect()
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

    #[test]
    fn version_key_sorts_numerically() {
        let mut v = vec!["v9.11.2", "v24.3.0", "v10.0.0"];
        v.sort_by_key(|b| std::cmp::Reverse(super::version_key(b)));
        assert_eq!(v, vec!["v24.3.0", "v10.0.0", "v9.11.2"]);
    }
}
