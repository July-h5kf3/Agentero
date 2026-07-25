import { describe, expect, it } from "vitest";
import {
	findLastUserMessageIndex,
	shouldRecallPreviousPrompt,
} from "@/lib/ui/prompt-recall";

describe("shouldRecallPreviousPrompt", () => {
	it("accepts ArrowUp on empty input with caret at start", () => {
		expect(
			shouldRecallPreviousPrompt(
				{ key: "ArrowUp" },
				{ value: "", selectionStart: 0, selectionEnd: 0 },
			),
		).toBe(true);
	});

	it("accepts whitespace-only draft", () => {
		expect(
			shouldRecallPreviousPrompt(
				{ key: "ArrowUp" },
				{ value: "  \n", selectionStart: 0, selectionEnd: 0 },
			),
		).toBe(true);
	});

	it("rejects when caret is not at start", () => {
		expect(
			shouldRecallPreviousPrompt(
				{ key: "ArrowUp" },
				{ value: "", selectionStart: 1, selectionEnd: 1 },
			),
		).toBe(false);
	});

	it("rejects when input has content", () => {
		expect(
			shouldRecallPreviousPrompt(
				{ key: "ArrowUp" },
				{ value: "hello", selectionStart: 0, selectionEnd: 0 },
			),
		).toBe(false);
	});

	it("rejects other keys", () => {
		expect(
			shouldRecallPreviousPrompt(
				{ key: "ArrowDown" },
				{ value: "", selectionStart: 0, selectionEnd: 0 },
			),
		).toBe(false);
	});

	it("rejects selection ranges", () => {
		expect(
			shouldRecallPreviousPrompt(
				{ key: "ArrowUp" },
				{ value: "", selectionStart: 0, selectionEnd: 2 },
			),
		).toBe(false);
	});
});

describe("findLastUserMessageIndex", () => {
	it("finds last user by kind (Agent chat lines)", () => {
		const lines = [
			{ kind: "user" },
			{ kind: "agent" },
			{ kind: "user" },
			{ kind: "agent" },
		];
		expect(findLastUserMessageIndex(lines)).toBe(2);
	});

	it("finds last user by role (PDF ask messages)", () => {
		const messages = [
			{ role: "user" },
			{ role: "assistant" },
			{ role: "system" },
		];
		expect(findLastUserMessageIndex(messages)).toBe(0);
	});

	it("returns -1 when none", () => {
		expect(findLastUserMessageIndex([{ kind: "agent" }])).toBe(-1);
		expect(findLastUserMessageIndex([])).toBe(-1);
	});
});
