export type ThemePreference = "system" | "light" | "dark";

export type LocalePreference = "system" | "en" | "zh-CN";

export type AppSettings = {
	// General
	restoreLastVault: boolean;
	confirmBeforeClose: boolean;
	/**
	 * Magic-wand / identifier import — extra local mirror when remote preview exists.
	 *
	 * Always (regardless of this flag): if the item has neither `pdf_url` nor
	 * `html_url`, Motif downloads full text into `source/` when a downloadable
	 * URL can be resolved (otherwise there is nothing to preview).
	 *
	 * When true: also download into `source/` even if `pdf_url`/`html_url` exist
	 * (catalog still keeps remote URLs). Default false.
	 */
	downloadFulltextToLocal: boolean;
	// Appearance
	theme: ThemePreference;
	locale: LocalePreference;
	editorFontSize: number;
	showLineNumbers: boolean;
	// Agent (local UI prefs; registry lives in Host)
	agentEnabled: boolean;
	// Privacy
	analyticsEnabled: boolean;
	shareCrashReports: boolean;
};

export const DEFAULT_SETTINGS: AppSettings = {
	restoreLastVault: true,
	confirmBeforeClose: false,
	downloadFulltextToLocal: false,
	theme: "system",
	locale: "system",
	editorFontSize: 14,
	showLineNumbers: false,
	agentEnabled: true,
	analyticsEnabled: false,
	shareCrashReports: false,
};

const SETTINGS_KEY = "motif-settings";

export function loadSettings(): AppSettings {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (!raw) return { ...DEFAULT_SETTINGS };
		const parsed = JSON.parse(raw) as Partial<AppSettings>;
		// Drop legacy BYOK fields if present.
		const {
			agentBaseUrl: _u,
			agentApiKey: _k,
			agentModel: _m,
			downloadFulltextWhenNoRemotePreview: legacyDownload,
			...rest
		} = parsed as Partial<AppSettings> & {
			agentBaseUrl?: string;
			agentApiKey?: string;
			agentModel?: string;
			/** @deprecated renamed to downloadFulltextToLocal */
			downloadFulltextWhenNoRemotePreview?: boolean;
		};
		const merged = { ...DEFAULT_SETTINGS, ...rest };
		if (
			legacyDownload !== undefined &&
			rest.downloadFulltextToLocal === undefined
		) {
			merged.downloadFulltextToLocal = legacyDownload;
		}
		return merged;
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function saveSettings(settings: AppSettings): void {
	try {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
	} catch {
		// ignore
	}
}
