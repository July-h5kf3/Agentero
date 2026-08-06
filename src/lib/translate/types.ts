/**
 * Application-level translation service types.
 * Architecture mirrors zotero-pdf-translate's pluggable TranslateService table.
 */

/** Free MT engines + BYOA Agent (no paid API keys). */
export type FreeTranslateProviderId =
	| "google"
	| "googleapi"
	| "bing"
	| "youdao"
	| "deeplx"
	| "huoshanweb"
	| "tencenttransmart"
	| "libre";

export type TranslateProviderId = FreeTranslateProviderId | "agent";

export type TranslateTargetLang = "ui" | "en" | "zh-CN";

export type TranslateSourceLang = "auto";

export type TranslateSettings = {
	/** App-wide default provider. */
	provider: TranslateProviderId;
	targetLang: TranslateTargetLang;
	sourceLang: TranslateSourceLang;
	/**
	 * Optional endpoint override:
	 * - provider `libre`: LibreTranslate base URL (required)
	 * - otherwise unused
	 */
	freeBaseUrl: string;
	/** PDF consumer: auto-run translate after selection (default off). */
	autoTranslateSelection: boolean;
	/**
	 * Agent seat for provider === "agent".
	 * Empty = follow registry defaultId.
	 */
	agentId: string;
	/**
	 * ACP model id for provider === "agent".
	 * Empty = follow loadModelPref(agentId) / agent current.
	 */
	modelId: string;
};

export type TranslateServiceType = "sentence" | "word";

/** Mutable task state (aligned with Zotero PDF Translate `data`). */
export type TranslateTask = {
	text: string;
	sourceLang: string;
	targetLang: string;
	result?: string;
	error?: string;
	context?: {
		page?: number;
		paperId?: string;
		quote?: string;
		/** e.g. "pdf-selection" */
		surface?: string;
	};
};

export type TranslateRunOptions = {
	/** Override settings.provider for this call. */
	providerId?: TranslateProviderId;
	/**
	 * Endpoint override for LibreTranslate.
	 * Prefer setting via {@link runTranslate} from AppSettings.
	 */
	freeBaseUrl?: string;
	/**
	 * Agent path: inject runner so lib/ does not depend on ACP wiring.
	 * Streaming is the caller's concern; this returns the final string when used.
	 */
	agent?: {
		runOnce: (prompt: string) => Promise<string>;
	};
};

export type TranslateService = {
	id: TranslateProviderId;
	type: TranslateServiceType;
	/** i18n key under settings:translate.provider.* */
	nameKey: string;
	requireSecret: boolean;
	requireExternalConfig?: boolean;
	/** Free MT engines call Host; agent uses ACP. */
	kind: "free-mt" | "agent";
	translate: (task: TranslateTask, opts: TranslateRunOptions) => Promise<void>;
};

/** Ordered list for settings UI (free engines; agent registered separately). */
export const FREE_MT_PROVIDER_IDS: FreeTranslateProviderId[] = [
	"tencenttransmart",
	"huoshanweb",
	"deeplx",
	"bing",
	"youdao",
	"googleapi",
	"google",
	"libre",
];
