import { readDir } from "@tauri-apps/plugin-fs";
import { nanoid } from "nanoid";

import { parsePdfTranslateRecord } from "@/lib/pdf-translate/schema";
import type {
	PdfTranslateRecord,
	PdfTranslateRect,
} from "@/lib/pdf-translate/types";
import { isTauri } from "@/lib/tauri";
import { joinVaultPath, readVaultFile, writeVaultFile } from "@/lib/vault";

/** In-memory fallback when not running under Tauri (browser dev). */
const memoryStore = new Map<string, Map<string, PdfTranslateRecord>>();

function translatesDir(paperAbsPath: string): string {
	return joinVaultPath(paperAbsPath, "translates");
}

function translatePath(paperAbsPath: string, id: string): string {
	return joinVaultPath(translatesDir(paperAbsPath), `${id}.json`);
}

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
	id?: string;
}): PdfTranslateRecord {
	const rec: PdfTranslateRecord = {
		version: 1,
		id: input.id ?? newTranslateId(),
		paperPath: input.paperPath,
		createdAt: new Date().toISOString(),
		page: Math.max(1, Math.floor(input.page)),
		rects: input.rects,
	};
	if (input.quote?.trim()) rec.quote = input.quote.trim();
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

	const dir = translatesDir(paperAbsPath);
	let names: string[] = [];
	try {
		const entries = await readDir(dir);
		names = entries
			.map((e) => e.name)
			.filter((n): n is string => Boolean(n?.endsWith(".json")));
	} catch {
		return [];
	}

	const list: PdfTranslateRecord[] = [];
	for (const name of names) {
		try {
			const raw = await readVaultFile(joinVaultPath(dir, name));
			const parsed = parsePdfTranslateRecord(JSON.parse(raw) as unknown);
			if (parsed) list.push(parsed);
		} catch {
			// skip corrupt
		}
	}
	list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
	return list;
}

export async function writePdfTranslate(
	paperAbsPath: string,
	record: PdfTranslateRecord,
): Promise<void> {
	if (!isTauri()) {
		memoryBucket(paperAbsPath).set(record.id, record);
		return;
	}
	const path = translatePath(paperAbsPath, record.id);
	await writeVaultFile(path, `${JSON.stringify(record, null, 2)}\n`);
}
