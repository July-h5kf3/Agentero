import type { TranslateSettings } from "@/lib/translate/types";

export const DEFAULT_TRANSLATE_SETTINGS: TranslateSettings = {
	/** Prefer Bing free (works in more networks than Google gtx). */
	provider: "bing",
	targetLang: "ui",
	sourceLang: "auto",
	freeBaseUrl: "",
	autoTranslateSelection: false,
	agentId: "",
	modelId: "",
};
