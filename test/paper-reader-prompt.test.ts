import { describe, expect, it } from "vitest";

import {
	buildPaperReaderUserPrompt,
	paperReaderLanguageInstruction,
} from "@/lib/paper/reader";

describe("paper-reader user prompt language", () => {
	it("asks for Simplified Chinese when App locale is zh-CN", () => {
		expect(paperReaderLanguageInstruction("zh-CN")).toMatch(/Chinese/i);
		const prompt = buildPaperReaderUserPrompt(
			"papers/1706.03762",
			"injected",
			"zh-CN",
		);
		expect(prompt).toContain("Chinese (Simplified)");
		expect(prompt).toContain("English section headings");
		expect(prompt).toContain("papers/1706.03762/NOTES.md");
	});

	it("asks for English when App locale is en", () => {
		expect(paperReaderLanguageInstruction("en")).toMatch(/English/i);
		const prompt = buildPaperReaderUserPrompt("papers/x", "slash", "en");
		expect(prompt).toContain("Write the NOTES.md body in English.");
		expect(prompt).toContain("/paper-reader");
	});

	it("treats other zh* locales as Chinese", () => {
		expect(paperReaderLanguageInstruction("zh")).toMatch(/Chinese/i);
		expect(paperReaderLanguageInstruction("zh-TW")).toMatch(/Chinese/i);
	});
});
