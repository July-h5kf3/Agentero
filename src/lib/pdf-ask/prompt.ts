import type { PdfAskThread } from "@/lib/pdf-ask/types";

/** Build a single-turn prompt for ACP (includes prior turns for multi-round). */
export function buildPdfAskPrompt(
	thread: PdfAskThread,
	latestUserQuestion: string,
): string {
	const quote = thread.anchor.quote?.trim();
	const page = thread.anchor.page;
	const history = thread.messages
		.filter((m) => m.role === "user" || m.role === "assistant")
		// exclude the just-appended user message if it matches latest
		.slice(0, -1)
		.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
		.join("\n\n");

	const parts = [
		"You are helping the user read a research paper PDF in Agentero.",
		`Page: ${page}`,
	];
	if (quote) {
		parts.push("Quoted text from the PDF:", `> ${quote}`);
	}
	if (history) {
		parts.push("Earlier turns in this selection thread:", history);
	}
	const q = latestUserQuestion.trim();
	parts.push(
		"User question:",
		q || "(no text)",
		"Answer based on the quote and prior turns when possible. Be concise. If uncertain, say so.",
	);
	return parts.join("\n\n");
}

export { buildTranslatePrompt } from "@/lib/translate/prompt";
