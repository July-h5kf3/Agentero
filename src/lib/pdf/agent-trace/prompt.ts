/**
 * Build the multimodal visual-annotation prompt for ACP runOnce.
 * Images are sent separately in Annotation 1…N order via `images`.
 */

export type VisualAnnotationPromptItem = {
	/** 1-based PDF page number. */
	page: number;
	comment: string;
};

export function buildVisualAnnotationsPrompt(
	items: VisualAnnotationPromptItem[],
): string {
	const annotations = items.map((item) => ({
		page: Math.max(1, Math.floor(item.page)),
		comment: item.comment.trim(),
	}));

	const n = annotations.length;
	if (n === 0) {
		return [
			"You are reviewing visual annotations from a research paper PDF.",
			"No annotations were provided.",
		].join("\n\n");
	}

	const parts: string[] = [
		`You are reviewing ${n} visual annotation${n === 1 ? "" : "s"} from a research paper PDF.`,
		"Answer every annotation separately and in the original order.",
		"Use these exact headings:",
		Array.from({ length: n }, (_, i) => `## Annotation ${i + 1}`).join("\n"),
		[
			"For each annotation:",
			"- Respond using the corresponding image (Image 1 maps to Annotation 1, and so on).",
			"- Do not merge or skip annotations.",
			"- Do not invent unreadable details.",
			"- State uncertainty explicitly.",
		].join("\n"),
	];

	for (let i = 0; i < n; i++) {
		const item = annotations[i];
		const comment = item.comment || "(no comment)";
		parts.push(
			[
				`Annotation ${i + 1} — page ${item.page}`,
				`User comment: ${comment}`,
			].join("\n"),
		);
	}

	return parts.join("\n\n");
}
