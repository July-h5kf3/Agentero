import { beforeEach, describe, expect, it } from "vitest";
import type { AgentListResponse, CatalogScanResponse } from "@/lib/agent";
import {
	agentHasContent,
	agentTextFromParts,
	appendStreamPart,
	applyToolToParts,
	buildLocalTranscriptPrompt,
	buildOptions,
	type ChatLine,
	dedupeModelsClient,
	ensureModelsInclude,
	errorChatLine,
	errorText,
	formatAskUserAnswers,
	isBackgroundWorkflowHistoryTitle,
	parseAskUserQuestions,
	providerSessionIdForHistoryLoad,
	resetAgentChatIds,
	resolveSelected,
	shouldDeferSessionEvent,
	upsertChatSessionTurn,
	upsertPlanPart,
} from "@/lib/agent/chat-state";

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

describe("AskUserQuestion tool input", () => {
	it("parses selectable questions and formats the selected answers", () => {
		const questions = parseAskUserQuestions({
			variant: "AskUserQuestion",
			questions: [
				{
					question: "Which scope should I use?",
					options: [
						{ label: "Paper", description: "Only the open paper" },
						{ label: "Vault" },
					],
				},
			],
		});

		expect(questions).toEqual([
			{
				question: "Which scope should I use?",
				options: [
					{ label: "Paper", description: "Only the open paper" },
					{ label: "Vault", description: undefined },
				],
			},
		]);
		expect(formatAskUserAnswers(questions ?? [], ["Paper"])).toBe(
			"Question: Which scope should I use?\nAnswer: Paper",
		);
	});

	it("leaves malformed or unrelated tools on the generic UI", () => {
		expect(parseAskUserQuestions({ variant: "Other", questions: [] })).toBe(
			null,
		);
		expect(
			parseAskUserQuestions('{"variant":"AskUserQuestion","questions":[]}'),
		).toBe(null);
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

describe("ensureModelsInclude", () => {
	it("prepends free-form ids missing from the catalog", () => {
		const out = ensureModelsInclude(
			[
				{ id: "gpt-5", name: "GPT-5" },
				{ id: "gpt-4.1", name: "GPT-4.1" },
			],
			["deepseek-chat", "gpt-5", "  ", null],
			"Custom",
		);
		expect(out[0]).toEqual({
			id: "deepseek-chat",
			name: "deepseek-chat",
			group: "Custom",
		});
		expect(out.map((m) => m.id)).toEqual(["deepseek-chat", "gpt-5", "gpt-4.1"]);
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

	it("hides visual-annotation system prompts from history list", () => {
		const title = `You are reviewing 1 visual annotation from a research paper PDF.

## Annotation 1
User comment: 这里最值得读的是什么?`;
		expect(isBackgroundWorkflowHistoryTitle(title)).toBe(true);
		expect(isBackgroundWorkflowHistoryTitle("这里最值得读的是什么?")).toBe(
			false,
		);
	});
});

describe("providerSessionIdForHistoryLoad", () => {
	it("uses the provider id instead of the Agentero runtime id", () => {
		expect(
			providerSessionIdForHistoryLoad({
				id: "runtime-v4",
				agentId: "codex",
				source: "local",
				title: "Earlier conversation",
				agentName: "Codex",
				startedAt: "",
				lines: [],
				status: "completed",
				providerSessionId: "provider-v7",
			}),
		).toBe("provider-v7");
	});

	it("falls back to the history id for provider-indexed sessions", () => {
		expect(
			providerSessionIdForHistoryLoad({
				id: "provider-v7",
				agentId: "codex",
				source: "external",
				title: "Earlier conversation",
				agentName: "Codex",
				startedAt: "",
				lines: [],
				status: "completed",
			}),
		).toBe("provider-v7");
	});
});

describe("upsertChatSessionTurn", () => {
	it("keeps one local history item when a resumed turn gets a new runtime id", () => {
		const previous = {
			id: "runtime-first",
			agentId: "codex",
			source: "local" as const,
			title: "First question",
			agentName: "Codex",
			startedAt: "",
			lines: [],
			status: "completed" as const,
			providerSessionId: "provider-thread",
		};
		const next = {
			...previous,
			id: "runtime-second",
			title: "Second question",
			lines: [
				{ id: "u1", kind: "user" as const, text: "First question" },
				{ id: "a1", kind: "agent" as const, parts: [] },
				{ id: "u2", kind: "user" as const, text: "Second question" },
			],
		};
		const unrelated = {
			...previous,
			id: "runtime-other",
			providerSessionId: "other-thread",
		};

		expect(
			upsertChatSessionTurn([previous, unrelated], next, previous),
		).toEqual([next, unrelated]);
	});
});

describe("shouldDeferSessionEvent", () => {
	it("defers a new runtime event during a resumed turn", () => {
		expect(
			shouldDeferSessionEvent({
				sessionId: "runtime-second",
				submitting: true,
				pendingRuntimeSessionId: null,
				knownSessionIds: new Set(["runtime-first"]),
			}),
		).toBe(true);
	});

	it("does not defer events after the runtime session is known", () => {
		expect(
			shouldDeferSessionEvent({
				sessionId: "runtime-first",
				submitting: true,
				pendingRuntimeSessionId: null,
				knownSessionIds: new Set(["runtime-first"]),
			}),
		).toBe(false);
	});
});

describe("buildLocalTranscriptPrompt", () => {
	it("formats prior turns for non-resume multi-turn", () => {
		const lines: ChatLine[] = [
			{ id: "u1", kind: "user", text: "first question" },
			{
				id: "a1",
				kind: "agent",
				parts: [{ type: "text", id: "t1", text: "first answer" }],
			},
			{ id: "u2", kind: "user", text: "follow up" },
		];
		const block = buildLocalTranscriptPrompt(lines);
		expect(block).toContain("Earlier turns");
		expect(block).toContain("User: first question");
		expect(block).toContain("Assistant: first answer");
		expect(block).toContain("User: follow up");
	});

	it("includes image-only user turns with a placeholder label", () => {
		const lines: ChatLine[] = [
			{
				id: "u1",
				kind: "user",
				text: "",
				images: [{ data: "YWJj", mimeType: "image/png" }],
			},
			{
				id: "a1",
				kind: "agent",
				parts: [{ type: "text", id: "t1", text: "looks like a chart" }],
			},
		];
		const block = buildLocalTranscriptPrompt(lines);
		expect(block).toContain("User: (image attachment)");
		expect(block).toContain("Assistant: looks like a chart");
	});

	it("returns empty when there is no prior dialogue", () => {
		expect(buildLocalTranscriptPrompt([])).toBe("");
	});
});
