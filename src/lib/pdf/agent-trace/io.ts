import { nanoid } from "nanoid";

import { parsePdfVisualSessionTrace } from "@/lib/pdf/agent-trace/schema";
import type {
	PdfVisualNormalizedRect,
	PdfVisualSessionTrace,
	PdfVisualTraceImage,
} from "@/lib/pdf/agent-trace/types";
import { createMarkStore } from "@/lib/pdf/marks/io";

const store = createMarkStore<PdfVisualSessionTrace>({
	parse: parsePdfVisualSessionTrace,
	sort: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
	prepareWrite: (trace) => ({
		...trace,
		kind: "agent-trace",
		updatedAt: new Date().toISOString(),
	}),
});

export function newTraceId(): string {
	return nanoid(10);
}

export type CreateRunningTraceItemInput = {
	id?: string;
	page: number;
	rects: PdfVisualNormalizedRect[];
	comment: string;
	image?: PdfVisualTraceImage;
};

export type CreateRunningTracesInput = {
	paperPath: string;
	items: CreateRunningTraceItemInput[];
	agentId: string;
	runtimeSessionId: string;
	messageId: string;
	createdAt?: string;
};

/** One mark file per crop; shared session fields when submitted together. */
export function createRunningTraces(
	input: CreateRunningTracesInput,
): PdfVisualSessionTrace[] {
	const now = input.createdAt ?? new Date().toISOString();
	if (!input.items.length) {
		throw new Error("createRunningTraces requires at least one item");
	}
	return input.items.map((item, offset) => {
		const trace: PdfVisualSessionTrace = {
			version: 1,
			kind: "agent-trace",
			id: item.id ?? newTraceId(),
			paperPath: input.paperPath,
			index: offset + 1,
			page: Math.max(1, Math.floor(item.page)),
			rects: item.rects,
			comment: item.comment.trim(),
			agentId: input.agentId,
			runtimeSessionId: input.runtimeSessionId,
			messageId: input.messageId,
			status: "running",
			createdAt: now,
			updatedAt: now,
		};
		if (item.image?.data) {
			trace.image = {
				data: item.image.data,
				mimeType: item.image.mimeType || "image/png",
			};
		}
		return trace;
	});
}

export type CompleteTraceInput = {
	providerSessionId?: string;
	answerSnapshot?: string;
	sources?: string[];
	updatedAt?: string;
};

export function completeTrace(
	trace: PdfVisualSessionTrace,
	input: CompleteTraceInput = {},
): PdfVisualSessionTrace {
	const now = input.updatedAt ?? new Date().toISOString();
	const next: PdfVisualSessionTrace = {
		...trace,
		status: "completed",
		updatedAt: now,
	};
	if (input.providerSessionId?.trim()) {
		next.providerSessionId = input.providerSessionId.trim();
	}
	if (typeof input.answerSnapshot === "string") {
		next.answerSnapshot = input.answerSnapshot;
	}
	if (input.sources) {
		next.sources = [...input.sources];
	}
	delete next.error;
	return next;
}

export type FailTraceInput = {
	error: string;
	answerSnapshot?: string;
	updatedAt?: string;
};

export function failTrace(
	trace: PdfVisualSessionTrace,
	input: FailTraceInput,
): PdfVisualSessionTrace {
	const now = input.updatedAt ?? new Date().toISOString();
	const next: PdfVisualSessionTrace = {
		...trace,
		status: "failed",
		error: input.error.trim() || "Agent failed",
		updatedAt: now,
	};
	if (typeof input.answerSnapshot === "string") {
		next.answerSnapshot = input.answerSnapshot;
	}
	return next;
}

export const listPdfVisualTraces = store.list;
export const readPdfVisualTrace = store.read;
export const writePdfVisualTrace = store.write;
export const deletePdfVisualTrace = store.remove;
