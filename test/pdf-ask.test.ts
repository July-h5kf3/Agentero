import { describe, expect, it } from "vitest";

import {
	clientRectsToNormalized,
	createEmptyThread,
	parsePdfAskThread,
	threadHasUserQuestion,
	threadPin,
	threadPreview,
	threadTitle,
} from "@/lib/pdf/ask";
import { buildPdfAskPrompt } from "@/lib/pdf/ask/prompt";

describe("pdf-ask schema", () => {
	it("parses a valid thread", () => {
		const raw = {
			version: 1,
			kind: "ask",
			id: "t1",
			paperPath: "papers/1706.03762",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			status: "open",
			anchor: {
				page: 2,
				rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }],
				quote: "attention is all you need",
				trigger: "selection",
			},
			messages: [
				{
					id: "m1",
					role: "user",
					content: "What does this mean?",
					createdAt: "2026-01-01T00:00:00.000Z",
				},
			],
		};
		const t = parsePdfAskThread(raw);
		expect(t).not.toBeNull();
		if (!t) return;
		expect(t.id).toBe("t1");
		expect(t.anchor.page).toBe(2);
		expect(threadPreview(t)).toContain("What does this mean");
		expect(threadTitle(t, "New")).toContain("What does this mean");
		const pin = threadPin(t);
		expect(pin.y).toBeCloseTo(0.225, 3);
		expect(pin.x).toBeGreaterThan(0.3);
	});

	it("uses empty fallback title when no messages", () => {
		const t = createEmptyThread({
			paperPath: "papers/x",
			anchor: {
				page: 1,
				rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }],
				trigger: "selection",
			},
		});
		expect(threadTitle(t, "新提问")).toBe("新提问");
		expect(threadHasUserQuestion(t)).toBe(false);
	});

	it("detects user question after a user turn", () => {
		const t = createEmptyThread({
			paperPath: "papers/x",
			anchor: {
				page: 1,
				rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }],
				trigger: "selection",
			},
		});
		t.messages.push({
			id: "m1",
			role: "user",
			content: "hello",
			createdAt: new Date().toISOString(),
		});
		expect(threadHasUserQuestion(t)).toBe(true);
	});

	it("rejects bad version", () => {
		expect(parsePdfAskThread({ version: 2, id: "x" })).toBeNull();
	});
});

describe("pdf-ask geometry", () => {
	it("normalizes client rects against page box", () => {
		const pageEl = {
			getBoundingClientRect: () =>
				({
					left: 100,
					top: 50,
					width: 200,
					height: 400,
					right: 300,
					bottom: 450,
					x: 100,
					y: 50,
					toJSON: () => ({}),
				}) as DOMRect,
		} as HTMLElement;

		const rects = clientRectsToNormalized(pageEl, [
			{
				left: 120,
				top: 90,
				width: 40,
				height: 20,
				right: 160,
				bottom: 110,
				x: 120,
				y: 90,
				toJSON: () => ({}),
			} as DOMRect,
		]);
		expect(rects).toHaveLength(1);
		expect(rects[0].x).toBeCloseTo(0.1);
		expect(rects[0].y).toBeCloseTo(0.1);
		expect(rects[0].w).toBeCloseTo(0.2);
		expect(rects[0].h).toBeCloseTo(0.05);
	});
});

describe("pdf-ask prompt", () => {
	it("includes page, quote, and question", () => {
		const thread = createEmptyThread({
			paperPath: "papers/x",
			anchor: {
				page: 3,
				rects: [{ x: 0, y: 0, w: 0.1, h: 0.1 }],
				quote: "Transformer",
				trigger: "selection",
			},
		});
		thread.messages.push({
			id: "u1",
			role: "user",
			content: "Explain",
			createdAt: new Date().toISOString(),
		});
		const p = buildPdfAskPrompt(thread, "Explain");
		expect(p).toContain("Page: 3");
		expect(p).toContain("Transformer");
		expect(p).toContain("Explain");
	});
});
