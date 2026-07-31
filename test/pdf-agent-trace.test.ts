import { beforeEach, describe, expect, it } from "vitest";

import {
	addVisualDraft,
	clearVisualDrafts,
	consumeVisualDrafts,
	currentVisualDrafts,
	groupVisualDraftsByPaper,
	removeVisualDraft,
	updateVisualDraftComment,
	visualContextStore,
} from "@/lib/agent/visual-context-store";
import {
	annotationPreview,
	buildVisualAnnotationsPrompt,
	completeTrace,
	createRunningTrace,
	failTrace,
	parsePdfVisualSessionTrace,
	tracePins,
} from "@/lib/pdf/agent-trace";

const rect = { x: 0.1, y: 0.2, w: 0.4, h: 0.15 };
const image = { data: "aaa", mimeType: "image/png" };

describe("visual-context-store", () => {
	beforeEach(() => {
		visualContextStore.setState({ drafts: [] });
	});

	it("adds, updates, removes, and consumes drafts", () => {
		const a = addVisualDraft({
			paperPath: "papers/a",
			page: 2,
			rects: [rect],
			comment: "  λ 是什么  ",
			image,
		});
		const b = addVisualDraft({
			paperPath: "papers/a",
			page: 3,
			rects: [rect],
			comment: "比较曲线",
			image,
		});
		expect(currentVisualDrafts()).toHaveLength(2);
		expect(a.comment).toBe("λ 是什么");

		expect(updateVisualDraftComment(a.id, "  updated  ")).toBe(true);
		expect(currentVisualDrafts()[0]?.comment).toBe("updated");

		removeVisualDraft(b.id);
		expect(currentVisualDrafts().map((d) => d.id)).toEqual([a.id]);

		const consumed = consumeVisualDrafts();
		expect(consumed).toHaveLength(1);
		expect(currentVisualDrafts()).toHaveLength(0);
	});

	it("clearVisualDrafts drops without returning items", () => {
		addVisualDraft({
			paperPath: "papers/a",
			page: 1,
			rects: [rect],
			comment: "x",
			image,
		});
		clearVisualDrafts();
		expect(currentVisualDrafts()).toEqual([]);
	});

	it("groups drafts by paper path", () => {
		addVisualDraft({
			paperPath: "papers/a",
			page: 1,
			rects: [rect],
			comment: "a1",
			image,
		});
		addVisualDraft({
			paperPath: "papers/b",
			page: 1,
			rects: [rect],
			comment: "b1",
			image,
		});
		addVisualDraft({
			paperPath: "papers/a",
			page: 2,
			rects: [rect],
			comment: "a2",
			image,
		});
		const groups = groupVisualDraftsByPaper(currentVisualDrafts());
		expect([...groups.keys()].sort()).toEqual(["papers/a", "papers/b"]);
		expect(groups.get("papers/a")).toHaveLength(2);
		expect(groups.get("papers/b")).toHaveLength(1);
	});
});

describe("visual annotations prompt", () => {
	it("requires per-annotation headings and ordered comments", () => {
		const prompt = buildVisualAnnotationsPrompt([
			{ page: 3, comment: "这条公式里的 λ 起什么作用？" },
			{ page: 5, comment: "比较红线和蓝线的差异。" },
		]);
		expect(prompt).toContain("## Annotation 1");
		expect(prompt).toContain("## Annotation 2");
		expect(prompt).toContain("Answer every annotation separately");
		expect(prompt).toContain("Annotation 1 — page 3");
		expect(prompt).toContain("User comment: 这条公式里的 λ 起什么作用？");
		expect(prompt).toContain("Annotation 2 — page 5");
		expect(prompt).toContain("User comment: 比较红线和蓝线的差异。");
		expect(prompt.indexOf("## Annotation 1")).toBeLessThan(
			prompt.indexOf("## Annotation 2"),
		);
	});
});

describe("agent-trace schema and lifecycle", () => {
	it("parses a valid trace", () => {
		const raw = {
			version: 1,
			kind: "agent-trace",
			id: "tr1",
			paperPath: "papers/1706.03762",
			annotations: [
				{
					id: "an1",
					index: 1,
					page: 3,
					rects: [rect],
					comment: "λ 是什么",
				},
			],
			agentId: "agent-1",
			runtimeSessionId: "sess-rt",
			messageId: "msg-1",
			status: "running",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};
		const t = parsePdfVisualSessionTrace(raw);
		expect(t).not.toBeNull();
		if (!t) return;
		expect(t.kind).toBe("agent-trace");
		expect(t.annotations[0]?.comment).toBe("λ 是什么");
		expect(annotationPreview(t.annotations[0]!)).toContain("λ");
		const pins = tracePins(t);
		expect(pins).toHaveLength(1);
		expect(pins[0]?.traceId).toBe("tr1");
		expect(pins[0]?.page).toBe(3);
	});

	it("rejects wrong kind or empty annotations", () => {
		expect(
			parsePdfVisualSessionTrace({
				version: 1,
				kind: "ask",
				id: "x",
			}),
		).toBeNull();
		expect(
			parsePdfVisualSessionTrace({
				version: 1,
				kind: "agent-trace",
				id: "x",
				paperPath: "p",
				annotations: [],
				agentId: "a",
				runtimeSessionId: "r",
				messageId: "m",
				status: "running",
				createdAt: "t",
				updatedAt: "t",
			}),
		).toBeNull();
	});

	it("creates running traces and updates completed/failed", () => {
		const running = createRunningTrace({
			paperPath: "papers/a",
			agentId: "agent-1",
			runtimeSessionId: "rt-1",
			messageId: "msg-1",
			annotations: [
				{ page: 1, rects: [rect], comment: "first" },
				{ page: 2, rects: [rect], comment: "second" },
			],
		});
		expect(running.status).toBe("running");
		expect(running.annotations).toHaveLength(2);
		expect(running.annotations[0]?.index).toBe(1);
		expect(running.annotations[1]?.index).toBe(2);
		expect(tracePins(running)).toHaveLength(2);

		const completed = completeTrace(running, {
			providerSessionId: "prov-1",
			answerSnapshot: "## Annotation 1\nok",
			sources: ["uri:1"],
		});
		expect(completed.status).toBe("completed");
		expect(completed.providerSessionId).toBe("prov-1");
		expect(completed.answerSnapshot).toContain("Annotation 1");
		expect(completed.sources).toEqual(["uri:1"]);
		expect(completed.error).toBeUndefined();

		const failed = failTrace(running, { error: "timeout" });
		expect(failed.status).toBe("failed");
		expect(failed.error).toBe("timeout");
	});

	it("round-trips create → complete → parse", () => {
		const running = createRunningTrace({
			id: "fixed-id",
			paperPath: "papers/x",
			agentId: "a",
			runtimeSessionId: "r",
			messageId: "m",
			annotations: [{ id: "ann-a", page: 4, rects: [rect], comment: "q" }],
			createdAt: "2026-01-01T00:00:00.000Z",
		});
		const completed = completeTrace(running, {
			providerSessionId: "p",
			answerSnapshot: "answer",
			updatedAt: "2026-01-01T00:01:00.000Z",
		});
		const parsed = parsePdfVisualSessionTrace(
			JSON.parse(JSON.stringify(completed)),
		);
		expect(parsed).toEqual(completed);
	});
});
