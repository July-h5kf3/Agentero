import { readDir } from "@tauri-apps/plugin-fs";
import { nanoid } from "nanoid";

import { parsePdfHighlight } from "@/lib/pdf-highlight/schema";
import type { PdfHighlight, PdfHighlightRect } from "@/lib/pdf-highlight/types";
import { isTauri } from "@/lib/tauri";
import { joinVaultPath, readVaultFile, writeVaultFile } from "@/lib/vault";

/** In-memory fallback when not running under Tauri (browser dev). */
const memoryStore = new Map<string, Map<string, PdfHighlight>>();

function highlightsDir(paperAbsPath: string): string {
	return joinVaultPath(paperAbsPath, "highlights");
}

function highlightPath(paperAbsPath: string, id: string): string {
	return joinVaultPath(highlightsDir(paperAbsPath), `${id}.json`);
}

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

	const dir = highlightsDir(paperAbsPath);
	let names: string[] = [];
	try {
		const entries = await readDir(dir);
		names = entries
			.map((e) => e.name)
			.filter((n): n is string => Boolean(n?.endsWith(".json")));
	} catch {
		return [];
	}

	const highlights: PdfHighlight[] = [];
	for (const name of names) {
		try {
			const raw = await readVaultFile(joinVaultPath(dir, name));
			const parsed = parsePdfHighlight(JSON.parse(raw) as unknown);
			if (parsed) highlights.push(parsed);
		} catch {
			// skip corrupt
		}
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
		updatedAt: new Date().toISOString(),
	};

	if (!isTauri()) {
		memoryBucket(paperAbsPath).set(next.id, next);
		return;
	}

	const path = highlightPath(paperAbsPath, next.id);
	await writeVaultFile(path, `${JSON.stringify(next, null, 2)}\n`);
}

export async function deletePdfHighlight(
	paperAbsPath: string,
	id: string,
): Promise<void> {
	if (!isTauri()) {
		memoryBucket(paperAbsPath).delete(id);
		return;
	}
	try {
		const { remove } = await import("@tauri-apps/plugin-fs");
		await remove(highlightPath(paperAbsPath, id));
	} catch {
		// missing file is fine
	}
}
