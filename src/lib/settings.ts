export type ThemePreference = "system" | "light" | "dark";

export type AppSettings = {
	// General
	restoreLastVault: boolean;
	confirmBeforeClose: boolean;
	// Appearance
	theme: ThemePreference;
	editorFontSize: number;
	showLineNumbers: boolean;
	// Agent
	agentEnabled: boolean;
	agentBaseUrl: string;
	agentApiKey: string;
	agentModel: string;
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
	agentEnabled: false,
	agentBaseUrl: "https://api.anthropic.com",
	agentApiKey: "",
	agentModel: "claude-sonnet-4-20250514",
	analyticsEnabled: false,
	shareCrashReports: false,
};

const SETTINGS_KEY = "motif-settings";

export function loadSettings(): AppSettings {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (!raw) return { ...DEFAULT_SETTINGS };
		const parsed = JSON.parse(raw) as Partial<AppSettings>;
		return { ...DEFAULT_SETTINGS, ...parsed };
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
