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
	});

	it("formats annotation bodies with preferred sugar", () => {
		expect(
			formatWikiLinkBody("paper", { kind: "annotation", id: "x1" }, "alias"),
		).toBe("paper@x1|alias");
		expect(
			annotationWikilinkMarkdown({ target: "p", id: "x", embed: true }),
		).toBe("![[p@x]]");
		expect(parseWikiFragment("@ab-c")).toEqual({
			kind: "annotation",
			id: "ab-c",
		});
		expect(splitAnnotationSugar("a@b")).toEqual({ target: "a", id: "b" });
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

	it("derives a short wiki target from paper paths", () => {
		expect(
			wikiTargetForPaper("/v/papers/1706.03762", "papers/1706.03762"),
		).toBe("1706.03762");
		expect(
			wikiTargetForPaper("/v/papers/1706.03762/NOTES.md", "papers/1706.03762"),
		).toBe("1706.03762");
	});
});
