/**
 * Line-oriented unified diff for notes review (and similar “before → after” UIs).
 * Pure LCS; no external `diff` dependency.
 */

export type DiffLineKind = "equal" | "add" | "remove";

export type DiffLine = {
	kind: DiffLineKind;
	/** Line text without trailing newline. */
	text: string;
	/** 1-based line number in the “before” text; null for pure additions. */
	oldLine: number | null;
	/** 1-based line number in the “after” text; null for pure removals. */
	newLine: number | null;
};

function splitLines(text: string): string[] {
	if (text.length === 0) return [];
	// Keep empty trailing line if the source ends with \n so empty files and
	// “file ends with newline” still show a sensible last row.
	const parts = text.split("\n");
	if (parts.length > 0 && parts[parts.length - 1] === "") {
		parts.pop();
	}
	return parts;
}

/** Compute a Myers-style LCS table (classic DP; fine for note-sized docs). */
function lcsTable(a: string[], b: string[]): number[][] {
	const n = a.length;
	const m = b.length;
	const dp: number[][] = Array.from({ length: n + 1 }, () =>
		new Array<number>(m + 1).fill(0),
	);
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
			else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	return dp;
}

/**
 * Unified line diff: equal / remove / add rows in document order.
 * Empty vs empty → one empty equal line so the UI is never blank without reason.
 */
export function diffLines(before: string, after: string): DiffLine[] {
	const a = splitLines(before);
	const b = splitLines(after);

	if (a.length === 0 && b.length === 0) {
		return [{ kind: "equal", text: "", oldLine: 1, newLine: 1 }];
	}

	const dp = lcsTable(a, b);
	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	let oldLine = 1;
	let newLine = 1;

	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			out.push({
				kind: "equal",
				text: a[i],
				oldLine: oldLine++,
				newLine: newLine++,
			});
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			out.push({
				kind: "remove",
				text: a[i],
				oldLine: oldLine++,
				newLine: null,
			});
			i++;
		} else {
			out.push({
				kind: "add",
				text: b[j],
				oldLine: null,
				newLine: newLine++,
			});
			j++;
		}
	}
	while (i < a.length) {
		out.push({
			kind: "remove",
			text: a[i++],
			oldLine: oldLine++,
			newLine: null,
		});
	}
	while (j < b.length) {
		out.push({
			kind: "add",
			text: b[j++],
			oldLine: null,
			newLine: newLine++,
		});
	}
	return out;
}
