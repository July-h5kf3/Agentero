import { describe, expect, it } from "vitest";
import {
	collectMarkdownRelPaths,
	type FileNode,
	isEagerTreeRel,
	normalizePathKey,
	paperRelFromNotes,
	pendingDirsAmongExpanded,
	replaceTreeNodeChildren,
	resolveCreateParent,
	shouldIgnoreTreeName,
	treeFindNode,
	treeHasPendingChildren,
} from "@/lib/vault";

function dir(
	path: string,
	children: FileNode[],
	extra?: Partial<FileNode>,
): FileNode {
	const name = path.split("/").pop() ?? path;
	return { id: path, name, path, kind: "directory", children, ...extra };
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

describe("shouldIgnoreTreeName", () => {
	it("skips VCS, cache, venv, and Host-only dirs", () => {
		for (const n of [
			".git",
			".agentero",
			".venv",
			"venv",
			"node_modules",
			"__pycache__",
			"site-packages",
			".codex",
			"foo.egg-info",
		]) {
			expect(shouldIgnoreTreeName(n)).toBe(true);
		}
	});

	it("keeps product surface and normal names", () => {
		expect(shouldIgnoreTreeName(".agents")).toBe(false);
		expect(shouldIgnoreTreeName(".env.example")).toBe(false);
		expect(shouldIgnoreTreeName("papers")).toBe(false);
		expect(shouldIgnoreTreeName("src")).toBe(false);
		expect(shouldIgnoreTreeName("AGENTS.md")).toBe(false);
	});
});

describe("isEagerTreeRel", () => {
	it("treats papers/notes/plans/.agents as eager", () => {
		expect(isEagerTreeRel("papers")).toBe(true);
		expect(isEagerTreeRel("papers/topic/x")).toBe(true);
		expect(isEagerTreeRel("notes/todo.md")).toBe(true);
		expect(isEagerTreeRel("plans")).toBe(true);
		expect(isEagerTreeRel(".agents/skills")).toBe(true);
	});

	it("treats other vault-root trees as lazy", () => {
		expect(isEagerTreeRel("src")).toBe(false);
		expect(isEagerTreeRel("src/agents")).toBe(false);
		expect(isEagerTreeRel("thesis")).toBe(false);
		expect(isEagerTreeRel("scripts")).toBe(false);
	});
});

describe("replaceTreeNodeChildren / lazy pending", () => {
	/** After open: non-eager `src/` has one listed level; nested dirs stay pending. */
	const lazyTree: FileNode[] = [
		dir("/v/papers", [dir("/v/papers/x", [file("/v/papers/x/NOTES.md")])]),
		dir("/v/src", [
			file("/v/src/README.md"),
			dir("/v/src/agents", [], { childrenPending: true }),
		]),
	];

	it("replaces children of an expanded pending folder", () => {
		const next = replaceTreeNodeChildren(lazyTree, "/v/src/agents", [
			file("/v/src/agents/README.md"),
			dir("/v/src/agents/benchmark", [], { childrenPending: true }),
		]);
		const agents = treeFindNode(next, "/v/src/agents");
		expect(agents?.childrenPending).toBe(false);
		expect(agents?.children?.map((c) => c.name).sort()).toEqual([
			"README.md",
			"benchmark",
		]);
		expect(treeFindNode(next, "/v/src/agents/benchmark")?.childrenPending).toBe(
			true,
		);
		// Sibling listing under src unchanged
		expect(treeFindNode(next, "/v/src/README.md")?.kind).toBe("file");
	});

	it("lists expanded pending dirs only", () => {
		expect(treeHasPendingChildren(lazyTree)).toBe(true);
		expect(
			pendingDirsAmongExpanded(lazyTree, new Set(["/v/src/agents"])),
		).toEqual(["/v/src/agents"]);
		expect(pendingDirsAmongExpanded(lazyTree, new Set(["/v/src"]))).toEqual([]);
	});
});
