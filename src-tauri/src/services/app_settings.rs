//! Application UI settings — XDG config file `settings.json`.
//!
//! Frontend `AppSettings` (camelCase JSON) is the source of shape; Host owns
//! the durable file under [`crate::services::paths::settings_path`].

use crate::error::AppError;
use crate::services::paths::{self, settings_path};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

pub const DEFAULT_TRANSLATOR_BASE_URL: &str = "https://translator.philfan.cn";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_true")]
    pub restore_last_vault: bool,
    #[serde(default)]
    pub confirm_before_close: bool,
    #[serde(default = "default_translator_base_url")]
    pub translator_base_url: String,
    #[serde(default = "default_paper_tree_label_mode")]
    pub paper_tree_label_mode: String,
    #[serde(default = "default_paper_tree_sort_mode")]
    pub paper_tree_sort_mode: String,
    #[serde(default)]
    pub connector_enabled: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_locale")]
    pub locale: String,
    #[serde(default = "default_editor_font_size")]
    pub editor_font_size: u32,
    #[serde(default = "default_true")]
    pub show_editor_toolbar: bool,
    #[serde(default = "default_true")]
    pub agent_enabled: bool,
    #[serde(default = "default_permission_mode")]
    pub agent_permission_mode: String,
    #[serde(default)]
    pub auto_paper_reader: bool,
    #[serde(default = "default_ai_response_language")]
    pub ai_response_language: String,
    #[serde(default)]
    pub pdf_ask: PdfAskSettings,
    #[serde(default)]
    pub analytics_enabled: bool,
    #[serde(default)]
    pub share_crash_reports: bool,
    #[serde(default)]
    pub translate: TranslateSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct PdfAskSettings {
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranslateSettings {
    #[serde(default = "default_translate_provider")]
    pub provider: String,
    #[serde(default = "default_translate_target")]
    pub target_lang: String,
    #[serde(default = "default_translate_source")]
    pub source_lang: String,
    #[serde(default)]
    pub free_base_url: String,
    #[serde(default)]
    pub auto_translate_selection: bool,
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub model_id: String,
}

impl Default for TranslateSettings {
    fn default() -> Self {
        Self {
            provider: default_translate_provider(),
            target_lang: default_translate_target(),
            source_lang: default_translate_source(),
            free_base_url: String::new(),
            auto_translate_selection: false,
            agent_id: String::new(),
            model_id: String::new(),
        }
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            restore_last_vault: true,
            confirm_before_close: false,
            translator_base_url: DEFAULT_TRANSLATOR_BASE_URL.to_string(),
            paper_tree_label_mode: default_paper_tree_label_mode(),
            paper_tree_sort_mode: default_paper_tree_sort_mode(),
            connector_enabled: false,
            theme: default_theme(),
            locale: default_locale(),
            editor_font_size: default_editor_font_size(),
            show_editor_toolbar: true,
            agent_enabled: true,
            agent_permission_mode: default_permission_mode(),
            auto_paper_reader: false,
            ai_response_language: default_ai_response_language(),
            pdf_ask: PdfAskSettings::default(),
            analytics_enabled: false,
            share_crash_reports: false,
            translate: TranslateSettings::default(),
        }
    }
}

fn default_true() -> bool {
    true
}
fn default_translator_base_url() -> String {
    DEFAULT_TRANSLATOR_BASE_URL.to_string()
}
fn default_paper_tree_label_mode() -> String {
    "title-author".into()
}
fn default_paper_tree_sort_mode() -> String {
    "folder".into()
}
fn default_theme() -> String {
    "system".into()
}
fn default_locale() -> String {
    "system".into()
}
fn default_editor_font_size() -> u32 {
    14
}
fn default_permission_mode() -> String {
    "restricted".into()
}
fn default_ai_response_language() -> String {
    "auto".into()
}
fn default_translate_provider() -> String {
    "bing".into()
}
fn default_translate_target() -> String {
    "ui".into()
}
fn default_translate_source() -> String {
    "auto".into()
}

/// In-memory + file-backed settings store.
pub struct AppSettingsStore {
    inner: Mutex<AppSettings>,
    path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsGetResult {
    pub settings: AppSettings,
    /// Absolute path to the settings file.
    pub path: String,
    /// Whether the file already existed before this read (false → first run / defaults).
    pub existed: bool,
}

impl AppSettingsStore {
    pub fn load() -> Self {
        let path = settings_path();
        paths::migrate_legacy_file("settings.json", &path);
        let (settings, _existed) = read_file(&path);
        Self {
            inner: Mutex::new(settings),
            path,
        }
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    pub fn get(&self) -> Result<SettingsGetResult, AppError> {
        let settings = self
            .inner
            .lock()
            .map_err(|_| AppError::message("settings lock poisoned"))?
            .clone();
        let existed = self.path.is_file();
        Ok(SettingsGetResult {
            settings,
            path: self.path.to_string_lossy().into_owned(),
            existed,
        })
    }

    pub fn set(&self, mut settings: AppSettings) -> Result<AppSettings, AppError> {
        normalize(&mut settings);
        persist(&self.path, &settings)?;
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| AppError::message("settings lock poisoned"))?;
        *guard = settings.clone();
        Ok(settings)
    }
}

fn read_file(path: &PathBuf) -> (AppSettings, bool) {
    if !path.is_file() {
        return (AppSettings::default(), false);
    }
    match fs::read_to_string(path) {
        Ok(raw) => match serde_json::from_str::<AppSettings>(&raw) {
            Ok(mut s) => {
                normalize(&mut s);
                (s, true)
            }
            Err(e) => {
                log::warn!(
                    target: "agentero::settings",
                    "invalid settings.json ({}): {e}; using defaults",
                    path.display()
                );
                (AppSettings::default(), true)
            }
        },
        Err(e) => {
            log::warn!(
                target: "agentero::settings",
                "failed to read settings.json: {e}"
            );
            (AppSettings::default(), false)
        }
    }
}

fn persist(path: &PathBuf, settings: &AppSettings) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let raw = serde_json::to_string_pretty(settings)?;
    // Atomic-ish: write tmp then rename.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, raw.as_bytes())?;
    fs::rename(&tmp, path).or_else(|_| {
        // Windows may fail rename over existing; fallback to write.
        fs::write(path, raw.as_bytes())
    })?;
    Ok(())
}

fn normalize(s: &mut AppSettings) {
    let url = s.translator_base_url.trim().trim_end_matches('/');
    s.translator_base_url = if url.is_empty() {
        DEFAULT_TRANSLATOR_BASE_URL.to_string()
    } else {
        url.to_string()
    };

    const LABEL_MODES: &[&str] = &["title-author", "title", "author-year-title", "folder"];
    if !LABEL_MODES.contains(&s.paper_tree_label_mode.as_str()) {
        s.paper_tree_label_mode = default_paper_tree_label_mode();
    }
    const SORT_MODES: &[&str] = &[
        "folder",
        "title",
        "author",
        "year-desc",
        "year-asc",
        "added-desc",
    ];
    if !SORT_MODES.contains(&s.paper_tree_sort_mode.as_str()) {
        s.paper_tree_sort_mode = default_paper_tree_sort_mode();
    }

    const THEMES: &[&str] = &["system", "light", "dark"];
    if !THEMES.contains(&s.theme.as_str()) {
        s.theme = default_theme();
    }
    const LOCALES: &[&str] = &["system", "en", "zh-CN"];
    if !LOCALES.contains(&s.locale.as_str()) {
        s.locale = default_locale();
    }
    if s.editor_font_size < 10 || s.editor_font_size > 32 {
        s.editor_font_size = default_editor_font_size();
    }
    const PERMS: &[&str] = &["restricted", "ask", "auto"];
    if !PERMS.contains(&s.agent_permission_mode.as_str()) {
        s.agent_permission_mode = default_permission_mode();
    }
    const AI_LANGS: &[&str] = &["auto", "en", "zh-CN"];
    if !AI_LANGS.contains(&s.ai_response_language.as_str()) {
        s.ai_response_language = default_ai_response_language();
    }

    s.pdf_ask.agent_id = s.pdf_ask.agent_id.trim().to_string();
    s.pdf_ask.model_id = s.pdf_ask.model_id.trim().to_string();

    s.translate.free_base_url = s
        .translate
        .free_base_url
        .trim()
        .trim_end_matches('/')
        .to_string();
    s.translate.agent_id = s.translate.agent_id.trim().to_string();
    s.translate.model_id = s.translate.model_id.trim().to_string();
    const TR_TARGETS: &[&str] = &["ui", "en", "zh-CN"];
    if !TR_TARGETS.contains(&s.translate.target_lang.as_str()) {
        s.translate.target_lang = default_translate_target();
    }
    if s.translate.source_lang != "auto" {
        s.translate.source_lang = default_translate_source();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn roundtrip_defaults() {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("agentero-settings-test-{n}"));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("settings.json");
        let s = AppSettings::default();
        persist(&path, &s).expect("write");
        let (loaded, existed) = read_file(&path);
        assert!(existed);
        assert_eq!(loaded.theme, "system");
        assert_eq!(loaded.translator_base_url, DEFAULT_TRANSLATOR_BASE_URL);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn normalize_empty_translator_url() {
        let mut s = AppSettings {
            translator_base_url: "  ".into(),
            ..AppSettings::default()
        };
        normalize(&mut s);
        assert_eq!(s.translator_base_url, DEFAULT_TRANSLATOR_BASE_URL);
    }
}
