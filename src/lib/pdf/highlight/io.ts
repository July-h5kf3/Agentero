import { nanoid } from "nanoid";
import { isTauri } from "@/lib/core/tauri";
import { parsePdfHighlight } from "@/lib/pdf/highlight/schema";
import type { PdfHighlight, PdfHighlightRect } from "@/lib/pdf/highlight/types";
import {
	deleteMarkFile,
	listMarkRaw,
	readMarkRaw,
	writeMarkFile,
} from "@/lib/pdf/selection/marks-io";

/** In-memory fallback when not running under Tauri (browser dev). */
const memoryStore = new Map<string, Map<string, PdfHighlight>>();

function memoryBucket(paperAbsPath: string): Map<string, PdfHighlight> {
	let b = memoryStore.get(paperAbsPath);
	if (!b) {
		b = new Map();
		memoryStore.set(paperAbsPath, b);
	}
	return b;
}

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

export async function listPdfHighlights(
	paperAbsPath: string,
): Promise<PdfHighlight[]> {
	if (!paperAbsPath) return [];

	if (!isTauri()) {
		return Array.from(memoryBucket(paperAbsPath).values()).sort((a, b) =>
			a.createdAt < b.createdAt ? 1 : -1,
		);
	}

	const highlights: PdfHighlight[] = [];
	for (const raw of await listMarkRaw(paperAbsPath)) {
		const parsed = parsePdfHighlight(raw);
		if (parsed) highlights.push(parsed);
	}
	highlights.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
	return highlights;
}

export async function writePdfHighlight(
	paperAbsPath: string,
	highlight: PdfHighlight,
): Promise<void> {
	const next: PdfHighlight = {
		...highlight,
		kind: "highlight",
		updatedAt: new Date().toISOString(),
	};

	if (!isTauri()) {
		memoryBucket(paperAbsPath).set(next.id, next);
		return;
	}

	await writeMarkFile(paperAbsPath, next.id, next);
}

export async function deletePdfHighlight(
	paperAbsPath: string,
	id: string,
): Promise<void> {
	if (!isTauri()) {
		memoryBucket(paperAbsPath).delete(id);
		return;
	}
	await deleteMarkFile(paperAbsPath, id);
}

export async function readPdfHighlight(
	paperAbsPath: string,
	id: string,
): Promise<PdfHighlight | null> {
	if (!isTauri()) {
		return memoryBucket(paperAbsPath).get(id) ?? null;
	}
	const raw = await readMarkRaw(paperAbsPath, id);
	return raw ? parsePdfHighlight(raw) : null;
}
