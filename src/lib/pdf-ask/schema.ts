import type {
	PdfAskAnchor,
	PdfAskMessage,
	PdfAskNormalizedRect,
	PdfAskThread,
	PdfAskTrigger,
} from "@/lib/pdf-ask/types";

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRect(v: unknown): v is PdfAskNormalizedRect {
	if (!isRecord(v)) return false;
	return (
		typeof v.x === "number" &&
		typeof v.y === "number" &&
		typeof v.w === "number" &&
		typeof v.h === "number"
	);
}

function isTrigger(v: unknown): v is PdfAskTrigger {
	return v === "selection" || v === "dblclick" || v === "dwell";
}

function parseMessage(v: unknown): PdfAskMessage | null {
	if (!isRecord(v)) return null;
	if (typeof v.id !== "string" || typeof v.content !== "string") return null;
	if (v.role !== "user" && v.role !== "assistant" && v.role !== "system") {
		return null;
	}
	if (typeof v.createdAt !== "string") return null;
	const msg: PdfAskMessage = {
		id: v.id,
		role: v.role,
		content: v.content,
		createdAt: v.createdAt,
	};
	if (typeof v.agentSessionId === "string") {
		msg.agentSessionId = v.agentSessionId;
	}
	if (Array.isArray(v.sources)) {
		msg.sources = v.sources.filter(isRecord).map((s) => ({
			title: typeof s.title === "string" ? s.title : undefined,
			uri: typeof s.uri === "string" ? s.uri : undefined,
		}));
	}
	return msg;
}

function parseAnchor(v: unknown): PdfAskAnchor | null {
	if (!isRecord(v)) return null;
	if (typeof v.page !== "number" || !Number.isFinite(v.page)) return null;
	if (!Array.isArray(v.rects) || !v.rects.every(isRect)) return null;
	if (!isTrigger(v.trigger)) return null;
	const anchor: PdfAskAnchor = {
		page: Math.max(1, Math.floor(v.page)),
		rects: v.rects as PdfAskNormalizedRect[],
		trigger: v.trigger,
	};
	if (typeof v.quote === "string") anchor.quote = v.quote;
	return anchor;
}

/** Validate and normalize a thread JSON payload. Returns null if invalid. */
export function parsePdfAskThread(raw: unknown): PdfAskThread | null {
	if (!isRecord(raw)) return null;
	if (raw.version !== 1) return null;
	if (typeof raw.id !== "string" || !raw.id) return null;
	if (typeof raw.paperPath !== "string") return null;
	if (typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string") {
		return null;
	}
	if (raw.status !== "open" && raw.status !== "ended") return null;
	const anchor = parseAnchor(raw.anchor);
	if (!anchor) return null;
	if (!Array.isArray(raw.messages)) return null;
	const messages: PdfAskMessage[] = [];
	for (const m of raw.messages) {
		const parsed = parseMessage(m);
		if (!parsed) return null;
		messages.push(parsed);
	}
	return {
		version: 1,
		id: raw.id,
		paperPath: raw.paperPath,
		createdAt: raw.createdAt,
		updatedAt: raw.updatedAt,
		status: raw.status,
		anchor,
		messages,
	};
}

export function threadPreview(thread: PdfAskThread): string {
	const firstUser = thread.messages.find((m) => m.role === "user");
	if (firstUser?.content.trim()) {
		const t = firstUser.content.trim().replace(/\s+/g, " ");
		return t.length > 80 ? `${t.slice(0, 77)}…` : t;
	}
	const q = thread.anchor.quote?.trim().replace(/\s+/g, " ") ?? "";
	if (q) return q.length > 80 ? `${q.slice(0, 77)}…` : q;
	return thread.id;
}

export function threadY(thread: PdfAskThread): number {
	const rects = thread.anchor.rects;
	if (!rects.length) return 0.1;
	let minY = 1;
	let maxY = 0;
	for (const r of rects) {
		minY = Math.min(minY, r.y);
		maxY = Math.max(maxY, r.y + r.h);
	}
	return Math.min(1, Math.max(0, (minY + maxY) / 2));
}
