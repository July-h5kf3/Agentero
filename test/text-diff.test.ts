import { describe, expect, it } from "vitest";
import { diffLines } from "@/lib/text-diff";

describe("diffLines", () => {
	it("marks equal files as equal lines", () => {
		const lines = diffLines("a\nb\n", "a\nb\n");
		expect(lines.map((l) => l.kind)).toEqual(["equal", "equal"]);
		expect(lines.map((l) => l.text)).toEqual(["a", "b"]);
	});

	it("shows additions and removals", () => {
		const lines = diffLines("hello\nworld\n", "hello\nagentero\nworld\n");
		expect(lines).toEqual([
			{ kind: "equal", text: "hello", oldLine: 1, newLine: 1 },
			{ kind: "add", text: "agentero", oldLine: null, newLine: 2 },
			{ kind: "equal", text: "world", oldLine: 2, newLine: 3 },
		]);
	});

	it("handles pure delete and pure insert", () => {
		expect(diffLines("x\n", "")).toEqual([
			{ kind: "remove", text: "x", oldLine: 1, newLine: null },
		]);
		expect(diffLines("", "y\n")).toEqual([
			{ kind: "add", text: "y", oldLine: null, newLine: 1 },
		]);
	});

	it("handles both empty", () => {
		expect(diffLines("", "")).toEqual([
			{ kind: "equal", text: "", oldLine: 1, newLine: 1 },
		]);
	});

	it("replaces a middle line", () => {
		const lines = diffLines("a\nb\nc\n", "a\nB\nc\n");
		expect(lines.map((l) => [l.kind, l.text])).toEqual([
			["equal", "a"],
			["remove", "b"],
			["add", "B"],
			["equal", "c"],
		]);
	});
});
