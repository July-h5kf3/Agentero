import { nanoid } from "nanoid";

import {
	deleteMarkFile,
	listMarkRaw,
	readMarkRaw,
	writeMarkFile,
} from "@/lib/pdf-selection/marks-io";
import { parsePdfTranslateRecord } from "@/lib/pdf-translate/schema";
import type {
	PdfTranslateRecord,
	PdfTranslateRect,
} from "@/lib/pdf-translate/types";
import { isTauri } from "@/lib/tauri";

/** In-memory fallback when not running under Tauri (browser dev). */
const memoryStore = new Map<string, Map<string, PdfTranslateRecord>>();

function memoryBucket(paperAbsPath: string): Map<string, PdfTranslateRecord> {
	let b = memoryStore.get(paperAbsPath);
	if (!b) {
		b = new Map();
		memoryStore.set(paperAbsPath, b);
	}
	return b;
}

export function newTranslateId(): string {
	return nanoid(10);
}

export function createTranslateRecord(input: {
	paperPath: string;
	page: number;
	rects: PdfTranslateRect[];
	quote?: string;
	result?: string;
	error?: string;
	id?: string;
}): PdfTranslateRecord {
	const now = new Date().toISOString();
	const rec: PdfTranslateRecord = {
		version: 1,
		kind: "translate",
		id: input.id ?? newTranslateId(),
		paperPath: input.paperPath,
		createdAt: now,
		updatedAt: now,
		page: Math.max(1, Math.floor(input.page)),
		rects: input.rects,
	};
	if (input.quote?.trim()) rec.quote = input.quote.trim();
	if (input.result?.trim()) rec.result = input.result.trim();
	if (input.error?.trim()) rec.error = input.error.trim();
	return rec;
}

export async function listPdfTranslates(
	paperAbsPath: string,
): Promise<PdfTranslateRecord[]> {
	if (!paperAbsPath) return [];

	if (!isTauri()) {
		return Array.from(memoryBucket(paperAbsPath).values()).sort((a, b) =>
			a.createdAt < b.createdAt ? 1 : -1,
		);
	}

	const list: PdfTranslateRecord[] = [];
	for (const raw of await listMarkRaw(paperAbsPath)) {
		const parsed = parsePdfTranslateRecord(raw);
		if (parsed) list.push(parsed);
	}
	list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
	return list;
}

export async function writePdfTranslate(
	paperAbsPath: string,
	record: PdfTranslateRecord,
): Promise<void> {
	const next: PdfTranslateRecord = {
		...record,
		kind: "translate",
		updatedAt: record.updatedAt ?? new Date().toISOString(),
	};

	if (!isTauri()) {
		memoryBucket(paperAbsPath).set(next.id, next);
		return;
	}

	await writeMarkFile(paperAbsPath, next.id, next);
}

export async function deletePdfTranslate(
	paperAbsPath: string,
	id: string,
): Promise<void> {
	if (!paperAbsPath || !id) return;
	if (!isTauri()) {
		memoryBucket(paperAbsPath).delete(id);
		return;
	}
	await deleteMarkFile(paperAbsPath, id);
}

export async function readPdfTranslate(
	paperAbsPath: string,
	id: string,
): Promise<PdfTranslateRecord | null> {
	if (!isTauri()) {
		return memoryBucket(paperAbsPath).get(id) ?? null;
	}
	const raw = await readMarkRaw(paperAbsPath, id);
	return raw ? parsePdfTranslateRecord(raw) : null;
}
