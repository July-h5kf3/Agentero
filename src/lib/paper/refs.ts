/**
 * Paper reference (citation) sidecar helpers.
 * Host parses references (online S2/Crossref → local bib/bbl fallback) into
 * the rebuildable `{paper}/source/agentero-cite.json`; see docs/backend/api.md
 * `paper_refs_parse` / `paper_refs_list`.
 */
import { invokeApi } from "@/lib/core/ipc";

export type CitationMeta = {
	title?: string;
	authors?: string[];
	year?: number;
	venue?: string;
	doi?: string;
	arxivId?: string;
	url?: string;
};

export type CitationLocalMatch = {
	/** Vault-relative path of the matched library paper. */
	paperPath: string;
	matchBy: "doi" | "arxiv" | "title";
};

export type Citation = {
	id: string;
	rawKey?: string;
	/** In-text marker like `[12]` when bibliography order is known. */
	display?: string;
	/** Raw bibliography entry text (always present for bbl/tex sources). */
	raw?: string;
	metadata: CitationMeta;
	localMatch?: CitationLocalMatch;
	/** e.g. `bbl`, `bib`, `s2`, `bbl+s2`. */
	source: string;
	status: "resolved" | "unresolved";
};

export type CiteSidecar = {
	schemaVersion: number;
	source: { mode: string; generatedAt: string; fingerprint: string };
	citations: Citation[];
	messages: string[];
};

/** Read the existing reference sidecar; `null` when not parsed yet. */
export async function paperRefsList(
	vaultPath: string,
	path: string,
): Promise<CiteSidecar | null> {
	const sidecar = await invokeApi<CiteSidecar | null>(
		"paper_refs_list",
		{ args: { vaultPath, path } },
		{ fallback: "paper_refs_list failed", allowVoid: true },
	);
	return sidecar ?? null;
}

/** Parse (or force-refresh) references for one paper and persist the sidecar. */
export async function paperRefsParse(
	vaultPath: string,
	path: string,
	force = false,
): Promise<CiteSidecar> {
	return await invokeApi<CiteSidecar>(
		"paper_refs_parse",
		{ args: { vaultPath, path, force } },
		{ fallback: "paper_refs_parse failed" },
	);
}

const pendingAutoParse = new Map<string, Promise<CiteSidecar | null>>();

function autoParseKey(vaultPath: string, path: string): string {
	return `${vaultPath}::${path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")}`;
}

/**
 * Load the reference sidecar for a paper, automatically parsing it in the
 * background if it does not yet exist. Concurrent calls for the same paper
 * share one parse attempt; failures are swallowed.
 */
export async function loadPaperRefsAuto(
	vaultPath: string,
	path: string,
): Promise<CiteSidecar | null> {
	const k = autoParseKey(vaultPath, path);
	const existing = pendingAutoParse.get(k);
	if (existing) return existing;

	const promise = (async () => {
		let sidecar = await paperRefsList(vaultPath, path).catch(() => null);
		if (!sidecar) {
			sidecar = await paperRefsParse(vaultPath, path, false).catch(() => null);
		}
		return sidecar;
	})();

	pendingAutoParse.set(k, promise);
	promise.finally(() => pendingAutoParse.delete(k));
	return promise;
}

/** Identifier usable by magic-wand import for an unmatched citation. */
export function citationImportIdentifier(citation: Citation): string | null {
	const { arxivId, doi } = citation.metadata;
	if (arxivId?.trim()) return `arXiv:${arxivId.trim()}`;
	if (doi?.trim()) return doi.trim();
	return null;
}

/**
 * Best-effort guard for text extracted from a PDF link annotation.
 *
 * PDF links also cover section, figure, table, and equation jumps. Keep those
 * navigable without publishing them as citation hover markers.
 */
export function looksLikeCitationMarker(marker: string): boolean {
	const compact = marker.trim().replace(/\s+/g, " ");
	if (!compact) return false;

	const internalCrossReference =
		/\b(?:fig(?:ure)?s?|tables?|sections?|secs?|equations?|eqs?|appendi(?:x|ces)|chapters?|pages?|pp?|algorithms?|theorems?|lemmas?|propositions?)\.?\s*\d/iu;
	if (internalCrossReference.test(compact)) return false;

	const numericBody = "\\d{1,3}(?:\\s*[-–—]\\s*\\d{1,3}|\\s*[,;]\\s*\\d{1,3})*";
	const numeric = new RegExp(
		`^(?:\\[\\s*${numericBody}\\s*\\]|\\(\\s*${numericBody}\\s*\\)|${numericBody})[,.;:]?$`,
		"u",
	);
	if (numeric.test(compact)) return true;

	const year = /\b(?:19|20)\d{2}[a-z]?\b/iu;
	const authorWord = /\p{L}{3,}/u;
	return year.test(compact) && authorWord.test(compact);
}

/**
 * Resolve a PDF citation-link anchor text (`[12]`, `12,`, `Vaswani et al.,
 * 2017`) to a sidecar citation id. Numeric anchors match the `[n]` display
 * order; author-year anchors match year + a surname word. Null when unknown.
 */
export function matchCitationByMarker(
	citations: Citation[],
	marker: string,
): string | null {
	const compact = marker.trim().replace(/\s+/g, " ");
	if (!looksLikeCitationMarker(compact)) return null;

	const byNumber = (n: string): string | null => {
		const hit = citations.find((c) => c.display === `[${n}]`);
		if (hit) return hit.id;
		// No bibliography numbering in the sidecar (bib/online mode): fall back
		// to sidecar order — the same ordinal the References cards show.
		if (!citations.some((c) => c.display)) {
			return citations[Number.parseInt(n, 10) - 1]?.id ?? null;
		}
		return null;
	};

	const strictNumeric = compact.match(/^\D{0,2}(\d{1,3})\D{0,2}$/);
	if (strictNumeric) return byNumber(strictNumeric[1]);

	const year = compact.match(/\b(?:19|20)\d{2}\b/)?.[0];
	const word = compact.match(/\p{L}{3,}/u)?.[0]?.toLowerCase();
	if (year && word) {
		const y = Number.parseInt(year, 10);
		const hit = citations.find((c) => {
			if (c.metadata.year !== y) return false;
			const authors = (c.metadata.authors ?? []).join(" ").toLowerCase();
			return (
				authors.includes(word) || (c.raw?.toLowerCase().includes(word) ?? false)
			);
		});
		if (hit) return hit.id;
	}

	// Short anchor like "[3, 7]" / "12–14": take the first number.
	if (compact.length <= 12) {
		const first = compact.match(/\d{1,3}/)?.[0];
		if (first) return byNumber(first);
	}
	return null;
}
