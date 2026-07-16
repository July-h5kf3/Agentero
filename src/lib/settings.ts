export type ThemePreference = "system" | "light" | "dark";

export type LocalePreference = "system" | "en" | "zh-CN";

/**
 * How Motif responds to agent permission escalations.
 * - `restricted`: decline requests (Codex uses workspace-write).
 * - `auto`: auto-approve every request (YOLO; Codex uses danger-full-access).
 */
export type AgentPermissionMode = "restricted" | "auto";

export type AppSettings = {
	// General
	restoreLastVault: boolean;
	confirmBeforeClose: boolean;
	/**
	 * Translator Runtime base URL for magic-wand / identifier import.
	 * Default: hosted poco-ai service.
	 */
	translatorBaseUrl: string;
	// Appearance
	theme: ThemePreference;
	locale: LocalePreference;
	editorFontSize: number;
	showLineNumbers: boolean;
	// Agent (local UI prefs; registry lives in Host)
	agentEnabled: boolean;
	/** Global permission handling applied to every agent run. */
	agentPermissionMode: AgentPermissionMode;
	// Privacy
	analyticsEnabled: boolean;
	shareCrashReports: boolean;
};

/** Default Translator Runtime endpoint (overridable in Settings). */
export const DEFAULT_TRANSLATOR_BASE_URL = "https://translator.philfan.cn";

export const DEFAULT_SETTINGS: AppSettings = {
	restoreLastVault: true,
	confirmBeforeClose: false,
	translatorBaseUrl: DEFAULT_TRANSLATOR_BASE_URL,
	theme: "system",
	locale: "system",
	editorFontSize: 14,
	showLineNumbers: false,
	agentEnabled: true,
	agentPermissionMode: "restricted",
	analyticsEnabled: false,
	shareCrashReports: false,
};

const SETTINGS_KEY = "motif-settings";

export function loadSettings(): AppSettings {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (!raw) return { ...DEFAULT_SETTINGS };
		const parsed = JSON.parse(raw) as Partial<AppSettings> & {
			agentBaseUrl?: string;
			agentApiKey?: string;
			agentModel?: string;
			/** @deprecated replaced by agentPermissionMode */
			agentYolo?: boolean;
			/** @deprecated always download PDF on import */
			downloadFulltextToLocal?: boolean;
			downloadFulltextWhenNoRemotePreview?: boolean;
		};
		// Drop legacy BYOK / download-toggle fields if present.
		const {
			agentBaseUrl: _u,
			agentApiKey: _k,
			agentModel: _m,
			agentYolo: _y,
			downloadFulltextToLocal: _d1,
			downloadFulltextWhenNoRemotePreview: _d2,
			...rest
		} = parsed;
		const merged = { ...DEFAULT_SETTINGS, ...rest };
		// Migrate legacy boolean YOLO into the permission-mode enum.
		if (
			parsed.agentYolo !== undefined &&
			rest.agentPermissionMode === undefined
		) {
			merged.agentPermissionMode = parsed.agentYolo ? "auto" : "restricted";
		}
		// Empty / missing URL → product default
		if (!merged.translatorBaseUrl?.trim()) {
			merged.translatorBaseUrl = DEFAULT_TRANSLATOR_BASE_URL;
		} else {
			merged.translatorBaseUrl = merged.translatorBaseUrl
				.trim()
				.replace(/\/+$/, "");
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
