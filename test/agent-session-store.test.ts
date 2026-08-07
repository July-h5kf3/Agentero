import { beforeEach, describe, expect, it } from "vitest";

import {
	agentSessionStore,
	EMPTY_CHAT_LINES,
} from "@/lib/agent/agent-session-store";

beforeEach(() => {
	agentSessionStore.setState({
		sessions: [],
		activeTabId: "draft",
		draftLines: EMPTY_CHAT_LINES,
		submitting: false,
		runningSessionIds: [],
		turnRequest: null,
	});
});

describe("startDraft", () => {
	it("keeps the completed conversation transcript when starting a new chat", () => {
		const lines = [{ id: "u1", kind: "user" as const, text: "hello" }];
		agentSessionStore.getState().upsertSession({
			id: "runtime-v4",
			agentId: "codex",
			source: "local",
			title: "hello",
			agentName: "Codex",
			startedAt: "",
			lines,
			status: "completed",
			providerSessionId: "provider-v7",
		});

		agentSessionStore.getState().startDraft();

		const state = agentSessionStore.getState();
		expect(state.activeTabId).toBe("draft");
		expect(state.draftLines).toBe(EMPTY_CHAT_LINES);
		expect(state.sessions[0]?.lines).toEqual(lines);
	});
});

describe("hydrateAndActivateSession", () => {
	it("publishes a loaded transcript and activation in one store update", () => {
		const historyItem = {
			id: "provider-v7",
			agentId: "codex",
			source: "external" as const,
			title: "Indexed title",
			agentName: "Codex",
			startedAt: "",
			lines: [],
			status: "completed" as const,
			providerSessionId: "provider-v7",
		};
		const loadedLines = [
			{ id: "u1", kind: "user" as const, text: "Earlier question" },
		];
		agentSessionStore.setState({
			sessions: [historyItem],
			activeTabId: "draft",
			draftLines: [
				{ id: "draft-u1", kind: "user" as const, text: "Unsaved draft" },
			],
		});

		agentSessionStore
			.getState()
			.hydrateAndActivateSession(historyItem, loadedLines, "Earlier question");

		const state = agentSessionStore.getState();
		expect(state.activeTabId).toBe(historyItem.id);
		expect(state.draftLines).toBe(EMPTY_CHAT_LINES);
		expect(state.sessions[0]).toMatchObject({
			id: historyItem.id,
			title: "Earlier question",
			lines: loadedLines,
		});
	});

	it("restores the selected item if a concurrent history refresh removed it", () => {
		const historyItem = {
			id: "provider-v7",
			agentId: "codex",
			source: "external" as const,
			title: "Earlier conversation",
			agentName: "Codex",
			startedAt: "",
			lines: [],
			status: "completed" as const,
			providerSessionId: "provider-v7",
		};
		const loadedLines = [
			{ id: "u1", kind: "user" as const, text: "Earlier question" },
		];

		agentSessionStore
			.getState()
			.hydrateAndActivateSession(historyItem, loadedLines);

		const state = agentSessionStore.getState();
		expect(state.activeTabId).toBe(historyItem.id);
		expect(state.sessions).toEqual([{ ...historyItem, lines: loadedLines }]);
	});
});
