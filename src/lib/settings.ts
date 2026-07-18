import {
	isPaperTreeLabelMode,
	type PaperTreeLabelMode,
} from "@/lib/paper-metadata";
import { DEFAULT_TRANSLATE_SETTINGS } from "@/lib/translate/defaults";
import { isTranslateProviderId } from "@/lib/translate/services";
import type {
	TranslateProviderId,
	TranslateSettings,
	TranslateTargetLang,
} from "@/lib/translate/types";

export type {
	PaperTreeLabelMode,
	TranslateProviderId,
	TranslateSettings,
	TranslateTargetLang,
};

export type ThemePreference = "system" | "light" | "dark";

export type LocalePreference = "system" | "en" | "zh-CN";

/**
 * How Agentero responds to agent permission escalations.
 * - `restricted`: decline requests (Codex uses workspace-write).
 * - `auto`: auto-approve every request (YOLO; Codex uses danger-full-access).
 */
export type AgentPermissionMode = "restricted" | "auto";

/**
 * Language every agent response (and notes written to files) should use.
 * Independent from the UI `locale`. `auto` injects no directive (agent decides).
 */
export type AiResponseLanguage = "auto" | "en" | "zh-CN";

export type AppSettings = {
	// General
	restoreLastVault: boolean;
	confirmBeforeClose: boolean;
	/**
	 * Translator Runtime base URL for magic-wand / identifier import.
	 * Default: hosted poco-ai service.
	 */
	translatorBaseUrl: string;
	/**
	 * How paper folders are labeled in the file tree (display-only).
	 * Default: title · author.
	 */
	paperTreeLabelMode: PaperTreeLabelMode;
	/**
	 * Host local HTTP server compatible with the official Zotero Connector
	 * (loopback :23119). Default **off**; mutually exclusive with Zotero desktop.
	 */
	connectorEnabled: boolean;
	// Appearance
	theme: ThemePreference;
	locale: LocalePreference;
	editorFontSize: number;
	showLineNumbers: boolean;
	/** Show the WYSIWYG formatting toolbar above Markdown/notes editors. */
	showEditorToolbar: boolean;
	// Agent (local UI prefs; registry lives in Host)
	agentEnabled: boolean;
	/** Global permission handling applied to every agent run. */
	agentPermissionMode: AgentPermissionMode;
	/**
	 * After magic-wand import / single-paper Download, auto-run paper-reader
	 * when assets are ready and catalog `is_read` is false.
	 * Default **off**; Zap still works for manual runs.
	 */
	autoPaperReader: boolean;
	/** Language forced onto every agent response and generated notes. */
	aiResponseLanguage: AiResponseLanguage;
	// Privacy
	analyticsEnabled: boolean;
	shareCrashReports: boolean;
	/** Application-level translation service (free MT + BYOA Agent). */
	translate: TranslateSettings;
};

/** Default Translator Runtime endpoint (overridable in Settings). */
export const DEFAULT_TRANSLATOR_BASE_URL = "https://translator.philfan.cn";

export const DEFAULT_SETTINGS: AppSettings = {
	restoreLastVault: true,
	confirmBeforeClose: false,
	translatorBaseUrl: DEFAULT_TRANSLATOR_BASE_URL,
	paperTreeLabelMode: "title-author",
	connectorEnabled: false,
	theme: "system",
	locale: "system",
	editorFontSize: 14,
	showLineNumbers: false,
	showEditorToolbar: true,
	agentEnabled: true,
	agentPermissionMode: "restricted",
	autoPaperReader: false,
	aiResponseLanguage: "auto",
	analyticsEnabled: false,
	shareCrashReports: false,
	translate: { ...DEFAULT_TRANSLATE_SETTINGS },
};

const SETTINGS_KEY = "agentero-settings";

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
		if (!isPaperTreeLabelMode(merged.paperTreeLabelMode)) {
			merged.paperTreeLabelMode = DEFAULT_SETTINGS.paperTreeLabelMode;
		}
		if (typeof parsed.autoPaperReader !== "boolean") {
			merged.autoPaperReader = DEFAULT_SETTINGS.autoPaperReader;
		}
		if (typeof parsed.connectorEnabled !== "boolean") {
			merged.connectorEnabled = DEFAULT_SETTINGS.connectorEnabled;
		}
		merged.translate = normalizeTranslateSettings(parsed.translate);
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

function isTranslateTargetLang(v: unknown): v is TranslateTargetLang {
	return v === "ui" || v === "en" || v === "zh-CN";
}

function normalizeTranslateSettings(
	raw: Partial<TranslateSettings> | undefined,
): TranslateSettings {
	const base = { ...DEFAULT_TRANSLATE_SETTINGS };
	if (!raw || typeof raw !== "object") return base;
	if (raw.provider && isTranslateProviderId(raw.provider)) {
		base.provider = raw.provider;
	}
	if (raw.targetLang && isTranslateTargetLang(raw.targetLang)) {
		base.targetLang = raw.targetLang;
	}
	if (raw.sourceLang === "auto") {
		base.sourceLang = "auto";
	}
	if (typeof raw.freeBaseUrl === "string") {
		base.freeBaseUrl = raw.freeBaseUrl.trim().replace(/\/+$/, "");
	}
	if (typeof raw.autoTranslateSelection === "boolean") {
		base.autoTranslateSelection = raw.autoTranslateSelection;
	}
	if (typeof raw.agentId === "string") {
		base.agentId = raw.agentId.trim();
	}
	if (typeof raw.modelId === "string") {
		base.modelId = raw.modelId.trim();
	}
	return base;
}
