//! Map Translator (Zotero API JSON) / arXiv Atom → PaperMeta.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperMeta {
    pub id: String,
    #[serde(rename = "type")]
    pub paper_type: String,
    pub title: String,
    pub authors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creators: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "abstract")]
    pub abstract_text: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arxiv_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub doi: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub isbn: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issn: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pmid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publication: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pages: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub place: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub series: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pdf_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bibtex_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zotero_item_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meta_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub status: String,
    pub added_at: String,
    pub updated_at: String,
}

pub fn map_zotero_item(item: &Value) -> Result<PaperMeta, AppError> {
    let title = item
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if title.is_empty() {
        return Err(AppError::message("translator item missing title"));
    }

    let zotero_type = item
        .get("itemType")
        .and_then(|v| v.as_str())
        .unwrap_or("journalArticle")
        .to_string();

    let mut authors = Vec::new();
    if let Some(arr) = item.get("creators").and_then(|v| v.as_array()) {
        for c in arr {
            let ctype = c
                .get("creatorType")
                .and_then(|v| v.as_str())
                .unwrap_or("author");
            if ctype != "author" && ctype != "editor" {
                continue;
            }
            if let Some(name) = c.get("name").and_then(|v| v.as_str()) {
                authors.push(name.trim().to_string());
            } else {
                let first = c
                    .get("firstName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim();
                let last = c
                    .get("lastName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim();
                let name = format!("{first} {last}").trim().to_string();
                if !name.is_empty() {
                    authors.push(name);
                }
            }
        }
    }

    let date = item
        .get("date")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let year = date.as_ref().and_then(|d| {
        d.chars()
            .take(4)
            .collect::<String>()
            .parse::<i32>()
            .ok()
            .filter(|&y| (1000..=2100).contains(&y))
    });

    let doi = item
        .get("DOI")
        .or_else(|| item.get("doi"))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let isbn = item
        .get("ISBN")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let issn = item
        .get("ISSN")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let publication = item
        .get("publicationTitle")
        .or_else(|| item.get("proceedingsTitle"))
        .or_else(|| item.get("bookTitle"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let extra = item
        .get("extra")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let arxiv_id = extract_arxiv_from_extra(extra.as_deref()).or_else(|| {
        item.get("archiveID").and_then(|v| v.as_str()).map(|s| {
            s.trim()
                .trim_start_matches("arXiv:")
                .trim_start_matches("arxiv:")
                .to_string()
        })
    });

    let pmid = extract_pmid_from_extra(extra.as_deref());

    let url = item
        .get("url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // attachments may carry pdf url
    let mut pdf_url = None;
    if let Some(atts) = item.get("attachments").and_then(|v| v.as_array()) {
        for a in atts {
            let mime = a.get("mimeType").and_then(|v| v.as_str()).unwrap_or("");
            let aurl = a.get("url").and_then(|v| v.as_str()).unwrap_or("");
            if (mime.contains("pdf") || aurl.contains(".pdf") || aurl.contains("/pdf/"))
                && !aurl.is_empty()
            {
                pdf_url = Some(aurl.to_string());
                break;
            }
        }
    }

    let tags = item
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    t.get("tag")
                        .and_then(|v| v.as_str())
                        .or_else(|| t.as_str())
                        .map(|s| s.to_string())
                })
                .collect()
        })
        .unwrap_or_default();

    let paper_type = if arxiv_id.is_some() {
        "arxiv"
    } else if doi.is_some() {
        "doi"
    } else if zotero_type == "webpage" {
        "html"
    } else {
        "other"
    };

    let id = arxiv_id
        .clone()
        .or_else(|| doi.clone().map(|d| doi_slug(&d)))
        .or_else(|| isbn.clone())
        .unwrap_or_else(|| citekey_fallback(&authors, year, &title));

    let now = chrono_lite_now();

    Ok(PaperMeta {
        id,
        paper_type: paper_type.to_string(),
        title,
        authors,
        creators: item.get("creators").cloned(),
        year,
        date,
        abstract_text: item
            .get("abstractNote")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        tags,
        arxiv_id,
        doi,
        isbn,
        issn,
        pmid,
        publication,
        volume: str_field(item, "volume"),
        issue: str_field(item, "issue"),
        pages: str_field(item, "pages"),
        publisher: str_field(item, "publisher"),
        place: str_field(item, "place"),
        series: str_field(item, "series"),
        language: str_field(item, "language"),
        pdf_url,
        html_url: None,
        source_url: url,
        bibtex_key: None,
        zotero_item_type: Some(zotero_type),
        meta_source: str_field(item, "libraryCatalog"),
        extra,
        summary: None,
        status: "completed".into(),
        added_at: now.clone(),
        updated_at: now,
    })
}

pub fn enrich_remote_urls(meta: &mut PaperMeta) {
    if let Some(ref aid) = meta.arxiv_id {
        let bare = aid.trim().trim_start_matches("arXiv:").to_string();
        let bare = strip_v(&bare);
        if meta.pdf_url.as_ref().is_none_or(|s| s.is_empty()) {
            meta.pdf_url = Some(format!("https://arxiv.org/pdf/{bare}"));
        }
        if meta.html_url.as_ref().is_none_or(|s| s.is_empty()) {
            meta.html_url = Some(format!("https://arxiv.org/html/{bare}"));
        }
        if meta.source_url.as_ref().is_none_or(|s| s.is_empty()) {
            meta.source_url = Some(format!("https://arxiv.org/abs/{bare}"));
        }
        if meta.bibtex_key.is_none() {
            meta.bibtex_key = Some(bare.replace('/', ""));
        }
    } else if let Some(ref doi) = meta.doi {
        if meta.source_url.as_ref().is_none_or(|s| s.is_empty()) {
            meta.source_url = Some(format!("https://doi.org/{doi}"));
        }
    }
    if meta.bibtex_key.is_none() {
        meta.bibtex_key = Some(meta.id.replace(['/', '.'], "_"));
    }
}

pub fn map_arxiv_atom(xml: &str, bare_id: &str) -> Result<PaperMeta, AppError> {
    let titles: Vec<String> = xml
        .split("<title>")
        .skip(1)
        .filter_map(|chunk| {
            chunk
                .split("</title>")
                .next()
                .map(collapse_ws)
                .filter(|s| !s.is_empty() && !s.to_lowercase().starts_with("arxiv query"))
        })
        .collect();
    let title = titles
        .first()
        .cloned()
        .unwrap_or_else(|| bare_id.to_string());

    let abstract_text = xml
        .split("<summary>")
        .nth(1)
        .and_then(|c| c.split("</summary>").next())
        .map(collapse_ws);

    let mut authors = Vec::new();
    for part in xml.split("<author>") {
        if let Some(name_chunk) = part.split("<name>").nth(1) {
            if let Some(name) = name_chunk.split("</name>").next() {
                let n = collapse_ws(name);
                if !n.is_empty() {
                    authors.push(n);
                }
            }
        }
    }

    let published = xml
        .split("<published>")
        .nth(1)
        .and_then(|c| c.split("</published>").next())
        .map(|s| s.trim().to_string());
    let year = published
        .as_ref()
        .and_then(|p| p.get(0..4)?.parse::<i32>().ok());

    let now = chrono_lite_now();
    Ok(PaperMeta {
        id: bare_id.to_string(),
        paper_type: "arxiv".into(),
        title,
        authors,
        creators: None,
        year,
        date: published,
        abstract_text,
        tags: vec![],
        arxiv_id: Some(bare_id.to_string()),
        doi: None,
        isbn: None,
        issn: None,
        pmid: None,
        publication: Some("arXiv".into()),
        volume: None,
        issue: None,
        pages: None,
        publisher: None,
        place: None,
        series: None,
        language: None,
        pdf_url: Some(format!("https://arxiv.org/pdf/{bare_id}")),
        html_url: Some(format!("https://arxiv.org/html/{bare_id}")),
        source_url: Some(format!("https://arxiv.org/abs/{bare_id}")),
        bibtex_key: Some(bare_id.replace('/', "")),
        zotero_item_type: Some("preprint".into()),
        meta_source: Some("arXiv.org".into()),
        extra: None,
        summary: None,
        status: "completed".into(),
        added_at: now.clone(),
        updated_at: now,
    })
}

fn str_field(item: &Value, key: &str) -> Option<String> {
    item.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn extract_arxiv_from_extra(extra: Option<&str>) -> Option<String> {
    let extra = extra?;
    for line in extra.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("arXiv:") {
            return Some(rest.split_whitespace().next()?.trim().to_string());
        }
        if line.to_ascii_lowercase().starts_with("arxiv:") {
            return Some(
                line.split_once(':')?
                    .1
                    .split_whitespace()
                    .next()?
                    .trim()
                    .to_string(),
            );
        }
    }
    None
}

fn extract_pmid_from_extra(extra: Option<&str>) -> Option<String> {
    let extra = extra?;
    for line in extra.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("PMID:") {
            return Some(rest.trim().to_string());
        }
    }
    None
}

fn doi_slug(doi: &str) -> String {
    doi.replace(['/', '.'], "_")
}

fn citekey_fallback(authors: &[String], year: Option<i32>, title: &str) -> String {
    let author = authors
        .first()
        .map(|a| {
            a.split_whitespace()
                .last()
                .unwrap_or("paper")
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .collect::<String>()
                .to_lowercase()
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "paper".into());
    let y = year.map(|y| y.to_string()).unwrap_or_else(|| "0000".into());
    let word = title
        .split_whitespace()
        .next()
        .unwrap_or("item")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase();
    format!("{author}{y}{word}")
}

fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn strip_v(id: &str) -> String {
    if let Some(i) = id.rfind('v') {
        if id[i + 1..].chars().all(|c| c.is_ascii_digit()) && i > 0 {
            return id[..i].to_string();
        }
    }
    id.to_string()
}

fn chrono_lite_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}
