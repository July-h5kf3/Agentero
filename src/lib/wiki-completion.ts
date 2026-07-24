import type { WikiSearchCandidate } from "@/lib/wiki";

export type WikiCompletionRequest =
	| { kind: "file"; query: string }
	| { kind: "heading"; target: string; query: string }
	| { kind: "block"; target: string; query: string };

/**
 * Interpret the text after a live `[[` trigger. The caller owns where that
 * text came from; this function keeps the query grammar deterministic and
 * makes it testable without a Slate editor.
 */
export function parseWikiCompletionQuery(
	draft: string,
): WikiCompletionRequest | null {
	if (/[\]\n|]/.test(draft)) return null;
	const hash = draft.indexOf("#");
	if (hash < 0) return { kind: "file", query: draft.trim() };
	const target = draft.slice(0, hash).trim();
	const fragment = draft.slice(hash + 1);
	if (fragment.startsWith("^")) {
		return { kind: "block", target, query: fragment.slice(1).trim() };
	}
	return { kind: "heading", target, query: fragment.trim() };
}

export type WikiCompletionInsert = {
	target: string;
	heading?: string;
	alias?: string;
};

/** Convert a canonical Host candidate into the persisted `wikiLink` node data. */
export function wikiCompletionInsert(
	candidate: WikiSearchCandidate,
): WikiCompletionInsert {
	const hash = candidate.insertText.indexOf("#");
	return {
		target:
			hash < 0 ? candidate.insertText : candidate.insertText.slice(0, hash),
		heading:
			hash < 0 ? undefined : candidate.insertText.slice(hash + 1) || undefined,
		alias: candidate.alias,
	};
}

export function sameWikiPath(left: string, right: string): boolean {
	return (
		left.replace(/\\/g, "/").toLowerCase() ===
		right.replace(/\\/g, "/").toLowerCase()
	);
}

/** Stable identity for a selected completion while the editor stays mounted. */
export function wikiCompletionCandidateKey(
	candidate: WikiSearchCandidate,
): string {
	return [
		candidate.kind,
		candidate.path,
		candidate.insertText,
		candidate.alias ?? "",
	].join("\u0000");
}

/** Keep an in-memory MRU list without adding another persisted Vault state. */
export function addRecentWikiCandidate(
	recent: WikiSearchCandidate[],
	candidate: WikiSearchCandidate,
	limit = 8,
): WikiSearchCandidate[] {
	const key = wikiCompletionCandidateKey(candidate);
	return [
		candidate,
		...recent.filter((item) => wikiCompletionCandidateKey(item) !== key),
	].slice(0, limit);
}
