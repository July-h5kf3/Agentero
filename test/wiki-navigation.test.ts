import { describe, expect, it } from "vitest";

import {
	findWikiBlockIdRange,
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
		expect(hasWikiBlockAnchor("可精确定位到本段。 ^验收块", "验收块")).toBe(
			true,
		);
		expect(hasWikiBlockAnchor("^summary followed by prose", "summary")).toBe(
			false,
		);
		expect(hasWikiBlockAnchor("not-a-block^summary", "summary")).toBe(false);
	});

	it("locates valid trailing block IDs for Live Preview styling", () => {
		expect(findWikiBlockIdRange("可精确定位到本段。 ^验收块")).toEqual({
			start: 10,
			end: 14,
		});
		expect(findWikiBlockIdRange("Text ^asb  ")).toEqual({
			start: 5,
			end: 9,
		});
		expect(findWikiBlockIdRange("Text ^bad id")).toBeNull();
		expect(findWikiBlockIdRange("`code ^asb`")).toBeNull();
	});
});
