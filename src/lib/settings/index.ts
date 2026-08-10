export {
	clampEditorLineHeight,
	DEFAULT_EDITOR_LINE_HEIGHT,
	DEFAULT_TRANSLATOR_BASE_URL,
	EDITOR_LINE_HEIGHT_MAX,
	EDITOR_LINE_HEIGHT_MIN,
	EDITOR_LINE_HEIGHT_STEP,
	editorFontFamilyCss,
	UI_SCALE_PRESETS,
} from "@/lib/settings/defaults";
export {
	ensureSettingsLoaded,
	loadSettings,
	saveSettings,
	saveSettingsAsync,
	subscribeSettings,
	useUiScale,
} from "@/lib/settings/store";
export { initSettingsSync } from "@/lib/settings/sync";
export type {
	AgentPermissionMode,
	AiResponseLanguage,
	AppSettings,
	AutoUpdateInternalLinks,
	CommercialTranslateProviderId,
	EditorFontFamily,
	LibraryColumnKey,
	LibraryColumnPref,
	LocalePreference,
	ThemePreference,
	TranslateProviderConfig,
	TranslateProviderId,
	TranslateTargetLang,
} from "@/lib/settings/types";
export {
	AUTO_UPDATE_INTERNAL_LINKS,
	DEFAULT_LIBRARY_COLUMNS,
	EDITOR_FONT_FAMILIES,
	isEditorFontFamily,
} from "@/lib/settings/types";
