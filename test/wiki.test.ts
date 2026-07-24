import { describe, expect, it } from "vitest";
import {
	extractWikilinks,
	parseWikiHref,
	resolveDemoWikiReference,
	resolveWikiTarget,
	rewriteWikilinksForPreview,
	toVaultRelative,
	WIKI_HREF_PREFIX,
} from "@/lib/wiki";
import semanticFixture from "./fixtures/wikilinks/semantic-cases.json";
import { createTestVault } from "./helpers/create-test-vault";

describe("wikilink extraction", () => {
	it("uses the shared semantic fixture without parsing code examples", () => {
		const source = semanticFixture.documents.find(
			(document) => document.path === "notes/Source.md",
		)?.content;
		expect(source).toBeTruthy();
		const links = extractWikilinks(source ?? "");
		expect(links.map((link) => link.targetRaw)).toEqual([
			"Target",
			"",
			"",
			"Target",
		]);
		expect(links[3]?.embed).toBe(true);
	});

	it("extracts typed fragments while skipping inline and fenced code", () => {
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
			fragment: { kind: "heading", path: ["Intro"] },
			alias: "Target Note",
			line: 1,
		});
		expect(links[1]).toMatchObject({
			targetRaw: "Loose Note",
			line: 5,
		});
	});

	it("accepts same-file heading and block fragments", () => {
		const links = extractWikilinks("[[#Root#Child]] and [[#^summary]]");
		expect(links).toMatchObject([
			{ targetRaw: "", fragment: { kind: "heading", path: ["Root", "Child"] } },
			{ targetRaw: "", fragment: { kind: "block", id: "summary" } },
		]);
	});
});

describe("wikilink resolution", () => {
	it("keeps the browser demo aligned with the shared semantic fixture", () => {
		for (const fixtureCase of semanticFixture.cases) {
			const result = resolveDemoWikiReference(
				fixtureCase.source,
				fixtureCase.link,
				semanticFixture.documents,
			);
			expect(result.status, fixtureCase.link).toBe(fixtureCase.status);
			expect(result.targetPath, fixtureCase.link).toBe(fixtureCase.path);
		}
	});

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
	it("rewrites real links to agentero hrefs without touching code", async () => {
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

			expect(rewritten).toContain("[Target Note](agentero-wiki:");
			expect(rewritten).toContain("`[[ignored-inline]]`");
			expect(rewritten).toContain("[[ignored-fence]]");

			const href = rewritten.match(/\((agentero-wiki:[^)]+)\)/)?.[1];
			expect(href?.startsWith(WIKI_HREF_PREFIX)).toBe(true);
			expect(parseWikiHref(href ?? "")).toEqual({
				targetRaw: "notes/Target",
				path: "notes/Target.md",
				status: "resolved",
				fragment: { kind: "heading", path: ["Intro"] },
			});
		} finally {
			await vault.cleanup();
		}
	});
});
