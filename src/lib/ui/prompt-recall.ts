/**
 * Shared “↑ recalls previous user prompt” helpers for chat composers.
 *
 * ChatGPT-style: when the input is empty and the caret is at the start,
 * ArrowUp starts editing (or restores) the last user message so the user
 * can fix and resend — rolling back that turn and everything after it.
 */

export type PromptRecallCaretTarget = {
	value: string;
	selectionStart: number | null;
	selectionEnd: number | null;
};

/**
 * Whether ArrowUp should recall the previous user prompt instead of moving
 * the caret. Requires empty (whitespace-only) input and caret at start.
 */
export function shouldRecallPreviousPrompt(
	event: { key: string },
	el: PromptRecallCaretTarget,
): boolean {
	if (event.key !== "ArrowUp") return false;
	const start = el.selectionStart ?? 0;
	const end = el.selectionEnd ?? 0;
	if (start !== 0 || end !== 0) return false;
	return el.value.trim() === "";
}

type RoleLike = { role?: string; kind?: string };

/** Index of the last user message, or -1. */
export function findLastUserMessageIndex(
	messages: readonly RoleLike[],
): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.role === "user" || m.kind === "user") return i;
	}
	return -1;
}
