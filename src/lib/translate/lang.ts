import type {
	TranslateSettings,
	TranslateTargetLang,
} from "@/lib/translate/types";

/** BCP-47 / API code for free MT backends. */
export function resolveTargetLangCode(
	targetLang: TranslateTargetLang,
	uiLanguage: string,
): string {
	if (targetLang === "en") return "en";
	if (targetLang === "zh-CN") return "zh-CN";
	// ui
	return uiLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

/** Human-readable name for Agent prompts. */
export function resolveTargetLangName(
	targetLang: TranslateTargetLang,
	uiLanguage: string,
): string {
	const code = resolveTargetLangCode(targetLang, uiLanguage);
	return code === "zh-CN" ? "Chinese" : "English";
}

export function resolveSourceLangCode(sourceLang: string): string {
	const s = sourceLang.trim().toLowerCase();
	if (!s || s === "auto") return "auto";
	return sourceLang.trim();
}

/** Map settings + UI locale → codes used by runTranslate. */
export function langsFromSettings(
	settings: Pick<TranslateSettings, "sourceLang" | "targetLang">,
	uiLanguage: string,
): { sourceLang: string; targetLang: string; targetLangName: string } {
	return {
		sourceLang: resolveSourceLangCode(settings.sourceLang),
		targetLang: resolveTargetLangCode(settings.targetLang, uiLanguage),
		targetLangName: resolveTargetLangName(settings.targetLang, uiLanguage),
	};
}
