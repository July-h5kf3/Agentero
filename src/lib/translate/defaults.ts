import type { TranslateSettings } from "@/lib/translate/types";

export const DEFAULT_TRANSLATE_SETTINGS: TranslateSettings = {
	/** Prefer Tencent Transmart: current no-key default with better availability. */
	provider: "tencenttransmart",
	targetLang: "ui",
	sourceLang: "auto",
	freeBaseUrl: "",
	autoTranslateSelection: false,
	agentId: "",
	modelId: "",
};
