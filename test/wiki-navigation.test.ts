import { describe, expect, it } from "vitest";

import {
	findWikiHeadingIndex,
	hasWikiBlockAnchor,
} from "@/lib/wiki-navigation";

describe("wikilink navigation anchors", () => {
	it("uses the full heading path when leaf headings repeat", () => {
		const headings = [
			{ level: 1, text: "Root A" },
			{ level: 2, text: "Child" },
			{ level: 1, text: "Root B" },
			{ level: 2, text: "Child" },
		];
		expect(findWikiHeadingIndex(headings, ["Root B", "Child"])).toBe(3);
		expect(findWikiHeadingIndex(headings, ["Missing"])).toBe(-1);
	});

	it("recognizes block IDs only at the end of their rendered block", () => {
		expect(hasWikiBlockAnchor("Summary text ^summary", "summary")).toBe(true);
		expect(hasWikiBlockAnchor("^summary followed by prose", "summary")).toBe(
			false,
		);
	});
});
