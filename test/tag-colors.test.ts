import { describe, expect, it } from "vitest";
import {
	coercePaperTags,
	isTagColorId,
	normalizePaperTags,
	tagChipStyle,
} from "@/lib/ui/tag-colors";

describe("tag colors", () => {
	it("accepts preset ids only", () => {
		expect(isTagColorId("green")).toBe(true);
		expect(isTagColorId("neon")).toBe(false);
	});

	it("normalizes strings and objects with dedupe", () => {
		const tags = normalizePaperTags([
			"  NLP ",
			{ name: "nlp", color: "green" },
			{ name: "survey", color: "red" },
			"",
			{ name: "  ", color: "teal" },
		]);
		expect(tags).toEqual([
			{ name: "NLP", color: "green" },
			{ name: "survey", color: "red" },
		]);
	});

	it("coerces mixed catalog payloads", () => {
		const tags = coercePaperTags([
			"plain",
			{ name: "colored", color: "teal" },
			{ name: "bad", color: "neon" },
			null,
			42,
		]);
		expect(tags).toEqual([
			{ name: "plain" },
			{ name: "colored", color: "teal" },
			{ name: "bad" },
		]);
	});

	it("returns chip styles only for valid colors", () => {
		expect(tagChipStyle(undefined)).toBeUndefined();
		expect(tagChipStyle("green")).toMatchObject({
			backgroundColor: expect.stringContaining("oklch"),
			color: expect.stringContaining("oklch"),
		});
	});
});
