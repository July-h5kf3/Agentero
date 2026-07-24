import { nanoid } from "nanoid";
import { isTauri } from "@/lib/core/tauri";
import {
	parsePdfAskThread,
	threadPin,
	threadPreview,
} from "@/lib/pdf/ask/schema";
import type {
	PdfAskAnchor,
	PdfAskThread,
	PdfAskThreadSummary,
} from "@/lib/pdf/ask/types";
import {
	deleteMarkFile,
	listMarkRaw,
	readMarkRaw,
	writeMarkFile,
} from "@/lib/pdf/selection/marks-io";

/** In-memory fallback when not running under Tauri (browser dev). */
const memoryStore = new Map<string, Map<string, PdfAskThread>>();

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
		kind: "ask",
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

	const threads: PdfAskThread[] = [];
	for (const raw of await listMarkRaw(paperAbsPath)) {
		const parsed = parsePdfAskThread(raw);
		if (parsed) threads.push(parsed);
	}
	threads.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
	return threads;
}

export async function listPdfAskSummaries(
	paperAbsPath: string,
): Promise<PdfAskThreadSummary[]> {
	return toSummaries(await listPdfAskThreads(paperAbsPath));
}

export async function readPdfAskThread(
	paperAbsPath: string,
	threadId: string,
): Promise<PdfAskThread | null> {
	if (!isTauri()) {
		return memoryBucket(paperAbsPath).get(threadId) ?? null;
	}
	const raw = await readMarkRaw(paperAbsPath, threadId);
	return raw ? parsePdfAskThread(raw) : null;
}

export async function writePdfAskThread(
	paperAbsPath: string,
	thread: PdfAskThread,
): Promise<void> {
	const next: PdfAskThread = {
		...thread,
		kind: "ask",
		updatedAt: new Date().toISOString(),
	};

	if (!isTauri()) {
		memoryBucket(paperAbsPath).set(next.id, next);
		return;
	}

	await writeMarkFile(paperAbsPath, next.id, next);
}

export async function deletePdfAskThread(
	paperAbsPath: string,
	threadId: string,
): Promise<void> {
	if (!isTauri()) {
		memoryBucket(paperAbsPath).delete(threadId);
		return;
	}
	await deleteMarkFile(paperAbsPath, threadId);
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
