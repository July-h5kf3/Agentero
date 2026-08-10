/** Helpers for counting words and characters in Markdown/plain text. */

const CJK_RE = /\p{Script=Han}/gu;
const WORD_RUN_RE = /[\p{L}\p{N}]+/gu;

/** Count words in a way that works for mixed Chinese/English text.
 *  - Each CJK (Han) character counts as one word.
 *  - Each non-CJK letter/number run counts as one word.
 */
export function countWords(text: string): number {
	const trimmed = text.trim();
	if (!trimmed) return 0;
	const cjk = trimmed.match(CJK_RE)?.length ?? 0;
	const others =
		trimmed.match(WORD_RUN_RE)?.filter((token) => !CJK_RE.test(token)).length ??
		0;
	return cjk + others;
}

/** Count characters in the raw text. */
export function countChars(text: string): number {
	return text.length;
}
