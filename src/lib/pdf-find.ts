import type { PDFDocumentProxy } from "pdfjs-dist";
import { clientRectsToNormalized, findPageElByNumber } from "@/lib/pdf-ask";
import type { PdfAskNormalizedRect } from "@/lib/pdf-ask/types";

/** One occurrence of the query: `occ`-th match on `page` (both 0/1-based as noted). */
export type FindMatch = { page: number; occ: number };

/** Lowercased text for a page, cached by page number for repeat searches. */
export async function getPageText(
	doc: PDFDocumentProxy,
	page: number,
	cache: Map<number, string>,
): Promise<string> {
	const hit = cache.get(page);
	if (hit !== undefined) return hit;
	try {
		const p = await doc.getPage(page);
		const tc = await p.getTextContent();
		const text = tc.items
			.map((it) => ("str" in it ? it.str : ""))
			.join("")
			.toLowerCase();
		cache.set(page, text);
		return text;
	} catch {
		cache.set(page, "");
		return "";
	}
}

/** All occurrences of `query` across pages 1..numPages (document order). */
export async function findAllMatches(
	doc: PDFDocumentProxy,
	numPages: number,
	query: string,
	cache: Map<number, string>,
): Promise<FindMatch[]> {
	const needle = query.toLowerCase();
	if (!needle) return [];
	const out: FindMatch[] = [];
	for (let page = 1; page <= numPages; page++) {
		const hay = await getPageText(doc, page, cache);
		if (!hay) continue;
		let from = 0;
		let occ = 0;
		for (;;) {
			const idx = hay.indexOf(needle, from);
			if (idx < 0) break;
			out.push({ page, occ });
			occ += 1;
			from = idx + needle.length;
		}
	}
	return out;
}

/**
 * Merge the many per-fragment rects a Range yields into one rect per text
 * line. Overlapping semi-transparent rects would otherwise stack into uneven
 * dark/light patches; one union rect per line keeps the highlight flat.
 */
function mergeRectsByLine(
	rects: PdfAskNormalizedRect[],
): PdfAskNormalizedRect[] {
	if (rects.length <= 1) return rects;
	const sorted = [...rects].sort((a, b) => a.y - b.y || a.x - b.x);
	const lines: PdfAskNormalizedRect[] = [];
	for (const r of sorted) {
		const last = lines[lines.length - 1];
		if (last) {
			const centerLast = last.y + last.h / 2;
			const centerR = r.y + r.h / 2;
			if (Math.abs(centerLast - centerR) < Math.max(last.h, r.h) * 0.6) {
				const x1 = Math.min(last.x, r.x);
				const y1 = Math.min(last.y, r.y);
				const x2 = Math.max(last.x + last.w, r.x + r.w);
				const y2 = Math.max(last.y + last.h, r.y + r.h);
				last.x = x1;
				last.y = y1;
				last.w = x2 - x1;
				last.h = y2 - y1;
				continue;
			}
		}
		lines.push({ ...r });
	}
	return lines;
}

/**
 * Normalized (0–1) rects for the `occ`-th occurrence of `query` in a page's
 * rendered text layer, or null when it cannot be located (e.g. text layer not
 * yet rendered). Walks the same item order used by {@link getPageText}, so the
 * occurrence index lines up with {@link findAllMatches}.
 */
export function matchRectsOnPage(
	host: HTMLElement,
	page: number,
	occ: number,
	query: string,
): PdfAskNormalizedRect[] | null {
	const needle = query.toLowerCase();
	if (!needle) return null;
	const pageEl = findPageElByNumber(host, page);
	const layer = pageEl?.querySelector(".react-pdf__Page__textContent");
	if (!pageEl || !layer) return null;

	const nodes: { node: Text; start: number }[] = [];
	let full = "";
	const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
	let cur = walker.nextNode();
	while (cur) {
		const tn = cur as Text;
		nodes.push({ node: tn, start: full.length });
		full += tn.nodeValue ?? "";
		cur = walker.nextNode();
	}

	const hay = full.toLowerCase();
	let from = 0;
	let found = -1;
	for (let k = 0; k <= occ; k++) {
		found = hay.indexOf(needle, from);
		if (found < 0) return null;
		from = found + needle.length;
	}
	const end = found + needle.length;

	const locate = (offset: number): { node: Text; offset: number } | null => {
		for (const e of nodes) {
			const len = e.node.nodeValue?.length ?? 0;
			if (offset >= e.start && offset <= e.start + len) {
				return { node: e.node, offset: offset - e.start };
			}
		}
		return null;
	};
	const s = locate(found);
	const en = locate(end);
	if (!s || !en) return null;

	try {
		const range = document.createRange();
		range.setStart(s.node, s.offset);
		range.setEnd(en.node, en.offset);
		return mergeRectsByLine(
			clientRectsToNormalized(pageEl, range.getClientRects()),
		);
	} catch {
		return null;
	}
}
