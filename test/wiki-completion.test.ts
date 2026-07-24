import { describe, expect, it } from "vitest";

import { wikiLinkRules } from "@/components/editor/plugins/wikilink-plugin";
import {
	addRecentWikiCandidate,
	parseWikiCompletionQuery,
	sameWikiPath,
	wikiCompletionInsert,
} from "@/lib/wiki-completion";

describe("wikilink completion grammar", () => {
	it("separates file, heading, block, and same-file queries", () => {
		expect(parseWikiCompletionQuery("Target")).toEqual({
			kind: "file",
			query: "Target",
		});
		expect(parseWikiCompletionQuery("Target#Overview")).toEqual({
			kind: "heading",
			target: "Target",
			query: "Overview",
		});
		expect(parseWikiCompletionQuery("#^summary")).toEqual({
			kind: "block",
			target: "",
			query: "summary",
		});
		expect(parseWikiCompletionQuery("Target|alias")).toBeNull();
	});

	it("writes an alias as display text around a canonical target", () => {
		expect(
			wikiCompletionInsert({
				kind: "file",
				path: "notes/Canonical.md",
				insertText: "notes/Canonical",
				label: "Short name",
				alias: "Short name",
			}),
		).toEqual({
			target: "notes/Canonical",
			alias: "Short name",
		});
		expect(
			wikiCompletionInsert({
				kind: "block",
				path: "notes/Canonical.md",
				insertText: "notes/Canonical#^summary",
				label: "^summary",
			}),
		).toEqual({ target: "notes/Canonical", heading: "^summary" });
		expect(sameWikiPath("notes\\Canonical.md", "notes/canonical.md")).toBe(
			true,
		);
	});

	it("keeps the most recently selected candidates unique and bounded", () => {
		const first = {
			kind: "file" as const,
			path: "notes/First.md",
			insertText: "notes/First",
			label: "First",
		};
		const second = {
			kind: "file" as const,
			path: "notes/Second.md",
			insertText: "notes/Second",
			label: "Second",
		};
		const recent = addRecentWikiCandidate([first], second, 2);
		expect(recent).toEqual([second, first]);
		expect(addRecentWikiCandidate(recent, first, 2)).toEqual([first, second]);
	});

	it("serializes a completion node back to a portable Wikilink", () => {
		const completion = wikiCompletionInsert({
			kind: "heading",
			path: "notes/Canonical.md",
			insertText: "notes/Canonical#Overview",
			label: "Overview",
		});
		const serialized = wikiLinkRules.wikiLink.serialize({
			type: "wikiLink",
			value: completion.target,
			heading: completion.heading,
			alias: "Short name",
			children: [{ text: "" }],
		});
		expect(serialized).toEqual({
			type: "wikiLink",
			value: "notes/Canonical#Overview",
			data: { alias: "Short name" },
		});
	});
});
