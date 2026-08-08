//! Open a local directory as a Vault in the desktop App via deep link.
//!
//! Prefer `agentero://open?path=…` (works when the desktop app has registered
//! the scheme — release installers / macOS bundle). Fall back to launching the
//! GUI binary with the URL as an argv (dev + second-instance single-instance).

use crate::error::CliError;
use crate::resolve::GlobalOpts;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

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
    let mut method = "deep-link";
    if !dry {
        match open_system_url(&url) {
            Ok(()) => {}
            Err(deep_err) => {
                // Dev / unregistered scheme: launch the GUI binary with the URL.
                match launch_gui_with_url(&url) {
                    Ok(gui) => {
                        method = "gui-argv";
                        log::info!(
                            target: "agentero::op",
                            "open via GUI binary {} (deep-link failed: {deep_err})",
                            gui.display()
                        );
                    }
                    Err(gui_err) => {
                        return Err(CliError::message(format!(
                            "could not open desktop App.\n\
                             deep-link: {deep_err}\n\
                             gui launch: {gui_err}\n\
                             Tips: install/run the desktop app once, or in dev keep `pnpm tauri dev` running."
                        )));
                    }
                }
            }
        }
    }
    Ok(json!({
        "path": abs.to_string_lossy(),
        "url": url,
        "method": method,
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
        let status = Command::new(program)
            .args(&args)
            .status()
            .map_err(|e| CliError::message(format!("failed to invoke {program}: {e}")))?;
        if !status.success() {
            return Err(CliError::message(format!(
                "{program} failed ({status}); scheme agentero:// not registered"
            )));
        }
        Ok(())
    }
}

/// Spawn (or second-instance) the desktop GUI with a deep-link URL on argv.
fn launch_gui_with_url(url: &str) -> Result<PathBuf, CliError> {
    let gui = find_gui_binary().ok_or_else(|| {
        CliError::message(
            "desktop binary not found (looked for Agentero.app and target/{debug,release}/agentero)",
        )
    })?;

    #[cfg(target_os = "macos")]
    {
        // Prefer `open -a` when the path is an .app bundle.
        if gui.extension().is_some_and(|e| e == "app")
            || gui
                .file_name()
                .is_some_and(|n| n.to_string_lossy().ends_with(".app"))
        {
            let status = Command::new("open")
                .args(["-a", &gui.to_string_lossy(), "--args", url])
                .status()
                .map_err(|e| CliError::message(format!("open -a failed: {e}")))?;
            if status.success() {
                return Ok(gui);
            }
        }
        // If path is the inner MacOS executable, open its .app parent when possible.
        if let Some(app) = gui
            .ancestors()
            .find(|p| p.extension().is_some_and(|e| e == "app"))
        {
            let status = Command::new("open")
                .args(["-a", &app.to_string_lossy(), "--args", url])
                .status()
                .map_err(|e| CliError::message(format!("open -a failed: {e}")))?;
            if status.success() {
                return Ok(app.to_path_buf());
            }
        }
    }

    // Direct spawn (dev binary or when open -a is unavailable). Detached so the CLI exits.
    let child = Command::new(&gui)
        .arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| {
            CliError::message(format!(
                "failed to spawn desktop binary {}: {e}",
                gui.display()
            ))
        })?;
    // Don't wait — single-instance plugin will forward if already running.
    let _ = child.id();
    Ok(gui)
}

fn find_gui_binary() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    // Same directory as this CLI binary (dev: target/debug/agentero-cli → agentero).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("agentero"));
            #[cfg(windows)]
            candidates.push(dir.join("agentero.exe"));
            // Bundled app layout
            candidates.push(dir.join("Agentero"));
            #[cfg(target_os = "macos")]
            {
                // …/Contents/MacOS/agentero-cli is wrong; GUI is sibling agentero
                // or …/Agentero.app/Contents/MacOS/Agentero
                if let Some(contents) = dir.parent() {
                    if contents.file_name().is_some_and(|n| n == "MacOS") {
                        candidates.push(dir.join("Agentero"));
                        candidates.push(dir.join("agentero"));
                    }
                }
            }
            for ancestor in dir.ancestors().take(6) {
                candidates.push(ancestor.join("target/debug/agentero"));
                candidates.push(ancestor.join("target/release/agentero"));
                #[cfg(target_os = "macos")]
                {
                    candidates.push(
                        ancestor.join("src-tauri/target/release/bundle/macos/Agentero.app"),
                    );
                    candidates
                        .push(ancestor.join("target/release/bundle/macos/Agentero.app"));
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/Applications/Agentero.app"));
        if let Some(home) = dirs::home_dir() {
            candidates.push(home.join("Applications/Agentero.app"));
        }
    }

    candidates.into_iter().find(|p| p.exists())
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
