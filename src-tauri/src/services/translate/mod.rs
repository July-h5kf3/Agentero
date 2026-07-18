//! Free machine-translation backends (no paid API keys).
//! Endpoints mirror the free web engines used by zotero-pdf-translate
//! (Google / Bing Edge / Youdao / Haici / CNKI / DeepLX / Volcengine / Tencent Transmart).
//! All are unofficial / best-effort and may break or rate-limit.

use crate::error::AppError;
use aes::cipher::{BlockEncrypt, KeyInit};
use aes::Aes128;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
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
    "haici",
    "cnki",
    "deeplx",
    "huoshanweb",
    "tencenttransmart",
    "libre",
    // Legacy alias → googleapi
    "free",
];

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateTextArgs {
    pub text: String,
    #[serde(default = "default_source")]
    pub source_lang: String,
    pub target_lang: String,
    /// Free engine id: google | googleapi | bing | youdao | haici | cnki | deeplx | huoshanweb | tencenttransmart | libre | free
    #[serde(default = "default_provider")]
    pub provider: String,
    /// LibreTranslate base, or DeepLX custom JSON-RPC endpoint when provider=deeplx.
    #[serde(default)]
    pub free_base_url: Option<String>,
}

fn default_source() -> String {
    "auto".to_string()
}

fn default_provider() -> String {
    "googleapi".to_string()
}

#[derive(Debug, Clone, Serialize)]
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
    if provider.is_empty() || provider == "free" {
        provider = "googleapi".to_string();
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

    let translated = match provider.as_str() {
        "google" => {
            translate_google("https://translate.google.com", text, &source, &target).await?
        }
        "googleapi" => {
            translate_google("https://translate.googleapis.com", text, &source, &target).await?
        }
        "bing" => translate_bing(text, &source, &target).await?,
        "youdao" => translate_youdao(text, &source, &target).await?,
        "haici" => translate_haici(text, &source, &target).await?,
        "cnki" => translate_cnki(text).await?,
        "deeplx" => {
            let endpoint = base.unwrap_or("https://www2.deepl.com/jsonrpc");
            translate_deeplx(endpoint, text, &source, &target).await?
        }
        "huoshanweb" => translate_huoshan_web(text, &source, &target).await?,
        "tencenttransmart" => translate_tencent_transmart(text, &source, &target).await?,
        "libre" => {
            let Some(url) = base else {
                return Err(AppError::message(
                    "LibreTranslate requires freeBaseUrl (Settings → Translate)",
                ));
            };
            translate_libre(url, text, &source, &target).await?
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

fn http_client() -> Result<reqwest::Client, AppError> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
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
) -> Result<String, AppError> {
    let client = http_client()?;
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

async fn bing_auth_token() -> Result<String, AppError> {
    {
        let guard = BING_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(c) = guard.as_ref() {
            if Instant::now() < c.exp {
                return Ok(c.token.clone());
            }
        }
    }
    let client = http_client()?;
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

async fn translate_bing(text: &str, source: &str, target: &str) -> Result<String, AppError> {
    let token = bing_auth_token().await?;
    let client = http_client()?;
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

async fn translate_youdao(text: &str, source: &str, target: &str) -> Result<String, AppError> {
    let client = http_client()?;
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

// ─── Haici (dict.cn via legacy MS Ajax API) ─────────────────────────────────

struct HaiciAppIdCache {
    app_id: String,
    exp: Instant,
}

static HAICI_APP_ID: Mutex<Option<HaiciAppIdCache>> = Mutex::new(None);

async fn haici_app_id() -> Result<String, AppError> {
    {
        let guard = HAICI_APP_ID.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(c) = guard.as_ref() {
            if Instant::now() < c.exp {
                return Ok(c.app_id.clone());
            }
        }
    }
    let client = http_client()?;
    let resp = client
        .get("http://capi.dict.cn/fanyi.php")
        .header("Referer", "http://fanyi.dict.cn/")
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| AppError::message(format!("Haici appId request failed: {e}")))?;
    let (status, body) = read_body(resp).await?;
    if !status.is_success() {
        return Err(http_err(status, &body, "Haici appId"));
    }
    // body like: "xxxx-app-id"
    let app_id = body
        .trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .to_string();
    if app_id.is_empty() {
        // try match "(.+)"
        if let Some(cap) = body.split('"').nth(1) {
            let id = cap.to_string();
            if !id.is_empty() {
                cache_haici(&id);
                return Ok(id);
            }
        }
        return Err(AppError::message("Haici appId empty"));
    }
    cache_haici(&app_id);
    Ok(app_id)
}

fn cache_haici(app_id: &str) {
    if let Ok(mut guard) = HAICI_APP_ID.lock() {
        *guard = Some(HaiciAppIdCache {
            app_id: app_id.to_string(),
            exp: Instant::now() + Duration::from_secs(50 * 60),
        });
    }
}

async fn translate_haici(text: &str, source: &str, target: &str) -> Result<String, AppError> {
    let app_id = haici_app_id().await?;
    let client = http_client()?;
    let from = if source == "auto" { "" } else { source };
    // Escape quotes for JSON array of strings in query
    let escaped = text.replace('\\', "\\\\").replace('"', "\\\"");
    let texts = format!("[\"{escaped}\"]");
    let url = format!(
        "http://api.microsofttranslator.com/V2/Ajax.svc/TranslateArray?appId={}&from={}&to={}&texts={}",
        urlencoding_minimal(&app_id),
        urlencoding_minimal(from),
        urlencoding_minimal(target),
        urlencoding_minimal(&texts),
    );
    let resp = client
        .get(&url)
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| AppError::message(format!("Haici request failed: {e}")))?;
    let (status, body) = read_body(resp).await?;
    if !status.is_success() {
        return Err(http_err(status, &body, "Haici"));
    }
    // Response may be JSON array with TranslatedText fields; sometimes prefixed with BOM
    let cleaned = body.trim().trim_start_matches('\u{feff}');
    let v: Value = serde_json::from_str(cleaned)
        .map_err(|e| AppError::message(format!("Haici parse: {e}")))?;
    let mut out = String::new();
    if let Some(arr) = v.as_array() {
        for line in arr {
            if let Some(t) = line.get("TranslatedText").and_then(|x| x.as_str()) {
                out.push_str(t);
            }
        }
    }
    if out.is_empty() {
        return Err(AppError::message("Unexpected Haici translation response"));
    }
    Ok(out)
}

// ─── CNKI dict (AES-ECB encrypt words) ──────────────────────────────────────

struct CnkiTokenCache {
    token: String,
    exp: Instant,
}

static CNKI_TOKEN: Mutex<Option<CnkiTokenCache>> = Mutex::new(None);

async fn cnki_token() -> Result<String, AppError> {
    {
        let guard = CNKI_TOKEN.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(c) = guard.as_ref() {
            if Instant::now() < c.exp {
                return Ok(c.token.clone());
            }
        }
    }
    let client = http_client()?;
    let resp = client
        .get("https://dict.cnki.net/fyzs-front-api/getToken")
        .header("User-Agent", UA)
        .send()
        .await
        .map_err(|e| AppError::message(format!("CNKI token request failed: {e}")))?;
    let (status, body) = read_body(resp).await?;
    if !status.is_success() {
        return Err(http_err(status, &body, "CNKI token"));
    }
    let v: Value = serde_json::from_str(&body)
        .map_err(|e| AppError::message(format!("CNKI token parse: {e}")))?;
    // Zotero stores xhr.response.data as token in one branch and xhr.response.token in another
    let token = v
        .get("data")
        .and_then(|x| x.as_str())
        .or_else(|| v.get("token").and_then(|x| x.as_str()))
        .unwrap_or("")
        .to_string();
    if token.is_empty() {
        return Err(AppError::message("CNKI token empty"));
    }
    if let Ok(mut guard) = CNKI_TOKEN.lock() {
        *guard = Some(CnkiTokenCache {
            token: token.clone(),
            exp: Instant::now() + Duration::from_secs(4 * 60),
        });
    }
    Ok(token)
}

/// AES-128-ECB PKCS7, base64 with URL-safe-ish replacements (CNKI).
fn cnki_encrypt_words(text: &str) -> Result<String, AppError> {
    const KEY: &[u8; 16] = b"4e87183cfd3a45fe";
    let cipher =
        Aes128::new_from_slice(KEY).map_err(|e| AppError::message(format!("CNKI AES key: {e}")))?;
    let mut buf = text.as_bytes().to_vec();
    // PKCS7 pad to 16
    let pad = 16 - (buf.len() % 16);
    buf.extend(std::iter::repeat_n(pad as u8, pad));
    for chunk in buf.chunks_exact_mut(16) {
        let block = aes::Block::from_mut_slice(chunk);
        cipher.encrypt_block(block);
    }
    let b64 = B64.encode(&buf);
    Ok(b64.replace('/', "_").replace('+', "-"))
}

async fn translate_cnki(text: &str) -> Result<String, AppError> {
    // CNKI free web is limited ~800 chars
    let slice: String = text.chars().take(800).collect();
    let token = cnki_token().await?;
    let words = cnki_encrypt_words(&slice)?;
    let client = http_client()?;
    let body = serde_json::json!({
        "words": words,
        "translateType": null,
    });
    let resp = client
        .post("https://dict.cnki.net/fyzs-front-api/translate/literaltranslation")
        .header("Content-Type", "application/json;charset=UTF-8")
        .header("Token", &token)
        .header("User-Agent", UA)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::message(format!("CNKI request failed: {e}")))?;
    let (status, body) = read_body(resp).await?;
    if !status.is_success() {
        return Err(http_err(status, &body, "CNKI"));
    }
    let v: Value =
        serde_json::from_str(&body).map_err(|e| AppError::message(format!("CNKI parse: {e}")))?;
    if v.pointer("/data/isInputVerificationCode")
        .and_then(|x| x.as_bool())
        == Some(true)
    {
        return Err(AppError::message(
            "CNKI requires human verification (temporarily banned). Open https://dict.cnki.net/ and pass the captcha, then retry.",
        ));
    }
    v.pointer("/data/mResult")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::message("Unexpected CNKI translation response"))
}

// ─── DeepLX (unofficial DeepL JSON-RPC) ─────────────────────────────────────

fn deepl_map_lang(code: &str) -> String {
    match code {
        "zh-CN" | "zh" | "zh-Hans" => "ZH-HANS".to_string(),
        "zh-TW" | "zh-HK" | "zh-MO" | "zh-Hant" => "ZH-HANT".to_string(),
        "pt-BR" => "PT-BR".to_string(),
        "pt-PT" => "PT-PT".to_string(),
        "auto" => "auto".to_string(),
        other => lang_base(other).to_ascii_uppercase(),
    }
}

async fn translate_deeplx(
    endpoint: &str,
    text: &str,
    source: &str,
    target: &str,
) -> Result<String, AppError> {
    let client = http_client()?;
    let id = 1000 * (fastrand_u32(8300000, 8300000 + 99999)) + 1;
    let i_counts = text.matches('i').count() as u64 + 1;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let timestamp = ts - (ts % i_counts) + i_counts;

    let mut req_body = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "LMT_handle_texts",
        "id": id,
        "params": {
            "texts": [{ "text": text, "requestAlternatives": 3 }],
            "splitting": "newlines",
            "lang": {
                "source_lang_user_selected": deepl_map_lang(source),
                "target_lang": deepl_map_lang(target),
            },
            "timestamp": timestamp,
            "commonJobParams": {
                "wasSpoken": false,
                "transcribe_as": "",
            },
        },
    })
    .to_string();

    // DeepL browser-extension quirk
    if (id + 5).is_multiple_of(29) || (id + 3).is_multiple_of(13) {
        req_body = req_body.replace("\"method\":\"", "\"method\" : \"");
    } else {
        req_body = req_body.replace("\"method\":\"", "\"method\": \"");
    }

    let url = if endpoint.contains('?') {
        endpoint.to_string()
    } else {
        format!(
            "{}?client=chrome-extension,1.28.0&method=LMT_handle_jobs",
            endpoint.trim_end_matches('/')
        )
    };

    let resp = client
        .post(&url)
        .header("Accept", "*/*")
        .header("Authorization", "None")
        .header("Content-Type", "application/json")
        .header("Origin", "chrome-extension://cofdbpoegempjloogbagkncekinflcnj")
        .header("Referer", "https://www.deepl.com/")
        .header(
            "User-Agent",
            "DeepLBrowserExtension/1.28.0 Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
        )
        .body(req_body)
        .send()
        .await
        .map_err(|e| AppError::message(format!("DeepLX request failed: {e}")))?;
    let (status, body) = read_body(resp).await?;
    if !status.is_success() {
        return Err(http_err(status, &body, "DeepLX"));
    }
    let v: Value =
        serde_json::from_str(&body).map_err(|e| AppError::message(format!("DeepLX parse: {e}")))?;
    v.pointer("/result/texts/0/text")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::message("Unexpected DeepLX translation response"))
}

/// Simple non-crypto PRNG for DeepLX id (no extra deps).
fn fastrand_u32(min: u32, max_inclusive: u32) -> u32 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(1);
    let span = max_inclusive.saturating_sub(min).saturating_add(1);
    min + (nanos % span)
}

// ─── Volcengine / Huoshan web ───────────────────────────────────────────────

async fn translate_huoshan_web(text: &str, source: &str, target: &str) -> Result<String, AppError> {
    let client = http_client()?;
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
) -> Result<String, AppError> {
    let client = http_client()?;
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
) -> Result<String, AppError> {
    let base = base_url.trim_end_matches('/');
    let url = format!("{base}/translate");
    let client = http_client()?;
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
    fn cnki_encrypt_not_empty() {
        let e = cnki_encrypt_words("hello").unwrap();
        assert!(!e.is_empty());
        assert!(!e.contains('/'));
        assert!(!e.contains('+'));
    }

    #[test]
    fn deepl_lang_map() {
        assert_eq!(deepl_map_lang("zh-CN"), "ZH-HANS");
        assert_eq!(deepl_map_lang("en"), "EN");
    }

    #[test]
    fn free_providers_listed() {
        assert!(FREE_PROVIDERS.contains(&"bing"));
        assert!(FREE_PROVIDERS.contains(&"deeplx"));
    }
}
