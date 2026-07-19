import { FileText, FileType2, Folder, ScrollText } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
	contextPathIcon,
	isDirectoryContextPath,
	isPaperContextPath,
	normalizeContextPath,
	toPathSet,
} from "@/lib/context-path-icon";

describe("context-path-icon", () => {
	it("normalizes slashes and trailing separators", () => {
		expect(normalizeContextPath("papers\\org\\")).toBe("papers/org");
		expect(normalizeContextPath("./notes/a.md")).toBe("notes/a.md");
	});

	it("uses tree directory set for org folders without extension", () => {
		const dirs = toPathSet([
			"papers",
			"papers/org",
			"papers/org/Smith2024_Title_2401",
		]);
		expect(isDirectoryContextPath("papers/org", dirs)).toBe(true);
		expect(contextPathIcon("papers/org", { directoryPaths: dirs })).toBe(
			Folder,
		);
	});

	it("uses ScrollText for paper folders (same as file tree)", () => {
		const paper = "papers/org/Smith2024_Title_2401";
		const dirs = toPathSet(["papers", "papers/org", paper]);
		const papers = toPathSet([paper]);
		expect(isPaperContextPath(paper, papers)).toBe(true);
		expect(
			contextPathIcon(paper, {
				directoryPaths: dirs,
				paperPaths: papers,
			}),
		).toBe(ScrollText);
		// Org folder stays Folder even under papers/
		expect(
			contextPathIcon("papers/org", {
				directoryPaths: dirs,
				paperPaths: papers,
			}),
		).toBe(Folder);
	});

	it("classifies files by extension even if not in tree", () => {
		const dirs = toPathSet(["papers"]);
		expect(isDirectoryContextPath("papers/foo.pdf", dirs)).toBe(false);
		expect(contextPathIcon("papers/foo.pdf", { directoryPaths: dirs })).toBe(
			FileType2,
		);
		expect(contextPathIcon("notes/hello.md", { directoryPaths: dirs })).toBe(
			FileText,
		);
	});

	it("trailing slash forces directory", () => {
		expect(isDirectoryContextPath("papers/org/")).toBe(true);
		expect(contextPathIcon("papers/org/")).toBe(Folder);
	});

	it("without tree, no-extension paths default to directory", () => {
		expect(isDirectoryContextPath("papers/my-topic")).toBe(true);
		expect(isDirectoryContextPath("NOTES.md")).toBe(false);
	});

	it("accepts legacy directory Set as second argument", () => {
		const dirs = toPathSet(["notes"]);
		expect(contextPathIcon("notes", dirs)).toBe(Folder);
	});
});
