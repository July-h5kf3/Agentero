export {
	DEFAULT_TRANSLATOR_BASE_URL,
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
	LibraryColumnKey,
	LibraryColumnPref,
	LocalePreference,
	ThemePreference,
	TranslateProviderId,
	TranslateTargetLang,
} from "@/lib/settings/types";
export {
	AUTO_UPDATE_INTERNAL_LINKS,
	DEFAULT_LIBRARY_COLUMNS,
} from "@/lib/settings/types";
