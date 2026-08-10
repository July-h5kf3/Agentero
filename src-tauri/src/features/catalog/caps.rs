use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PaperCaps {
    pub pdf_path: Option<PathBuf>,
    pub has_tex: bool,
    pub has_paper_md: bool,
}

impl PaperCaps {
    pub fn has_pdf(&self) -> bool {
        self.pdf_path.is_some()
    }
}

pub fn probe_paper_caps(paper_dir: &Path) -> PaperCaps {
    let mut caps = PaperCaps {
        has_paper_md: has_paper_md(paper_dir),
        ..Default::default()
    };
    let mut stack = Vec::new();

    if let Ok(entries) = fs::read_dir(paper_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if is_ext(&path, &["pdf"]) && caps.pdf_path.is_none() {
                caps.pdf_path = Some(path);
            } else if is_ext(&path, &["tex", "ltx"]) {
                caps.has_tex = true;
            }
        }
    }

    while let Some(dir) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if stack.len() < 32 {
                    stack.push(path);
                }
                continue;
            }
            if caps.pdf_path.is_none() && is_ext(&path, &["pdf"]) {
                caps.pdf_path = Some(path);
            } else if is_ext(&path, &["tex", "ltx"]) {
                caps.has_tex = true;
            }
            if caps.pdf_path.is_some() && caps.has_tex {
                return caps;
            }
        }
    }

    caps
}

pub fn find_local_pdf(paper_dir: &Path) -> Option<PathBuf> {
    probe_paper_caps(paper_dir).pdf_path
}

pub fn has_local_pdf(paper_dir: &Path) -> bool {
    probe_paper_caps(paper_dir).has_pdf()
}

pub fn has_local_tex(paper_dir: &Path) -> bool {
    probe_paper_caps(paper_dir).has_tex
}

pub fn has_paper_md(paper_dir: &Path) -> bool {
    paper_dir.join("PAPER.md").is_file()
}

fn is_ext(path: &Path, exts: &[&str]) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| {
            exts.iter()
                .any(|candidate| ext.eq_ignore_ascii_case(candidate))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_paper_dir(name: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "agentero-paper-caps-{}-{}-{stamp}",
            std::process::id(),
            name
        ));
        fs::create_dir_all(&dir).expect("create temp paper dir");
        dir
    }

    #[test]
    fn probe_detects_root_paper_md_only() {
        let root = temp_paper_dir("root-paper-md");
        fs::write(root.join("PAPER.md"), "body").expect("write root paper md");
        fs::create_dir_all(root.join("source")).expect("create source dir");
        fs::write(root.join("source/PAPER.md"), "nested").expect("write nested paper md");
        assert!(probe_paper_caps(&root).has_paper_md);
        fs::remove_dir_all(&root).ok();

        let nested_only = temp_paper_dir("nested-paper-md");
        fs::create_dir_all(nested_only.join("source")).expect("create nested source dir");
        fs::write(nested_only.join("source/PAPER.md"), "nested").expect("write nested paper md");
        assert!(!probe_paper_caps(&nested_only).has_paper_md);
        fs::remove_dir_all(&nested_only).ok();
    }

    #[test]
    fn probe_prefers_root_pdf_over_nested_pdf() {
        let root = temp_paper_dir("root-pdf");
        let root_pdf = root.join("root.PDF");
        fs::write(&root_pdf, b"%PDF root").expect("write root pdf");
        fs::create_dir_all(root.join("source")).expect("create source dir");
        fs::write(root.join("source/nested.pdf"), b"%PDF nested").expect("write nested pdf");
        assert_eq!(
            probe_paper_caps(&root).pdf_path.as_deref(),
            Some(root_pdf.as_path())
        );
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn probe_finds_nested_pdf_when_no_root_pdf() {
        let root = temp_paper_dir("nested-pdf");
        fs::create_dir_all(root.join("source/deep")).expect("create deep source dir");
        let nested_pdf = root.join("source/deep/file.PdF");
        fs::write(&nested_pdf, b"%PDF nested").expect("write nested pdf");
        let caps = probe_paper_caps(&root);
        assert!(caps.has_pdf());
        assert_eq!(caps.pdf_path.as_deref(), Some(nested_pdf.as_path()));
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn probe_finds_recursive_tex_and_ltx_case_insensitive() {
        let tex_root = temp_paper_dir("tex");
        fs::create_dir_all(tex_root.join("source/deep")).expect("create tex source dir");
        fs::write(tex_root.join("source/deep/main.TeX"), "tex").expect("write tex");
        assert!(probe_paper_caps(&tex_root).has_tex);
        fs::remove_dir_all(&tex_root).ok();

        let ltx_root = temp_paper_dir("ltx");
        fs::create_dir_all(ltx_root.join("source/deep")).expect("create ltx source dir");
        fs::write(ltx_root.join("source/deep/main.LTX"), "ltx").expect("write ltx");
        assert!(probe_paper_caps(&ltx_root).has_tex);
        fs::remove_dir_all(&ltx_root).ok();
    }

    #[test]
    fn probe_empty_folder_reports_no_caps() {
        let root = temp_paper_dir("empty");
        let caps = probe_paper_caps(&root);
        assert!(!caps.has_pdf());
        assert!(!caps.has_tex);
        assert!(!caps.has_paper_md);
        fs::remove_dir_all(&root).ok();
    }
}
