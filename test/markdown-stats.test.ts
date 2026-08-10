import { describe, expect, it } from "vitest";
import { countChars, countWords } from "@/lib/markdown/stats";

describe("markdown stats", () => {
	it("counts English words and whitespace-separated tokens", () => {
		expect(countWords("Hello world")).toBe(2);
		expect(countWords("The quick brown fox jumps")).toBe(5);
	});

	it("counts each CJK character as one word", () => {
		expect(countWords("这是一个测试")).toBe(6);
		expect(countWords("你好世界")).toBe(4);
	});

	it("handles mixed Chinese/English text", () => {
		expect(countWords("Hello world 这是一个测试")).toBe(8);
		expect(countWords("AI 技术正在改变 world")).toBe(8);
	});

	it("ignores leading/trailing whitespace and empty input", () => {
		expect(countWords("")).toBe(0);
		expect(countWords("   ")).toBe(0);
		expect(countWords("  Hello  ")).toBe(1);
	});

	it("counts raw characters including whitespace", () => {
		expect(countChars("Hello")).toBe(5);
		expect(countChars("你好")).toBe(2);
		expect(countChars("Hello 你好")).toBe(8);
	});
});
