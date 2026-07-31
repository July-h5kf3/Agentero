//! Download PDF + arXiv LaTeX source into a paper folder's `source/`.
//!
//! Flow: always try PDF → arXiv also tries e-print TeX → caller may liteparse when no TeX.

use crate::core::error::AppError;
use flate2::read::GzDecoder;
use serde::Serialize;
use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tar::Archive;
use tauri::{AppHandle, Emitter};

// Browser-like UA: several non-arXiv publishers (PLOS, IEEE, Springer, …)
// reject non-browser agents with HTTP 403, which blocked DOI PDF downloads.
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDownloadResult {
    pub pdf: bool,
    pub tex: bool,
    /// True when `PAPER.md` was written (or already present after auto-parse).
    #[serde(default)]
    pub paper_md: bool,
    pub messages: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDownloadProgress {
    pub task_id: String,
    pub phase: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub progress: Option<u8>,
    /// Optional item counters for batch operations (e.g. import 2/5).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_count: Option<usize>,
}

#[derive(Clone, Copy)]
pub struct AssetProgressContext<'a> {
    pub app: Option<&'a AppHandle>,
    pub task_id: Option<&'a str>,
}

impl AssetProgressContext<'_> {
    /// Emit a phase transition that has no meaningful byte-level progress.
    pub fn emit_phase(&self, phase: &str) {
        let (Some(app), Some(task_id)) = (self.app, self.task_id) else {
            return;
        };
        let _ = app.emit(
            "background-task:progress",
            AssetDownloadProgress {
                task_id: task_id.to_string(),
                phase: phase.to_string(),
                downloaded_bytes: 0,
                total_bytes: None,
                progress: None,
                current_count: None,
                total_count: None,
            },
        );
    }
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
///
/// - **PDF** → paper folder root: `{paper}/{id}.pdf` (not under `source/`)
/// - **TeX** (arXiv e-print) → `{paper}/source/`
///
/// Order: PDF first, then TeX. Caller runs liteparse when `!tex && pdf`.
pub async fn ensure_paper_assets(
    paper_dir: &Path,
    id: &str,
    arxiv_id: Option<&str>,
    pdf_url: Option<&str>,
    doi: Option<&str>,
) -> Result<AssetDownloadResult, AppError> {
    ensure_paper_assets_with_cookies(paper_dir, id, arxiv_id, pdf_url, doi, None).await
}

pub async fn ensure_paper_assets_with_progress(
    paper_dir: &Path,
    id: &str,
    arxiv_id: Option<&str>,
    pdf_url: Option<&str>,
    doi: Option<&str>,
    cookies: Option<&str>,
    progress: AssetProgressContext<'_>,
) -> Result<AssetDownloadResult, AppError> {
    ensure_paper_assets_impl(paper_dir, id, arxiv_id, pdf_url, doi, cookies, progress).await
}

/// Variant used by browser integrations that provide the page's cookie jar.
/// The cookie string is only sent to the explicitly supplied attachment URL.
pub async fn ensure_paper_assets_with_cookies(
    paper_dir: &Path,
    id: &str,
    arxiv_id: Option<&str>,
    pdf_url: Option<&str>,
    doi: Option<&str>,
    cookies: Option<&str>,
) -> Result<AssetDownloadResult, AppError> {
    ensure_paper_assets_impl(
        paper_dir,
        id,
        arxiv_id,
        pdf_url,
        doi,
        cookies,
        AssetProgressContext {
            app: None,
            task_id: None,
        },
    )
    .await
}

async fn ensure_paper_assets_impl(
    paper_dir: &Path,
    id: &str,
    arxiv_id: Option<&str>,
    pdf_url: Option<&str>,
    doi: Option<&str>,
    cookies: Option<&str>,
    progress: AssetProgressContext<'_>,
) -> Result<AssetDownloadResult, AppError> {
    let mut out = AssetDownloadResult::default();
    fs::create_dir_all(paper_dir)?;

    let need_pdf = !has_local_pdf(paper_dir);
    let need_tex = !has_local_tex(paper_dir);

    if need_pdf {
        let mut candidates = pdf_url_candidates(id, arxiv_id, pdf_url);
        let mut ok = try_download_candidates_with_cookies(
            paper_dir,
            id,
            &candidates,
            &mut out,
            cookies,
            progress.app,
            progress.task_id,
        )
        .await;
        // DOI fallback: Crossref often lists a direct / open-access PDF link even
        // when the Translator gave no pdf_url (or the publisher landing page failed).
        if !ok {
            if let Some(doi) = doi.map(str::trim).filter(|s| !s.is_empty()) {
                let extra: Vec<String> = crossref_pdf_urls(doi)
                    .await
                    .into_iter()
                    .filter(|u| !candidates.iter().any(|c| c == u))
                    .collect();
                if extra.is_empty() {
                    out.messages
                        .push("pdf: no Crossref PDF link for DOI".into());
                } else {
                    ok = try_download_candidates_with_cookies(
                        paper_dir,
                        id,
                        &extra,
                        &mut out,
                        cookies,
                        progress.app,
                        progress.task_id,
                    )
                    .await;
                    candidates.extend(extra);
                }
            }
        }
        // Unpaywall fallback: open-access PDF for DOI papers (helps some ACM/IEEE
        // and other paywalled papers that have an OA copy; no API key required).
        if !ok {
            if let Some(doi) = doi.map(str::trim).filter(|s| !s.is_empty()) {
                if let Some(url) = unpaywall_pdf_url(doi).await {
                    if !candidates.iter().any(|c| c == &url) {
                        ok = try_download_candidates_with_cookies(
                            paper_dir,
                            id,
                            std::slice::from_ref(&url),
                            &mut out,
                            cookies,
                            progress.app,
                            progress.task_id,
                        )
                        .await;
                        candidates.push(url);
                    }
                }
            }
        }
        if !ok && candidates.is_empty() {
            out.messages.push("pdf: no url".into());
        }
    } else {
        out.pdf = true;
        out.messages.push("pdf already present".into());
    }

    // LaTeX only for arXiv papers → unpack into source/
    if let Some(aid) = arxiv_id.filter(|a| !a.trim().is_empty()) {
        if need_tex {
            let source = paper_dir.join("source");
            fs::create_dir_all(&source)?;
            match download_arxiv_source(&source, paper_dir, aid, progress.app, progress.task_id)
                .await
            {
                Ok(()) => {
                    // A PDF-only e-print also returns Ok (the PDF is written to
                    // the paper root and no TeX is extracted), so success here
                    // does not guarantee TeX. The has_local_tex refresh below
                    // sets `tex` from what actually landed on disk.
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

/// Build ordered PDF URL candidates (first success wins).
fn pdf_url_candidates(id: &str, arxiv_id: Option<&str>, pdf_url: Option<&str>) -> Vec<String> {
    let mut out = Vec::new();
    let mut push = |u: String| {
        let t = u.trim().to_string();
        if !t.is_empty() && !out.iter().any(|x| x == &t) {
            out.push(t);
        }
    };

    if let Some(u) = pdf_url.map(str::trim).filter(|s| !s.is_empty()) {
        push(u.to_string());
    }

    let bare_arxiv = arxiv_id
        .map(strip_version)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            // Folder / id often is the arXiv id
            let s = strip_version(id);
            if looks_like_arxiv_id(&s) {
                Some(s)
            } else {
                None
            }
        });

    if let Some(bare) = bare_arxiv {
        push(format!("https://arxiv.org/pdf/{bare}"));
        push(format!("https://arxiv.org/pdf/{bare}.pdf"));
        push(format!("https://export.arxiv.org/pdf/{bare}"));
    }

    out
}

/// Query Unpaywall for a DOI's best open-access PDF location (no API key needed).
/// Returns the `best_oa_location.url_for_pdf` when present.
async fn unpaywall_pdf_url(doi: &str) -> Option<String> {
    let url = format!(
        "https://api.unpaywall.org/v2/{}?email=agentero@users.noreply.github.com",
        doi.trim()
    );
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .build()
        .ok()?;
    let resp = client.get(&url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(&resp.text().await.ok()?).ok()?;
    v.pointer("/best_oa_location/url_for_pdf")
        .and_then(|u| u.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Try each PDF URL in order; write on first success. Returns true when a PDF was saved.
async fn try_download_candidates_with_cookies(
    paper_dir: &Path,
    id: &str,
    urls: &[String],
    out: &mut AssetDownloadResult,
    cookies: Option<&str>,
    app: Option<&AppHandle>,
    task_id: Option<&str>,
) -> bool {
    for url in urls {
        // PDF lives next to NOTES.md, not under source/
        match download_pdf_with_cookies(paper_dir, id, url, cookies, app, task_id).await {
            Ok(()) => {
                out.pdf = true;
                out.messages.push(format!("pdf ok ({url})"));
                return true;
            }
            Err(e) => {
                out.messages
                    .push(format!("pdf candidate failed ({url}): {e}"));
            }
        }
    }
    false
}

/// Query Crossref for a DOI's direct / open-access PDF links (no API key needed).
/// Prefers links whose content-type is application/pdf; falls back to any link URL.
async fn crossref_pdf_urls(doi: &str) -> Vec<String> {
    let api = format!(
        "https://api.crossref.org/works/{}",
        doi.trim().replace(' ', "%20")
    );
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
    else {
        return Vec::new();
    };
    let Ok(res) = client
        .get(&api)
        .header("Accept", "application/json")
        .send()
        .await
    else {
        return Vec::new();
    };
    if !res.status().is_success() {
        return Vec::new();
    }
    let Ok(text) = res.text().await else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Vec::new();
    };
    let mut pdf_links = Vec::new();
    let mut other_links = Vec::new();
    if let Some(links) = value.pointer("/message/link").and_then(|v| v.as_array()) {
        for l in links {
            let url = l.get("URL").and_then(|v| v.as_str()).unwrap_or("").trim();
            if url.is_empty() {
                continue;
            }
            let ct = l.get("content-type").and_then(|v| v.as_str()).unwrap_or("");
            if ct.eq_ignore_ascii_case("application/pdf")
                || url.to_ascii_lowercase().ends_with(".pdf")
            {
                pdf_links.push(url.to_string());
            } else {
                other_links.push(url.to_string());
            }
        }
    }
    if pdf_links.is_empty() {
        other_links
    } else {
        pdf_links
    }
}

fn looks_like_arxiv_id(s: &str) -> bool {
    // 1412.6980 or hep-th/9901001
    let s = s.trim();
    if s.is_empty() {
        return false;
    }
    if s.contains('/') {
        return true;
    }
    let parts: Vec<_> = s.split('.').collect();
    parts.len() == 2
        && parts[0].len() == 4
        && parts[0].chars().all(|c| c.is_ascii_digit())
        && parts[1].chars().all(|c| c.is_ascii_digit())
        && (parts[1].len() >= 4 && parts[1].len() <= 5)
}

async fn download_pdf_with_cookies(
    source_dir: &Path,
    id: &str,
    url: &str,
    cookies: Option<&str>,
    app: Option<&AppHandle>,
    task_id: Option<&str>,
) -> Result<(), AppError> {
    let bytes =
        http_get_bytes_with_progress(url, Duration::from_secs(180), app, task_id, cookies, "pdf")
            .await?;
    // Reject HTML error pages disguised as PDF
    if bytes.len() >= 4 && &bytes[..4] == b"%PDF" {
        let name = safe_filename(id, "pdf");
        fs::write(source_dir.join(name), &bytes)?;
        return Ok(());
    }
    // Some servers omit magic; still write if URL looks like pdf and body is large
    if (url.contains("/pdf/") || url.ends_with(".pdf")) && bytes.len() > 1024 {
        // Avoid writing HTML error pages
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(200)]).to_ascii_lowercase();
        if head.contains("<!doctype") || head.contains("<html") {
            return Err(AppError::message("download returned HTML, not PDF"));
        }
        let name = safe_filename(id, "pdf");
        fs::write(source_dir.join(name), &bytes)?;
        return Ok(());
    }
    Err(AppError::message("download did not look like a PDF"))
}

/// Fetch arXiv e-print and unpack TeX into `source/`.
/// PDF-only e-prints are written to the **paper folder root** (same as normal PDF download).
async fn download_arxiv_source(
    source_dir: &Path,
    paper_dir: &Path,
    arxiv_id: &str,
    app: Option<&AppHandle>,
    task_id: Option<&str>,
) -> Result<(), AppError> {
    let bare = strip_version(arxiv_id);
    // Prefer e-print; /src/ is an alias
    let url = format!("https://arxiv.org/e-print/{bare}");
    let bytes =
        http_get_bytes_with_progress(&url, Duration::from_secs(180), app, task_id, None, "tex")
            .await?;
    unpack_arxiv_eprint(source_dir, paper_dir, &bare, &bytes)
}

fn unpack_arxiv_eprint(
    source_dir: &Path,
    paper_dir: &Path,
    bare_id: &str,
    bytes: &[u8],
) -> Result<(), AppError> {
    if bytes.is_empty() {
        return Err(AppError::message("empty e-print response"));
    }

    // PDF-only submissions → paper folder root (not source/)
    if bytes.len() >= 4 && &bytes[..4] == b"%PDF" {
        // Only write if we don't already have a local PDF
        if !has_local_pdf(paper_dir) {
            fs::write(paper_dir.join(safe_filename(bare_id, "pdf")), bytes)?;
        }
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

pub(crate) fn extract_tar_safe(dest: &Path, tar_bytes: &[u8]) -> Result<(), AppError> {
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

pub(crate) async fn http_get_bytes_with_progress(
    url: &str,
    timeout: Duration,
    app: Option<&AppHandle>,
    task_id: Option<&str>,
    cookies: Option<&str>,
    phase: &str,
) -> Result<Vec<u8>, AppError> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| AppError::message(format!("http client: {e}")))?;
    let mut request = client
        .get(url)
        .header("Accept", "application/pdf,application/octet-stream,*/*");
    if let Some(cookie) = cookies.map(str::trim).filter(|s| !s.is_empty()) {
        request = request.header(reqwest::header::COOKIE, cookie);
    }
    let mut res = request
        .send()
        .await
        .map_err(|e| AppError::message(format!("download: {e}")))?;
    if !res.status().is_success() {
        return Err(AppError::message(format!("download HTTP {}", res.status())));
    }
    let total_bytes = res.content_length();
    let mut downloaded_bytes = 0_u64;
    let mut bytes = Vec::new();
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| AppError::message(format!("download body: {e}")))?
    {
        if let Some(task_id) = task_id {
            if crate::features::agent::background_tasks::is_cancelled(task_id) {
                return Err(AppError::message("background task cancelled"));
            }
        }
        downloaded_bytes += chunk.len() as u64;
        bytes.extend_from_slice(&chunk);
        if let (Some(app), Some(task_id)) = (app, task_id) {
            let progress = total_bytes.map(|total| {
                ((downloaded_bytes.saturating_mul(100) / total.max(1)).min(100)) as u8
            });
            let _ = app.emit(
                "background-task:progress",
                AssetDownloadProgress {
                    task_id: task_id.to_string(),
                    phase: phase.to_string(),
                    downloaded_bytes,
                    total_bytes,
                    progress,
                    current_count: None,
                    total_count: None,
                },
            );
        }
    }
    Ok(bytes)
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
        let paper = std::env::temp_dir().join(format!("agentero-paper-{}", std::process::id()));
        let source = paper.join("source");
        let _ = fs::remove_dir_all(&paper);
        fs::create_dir_all(&source).unwrap();

        let tex = b"\\documentclass{article}\\begin{document}Hi\\end{document}";
        unpack_arxiv_eprint(&source, &paper, "1706.03762", tex).unwrap();
        assert!(source.join("1706.03762.tex").exists());

        let mut enc = GzEncoder::new(Vec::new(), Compression::default());
        enc.write_all(b"\\documentclass{article}\n").unwrap();
        let gz = enc.finish().unwrap();
        unpack_arxiv_eprint(&source, &paper, "1234.5678", &gz).unwrap();
        assert!(source.join("1234.5678.tex").exists());

        let _ = fs::remove_dir_all(&paper);
    }

    #[test]
    fn unpack_pdf_only_eprint_to_paper_root() {
        let paper =
            std::env::temp_dir().join(format!("agentero-pdf-eprint-{}", std::process::id()));
        let source = paper.join("source");
        let _ = fs::remove_dir_all(&paper);
        fs::create_dir_all(&source).unwrap();

        let mut pdf = b"%PDF-1.4".to_vec();
        pdf.extend_from_slice(&[0u8; 64]);
        unpack_arxiv_eprint(&source, &paper, "1412.6980", &pdf).unwrap();
        assert!(paper.join("1412.6980.pdf").exists());
        assert!(!source.join("1412.6980.pdf").exists());

        let _ = fs::remove_dir_all(&paper);
    }

    #[test]
    fn pdf_candidates_include_arxiv() {
        let c = pdf_url_candidates(
            "1412.6980",
            Some("1412.6980"),
            Some("https://arxiv.org/pdf/1412.6980"),
        );
        assert!(c.iter().any(|u| u.contains("arxiv.org/pdf/1412.6980")));
        assert!(c.len() >= 2);
    }

    #[test]
    fn looks_like_arxiv_id_basic() {
        assert!(looks_like_arxiv_id("1412.6980"));
        assert!(looks_like_arxiv_id("1706.03762"));
        assert!(!looks_like_arxiv_id("not-an-id"));
    }
}
