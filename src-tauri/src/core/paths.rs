//! Application data directories following the [XDG Base Directory
//! Specification](https://specifications.freedesktop.org/basedir-spec/latest/).
//!
//! | Kind | Env | Default (Unix) | Contents |
//! |------|-----|----------------|----------|
//! | config | `$XDG_CONFIG_HOME` | `~/.config` | `agentero/settings.json`, `agents.json` |
//! | cache | `$XDG_CACHE_HOME` | `~/.cache` | remote work mirrors, PDF blobs |
//! | data | `$XDG_DATA_HOME` | `~/.local/share` | reserved |
//! | state | `$XDG_STATE_HOME` | `~/.local/state` | reserved |
//!
//! On Windows, when XDG env vars are unset, falls back to the platform dirs
//! crate (`config` → `%APPDATA%`, `cache` → `%LOCALAPPDATA%`).

use std::path::PathBuf;

/// Resolve XDG config home (`$XDG_CONFIG_HOME` or platform default).
pub fn xdg_config_home() -> PathBuf {
    if let Some(p) = env_dir("XDG_CONFIG_HOME") {
        return p;
    }
    #[cfg(windows)]
    {
        dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(not(windows))]
    {
        home_dir().join(".config")
    }
}

/// Resolve XDG cache home (`$XDG_CACHE_HOME` or platform default).
pub fn xdg_cache_home() -> PathBuf {
    if let Some(p) = env_dir("XDG_CACHE_HOME") {
        return p;
    }
    #[cfg(windows)]
    {
        dirs::cache_dir().unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(not(windows))]
    {
        home_dir().join(".cache")
    }
}

/// `$XDG_CONFIG_HOME/agentero` (created on demand by callers).
pub fn agentero_config_dir() -> PathBuf {
    xdg_config_home().join("agentero")
}

/// `$XDG_CACHE_HOME/agentero` (created on demand by callers).
pub fn agentero_cache_dir() -> PathBuf {
    xdg_cache_home().join("agentero")
}

/// App settings file: `…/agentero/settings.json`.
pub fn settings_path() -> PathBuf {
    agentero_config_dir().join("settings.json")
}

/// Agent registry file: `…/agentero/agents.json`.
pub fn agents_path() -> PathBuf {
    agentero_config_dir().join("agents.json")
}

/// Pre-XDG path used by older builds (`dirs::config_dir()/agentero`).
/// On Linux this often equals the XDG path; on macOS it was
/// `~/Library/Application Support/agentero`.
pub fn legacy_config_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("agentero"))
}

/// If `target` is missing but a legacy file exists, copy it once (best-effort).
pub fn migrate_legacy_file(file_name: &str, target: &std::path::Path) {
    if target.exists() {
        return;
    }
    let Some(legacy_dir) = legacy_config_dir() else {
        return;
    };
    // Same directory as the new path — nothing to migrate.
    if legacy_dir == agentero_config_dir() {
        return;
    }
    let src = legacy_dir.join(file_name);
    if !src.is_file() {
        return;
    }
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::copy(&src, target) {
        Ok(_) => {
            log::info!(
                target: "agentero::paths",
                "migrated {file_name} from {} → {}",
                src.display(),
                target.display()
            );
        }
        Err(e) => {
            log::warn!(
                target: "agentero::paths",
                "failed to migrate {file_name} from {}: {e}",
                src.display()
            );
        }
    }
}

fn env_dir(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// Fallback home directory for XDG defaults. Only used on non-Windows platforms
/// (Windows uses `dirs::config_dir`/`cache_dir` directly), hence the cfg gate to
/// avoid a dead-code warning on Windows builds.
#[cfg(not(windows))]
fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_dir_ends_with_agentero() {
        let p = agentero_config_dir();
        assert_eq!(p.file_name().and_then(|s| s.to_str()), Some("agentero"));
    }

    #[test]
    fn settings_and_agents_share_config_dir() {
        assert_eq!(settings_path().parent(), agents_path().parent());
    }

    #[test]
    fn cache_dir_ends_with_agentero() {
        let p = agentero_cache_dir();
        assert_eq!(p.file_name().and_then(|s| s.to_str()), Some("agentero"));
    }
}
