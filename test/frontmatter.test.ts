import { describe, expect, it } from "vitest";

import { joinFrontmatter, splitFrontmatter } from "@/lib/markdown/doc";
import {
	countFrontmatterProperties,
	frontmatterInterior,
	wrapFrontmatter,
} from "@/lib/markdown/frontmatter";

describe("frontmatter helpers", () => {
	it("extracts the YAML interior without fences", () => {
		expect(
			frontmatterInterior("---\naliases:\n  - Full Title\n  - Short\n---\n"),
		).toBe("aliases:\n  - Full Title\n  - Short");
		expect(frontmatterInterior("")).toBe("");
		expect(frontmatterInterior("---\n---\n")).toBe("");
	});

	it("wraps interior into a disk-ready block or clears empty input", () => {
		expect(wrapFrontmatter("aliases:\n  - A\n  - B")).toBe(
			"---\naliases:\n  - A\n  - B\n---\n",
		);
		expect(wrapFrontmatter("  \n  ")).toBe("");
		expect(wrapFrontmatter("")).toBe("");
	});

	it("round-trips through split/join with the panel interior", () => {
		const original =
			"---\naliases:\n  - Attention Is All You Need\n  - AIAYN\ntags:\n  - transformers\n---\n# Body\n";
		const { frontmatter, body } = splitFrontmatter(original);
		const interior = frontmatterInterior(frontmatter);
		expect(countFrontmatterProperties(interior)).toBe(2);
		const next = joinFrontmatter(wrapFrontmatter(interior), body);
		expect(next).toBe(original);
	});

	it("counts only top-level property keys", () => {
		expect(
			countFrontmatterProperties(
				"aliases:\n  - one\n  - two\ntitle: Note\n# comment\n",
			),
		).toBe(2);
		expect(countFrontmatterProperties("")).toBe(0);
	});
});
