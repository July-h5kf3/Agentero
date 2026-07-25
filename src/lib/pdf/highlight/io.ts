import { nanoid } from "nanoid";
import { isTauri } from "@/lib/core/tauri";
import { parsePdfHighlight } from "@/lib/pdf/highlight/schema";
import type { PdfHighlight, PdfHighlightRect } from "@/lib/pdf/highlight/types";
import { listMarkRaw } from "@/lib/pdf/selection/marks-io";

/**
 * Marks IO for **legacy / read-side** highlight files (`marks/*.json`).
 * Runtime write path is {@link annotation-store} (EmbedPDF annotations);
 * keep only list + factory helpers used by migrate/heatmap/tests.
 */

export function newHighlightId(): string {
	return nanoid(10);
}

export function createHighlight(input: {
	paperPath: string;
	page: number;
	rects: PdfHighlightRect[];
	quote: string;
	color?: string;
	comment?: string;
	id?: string;
}): PdfHighlight {
	const now = new Date().toISOString();
	const highlight: PdfHighlight = {
		version: 1,
		kind: "highlight",
		id: input.id ?? newHighlightId(),
		paperPath: input.paperPath,
		createdAt: now,
		updatedAt: now,
		page: Math.max(1, Math.floor(input.page)),
		rects: input.rects,
		quote: input.quote,
	};
	if (input.color) highlight.color = input.color;
	if (input.comment?.trim()) highlight.comment = input.comment.trim();
	return highlight;
}

/** List legacy mark-file highlights (migration / reading heatmap). */
export async function listPdfHighlights(
	paperAbsPath: string,
): Promise<PdfHighlight[]> {
	if (!paperAbsPath || !isTauri()) return [];

	const highlights: PdfHighlight[] = [];
	for (const raw of await listMarkRaw(paperAbsPath)) {
		const parsed = parsePdfHighlight(raw);
		if (parsed) highlights.push(parsed);
	}
	highlights.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
	return highlights;
}
