import { describe, expect, it } from "vitest";

import {
	type Citation,
	looksLikeCitationMarker,
	matchCitationByMarker,
} from "@/lib/paper/refs";

const citations: Citation[] = [
	{
		id: "ref-1",
		display: "[1]",
		metadata: {
			title: "Attention Is All You Need",
			authors: ["Ashish Vaswani"],
			year: 2017,
		},
		source: "bbl",
		status: "resolved",
	},
	{
		id: "ref-2",
		display: "[2]",
		metadata: {
			title: "A second paper",
			authors: ["Jane Smith"],
			year: 2020,
		},
		source: "bbl",
		status: "resolved",
	},
];

describe("looksLikeCitationMarker", () => {
	it.each([
		"[12]",
		"(12)",
		"[3, 7]",
		"12–14",
		"12,",
		"Smith 2020",
	])("accepts citation-shaped marker %s", (marker) => {
		expect(looksLikeCitationMarker(marker)).toBe(true);
	});

	it.each([
		"Figure 2",
		"Fig. 3",
		"Section 4",
		"Table 1",
		"Equation 5",
		"Appendix A",
		"page 12",
		"[12",
		"12]",
	])("rejects internal cross-reference %s", (marker) => {
		expect(looksLikeCitationMarker(marker)).toBe(false);
	});
});

describe("matchCitationByMarker", () => {
	it("matches numeric and author-year citations", () => {
		expect(matchCitationByMarker(citations, "[2]")).toBe("ref-2");
		expect(matchCitationByMarker(citations, "Vaswani et al., 2017")).toBe(
			"ref-1",
		);
	});

	it("does not interpret a figure number as a bibliography ordinal", () => {
		expect(matchCitationByMarker(citations, "Figure 2")).toBeNull();
	});
});
