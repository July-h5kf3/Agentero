/**
 * Prompts for the Agent translation provider.
 * Generic surface + PDF selection variant.
 */

export function buildTranslatePrompt(opts: {
	text: string;
	targetLangName: string;
	page?: number;
	surface?: string;
}): string {
	const text = opts.text.trim();
	const parts = [
		"You are a translation assistant in Agentero.",
		`Translate the text below into ${opts.targetLangName}. Preserve technical terms and formulas.`,
		"Return only the translation, without commentary.",
	];
	if (opts.surface === "pdf-selection" && opts.page != null) {
		parts.push(`Source: research paper PDF, page ${opts.page}.`);
	}
	parts.push("Text:", `> ${text}`);
	return parts.join("\n\n");
}

/**
 * @deprecated Prefer {@link buildTranslatePrompt}; kept for pdf-ask re-exports.
 */
export function buildPdfTranslatePrompt(
	quote: string,
	page: number,
	targetLang: string,
): string {
	return buildTranslatePrompt({
		text: quote,
		targetLangName: targetLang,
		page,
		surface: "pdf-selection",
	});
}
