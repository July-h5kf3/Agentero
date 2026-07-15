//! Download PDF + arXiv LaTeX source into a paper folder's `source/`.

use crate::error::AppError;
use flate2::read::GzDecoder;
use serde::Serialize;
use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tar::Archive;

const USER_AGENT: &str = "motif-lookup/0.1 (+https://github.com/poco-ai/motif)";

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDownloadResult {
    pub pdf: bool,
    pub tex: bool,
    pub messages: Vec<String>,
}

/// True if `source/` (or paper dir) already has a PDF.
pub fn has_local_pdf(paper_dir: &Path) -> bool {
    walk_has_ext(paper_dir, &["pdf"])
}

/// True if `source/` (or paper dir) already has a TeX / LaTeX source file.
pub fn has_local_tex(paper_dir: &Path) -> bool {
    walk_has_ext(paper_dir, &["tex", "ltx"])
}

fn walk_has_ext(root: &Path, exts: &[&str]) -> bool {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Skip huge trees; paper folders are shallow.
                if stack.len() < 32 {
                    stack.push(path);
                }
            } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                let lower = ext.to_ascii_lowercase();
                if exts.iter().any(|x| *x == lower) {
                    return true;
                }
            }
        }
    }
    false
}

/// Download missing PDF (always try when URL known) and arXiv LaTeX source.
pub async fn ensure_paper_assets(
    paper_dir: &Path,
    id: &str,
    arxiv_id: Option<&str>,
    pdf_url: Option<&str>,
) -> Result<AssetDownloadResult, AppError> {
    let mut out = AssetDownloadResult::default();
    let source = paper_dir.join("source");
    fs::create_dir_all(&source)?;

    let need_pdf = !has_local_pdf(paper_dir);
    let need_tex = !has_local_tex(paper_dir);

    if need_pdf {
        let url = pdf_url
            .filter(|u| !u.trim().is_empty())
            .map(str::to_string)
            .or_else(|| {
                arxiv_id
                    .filter(|a| !a.trim().is_empty())
                    .map(|a| format!("https://arxiv.org/pdf/{}", strip_version(a)))
            });
        if let Some(url) = url {
            match download_pdf(&source, id, &url).await {
                Ok(()) => {
                    out.pdf = true;
                    out.messages.push("pdf ok".into());
                }
                Err(e) => out.messages.push(format!("pdf failed: {e}")),
            }
        } else {
            out.messages.push("pdf: no url".into());
        }
    } else {
        out.pdf = true;
        out.messages.push("pdf already present".into());
    }

    // LaTeX only for arXiv papers
    if let Some(aid) = arxiv_id.filter(|a| !a.trim().is_empty()) {
        if need_tex {
            match download_arxiv_source(&source, aid).await {
                Ok(()) => {
                    out.tex = true;
                    out.messages.push("tex ok".into());
                }
                Err(e) => out.messages.push(format!("tex failed: {e}")),
            }
        } else {
            out.tex = true;
            out.messages.push("tex already present".into());
        }
    }

    // Refresh presence after attempts
    if has_local_pdf(paper_dir) {
        out.pdf = true;
    }
    if has_local_tex(paper_dir) {
        out.tex = true;
    }

    Ok(out)
}

async fn download_pdf(source_dir: &Path, id: &str, url: &str) -> Result<(), AppError> {
    let bytes = http_get_bytes(url, Duration::from_secs(180)).await?;
    // Reject HTML error pages disguised as PDF
    if bytes.len() >= 4 && &bytes[..4] == b"%PDF" {
        let name = safe_filename(id, "pdf");
        fs::write(source_dir.join(name), &bytes)?;
        return Ok(());
    }
    // Some servers omit magic; still write if URL looks like pdf and body is large
    if (url.contains("/pdf/") || url.ends_with(".pdf")) && bytes.len() > 1024 {
        let name = safe_filename(id, "pdf");
        fs::write(source_dir.join(name), &bytes)?;
        return Ok(());
    }
    Err(AppError::message("download did not look like a PDF"))
}

/// Fetch arXiv e-print and unpack into `source/`.
async fn download_arxiv_source(source_dir: &Path, arxiv_id: &str) -> Result<(), AppError> {
    let bare = strip_version(arxiv_id);
    // Prefer e-print; /src/ is an alias
    let url = format!("https://arxiv.org/e-print/{bare}");
    let bytes = http_get_bytes(&url, Duration::from_secs(180)).await?;
    unpack_arxiv_eprint(source_dir, &bare, &bytes)
}

fn unpack_arxiv_eprint(source_dir: &Path, bare_id: &str, bytes: &[u8]) -> Result<(), AppError> {
    if bytes.is_empty() {
        return Err(AppError::message("empty e-print response"));
    }

    // PDF-only submissions
    if bytes.len() >= 4 && &bytes[..4] == b"%PDF" {
        fs::write(source_dir.join(safe_filename(bare_id, "pdf")), bytes)?;
        return Ok(());
    }

    let payload = if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
        let mut decoder = GzDecoder::new(Cursor::new(bytes));
        let mut inflated = Vec::new();
        decoder
            .read_to_end(&mut inflated)
            .map_err(|e| AppError::message(format!("gzip decode: {e}")))?;
        inflated
    } else {
        bytes.to_vec()
    };

    // Prefer tar when it looks like one; fall back to single .tex file
    if looks_like_tar(&payload) {
        match extract_tar_safe(source_dir, &payload) {
            Ok(()) => return Ok(()),
            Err(e) => {
                // Rare: not a real tar — store as tex
                let _ = e;
            }
        }
    }

    let sample = String::from_utf8_lossy(&payload[..payload.len().min(400)]);
    if sample.contains('\\')
        || sample.contains("\\documentclass")
        || sample.contains("\\begin{document}")
        || sample.contains("\\section")
        || payload.len() < 512
    {
        fs::write(source_dir.join(safe_filename(bare_id, "tex")), &payload)?;
        return Ok(());
    }

    Err(AppError::message(
        "unrecognized arXiv e-print format (expected gzip/tar/tex/pdf)",
    ))
}

fn looks_like_tar(bytes: &[u8]) -> bool {
    // ustar magic at offset 257
    if bytes.len() > 262 {
        let magic = &bytes[257..262];
        if magic == b"ustar" || magic == b"ustar\0" {
            return true;
        }
        // Some tars use "ustar " (POSIX)
        if &bytes[257..263] == b"ustar " {
            return true;
        }
    }
    // Heuristic: 512-byte blocks with NUL padding in header
    bytes.len() >= 512 && bytes[0] != 0 && bytes.iter().take(100).any(|&b| b == 0)
}

fn extract_tar_safe(dest: &Path, tar_bytes: &[u8]) -> Result<(), AppError> {
    let mut archive = Archive::new(Cursor::new(tar_bytes));
    let entries = archive
        .entries()
        .map_err(|e| AppError::message(format!("tar entries: {e}")))?;

    for entry in entries {
        let mut entry = entry.map_err(|e| AppError::message(format!("tar entry: {e}")))?;
        let path = entry
            .path()
            .map_err(|e| AppError::message(format!("tar path: {e}")))?
            .into_owned();

        let safe = sanitize_tar_path(&path)?;
        if safe.as_os_str().is_empty() {
            continue;
        }
        let out_path = dest.join(&safe);

        if entry.header().entry_type().is_dir() {
            fs::create_dir_all(&out_path)?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut file =
            File::create(&out_path).map_err(|e| AppError::message(format!("create: {e}")))?;
        let mut buf = Vec::new();
        entry
            .read_to_end(&mut buf)
            .map_err(|e| AppError::message(format!("tar read: {e}")))?;
        file.write_all(&buf)
            .map_err(|e| AppError::message(format!("write: {e}")))?;
    }
    Ok(())
}

/// Reject absolute paths and `..` components.
fn sanitize_tar_path(path: &Path) -> Result<PathBuf, AppError> {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::Normal(s) => out.push(s),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(AppError::message("tar path traversal rejected"));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::message("absolute tar path rejected"));
            }
        }
    }
    Ok(out)
}

async fn http_get_bytes(url: &str, timeout: Duration) -> Result<Vec<u8>, AppError> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| AppError::message(format!("http client: {e}")))?;
    let res = client
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::message(format!("download: {e}")))?;
    if !res.status().is_success() {
        return Err(AppError::message(format!("download HTTP {}", res.status())));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| AppError::message(format!("download body: {e}")))?;
    Ok(bytes.to_vec())
}

fn strip_version(id: &str) -> String {
    let s = id
        .trim()
        .trim_start_matches("arXiv:")
        .trim_start_matches("arxiv:");
    if let Some(i) = s.rfind('v') {
        if s[i + 1..].chars().all(|c| c.is_ascii_digit()) && i > 0 {
            return s[..i].to_string();
        }
    }
    s.to_string()
}

fn safe_filename(id: &str, ext: &str) -> String {
    let base = id
        .replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
        .trim()
        .to_string();
    let base = if base.is_empty() {
        "paper".into()
    } else {
        base
    };
    format!("{base}.{ext}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    #[test]
    fn sanitize_rejects_parent() {
        assert!(sanitize_tar_path(Path::new("../evil")).is_err());
        assert!(sanitize_tar_path(Path::new("/abs")).is_err());
        assert_eq!(
            sanitize_tar_path(Path::new("a/b.tex")).unwrap(),
            PathBuf::from("a/b.tex")
        );
    }

    #[test]
    fn unpack_plain_and_gzipped_tex() {
        let dir = std::env::temp_dir().join(format!("motif-tex-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let tex = b"\\documentclass{article}\\begin{document}Hi\\end{document}";
        unpack_arxiv_eprint(&dir, "1706.03762", tex).unwrap();
        assert!(dir.join("1706.03762.tex").exists());

        let mut enc = GzEncoder::new(Vec::new(), Compression::default());
        enc.write_all(b"\\documentclass{article}\n").unwrap();
        let gz = enc.finish().unwrap();
        unpack_arxiv_eprint(&dir, "1234.5678", &gz).unwrap();
        assert!(dir.join("1234.5678.tex").exists());

        let _ = fs::remove_dir_all(&dir);
    }
}
