//! Free machine-translation backends (no paid API keys).
//! Google / Bing Edge / Youdao / DeepLX / Volcengine / Tencent Transmart / LibreTranslate.
//! Unofficial / best-effort; may break or rate-limit.

use crate::core::error::AppError;
use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Soft cap for a single free-MT request (characters).
pub const MAX_TEXT_CHARS: usize = 5000;

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// Known free MT provider ids (plus Host-side `libre` via freeBaseUrl).
pub const FREE_PROVIDERS: &[&str] = &[
    "google",
    "googleapi",
    "bing",
    "youdao",
    "deeplx",
    "huoshanweb",
    "tencenttransmart",
    "libre",
];

/// Default free engines raced in parallel for best-effort zh-CN (NOTES abstract).
/// First non-empty success wins; remaining in-flight requests are dropped.
/// Prefer engines that work better from CN networks.
pub const ZH_RACE_PROVIDERS: &[&str] = &["tencenttransmart", "huoshanweb", "deeplx"];

/// Per-engine HTTP timeout for [`free_mt_to_zh`] (import NOTES abstract, etc.).
///
/// Bench (2026-08, 5 arXiv abstracts ≈0.9–1.8k chars, Host-equivalent endpoints):
/// success p50 ≈0.5–0.9s, max ≈1.3s. Engines run **in parallel**, so wall time is
/// ~min(successes) rather than sum of failures. 5s ≈4× headroom on a slow success;
/// worst-case wall time is one timeout (5s), not 3×.
pub const FREE_MT_ZH_TIMEOUT_MS: u32 = 5_000;

/// zh-CN via parallel free-MT race; `None` when every engine fails or returns empty.
///
/// Spawns one request per [`ZH_RACE_PROVIDERS`] entry and returns the **first**
/// non-empty translation. Dropping unfinished tasks cancels their HTTP work.
pub async fn free_mt_to_zh(text: &str) -> Option<String> {
    use futures_util::stream::{FuturesUnordered, StreamExt};

    let slice: String = text.chars().take(MAX_TEXT_CHARS).collect();
    if slice.trim().is_empty() {
        return None;
    }

    let mut tasks = FuturesUnordered::new();
    for provider in ZH_RACE_PROVIDERS {
        let text = slice.clone();
        let provider = (*provider).to_string();
        tasks.push(async move {
            let r = translate_text(TranslateTextArgs {
                text,
                source_lang: "auto".into(),
                target_lang: "zh-CN".into(),
                provider,
                free_base_url: None,
                timeout_ms: Some(FREE_MT_ZH_TIMEOUT_MS),
            })
            .await
            .ok()?;
            let t = r.text.trim().to_string();
            if t.is_empty() {
                None
            } else {
                Some(t)
            }
        });
    }

    while let Some(result) = tasks.next().await {
        if let Some(translated) = result {
            // Drop `tasks` → cancel remaining engine futures / HTTP clients.
            return Some(translated);
        }
    }
    None
}

/// Heuristic: already mostly CJK → skip MT (e.g. Chinese papers).
pub fn looks_mostly_cjk(s: &str) -> bool {
    let mut cjk = 0usize;
    let mut letters = 0usize;
    for c in s.chars() {
        if ('\u{4e00}'..='\u{9fff}').contains(&c) {
            cjk += 1;
        } else if c.is_ascii_alphabetic() {
            letters += 1;
        }
    }
    cjk > 0 && cjk >= letters
}

#[derive(Debug, Clone, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TranslateTextArgs {
    pub text: String,
    #[serde(default = "default_source")]
    pub source_lang: String,
    pub target_lang: String,
    /// Free engine id: google | googleapi | bing | youdao | deeplx | huoshanweb | tencenttransmart | libre
    #[serde(default = "default_provider")]
    pub provider: String,
    /// LibreTranslate base URL when provider=libre.
    #[serde(default)]
    pub free_base_url: Option<String>,
    /// Optional request timeout in milliseconds (clamped 1s–30s). Default 30s.
    /// Settings probe uses a shorter value for snappy parallel checks.
    #[serde(default)]
    pub timeout_ms: Option<u32>,
}

fn default_source() -> String {
    "auto".to_string()
}

fn default_provider() -> String {
    "tencenttransmart".to_string()
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TranslateTextResult {
    pub text: String,
    pub provider: String,
}

pub async fn translate_text(args: TranslateTextArgs) -> Result<TranslateTextResult, AppError> {
    let text = args.text.trim();
    if text.is_empty() {
        return Err(AppError::message("Empty text"));
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(AppError::message(format!(
            "Text too long for free translation (max {MAX_TEXT_CHARS} characters)"
        )));
    }

    let mut provider = args.provider.trim().to_ascii_lowercase();
    if provider.is_empty() {
        provider = default_provider();
    }

    let source = normalize_lang(&args.source_lang, true);
    let target = normalize_lang(&args.target_lang, false);
    if target.is_empty() {
        return Err(AppError::message("Missing target language"));
    }

    let base = args
        .free_base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let timeout = resolve_timeout(args.timeout_ms);

    let translated = match provider.as_str() {
        "google" => {
            translate_google(
                "https://translate.google.com",
                text,
                &source,
                &target,
                timeout,
            )
            .await?
        }
        "googleapi" => {
            translate_google(
                "https://translate.googleapis.com",
                text,
                &source,
                &target,
                timeout,
            )
            .await?
        }
        "bing" => translate_bing(text, &source, &target, timeout).await?,
        "youdao" => translate_youdao(text, &source, &target, timeout).await?,
        "deeplx" => translate_deeplx(text, &source, &target, timeout).await?,
        "huoshanweb" => translate_huoshan_web(text, &source, &target, timeout).await?,
        "tencenttransmart" => translate_tencent_transmart(text, &source, &target, timeout).await?,
        "libre" => {
            let Some(url) = base else {
                return Err(AppError::message(
                    "LibreTranslate requires freeBaseUrl (Settings → Translate)",
                ));
            };
            translate_libre(url, text, &source, &target, timeout).await?
        }
        other => {
            return Err(AppError::message(format!(
                "Unknown free translation provider: {other}"
            )));
        }
    };

    let out = translated.trim().to_string();
    if out.is_empty() {
        return Err(AppError::message("Empty translation result"));
    }
    Ok(TranslateTextResult {
        text: out,
        provider,
    })
}

fn normalize_lang(raw: &str, allow_auto: bool) -> String {
    let s = raw.trim();
    if s.is_empty() {
        return if allow_auto {
            "auto".to_string()
        } else {
            String::new()
        };
    }
    let lower = s.to_ascii_lowercase();
    if allow_auto && (lower == "auto" || lower == "detect") {
        return "auto".to_string();
    }
    if lower == "zh" || lower == "zh-cn" || lower == "zh-hans" || lower == "chinese" {
        return "zh-CN".to_string();
    }
    if lower == "en" || lower == "english" {
        return "en".to_string();
    }
    s.to_string()
}

fn lang_base(code: &str) -> &str {
    code.split('-').next().unwrap_or(code)
}

/// Clamp optional timeout_ms to 1s–30s; default 30s.
fn resolve_timeout(timeout_ms: Option<u32>) -> Duration {
    match timeout_ms {
        Some(ms) => Duration::from_millis(u64::from(ms.clamp(1_000, 30_000))),
        None => Duration::from_secs(30),
    }
}

fn http_client(timeout: Duration) -> Result<reqwest::Client, AppError> {
    crate::features::network::client_builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| AppError::message(format!("http client: {e}")))
}

async fn read_body(resp: reqwest::Response) -> Result<(reqwest::StatusCode, String), AppError> {
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| AppError::message(format!("translate read body: {e}")))?;
    Ok((status, body))
}

fn http_err(status: reqwest::StatusCode, body: &str, label: &str) -> AppError {
    let snippet: String = body.chars().take(180).collect();
    AppError::message(format!("{label} failed (HTTP {status}): {snippet}"))
}

// ─── Google (gtx) ───────────────────────────────────────────────────────────

async fn translate_google(
    host: &str,
    text: &str,
    source: &str,
    target: &str,
    timeout: Duration,
) -> Result<String, AppError> {
    let client = http_client(timeout)?;
    let sl = if source == "auto" { "auto" } else { source };
    let tl = target;
    let url = format!("{}/translate_a/single", host.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .query(&[
            ("client", "gtx"),
            ("sl", sl),
            ("tl", tl),
            ("dt", "t"),
            ("q", text),
        ])
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| AppError::message(format!("Google translate request failed: {e}")))?;
    let (status, body) = read_body(resp).await?;
    if !status.is_success() {
        return Err(http_err(status, &body, "Google Translate"));
    }
    parse_google_gtx_body(&body)
}

fn parse_google_gtx_body(body: &str) -> Result<String, AppError> {
    let v: Value = serde_json::from_str(body)
        .map_err(|e| AppError::message(format!("Google translate parse: {e}")))?;
    let mut out = String::new();
    let Some(segments) = v.get(0).and_then(|x| x.as_array()) else {
        return Err(AppError::message("Unexpected Google translation response"));
    };
    for seg in segments {
        if let Some(piece) = seg.get(0).and_then(|x| x.as_str()) {
            out.push_str(piece);
        }
    }
    if out.is_empty() {
        return Err(AppError::message("Empty Google translation result"));
    }
    Ok(out)
}

// ─── Bing (Edge free token) ─────────────────────────────────────────────────

struct BingTokenCache {
    token: String,
    exp: Instant,
}

static BING_TOKEN: Mutex<Option<BingTokenCache>> = Mutex::new(None);

async fn bing_auth_token(timeout: Duration) -> Result<String, AppError> {
    {
        let guard = BING_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(c) = guard.as_ref() {
            if Instant::now() < c.exp {
                return Ok(c.token.clone());
            }
        }
    }
    let client = http_client(timeout)?;
    let resp = client
        .get("https://edge.microsoft.com/translate/auth")
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| AppError::message(format!("Bing auth failed: {e}")))?;
    let (status, body) = read_body(resp).await?;
    if !status.is_success() || body.trim().is_empty() {
        return Err(http_err(status, &body, "Bing auth"));
    }
    let token = body.trim().to_string();
    if let Ok(mut guard) = BING_TOKEN.lock() {
        *guard = Some(BingTokenCache {
            token: token.clone(),
            exp: Instant::now() + Duration::from_secs(4 * 60),
        });
    }
    Ok(token)
}

async fn translate_bing(
    text: &str,
    source: &str,
    target: &str,
    timeout: Duration,
) -> Result<String, AppError> {
    let token = bing_auth_token(timeout).await?;
    let client = http_client(timeout)?;
    let from = if source == "auto" { "" } else { source };
    let mut url = format!(
        "https://api-edge.cognitive.microsofttranslator.com/translate?to={}&api-version=3.0&includeSentenceLength=true",
        urlencoding_minimal(target)
    );
    if !from.is_empty() {
        url.push_str(&format!("&from={}", urlencoding_minimal(from)));
    }
    let body = serde_json::json!([{ "text": text }]);
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .header("User-Agent", UA)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::message(format!("Bing translate request failed: {e}")))?;
    let (status, body) = read_body(resp).await?;
    if !status.is_success() {
        return Err(http_err(status, &body, "Bing Translate"));
    }
    let v: Value =
        serde_json::from_str(&body).map_err(|e| AppError::message(format!("Bing parse: {e}")))?;
    v.get(0)
        .and_then(|x| x.get("translations"))
        .and_then(|x| x.get(0))
        .and_then(|x| x.get("text"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::message("Unexpected Bing translation response"))
}

// ─── Youdao free web ────────────────────────────────────────────────────────

async fn translate_youdao(
    text: &str,
    source: &str,
    target: &str,
    timeout: Duration,
) -> Result<String, AppError> {
    let client = http_client(timeout)?;
    let from = youdao_lang(source);
    let to = youdao_lang(target);
    let typ = format!("{from}2{to}");
    let resp = client
        .get("https://fanyi.youdao.com/translate")
        .query(&[("doctype", "json"), ("type", typ.as_str()), ("i", text)])
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| AppError::message(format!("Youdao request failed: {e}")))?;
    let (status, body) = read_body(resp).await?;
    if !status.is_success() {
        return Err(http_err(status, &body, "Youdao"));
    }
    let v: Value =
        serde_json::from_str(&body).map_err(|e| AppError::message(format!("Youdao parse: {e}")))?;
    let mut out = String::new();
    if let Some(rows) = v.get("translateResult").and_then(|x| x.as_array()) {
        for row in rows {
            if let Some(cells) = row.as_array() {
                for cell in cells {
                    if let Some(t) = cell.get("tgt").and_then(|x| x.as_str()) {
                        out.push_str(t);
                    }
                }
            }
        }
    }
    if out.is_empty() {
        return Err(AppError::message("Unexpected Youdao translation response"));
    }
    Ok(out)
}

fn youdao_lang(code: &str) -> String {
    if code == "auto" {
        return "AUTO".to_string();
    }
    // EN2ZH_CN style
    let base = lang_base(code).to_ascii_uppercase();
    if base == "ZH" {
        "ZH_CN".to_string()
    } else {
        base
    }
}

// ─── DeepLX / DeepL browser-extension endpoint ─────────────────────────────

async fn translate_deeplx(
    text: &str,
    source: &str,
    target: &str,
    timeout: Duration,
) -> Result<String, AppError> {
    let client = http_client(timeout)?;
    let id = deeplx_request_id();
    let i_count = text.matches('i').count() as u128 + text.matches('I').count() as u128 + 1;
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let timestamp = now_ms - (now_ms % i_count) + i_count;
    let mut body = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "LMT_handle_texts",
        "id": id,
        "params": {
            "texts": [
                {
                    "text": text,
                    "requestAlternatives": 3,
                }
            ],
            "splitting": "newlines",
            "lang": {
                "source_lang_user_selected": deeplx_lang(source, true),
                "target_lang": deeplx_lang(target, false),
            },
            "timestamp": timestamp,
            "commonJobParams": {
                "wasSpoken": false,
                "transcribe_as": "",
            },
        },
    })
    .to_string();
    if (id + 5).is_multiple_of(29) || (id + 3).is_multiple_of(13) {
        body = body.replace("\"method\":\"", "\"method\" : \"");
    } else {
        body = body.replace("\"method\":\"", "\"method\": \"");
    }

    let resp = client
        .post("https://www2.deepl.com/jsonrpc?client=chrome-extension,1.28.0&method=LMT_handle_jobs")
        .header("Accept", "*/*")
        .header("Authorization", "None")
        .header("Cache-Control", "no-cache")
        .header("Content-Type", "application/json")
        .header("DNT", "1")
        .header("Origin", "chrome-extension://cofdbpoegempjloogbagkncekinflcnj")
        .header("Pragma", "no-cache")
        .header("Referer", "https://www.deepl.com/")
        .header("Sec-Fetch-Dest", "empty")
        .header("Sec-Fetch-Mode", "cors")
        .header("Sec-Fetch-Site", "none")
        .header("Sec-GPC", "1")
        .header("User-Agent", "DeepLBrowserExtension/1.28.0 Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36")
        .body(body)
        .send()
        .await
        .map_err(|e| AppError::message(format!("DeepLX request failed: {e}")))?;
    let (status, body) = read_body(resp).await?;
    if !status.is_success() {
        return Err(http_err(status, &body, "DeepLX"));
    }
    let v: Value =
        serde_json::from_str(&body).map_err(|e| AppError::message(format!("DeepLX parse: {e}")))?;
    if let Some(error) = v.get("error") {
        return Err(AppError::message(format!("DeepLX service error: {error}")));
    }
    v.get("result")
        .and_then(|x| x.get("texts"))
        .and_then(|x| x.get(0))
        .and_then(|x| x.get("text"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::message("Unexpected DeepLX translation response"))
}

fn deeplx_request_id() -> u64 {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    8_300_000_001 + (now_ms % 99_999) * 1_000
}

fn deeplx_lang(code: &str, allow_auto: bool) -> String {
    if allow_auto && code == "auto" {
        return "AUTO".to_string();
    }
    let lower = code.to_ascii_lowercase();
    match lower.as_str() {
        "zh" | "zh-cn" | "zh-hans" | "zh-hk" | "zh-mo" | "zh-sg" | "zh-tw" => "ZH".to_string(),
        "pt-br" => "PT-BR".to_string(),
        "pt-pt" => "PT-PT".to_string(),
        _ => lang_base(code).to_ascii_uppercase(),
    }
}

// ─── Volcengine / Huoshan web ───────────────────────────────────────────────

async fn translate_huoshan_web(
    text: &str,
    source: &str,
    target: &str,
    timeout: Duration,
) -> Result<String, AppError> {
    let client = http_client(timeout)?;
    let from = if source == "auto" {
        "auto".to_string()
    } else {
        lang_base(source).to_string()
    };
    let to = lang_base(target).to_string();
    let body = serde_json::json!({
        "source_language": from,
        "target_language": to,
        "text": text,
    });
    let resp = client
        .post("https://translate.volcengine.com/crx/translate/v1")
        .header("Content-Type", "application/json")
        .header("User-Agent", UA)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::message(format!("Volcengine request failed: {e}")))?;
    let (status, body) = read_body(resp).await?;
    if !status.is_success() {
        return Err(http_err(status, &body, "Volcengine Web"));
    }
    let v: Value = serde_json::from_str(&body)
        .map_err(|e| AppError::message(format!("Volcengine parse: {e}")))?;
    v.get("translation")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::message("Unexpected Volcengine translation response"))
}

// ─── Tencent Transmart web ──────────────────────────────────────────────────

async fn translate_tencent_transmart(
    text: &str,
    source: &str,
    target: &str,
    timeout: Duration,
) -> Result<String, AppError> {
    let client = http_client(timeout)?;
    let from = if source == "auto" {
        "auto".to_string()
    } else {
        lang_base(source).to_string()
    };
    let to = lang_base(target).to_string();
    let body = serde_json::json!({
        "header": {
            "fn": "auto_translation",
            "client_key": "browser-chrome-110.0.0-Mac OS-df4bd4c5-a65d-44b2-a40f-42f34f3535f2-1677486696487"
        },
        "type": "plain",
        "model_category": "normal",
        "source": {
            "lang": from,
            "text_list": [text],
        },
        "target": {
            "lang": to,
        },
    });
    let resp = client
        .post("https://transmart.qq.com/api/imt")
        .header("Content-Type", "application/json")
        .header("User-Agent", UA)
        .header("Referer", "https://transmart.qq.com/zh-CN/index")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::message(format!("Tencent Transmart request failed: {e}")))?;
    let (status, body) = read_body(resp).await?;
    if !status.is_success() {
        return Err(http_err(status, &body, "Tencent Transmart"));
    }
    let v: Value = serde_json::from_str(&body)
        .map_err(|e| AppError::message(format!("Tencent Transmart parse: {e}")))?;
    if let Some(arr) = v.get("auto_translation").and_then(|x| x.as_array()) {
        let parts: Vec<&str> = arr.iter().filter_map(|x| x.as_str()).collect();
        if !parts.is_empty() {
            return Ok(parts.join("\n").trim().to_string());
        }
    }
    Err(AppError::message(
        "Unexpected Tencent Transmart translation response",
    ))
}

// ─── LibreTranslate ─────────────────────────────────────────────────────────

#[derive(Serialize)]
struct LibreRequest<'a> {
    q: &'a str,
    source: &'a str,
    target: &'a str,
    format: &'a str,
}

async fn translate_libre(
    base_url: &str,
    text: &str,
    source: &str,
    target: &str,
    timeout: Duration,
) -> Result<String, AppError> {
    let base = base_url.trim_end_matches('/');
    let url = format!("{base}/translate");
    let client = http_client(timeout)?;
    let lt_target =
        if target.eq_ignore_ascii_case("zh-CN") || target.eq_ignore_ascii_case("zh-Hans") {
            "zh"
        } else {
            target
        };
    let lt_source = if source == "auto" { "auto" } else { source };
    let resp = client
        .post(&url)
        .json(&LibreRequest {
            q: text,
            source: lt_source,
            target: lt_target,
            format: "text",
        })
        .send()
        .await
        .map_err(|e| AppError::message(format!("LibreTranslate request failed: {e}")))?;
    let (status, body) = read_body(resp).await?;
    if !status.is_success() {
        return Err(http_err(status, &body, "LibreTranslate"));
    }
    let parsed: Value = serde_json::from_str(&body)
        .map_err(|e| AppError::message(format!("LibreTranslate parse: {e}")))?;
    if let Some(t) = parsed
        .get("translatedText")
        .or_else(|| parsed.get("translated_text"))
        .and_then(|x| x.as_str())
    {
        return Ok(t.to_string());
    }
    Err(AppError::message(
        "Unexpected LibreTranslate response (missing translatedText)",
    ))
}

/// Minimal URL-encoding for query values (enough for our use).
fn urlencoding_minimal(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => {
                out.push('%');
                out.push_str(&format!("{b:02X}"));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_google_segments() {
        let body = r#"[[["你好","Hello",null,null,10]],null,"en"]"#;
        let t = parse_google_gtx_body(body).unwrap();
        assert_eq!(t, "你好");
    }

    #[test]
    fn normalize_zh() {
        assert_eq!(normalize_lang("zh-CN", false), "zh-CN");
        assert_eq!(normalize_lang("Chinese", false), "zh-CN");
        assert_eq!(normalize_lang("auto", true), "auto");
    }

    #[test]
    fn free_providers_listed() {
        assert!(FREE_PROVIDERS.contains(&"bing"));
        assert!(FREE_PROVIDERS.contains(&"youdao"));
        assert!(FREE_PROVIDERS.contains(&"deeplx"));
        assert!(FREE_PROVIDERS.contains(&"huoshanweb"));
        for p in ZH_RACE_PROVIDERS {
            assert!(
                FREE_PROVIDERS.contains(p),
                "{p} missing from FREE_PROVIDERS"
            );
        }
        assert_eq!(
            ZH_RACE_PROVIDERS,
            &["tencenttransmart", "huoshanweb", "deeplx"]
        );
        // Keep abstract-MT snappy: enough for slow success (~1.3s bench max);
        // parallel race → wall ≈ one timeout, not 3×.
        assert!((3_000..=8_000).contains(&FREE_MT_ZH_TIMEOUT_MS));
    }

    #[test]
    fn looks_mostly_cjk_detects_chinese() {
        assert!(looks_mostly_cjk("本文提出了一种新的注意力机制。"));
        assert!(!looks_mostly_cjk(
            "We propose a new attention mechanism for sequence transduction."
        ));
        assert!(!looks_mostly_cjk(""));
    }
}

pub mod commands;
