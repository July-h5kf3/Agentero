//! Spawn a remote BYOA agent over SSH and expose stdio pipes (ACP transport).
//!
//! MVP: separate `ssh` process (does not share the SFTP mux session). Uses system
//! OpenSSH so `~/.ssh/config`, agent, and ProxyJump work.

use crate::error::AppError;
use std::process::Stdio;
use tokio::process::{Child, Command};

/// Build a remote shell command that `cd`s into the vault and execs the agent.
///
/// Uses `bash -lc` so non-interactive SSH still loads the user's login PATH
/// (`~/.local/bin`, nvm, etc.).
pub fn remote_agent_shell_command(remote_cwd: &str, command: &str, args: &[String]) -> String {
    let mut parts = Vec::with_capacity(1 + args.len());
    parts.push(shell_quote(command));
    for a in args {
        parts.push(shell_quote(a));
    }
    let cmd = parts.join(" ");
    let inner = format!("cd {} && exec {}", shell_quote(remote_cwd), cmd);
    format!("bash -lc {}", shell_quote(&inner))
}

fn shell_quote(s: &str) -> String {
    // Single-quote POSIX style
    if s.is_empty() {
        return "''".into();
    }
    if s.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '_' | '-' | '=' | ':' | '+'))
    {
        return s.to_string();
    }
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}

/// Destination for OpenSSH: `host` or `user@host`.
pub async fn spawn_remote_agent(
    destination: &str,
    remote_cwd: &str,
    command: &str,
    args: &[String],
) -> Result<Child, AppError> {
    let remote = remote_agent_shell_command(remote_cwd, command, args);
    let mut cmd = Command::new("ssh");
    cmd.arg("-T")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=15")
        .arg(destination)
        .arg(remote)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    cmd.spawn()
        .map_err(|e| AppError::message(format!("ssh spawn agent: {e}")))
}

/// Discover whether a binary exists on the remote host (`command -v` in login shell).
pub async fn remote_which(destination: &str, bin: &str) -> Result<Option<String>, AppError> {
    // login shell so ~/.local/bin and user profile PATH apply (BatchMode SSH is non-login).
    let remote = format!(
        "bash -lc {}",
        shell_quote(&format!("command -v {}", shell_quote(bin)))
    );
    let output = Command::new("ssh")
        .arg("-T")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ConnectTimeout=15")
        .arg(destination)
        .arg(remote)
        .output()
        .await
        .map_err(|e| AppError::message(format!("ssh which: {e}")))?;
    if !output.status.success() {
        return Ok(None);
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(path))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_and_builds_exec() {
        let s = remote_agent_shell_command("/data/vault", "opencode", &["acp".into()]);
        assert!(s.contains("bash -lc"));
        assert!(s.contains("cd /data/vault"));
        assert!(s.contains("exec opencode acp"));
    }

    #[test]
    fn quotes_spaces() {
        let s = remote_agent_shell_command("/tmp/my vault", "my agent", &[]);
        assert!(s.contains("bash -lc"));
        assert!(s.contains("/tmp/my vault"));
        assert!(s.contains("my agent"));
    }
}
