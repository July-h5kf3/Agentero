import { describe, expect, it } from "vitest";

import {
	isSymbolTableHeader,
	parseAnnotationMd,
	splitMarkdownTableRow,
	stripYamlFrontmatter,
	symbolTexSource,
} from "@/lib/pdf/equation-annotation";

describe("equation-annotation parse", () => {
	it("strips YAML frontmatter", () => {
		const src = `---
aliases: [eq]
created: 2026-01-01
---
| 符号 | 含义 |
| --- | --- |
| $Q$ | 查询 |
`;
		expect(stripYamlFrontmatter(src).startsWith("| 符号")).toBe(true);
	});

	it("splits GFM table rows", () => {
		expect(splitMarkdownTableRow("| $Q$ | query | plain |")).toEqual([
			"$Q$",
			"query",
			"plain",
		]);
		expect(splitMarkdownTableRow("not a table")).toBeNull();
	});

	it("detects symbol table headers in zh/en", () => {
		expect(isSymbolTableHeader(["符号", "含义", "通俗理解"])).toBe(true);
		expect(isSymbolTableHeader(["Symbol", "Meaning"])).toBe(true);
		expect(isSymbolTableHeader(["Page", "Note"])).toBe(false);
	});

	it("parses the equation-annotation skill table shape", () => {
		const md = `---
created: 2026-08-01
---

# 符号注释

| 符号 | 含义 | 通俗理解 |
| --- | --- | --- |
| $Q$ | 查询矩阵 | 问问题的表示 |
| $K$ | 键矩阵 | |
| $V$ | 值矩阵 | 要取的内容 |
| $Q$ | 重复符号应被去重 | 不会出现 |
`;
		const rows = parseAnnotationMd(md);
		expect(rows).toHaveLength(3);
		expect(rows[0]).toEqual({
			symbol: "$Q$",
			meaning: "查询矩阵",
			plain: "问问题的表示",
		});
		expect(rows[1]).toEqual({
			symbol: "$K$",
			meaning: "键矩阵",
			plain: undefined,
		});
		expect(rows[2]?.symbol).toBe("$V$");
	});

	it("accepts English headers and bare symbols", () => {
		const md = `
| Symbol | Meaning | Notes |
| --- | --- | --- |
| \\alpha | learning rate | step size |
| $\\theta$ | parameters | |
`;
		const rows = parseAnnotationMd(md);
		expect(rows).toHaveLength(2);
		expect(rows[0]?.symbol).toBe("\\alpha");
		expect(rows[0]?.meaning).toBe("learning rate");
		expect(rows[0]?.plain).toBe("step size");
		expect(rows[1]?.symbol).toBe("$\\theta$");
	});

	it("strips math delimiters for KaTeX", () => {
		expect(symbolTexSource("$Q$")).toBe("Q");
		expect(symbolTexSource("$$\\alpha$$")).toBe("\\alpha");
		expect(symbolTexSource("\\beta")).toBe("\\beta");
	});

	it("returns empty for missing tables", () => {
		expect(parseAnnotationMd("# notes\n\nNo table here.")).toEqual([]);
		expect(parseAnnotationMd("")).toEqual([]);
	});
});
