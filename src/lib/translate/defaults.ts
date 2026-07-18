import type { TranslateSettings } from "@/lib/translate/types";

export const DEFAULT_TRANSLATE_SETTINGS: TranslateSettings = {
	provider: "googleapi",
	targetLang: "ui",
	sourceLang: "auto",
	freeBaseUrl: "",
	autoTranslateSelection: false,
	agentId: "",
	modelId: "",
};
