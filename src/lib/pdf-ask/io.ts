import { readDir } from "@tauri-apps/plugin-fs";
import { nanoid } from "nanoid";

import {
	parsePdfAskThread,
	threadPin,
	threadPreview,
} from "@/lib/pdf-ask/schema";
import type {
	PdfAskAnchor,
	PdfAskThread,
	PdfAskThreadSummary,
} from "@/lib/pdf-ask/types";
import { isTauri } from "@/lib/tauri";
import { joinVaultPath, readVaultFile, writeVaultFile } from "@/lib/vault";

/** In-memory fallback when not running under Tauri (browser dev). */
const memoryStore = new Map<string, Map<string, PdfAskThread>>();

function asksDir(paperAbsPath: string): string {
	return joinVaultPath(paperAbsPath, "asks");
}

function threadPath(paperAbsPath: string, threadId: string): string {
	return joinVaultPath(asksDir(paperAbsPath), `${threadId}.json`);
}

function memoryBucket(paperAbsPath: string): Map<string, PdfAskThread> {
	let b = memoryStore.get(paperAbsPath);
	if (!b) {
		b = new Map();
		memoryStore.set(paperAbsPath, b);
	}
	return b;
}

export function newThreadId(): string {
	return nanoid(10);
}

export function newMessageId(): string {
	return nanoid(10);
}

export function createEmptyThread(input: {
	paperPath: string;
	anchor: PdfAskAnchor;
	id?: string;
}): PdfAskThread {
	const now = new Date().toISOString();
	return {
		version: 1,
		id: input.id ?? newThreadId(),
		paperPath: input.paperPath,
		createdAt: now,
		updatedAt: now,
		status: "open",
		anchor: input.anchor,
		messages: [],
	};
}

export async function listPdfAskThreads(
	paperAbsPath: string,
): Promise<PdfAskThread[]> {
	if (!paperAbsPath) return [];

	if (!isTauri()) {
		return Array.from(memoryBucket(paperAbsPath).values()).sort((a, b) =>
			a.updatedAt < b.updatedAt ? 1 : -1,
		);
	}

	const dir = asksDir(paperAbsPath);
	let names: string[] = [];
	try {
		const entries = await readDir(dir);
		names = entries
			.map((e) => e.name)
			.filter((n): n is string => Boolean(n?.endsWith(".json")));
	} catch {
		return [];
	}

	const threads: PdfAskThread[] = [];
	for (const name of names) {
		if (name === "index.json") continue;
		try {
			const raw = await readVaultFile(joinVaultPath(dir, name));
			const parsed = parsePdfAskThread(JSON.parse(raw) as unknown);
			if (parsed) threads.push(parsed);
		} catch {
			// skip corrupt
		}
	}
	threads.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
	return threads;
}

export async function listPdfAskSummaries(
	paperAbsPath: string,
): Promise<PdfAskThreadSummary[]> {
	const threads = await listPdfAskThreads(paperAbsPath);
	return threads.map((t) => {
		const pin = threadPin(t);
		return {
			id: t.id,
			page: t.anchor.page,
			x: pin.x,
			y: pin.y,
			preview: threadPreview(t),
			updatedAt: t.updatedAt,
			status: t.status,
		};
	});
}

export async function readPdfAskThread(
	paperAbsPath: string,
	threadId: string,
): Promise<PdfAskThread | null> {
	if (!isTauri()) {
		return memoryBucket(paperAbsPath).get(threadId) ?? null;
	}
	try {
		const raw = await readVaultFile(threadPath(paperAbsPath, threadId));
		return parsePdfAskThread(JSON.parse(raw) as unknown);
	} catch {
		return null;
	}
}

export async function writePdfAskThread(
	paperAbsPath: string,
	thread: PdfAskThread,
): Promise<void> {
	const next: PdfAskThread = {
		...thread,
		updatedAt: new Date().toISOString(),
	};

	if (!isTauri()) {
		memoryBucket(paperAbsPath).set(next.id, next);
		return;
	}

	const path = threadPath(paperAbsPath, next.id);
	await writeVaultFile(path, `${JSON.stringify(next, null, 2)}\n`);
}

export async function deletePdfAskThread(
	paperAbsPath: string,
	threadId: string,
): Promise<void> {
	if (!isTauri()) {
		memoryBucket(paperAbsPath).delete(threadId);
		return;
	}
	try {
		const { remove } = await import("@tauri-apps/plugin-fs");
		await remove(threadPath(paperAbsPath, threadId));
	} catch {
		// missing file is fine
	}
}

export function toSummaries(threads: PdfAskThread[]): PdfAskThreadSummary[] {
	return threads.map((t) => {
		const pin = threadPin(t);
		return {
			id: t.id,
			page: t.anchor.page,
			x: pin.x,
			y: pin.y,
			preview: threadPreview(t),
			updatedAt: t.updatedAt,
			status: t.status,
		};
	});
}
