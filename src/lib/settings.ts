import {
	isPaperTreeLabelMode,
	isPaperTreeSortMode,
	type PaperTreeLabelMode,
	type PaperTreeSortMode,
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
	PaperTreeSortMode,
	TranslateProviderId,
	TranslateSettings,
	TranslateTargetLang,
};

export type ThemePreference = "system" | "light" | "dark";

export type LocalePreference = "system" | "en" | "zh-CN";

/**
 * How Agentero responds to agent permission escalations.
 * - `restricted`: decline requests (Codex uses workspace-write).
 * - `ask`: forward each request to the user for an explicit decision.
 * - `auto`: auto-approve every request (YOLO; Codex uses danger-full-access).
 */
export type AgentPermissionMode = "restricted" | "ask" | "auto";

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
	 * How siblings under each folder are ordered in the file tree (display-only).
	 * Default: folder name A–Z.
	 */
	paperTreeSortMode: PaperTreeSortMode;
	/**
	 * Host local HTTP server compatible with the official Zotero Connector
	 * (loopback :23119). Default **off**; mutually exclusive with Zotero desktop.
	 */
	connectorEnabled: boolean;
	// Appearance
	theme: ThemePreference;
	locale: LocalePreference;
	editorFontSize: number;
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
	/**
	 * Free-form user preference instructions injected into every agent
	 * prompt envelope (Composer, paper-reader, workflows, …). Empty = off.
	 */
	agentPersonalPrompt: string;
	/**
	 * Agent seat + model for PDF selection Ask dialogs (划词提问).
	 * Independent of Chat's current agent and of translate.agentId.
	 * Empty agentId / modelId = follow app default agent / that agent's model pref.
	 */
	pdfAsk: PdfAskSettings;
	// Privacy
	analyticsEnabled: boolean;
	shareCrashReports: boolean;
	/** Application-level translation service (free MT + BYOA Agent). */
	translate: TranslateSettings;
};

/** PDF selection Ask (question popover) agent/model prefs. */
export type PdfAskSettings = {
	/** Empty = follow registry default agent. */
	agentId: string;
	/** Empty = follow loadModelPref(agentId). */
	modelId: string;
};

export const DEFAULT_PDF_ASK_SETTINGS: PdfAskSettings = {
	agentId: "",
	modelId: "",
};

/** Default Translator Runtime endpoint (overridable in Settings). */
export const DEFAULT_TRANSLATOR_BASE_URL = "https://translator.philfan.cn";

export const DEFAULT_SETTINGS: AppSettings = {
	restoreLastVault: true,
	confirmBeforeClose: false,
	translatorBaseUrl: DEFAULT_TRANSLATOR_BASE_URL,
	paperTreeLabelMode: "title-author",
	paperTreeSortMode: "folder",
	connectorEnabled: false,
	theme: "system",
	locale: "system",
	editorFontSize: 14,
	showEditorToolbar: true,
	agentEnabled: true,
	agentPermissionMode: "restricted",
	autoPaperReader: false,
	aiResponseLanguage: "auto",
	agentPersonalPrompt: "",
	pdfAsk: { ...DEFAULT_PDF_ASK_SETTINGS },
	analyticsEnabled: false,
	shareCrashReports: false,
	translate: { ...DEFAULT_TRANSLATE_SETTINGS },
};

const SETTINGS_KEY = "agentero-settings";

export function loadSettings(): AppSettings {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (!raw) return { ...DEFAULT_SETTINGS };
		const parsed = JSON.parse(raw) as Partial<AppSettings>;
		const merged = { ...DEFAULT_SETTINGS, ...parsed };
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
		if (!isPaperTreeSortMode(merged.paperTreeSortMode)) {
			merged.paperTreeSortMode = DEFAULT_SETTINGS.paperTreeSortMode;
		}
		if (typeof parsed.autoPaperReader !== "boolean") {
			merged.autoPaperReader = DEFAULT_SETTINGS.autoPaperReader;
		}
		if (typeof parsed.agentPersonalPrompt !== "string") {
			merged.agentPersonalPrompt = DEFAULT_SETTINGS.agentPersonalPrompt;
		} else {
			// Cap extreme values from hand-edited storage; UI does not enforce a hard max.
			merged.agentPersonalPrompt = parsed.agentPersonalPrompt.slice(0, 8000);
		}
		if (typeof parsed.connectorEnabled !== "boolean") {
			merged.connectorEnabled = DEFAULT_SETTINGS.connectorEnabled;
		}
		merged.pdfAsk = normalizePdfAskSettings(
			(parsed as { pdfAsk?: Partial<PdfAskSettings> }).pdfAsk,
		);
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

function normalizePdfAskSettings(
	raw: Partial<PdfAskSettings> | undefined,
): PdfAskSettings {
	const base = { ...DEFAULT_PDF_ASK_SETTINGS };
	if (!raw || typeof raw !== "object") return base;
	if (typeof raw.agentId === "string") {
		base.agentId = raw.agentId.trim();
	}
	if (typeof raw.modelId === "string") {
		base.modelId = raw.modelId.trim();
	}
	return base;
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
