//! Open a local directory as a Vault in the desktop App via deep link.

use crate::error::CliError;
use crate::resolve::GlobalOpts;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// Build the desktop deep-link URL for `agentero open <path>`.
pub fn open_deep_link_url(absolute_path: &Path) -> String {
    let encoded = urlencoding_encode(&absolute_path.to_string_lossy());
    format!("agentero://open?path={encoded}")
}

/// Percent-encode a path for use in a query value (encode `/` too for safety).
fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char);
            }
            _ => {
                out.push('%');
                out.push(char::from(b"0123456789ABCDEF"[(b >> 4) as usize]));
                out.push(char::from(b"0123456789ABCDEF"[(b & 0xf) as usize]));
            }
        }
    }
    out
}

/// Resolve and validate a directory path for open.
pub fn resolve_open_dir(path: &Path) -> Result<PathBuf, CliError> {
    let expanded = expand_user(path);
    if !expanded.exists() {
        return Err(CliError::usage(format!(
            "path does not exist: {}",
            expanded.display()
        )));
    }
    if !expanded.is_dir() {
        return Err(CliError::usage(format!(
            "path is not a directory: {}",
            expanded.display()
        )));
    }
    expanded.canonicalize().map_err(|e| {
        CliError::message(format!(
            "failed to resolve path {}: {e}",
            expanded.display()
        ))
    })
}

fn expand_user(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if s == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    }
    if let Some(rest) = s.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    path.to_path_buf()
}

/// Open the desktop app at `path` (or dry-run when `AGENTERO_OPEN_DRY_RUN=1`).
pub fn run(path: &Path, globals: &GlobalOpts) -> Result<Value, CliError> {
    let abs = resolve_open_dir(path)?;
    let url = open_deep_link_url(&abs);
    let dry = matches!(
        std::env::var("AGENTERO_OPEN_DRY_RUN").as_deref(),
        Ok("1") | Ok("true") | Ok("TRUE")
    );
    if !dry {
        open_system_url(&url)?;
    }
    Ok(json!({
        "path": abs.to_string_lossy(),
        "url": url,
        "dryRun": dry,
        "lines": [if dry {
            format!("would open {}", globals.style.path(&abs.to_string_lossy()))
        } else {
            format!("opening {}", globals.style.path(&abs.to_string_lossy()))
        }],
    }))
}

fn open_system_url(url: &str) -> Result<(), CliError> {
    #[cfg(target_os = "macos")]
    let (program, args): (&str, Vec<&str>) = ("open", vec![url]);
    #[cfg(target_os = "linux")]
    let (program, args): (&str, Vec<&str>) = ("xdg-open", vec![url]);
    #[cfg(target_os = "windows")]
    // `start` treats the first quoted arg as a window title.
    let (program, args): (&str, Vec<&str>) = ("cmd", vec!["/C", "start", "", url]);
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = url;
        return Err(CliError::message(
            "agentero open is not supported on this platform",
        ));
    }
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
    {
        let status = std::process::Command::new(program)
            .args(&args)
            .status()
            .map_err(|e| CliError::message(format!("failed to invoke {program}: {e}")))?;
        if !status.success() {
            return Err(CliError::message(format!(
                "{program} exited with {status}; is Agentero installed and registered for agentero:// ?"
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deep_link_encodes_path() {
        let url = open_deep_link_url(Path::new("/tmp/my vault"));
        assert!(url.starts_with("agentero://open?path="));
        assert!(url.contains("%20") || url.contains("my%20vault") || url.contains("%2F"));
        assert!(!url.contains(" "));
    }
}
