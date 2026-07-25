//! Path safety and shared FS metadata types.

use serde::Serialize;

/// Capability flags so UI / business logic can degrade without guesswork.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsCaps {
    pub atomic_rename: bool,
    pub reliable_watch: bool,
    pub sqlite_native: bool,
    pub cheap_random_read: bool,
    pub agent_cwd_local: bool,
    pub finder_reveal: bool,
}

impl FsCaps {
    pub const LOCAL: Self = Self {
        atomic_rename: true,
        reliable_watch: true,
        sqlite_native: true,
        cheap_random_read: true,
        agent_cwd_local: true,
        finder_reveal: true,
    };

    pub const REMOTE: Self = Self {
        atomic_rename: true,
        reliable_watch: false,
        sqlite_native: false,
        cheap_random_read: false,
        agent_cwd_local: false,
        finder_reveal: false,
    };
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsDirEntry {
    pub name: String,
    pub is_dir: bool,
    pub is_file: bool,
    /// Vault-relative path using `/`.
    pub path: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FsFileMeta {
    pub size: u64,
    /// Modified time as unix seconds when known; 0 if unavailable.
    pub mtime: u64,
    pub is_dir: bool,
    pub is_file: bool,
}

/// Normalize a vault-relative path to UNIX style without leading `/`.
pub fn normalize_rel(rel: &str) -> String {
    let s = rel.trim().replace('\\', "/");
    let s = s.trim_matches('/');
    if s.is_empty() || s == "." {
        return String::new();
    }
    // Collapse duplicate slashes
    let mut out = String::with_capacity(s.len());
    let mut prev_slash = false;
    for ch in s.chars() {
        if ch == '/' {
            if !prev_slash {
                out.push('/');
            }
            prev_slash = true;
        } else {
            out.push(ch);
            prev_slash = false;
        }
    }
    out
}

/// Returns true if `rel` attempts to escape the vault root via `..` segments.
pub fn path_escapes_root(rel: &str) -> bool {
    let norm = normalize_rel(rel);
    if norm.is_empty() {
        return false;
    }
    for part in norm.split('/') {
        if part == ".." {
            return true;
        }
    }
    false
}

/// Join remote root (absolute remote path) with vault-relative path.
pub fn join_remote(remote_root: &str, rel: &str) -> Result<String, String> {
    if path_escapes_root(rel) {
        return Err("path escapes vault root".into());
    }
    let root = remote_root.trim_end_matches('/');
    let rel = normalize_rel(rel);
    if rel.is_empty() {
        Ok(if root.is_empty() {
            "/".into()
        } else {
            root.to_string()
        })
    } else if root.is_empty() {
        Ok(format!("/{rel}"))
    } else {
        Ok(format!("{root}/{rel}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_strips_and_collapses() {
        assert_eq!(normalize_rel("/a//b/"), "a/b");
        assert_eq!(normalize_rel("."), "");
        assert_eq!(normalize_rel("papers\\x\\NOTES.md"), "papers/x/NOTES.md");
    }

    #[test]
    fn escape_detection() {
        assert!(path_escapes_root("../etc/passwd"));
        assert!(path_escapes_root("a/../../b"));
        assert!(!path_escapes_root("papers/1706.03762/NOTES.md"));
        assert!(!path_escapes_root(""));
    }

    #[test]
    fn join_remote_ok() {
        assert_eq!(
            join_remote("/data/vault", "papers/x").unwrap(),
            "/data/vault/papers/x"
        );
        assert_eq!(join_remote("/data/vault/", "").unwrap(), "/data/vault");
        assert!(join_remote("/data/vault", "../x").is_err());
    }
}
