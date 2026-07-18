import { describe, expect, it } from "vitest";
import {
	collectPaperFoldersFromTree,
	collectPapersNeedingAssetDownload,
	directoryHasPaperMarkers,
	formatAuthorsShort,
	formatPaperTreeLabel,
	isPaperDirectory,
	isPapersRoot,
	isUnderPapers,
	paperDirFromPath,
} from "@/lib/paper-metadata";
import type { FileNode } from "@/lib/vault";

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

	it("collects only paper folders still missing assets", () => {
		const file = (name: string): FileNode => ({
			id: name,
			name,
			path: `x/${name}`,
			kind: "file",
		});
		const tree: FileNode[] = [
			{
				id: "/v/papers/nlp",
				name: "nlp",
				path: "/v/papers/nlp",
				kind: "directory",
				children: [
					{
						id: "/v/papers/nlp/needy",
						name: "needy",
						path: "/v/papers/nlp/needy",
						kind: "directory",
						children: [file("NOTES.md")],
					},
					{
						id: "/v/papers/nlp/complete",
						name: "complete",
						path: "/v/papers/nlp/complete",
						kind: "directory",
						children: [file("NOTES.md"), file("a.pdf"), file("b.tex")],
					},
				],
			},
		];
		expect(collectPapersNeedingAssetDownload(tree)).toEqual([
			"/v/papers/nlp/needy",
		]);
	});
});

describe("formatPaperTreeLabel", () => {
	const meta = {
		title: "Attention Is All You Need",
		authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
		year: 2017,
	};

	it("formats authors compactly", () => {
		expect(formatAuthorsShort(["A"])).toBe("A");
		expect(formatAuthorsShort(["A", "B"])).toBe("A, B");
		expect(formatAuthorsShort(["A", "B", "C"])).toBe("A et al.");
		expect(formatAuthorsShort([])).toBe("");
	});

	it("title-author uses title and short authors", () => {
		expect(formatPaperTreeLabel("title-author", meta, "1706.03762")).toBe(
			"Attention Is All You Need · Ashish Vaswani et al.",
		);
	});

	it("title only", () => {
		expect(formatPaperTreeLabel("title", meta, "1706.03762")).toBe(
			"Attention Is All You Need",
		);
	});

	it("author-year-title", () => {
		expect(formatPaperTreeLabel("author-year-title", meta, "1706.03762")).toBe(
			"Ashish Vaswani et al. (2017) · Attention Is All You Need",
		);
	});

	it("folder mode and missing meta fall back to folder name", () => {
		expect(formatPaperTreeLabel("folder", meta, "1706.03762")).toBe(
			"1706.03762",
		);
		expect(formatPaperTreeLabel("title-author", null, "25.23211")).toBe(
			"25.23211",
		);
		expect(
			formatPaperTreeLabel(
				"title",
				{ title: "", authors: [], year: undefined },
				"25.23211",
			),
		).toBe("25.23211");
	});
});
