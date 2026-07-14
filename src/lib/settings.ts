export type ThemePreference = "system" | "light" | "dark";

export type AppSettings = {
	// General
	restoreLastVault: boolean;
	confirmBeforeClose: boolean;
	// Appearance
	theme: ThemePreference;
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
	theme: "system",
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
			...rest
		} = parsed as Partial<AppSettings> & {
			agentBaseUrl?: string;
			agentApiKey?: string;
			agentModel?: string;
		};
		return { ...DEFAULT_SETTINGS, ...rest };
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
