import { describe, expect, it } from "vitest";

import {
	parseWikiLinkMarkdown,
	wikiLinkToMarkdown,
} from "@/components/editor/plugins/wikilink-model";
import {
	annotationWikilinkMarkdown,
	wikiTargetForPaper,
} from "@/lib/pdf/annotation-ref";
import {
	extractWikilinks,
	formatWikiLinkBody,
	isValidAnnotationId,
	parseWikiFragment,
	resolveDemoWikiReference,
	splitAnnotationSugar,
} from "@/lib/wiki";
import { parseWikiCompletionQuery } from "@/lib/wiki-completion";

describe("annotation wikilink parse", () => {
	it("accepts sugar target@id and #@id fragment", () => {
		const links = extractWikilinks(
			"See [[NOTES@abc-123|q]] and ![[paper#@def456]].\n",
		);
		expect(links).toHaveLength(2);
		expect(links[0]).toMatchObject({
			targetRaw: "NOTES",
			fragment: { kind: "annotation", id: "abc-123" },
			alias: "q",
		});
		expect(links[1]).toMatchObject({
			targetRaw: "paper",
			embed: true,
			fragment: { kind: "annotation", id: "def456" },
		});
	});

	it("accepts same-note [[@id]] and nanoid underscore ids", () => {
		const links = extractWikilinks(
			"[[@TGDf_eZGV4]] and [[../NOTES.md@x_y-1]] and [[paper.pdf@ab_c]].\n",
		);
		expect(links).toHaveLength(3);
		expect(links[0]).toMatchObject({
			targetRaw: "",
			fragment: { kind: "annotation", id: "TGDf_eZGV4" },
		});
		expect(links[1]).toMatchObject({
			targetRaw: "../NOTES.md",
			fragment: { kind: "annotation", id: "x_y-1" },
		});
		expect(links[2]).toMatchObject({
			targetRaw: "paper.pdf",
			fragment: { kind: "annotation", id: "ab_c" },
		});
	});

	it("does not treat invalid sugar as annotation", () => {
		const links = extractWikilinks("[[keep@not valid]]\n");
		expect(links[0]?.targetRaw).toBe("keep@not valid");
		expect(links[0]?.fragment).toBeUndefined();
	});

	it("round-trips sugar through the editor model", () => {
		const md = "![[Attention@uuid-1|note]]";
		const node = parseWikiLinkMarkdown(md);
		expect(node).toMatchObject({
			value: "Attention",
			heading: "@uuid-1",
			alias: "note",
			embed: true,
		});
		expect(wikiLinkToMarkdown(node!)).toBe(md);
		const sameNote = parseWikiLinkMarkdown("[[@TGDf_eZGV4]]");
		expect(sameNote).toMatchObject({
			value: "",
			heading: "@TGDf_eZGV4",
		});
		expect(wikiLinkToMarkdown(sameNote!)).toBe("[[@TGDf_eZGV4]]");
	});

	it("formats annotation bodies with preferred sugar", () => {
		expect(
			formatWikiLinkBody("paper", { kind: "annotation", id: "x1" }, "alias"),
		).toBe("paper@x1|alias");
		expect(formatWikiLinkBody("", { kind: "annotation", id: "x1" })).toBe(
			"@x1",
		);
		expect(
			annotationWikilinkMarkdown({ target: "p", id: "x", embed: true }),
		).toBe("![[p@x]]");
		expect(
			annotationWikilinkMarkdown({
				target: "papers/foo/NOTES",
				id: "TGDf_eZGV4",
				alias: "Towards Long Horizon Agent",
			}),
		).toBe("[[papers/foo/NOTES@TGDf_eZGV4|Towards Long Horizon Agent]]");
		expect(parseWikiFragment("@ab-c")).toEqual({
			kind: "annotation",
			id: "ab-c",
		});
		expect(splitAnnotationSugar("a@b")).toEqual({ target: "a", id: "b" });
		expect(splitAnnotationSugar("@TGDf_eZGV4")).toEqual({
			target: "",
			id: "TGDf_eZGV4",
		});
		expect(isValidAnnotationId("TGDf_eZGV4")).toBe(true);
		expect(isValidAnnotationId("not id")).toBe(false);
	});

	it("demo resolver accepts annotation fragments when the target exists", () => {
		const resolved = resolveDemoWikiReference(
			"notes/Source.md",
			"Target@abc-1",
			[{ path: "notes/Target.md", content: "# Hi\n" }],
		);
		expect(resolved.status).toBe("resolved");
		expect(resolved.fragment).toEqual({ kind: "annotation", id: "abc-1" });
		expect(resolved.targetPath).toBe("notes/Target.md");
	});

	it("derives a resolvable wiki target from paper paths (not display title)", () => {
		expect(
			wikiTargetForPaper("/v/papers/1706.03762", "papers/1706.03762"),
		).toBe("papers/1706.03762/NOTES");
		expect(
			wikiTargetForPaper(
				"/v/papers/1706.03762/NOTES.md",
				"papers/1706.03762/NOTES.md",
			),
		).toBe("papers/1706.03762/NOTES");
		expect(
			wikiTargetForPaper("/v/papers/foo/paper.pdf", "papers/foo/paper.pdf"),
		).toBe("papers/foo/paper.pdf");
	});

	it("completion grammar treats @ as annotation mode", () => {
		expect(parseWikiCompletionQuery("@")).toEqual({
			kind: "annotation",
			target: "",
			query: "",
		});
		expect(parseWikiCompletionQuery("@TG")).toEqual({
			kind: "annotation",
			target: "",
			query: "TG",
		});
		expect(parseWikiCompletionQuery("NOTES@")).toEqual({
			kind: "annotation",
			target: "NOTES",
			query: "",
		});
		expect(parseWikiCompletionQuery("paper.pdf@ab")).toEqual({
			kind: "annotation",
			target: "paper.pdf",
			query: "ab",
		});
		expect(parseWikiCompletionQuery("#@x")).toEqual({
			kind: "annotation",
			target: "",
			query: "x",
		});
	});
});
