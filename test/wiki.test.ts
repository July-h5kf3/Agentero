import { describe, expect, it } from "vitest";
import {
	extractWikilinks,
	parseWikiHref,
	resolveWikiTarget,
	rewriteWikilinksForPreview,
	toVaultRelative,
	WIKI_HREF_PREFIX,
} from "@/lib/wiki";
import { createTestVault } from "./helpers/create-test-vault";

describe("wikilink extraction", () => {
	it("extracts aliases and headings while skipping inline and fenced code", () => {
		const links = extractWikilinks(
			[
				"See [[notes/Target#Intro|Target Note]] and `[[ignored-inline]]`.",
				"```",
				"[[ignored-fence]]",
				"```",
				"Then [[Loose Note]].",
			].join("\n"),
		);

		expect(links).toHaveLength(2);
		expect(links[0]).toMatchObject({
			targetRaw: "notes/Target",
			heading: "Intro",
			alias: "Target Note",
			line: 1,
		});
		expect(links[1]).toMatchObject({
			targetRaw: "Loose Note",
			line: 5,
		});
	});
});

describe("wikilink resolution", () => {
	it("resolves targets against markdown files in a real vault directory", async () => {
		const vault = await createTestVault({
			"notes/Index.md": "[[Target]] [[Case]]",
			"notes/Target.md": "# Target",
			"papers/Case.MD": "# Case",
		});

		try {
			const files = await vault.listMarkdownFiles();
			expect(resolveWikiTarget("notes/Target", files)).toBe("notes/Target.md");
			expect(resolveWikiTarget("target", files)).toBe("notes/Target.md");
			expect(resolveWikiTarget("papers/case", files)).toBe("papers/Case.MD");
			expect(toVaultRelative(vault.root, `${vault.root}/notes/Index.md`)).toBe(
				"notes/Index.md",
			);
		} finally {
			await vault.cleanup();
		}
	});

	it("does not resolve ambiguous stem matches", async () => {
		const vault = await createTestVault({
			"a/Duplicate.md": "# A",
			"b/Duplicate.md": "# B",
		});

		try {
			const files = await vault.listMarkdownFiles();
			expect(resolveWikiTarget("Duplicate", files)).toBeNull();
		} finally {
			await vault.cleanup();
		}
	});
});

describe("wikilink preview rewrite", () => {
	it("rewrites real links to motif hrefs without touching code", async () => {
		const vault = await createTestVault({
			"notes/Source.md": "See [[notes/Target#Intro|Target Note]].",
			"notes/Target.md": "# Target",
		});

		try {
			const files = await vault.listMarkdownFiles();
			const rewritten = rewriteWikilinksForPreview(
				[
					"See [[notes/Target#Intro|Target Note]] and `[[ignored-inline]]`.",
					"```",
					"[[ignored-fence]]",
					"```",
				].join("\n"),
				files,
			);

			expect(rewritten).toContain("[Target Note](motif-wiki:");
			expect(rewritten).toContain("`[[ignored-inline]]`");
			expect(rewritten).toContain("[[ignored-fence]]");

			const href = rewritten.match(/\((motif-wiki:[^)]+)\)/)?.[1];
			expect(href?.startsWith(WIKI_HREF_PREFIX)).toBe(true);
			expect(parseWikiHref(href ?? "")).toEqual({
				targetRaw: "notes/Target",
				path: "notes/Target.md",
				exists: true,
				heading: "Intro",
			});
		} finally {
			await vault.cleanup();
		}
	});
});
