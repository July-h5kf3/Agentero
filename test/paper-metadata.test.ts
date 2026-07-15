import { describe, expect, it } from "vitest";
import {
	collectPaperFoldersFromTree,
	directoryHasPaperMarkers,
	isPaperDirectory,
	isPapersRoot,
	isUnderPapers,
	paperDirFromPath,
} from "@/lib/paper-metadata";

describe("paper folder minimal unit", () => {
	it("detects papers root and under-papers", () => {
		expect(isPapersRoot("/vault/papers")).toBe(true);
		expect(isPapersRoot("/vault/papers/")).toBe(true);
		expect(isUnderPapers("/vault/papers/a")).toBe(true);
		expect(isUnderPapers("/vault/papers")).toBe(false);
		expect(isUnderPapers("papers/nlp/x")).toBe(true);
	});

	it("identifies paper folders by markers, not path depth", () => {
		expect(
			directoryHasPaperMarkers([
				{ name: "NOTES.md", kind: "file" },
				{ name: "source", kind: "directory" },
			]),
		).toBe(true);
		expect(
			directoryHasPaperMarkers([{ name: "readme.md", kind: "file" }]),
		).toBe(false);
		expect(
			isPaperDirectory("/v/papers/nlp/1706.03762", [
				{ name: "NOTES.md", kind: "file" },
			]),
		).toBe(true);
		expect(
			isPaperDirectory("/v/papers/nlp", [
				{ name: "1706.03762", kind: "directory" },
			]),
		).toBe(false);
		// path-only without children is never enough
		expect(isPaperDirectory("/v/papers/flat-id")).toBe(false);
	});

	it("resolves nested paperDirFromPath from known files", () => {
		expect(
			paperDirFromPath("/vault/papers/nlp/transformers/1706.03762/NOTES.md"),
		).toBe("/vault/papers/nlp/transformers/1706.03762");
		expect(
			paperDirFromPath(
				"/vault/papers/nlp/transformers/1706.03762/source/original.pdf",
			),
		).toBe("/vault/papers/nlp/transformers/1706.03762");
		expect(paperDirFromPath("papers/a/b/highlights.md")).toBe("papers/a/b");
		expect(paperDirFromPath("/vault/notes/idea.md")).toBe(null);
	});

	it("uses paperFolders list for longest prefix", () => {
		const folders = ["/v/papers/nlp/1706.03762", "/v/papers/nlp"];
		// Only real paper folders should be passed; longest match wins
		expect(paperDirFromPath("/v/papers/nlp/1706.03762/NOTES.md", folders)).toBe(
			"/v/papers/nlp/1706.03762",
		);
	});

	it("collects paper folders from tree at any depth", () => {
		const tree = [
			{
				path: "/v/papers",
				kind: "directory" as const,
				name: "papers",
				children: [
					{
						path: "/v/papers/nlp",
						kind: "directory" as const,
						name: "nlp",
						children: [
							{
								path: "/v/papers/nlp/1706.03762",
								kind: "directory" as const,
								name: "1706.03762",
								children: [
									{
										path: "/v/papers/nlp/1706.03762/NOTES.md",
										kind: "file" as const,
										name: "NOTES.md",
									},
								],
							},
						],
					},
					{
						path: "/v/papers/vaswani2017",
						kind: "directory" as const,
						name: "vaswani2017",
						children: [
							{
								path: "/v/papers/vaswani2017/NOTES.md",
								kind: "file" as const,
								name: "NOTES.md",
							},
						],
					},
				],
			},
		];
		const folders = collectPaperFoldersFromTree(tree);
		expect(folders.sort()).toEqual(
			["/v/papers/nlp/1706.03762", "/v/papers/vaswani2017"].sort(),
		);
	});
});
