import { describe, expect, it } from "vitest";
import {
	collectMarkdownRelPaths,
	type FileNode,
	normalizePathKey,
	paperRelFromNotes,
	resolveCreateParent,
	treeFindNode,
} from "@/lib/vault";

function dir(path: string, children: FileNode[]): FileNode {
	const name = path.split("/").pop() ?? path;
	return { id: path, name, path, kind: "directory", children };
}

function file(path: string): FileNode {
	const name = path.split("/").pop() ?? path;
	return { id: path, name, path, kind: "file" };
}

const tree: FileNode[] = [
	dir("/v/papers", [
		dir("/v/papers/x", [
			file("/v/papers/x/NOTES.md"),
			file("/v/papers/x/a.pdf"),
		]),
	]),
	file("/v/notes/todo.md"),
	file("/v/readme.txt"),
];

describe("normalizePathKey", () => {
	it("lowercases, forward-slashes, and trims trailing slashes", () => {
		expect(normalizePathKey("C:\\V\\Papers\\")).toBe("c:/v/papers");
		expect(normalizePathKey("/v/Papers/x/")).toBe("/v/papers/x");
	});
});

describe("treeFindNode", () => {
	it("finds a node case-insensitively at any depth", () => {
		expect(treeFindNode(tree, "/V/PAPERS/X")?.kind).toBe("directory");
		expect(treeFindNode(tree, "/v/papers/x/a.pdf")?.name).toBe("a.pdf");
	});

	it("returns undefined when absent", () => {
		expect(treeFindNode(tree, "/v/missing")).toBeUndefined();
	});
});

describe("resolveCreateParent", () => {
	it("uses the vault root when nothing is selected", () => {
		expect(resolveCreateParent("/v", null, tree)).toBe("/v");
	});

	it("returns a selected directory as-is", () => {
		expect(resolveCreateParent("/v", "/v/papers/x", tree)).toBe("/v/papers/x");
	});

	it("returns the parent directory of a selected file", () => {
		expect(resolveCreateParent("/v", "/v/papers/x/a.pdf", tree)).toBe(
			"/v/papers/x",
		);
	});
});

describe("collectMarkdownRelPaths", () => {
	it("flattens only Markdown files as vault-relative paths", () => {
		expect(collectMarkdownRelPaths(tree, "/v").sort()).toEqual([
			"notes/todo.md",
			"papers/x/NOTES.md",
		]);
	});
});

describe("paperRelFromNotes", () => {
	it("derives the paper folder rel path from a NOTES.md path", () => {
		expect(paperRelFromNotes("/v/papers/x/NOTES.md", "/v")).toBe("papers/x");
	});

	it("returns empty string when the paper folder is the vault root", () => {
		expect(paperRelFromNotes("/v/NOTES.md", "/v")).toBe("");
	});

	it("returns null when either path is missing", () => {
		expect(paperRelFromNotes(null, "/v")).toBeNull();
		expect(paperRelFromNotes("/v/papers/x/NOTES.md", null)).toBeNull();
	});
});
