import { describe, expect, it } from "vitest";
import { parseWikiImageEmbedDimensions } from "@/components/editor/wiki-attachment-embed";
import type { WikiEmbedResponse } from "@/lib/wiki";
import { wikiEmbedResponseKind } from "@/lib/wiki-embed";

function attachmentResponse(contentKind: "image" | "pdf"): WikiEmbedResponse {
	return {
		contentKind,
		link: {
			status: "resolved",
			targetPath: `assets/example.${contentKind === "image" ? "png" : "pdf"}`,
			occurrence: {
				source: "notes/source.md",
				targetRaw: "example",
				syntax: "wikilink",
				embed: true,
				sourceRange: { start: 0, end: 0 },
				line: 1,
			},
		},
	};
}

describe("parseWikiImageEmbedDimensions", () => {
	it("accepts Obsidian width and width-by-height aliases", () => {
		expect(parseWikiImageEmbedDimensions("100")).toEqual({ width: 100 });
		expect(parseWikiImageEmbedDimensions("640x480")).toEqual({
			width: 640,
			height: 480,
		});
	});

	it("does not treat ordinary display aliases as image dimensions", () => {
		expect(parseWikiImageEmbedDimensions("Figure 1")).toBeNull();
		expect(parseWikiImageEmbedDimensions("0")).toBeNull();
		expect(parseWikiImageEmbedDimensions("100x")).toBeNull();
	});
});

describe("wikiEmbedResponseKind", () => {
	it("treats resolved image and PDF attachments as renderable", () => {
		expect(wikiEmbedResponseKind(attachmentResponse("image"))).toBe("ready");
		expect(wikiEmbedResponseKind(attachmentResponse("pdf"))).toBe("ready");
	});
});
