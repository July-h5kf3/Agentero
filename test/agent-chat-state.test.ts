import { beforeEach, describe, expect, it } from "vitest";
import type { AgentListResponse, CatalogScanResponse } from "@/lib/agent";
import {
	agentHasContent,
	agentTextFromParts,
	appendStreamPart,
	applyToolToParts,
	buildOptions,
	dedupeModelsClient,
	errorChatLine,
	errorText,
	isBackgroundWorkflowHistoryTitle,
	resetAgentChatIds,
	resolveSelected,
	upsertPlanPart,
} from "@/lib/agent-chat-state";

beforeEach(() => {
	resetAgentChatIds();
});

describe("errorChatLine / errorText", () => {
	it("builds a stable error line shape", () => {
		const line = errorChatLine("boom");
		expect(line).toEqual({
			id: "err-1",
			kind: "error",
			text: "boom",
		});
	});

	it("coerces thrown values", () => {
		expect(errorText(new Error("x"))).toBe("x");
		expect(errorText("y")).toBe("y");
	});
});

describe("stream / tool / plan parts", () => {
	it("merges consecutive same-kind stream chunks", () => {
		let parts = appendStreamPart([], "text", "hello");
		parts = appendStreamPart(parts, "text", " world");
		expect(parts).toHaveLength(1);
		expect(parts[0]).toMatchObject({ type: "text", text: "hello world" });
	});

	it("starts a new part when kind switches", () => {
		let parts = appendStreamPart([], "reasoning", "think");
		parts = appendStreamPart(parts, "text", "answer");
		expect(parts.map((p) => p.type)).toEqual(["reasoning", "text"]);
	});

	it("upserts tools by id without reordering", () => {
		let parts = appendStreamPart([], "text", "before");
		parts = applyToolToParts(parts, {
			id: "t1",
			title: "Read",
			status: "in_progress",
		});
		parts = appendStreamPart(parts, "text", "after");
		parts = applyToolToParts(parts, {
			id: "t1",
			status: "completed",
			output: "ok",
		});
		expect(parts).toHaveLength(3);
		expect(parts[1]).toMatchObject({
			type: "tool",
			tool: { id: "t1", status: "completed", output: "ok" },
		});
	});

	it("keeps a single plan part", () => {
		let parts = upsertPlanPart(
			[],
			[{ content: "a", status: "pending", priority: "medium" }],
		);
		parts = upsertPlanPart(parts, [
			{ content: "b", status: "completed", priority: "high" },
		]);
		expect(parts).toHaveLength(1);
		expect(parts[0]).toMatchObject({
			type: "plan",
			entries: [{ content: "b" }],
		});
	});

	it("detects content and joins text parts", () => {
		const parts = appendStreamPart(
			appendStreamPart([], "text", "a"),
			"text",
			"b",
		);
		expect(agentHasContent(parts)).toBe(true);
		expect(agentTextFromParts(parts)).toBe("ab");
		expect(agentHasContent([])).toBe(false);
	});
});

describe("buildOptions / resolveSelected", () => {
	const registry: AgentListResponse = {
		agents: [
			{
				id: "reg-1",
				name: "Reg",
				template: "custom",
				command: "x",
				args: [],
				env: {},
				available: true,
			},
		],
		defaultId: "reg-1",
		enabled: true,
	};

	const catalog: CatalogScanResponse = {
		entries: [
			{
				templateId: "claude-acp",
				name: "Claude",
				description: "",
				command: "claude",
				args: [],
				installHint: "",
				binaryAvailable: true,
				acpCommandAvailable: true,
				acpStatus: "ready",
				registeredId: "claude-1",
				isDefault: true,
			},
			{
				templateId: "missing",
				name: "Missing",
				description: "",
				command: "nope",
				args: [],
				installHint: "",
				binaryAvailable: false,
				acpCommandAvailable: false,
				acpStatus: "missing",
				isDefault: false,
			},
		],
		customAgents: [],
		defaultId: "claude-1",
		enabled: true,
		proxyEnabled: false,
		proxyUrl: "",
	};

	it("omits unavailable catalog entries", () => {
		const opts = buildOptions(registry, catalog);
		expect(opts.map((o) => o.name)).toEqual(["Claude", "Reg"]);
		expect(opts.find((o) => o.name === "Missing")).toBeUndefined();
	});

	it("prefers selected id then default", () => {
		const opts = buildOptions(registry, catalog);
		expect(resolveSelected(opts, "reg-1", registry)?.id).toBe("reg-1");
		expect(resolveSelected(opts, null, registry)?.isDefault).toBe(true);
	});
});

describe("dedupeModelsClient", () => {
	it("dedupes by id and display name", () => {
		const out = dedupeModelsClient([
			{ id: "a", name: "Alpha" },
			{ id: "a", name: "Alpha copy" },
			{ id: "b", name: "Alpha" },
			{ id: " c ", name: "  Gamma  " },
		]);
		expect(out).toEqual([
			{ id: "a", name: "Alpha", group: undefined },
			{ id: "c", name: "Gamma", group: undefined },
		]);
	});
});

describe("isBackgroundWorkflowHistoryTitle", () => {
	it("hides paper-reader workflow titles", () => {
		expect(
			isBackgroundWorkflowHistoryTitle("agentero paper-reader notes"),
		).toBe(true);
		expect(isBackgroundWorkflowHistoryTitle("Summarize this paper")).toBe(
			false,
		);
	});
});
