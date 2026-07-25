import { nanoid } from "nanoid";
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
import { createMarkStore } from "@/lib/pdf/marks/io";

const store = createMarkStore<PdfAskThread>({
	parse: parsePdfAskThread,
	sort: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
	prepareWrite: (thread) => ({
		...thread,
		kind: "ask",
		updatedAt: new Date().toISOString(),
	}),
});

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

export const listPdfAskThreads = store.list;
export const readPdfAskThread = store.read;
export const writePdfAskThread = store.write;
export const deletePdfAskThread = store.remove;

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
