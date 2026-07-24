export {
	DEFAULT_PDF_ASK_SETTINGS,
	DEFAULT_SETTINGS,
	DEFAULT_TRANSLATOR_BASE_URL,
	snapUiScale,
	UI_SCALE_PRESETS,
} from "@/lib/settings/defaults";
export {
	ensureSettingsLoaded,
	getSettingsFilePath,
	loadSettings,
	saveSettings,
	saveSettingsAsync,
	subscribeSettings,
	useUiScale,
} from "@/lib/settings/store";
export { applyExternalSettings, initSettingsSync } from "@/lib/settings/sync";
export type {
	AgentPermissionMode,
	AiResponseLanguage,
	AppSettings,
	LibraryColumnKey,
	LibraryColumnPref,
	LocalePreference,
	PaperTreeLabelMode,
	PaperTreeSortMode,
	PdfAskSettings,
	ThemePreference,
	TranslateProviderId,
	TranslateSettings,
	TranslateTargetLang,
} from "@/lib/settings/types";
export {
	DEFAULT_LIBRARY_COLUMNS,
	LIBRARY_COLUMN_KEYS,
} from "@/lib/settings/types";
