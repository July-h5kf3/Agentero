import type { PdfAskThread } from "@/lib/pdf-ask/types";

/** Build a single-turn prompt for ACP (includes prior turns for multi-round). */
export function buildPdfAskPrompt(
	thread: PdfAskThread,
	latestUserQuestion: string,
	opts?: { hasImage?: boolean },
): string {
	const quote = thread.anchor.quote?.trim();
	const page = thread.anchor.page;
	const history = thread.messages
		.filter((m) => m.role === "user" || m.role === "assistant")
		// exclude the just-appended user message if it matches latest
		.slice(0, -1)
		.map((m) => {
			const img = m.image ? " [image attached]" : "";
			return `${m.role === "user" ? "User" : "Assistant"}: ${m.content}${img}`;
		})
		.join("\n\n");

	const parts = [
		"You are helping the user read a research paper PDF in Motif.",
		`Page: ${page}`,
	];
	if (quote) {
		parts.push("Quoted text from the PDF:", `> ${quote}`);
	}
	if (opts?.hasImage || thread.anchor.trigger === "marquee") {
		parts.push(
			"An image crop from the PDF page is attached (figure / region screenshot). Describe and reason over the visual content when relevant.",
		);
	}
	if (history) {
		parts.push("Earlier turns in this selection thread:", history);
	}
	const q = latestUserQuestion.trim();
	parts.push(
		"User question:",
		q ||
			(opts?.hasImage
				? "Please explain what this figure / region shows."
				: "(no text)"),
		"Answer based on the quote, image, and prior turns when possible. Be concise. If uncertain, say so.",
	);
	return parts.join("\n\n");
}
