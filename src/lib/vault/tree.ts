import { readDir } from "@tauri-apps/plugin-fs";
import { normalizePathKey } from "@/lib/vault/path";
import {
	isRemoteVaultHandle,
	remoteList,
	remoteSessionIdFromHandle,
} from "@/lib/vault/remote/remote-vault";
import { joinRemotePath, remoteRelFromJoined } from "@/lib/vault/remote-path";
import { ensureLocalFsScope } from "@/lib/vault/scope";
import type { FileNode } from "@/lib/vault/types";

/**
 * Names never listed in the file tree (local or remote).
 * Includes VCS, build/cache, virtualenvs, and Host-only `.agentero`.
 */
export const TREE_IGNORE_NAMES = new Set([
	".git",
	".DS_Store",
	"node_modules",
	"target",
	"dist",
	".agentero",
	".venv",
	"venv",
	"__pycache__",
	".pytest_cache",
	".mypy_cache",
	".ruff_cache",
	".tox",
	".eggs",
	".codex",
	".idea",
	".vscode",
	"site-packages",
]);

/**
 * Vault-root segment names that are fully recursive on open (product surface).
 * Everything else at the vault root is shallow (one level) until expanded.
 */
export const TREE_EAGER_ROOT_NAMES = new Set([
	"papers",
	"notes",
	"plans",
	".agents",
]);

/**
 * Dot-directories that are still part of the product surface (not ignored).
 * Must stay in sync with {@link TREE_EAGER_ROOT_NAMES} where applicable.
 */
const TREE_ALLOWED_DOT_NAMES = new Set([".env.example", ".agents"]);

/** True when this basename should never appear in the tree. */
export function shouldIgnoreTreeName(name: string): boolean {
	if (!name) return true;
	if (TREE_IGNORE_NAMES.has(name)) return true;
	if (TREE_ALLOWED_DOT_NAMES.has(name)) return false;
	// Other hidden entries (`.git`, `.venv`, `.codex`, …).
	if (name.startsWith(".")) return true;
	// Python packaging / build noise.
	if (name.endsWith(".egg-info")) return true;
	return false;
}

/**
 * Whether a directory under the vault should be fully walked on open.
 * - Under `papers/` / `notes/` / `plans/` / `.agents/`: always eager (markers, skills).
 * - Other vault-root trees (`src/`, `thesis/`, …): shallow only until user expands.
 */
export function isEagerTreeRel(rel: string): boolean {
	const r = rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	if (!r) return true; // vault root itself is always listed
	const top = r.split("/")[0]?.toLowerCase() ?? "";
	return TREE_EAGER_ROOT_NAMES.has(top);
}

function joinPath(parent: string, name: string): string {
	if (!parent) return name;
	const sep = parent.includes("\\") ? "\\" : "/";
	return parent.endsWith(sep) ? `${parent}${name}` : `${parent}${sep}${name}`;
}

function sortNodes(nodes: FileNode[]): FileNode[] {
	return [...nodes].sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
		return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	});
}

/**
 * Build directory children.
 *
 * - `shallowOnly=false` (initial open): eager roots recurse fully; other dirs
 *   are listed **once** (one level of files + subdir shells with `childrenPending`).
 * - `shallowOnly=true` (inside a non-eager tree, or expand): files only; subdirs
 *   become pending shells (no further list until expand).
 *
 * `rel` is vault-relative (`""` at root). Local uses absolute `dirPath`.
 */
async function buildTreeLocal(
	dirPath: string,
	rel: string,
	depth = 0,
	shallowOnly = false,
): Promise<FileNode[]> {
	if (depth > 12) return [];

	const entries = await readDir(dirPath);
	const nodes: FileNode[] = [];

	for (const entry of entries) {
		if (!entry.name || shouldIgnoreTreeName(entry.name)) continue;

		const path = joinPath(dirPath, entry.name);
		const childRel = rel ? `${rel}/${entry.name}` : entry.name;
		if (entry.isDirectory) {
			const node = await buildDirNodeLocal(
				path,
				entry.name,
				childRel,
				depth,
				shallowOnly,
			);
			nodes.push(node);
		} else if (entry.isFile) {
			nodes.push({
				id: path,
				name: entry.name,
				path,
				kind: "file",
			});
		}
	}

	return sortNodes(nodes);
}

async function buildDirNodeLocal(
	path: string,
	name: string,
	childRel: string,
	depth: number,
	shallowOnly: boolean,
): Promise<FileNode> {
	// Already one level into a non-eager tree (or expand): do not list further.
	if (shallowOnly) {
		return {
			id: path,
			name,
			path,
			kind: "directory",
			children: [],
			childrenPending: true,
		};
	}
	if (isEagerTreeRel(childRel)) {
		const children = await buildTreeLocal(path, childRel, depth + 1, false);
		return {
			id: path,
			name,
			path,
			kind: "directory",
			children,
		};
	}
	// Non-product dir: list exactly one level; nested dirs stay pending.
	const children = await buildTreeLocal(path, childRel, depth + 1, true);
	return {
		id: path,
		name,
		path,
		kind: "directory",
		children,
		childrenPending: false,
	};
}

async function buildTreeRemote(
	handle: string,
	rel: string,
	depth = 0,
	shallowOnly = false,
): Promise<FileNode[]> {
	if (depth > 12) return [];
	const sessionId = remoteSessionIdFromHandle(handle);
	if (!sessionId) return [];

	const entries = await remoteList(sessionId, rel);
	const nodes: FileNode[] = [];

	for (const entry of entries) {
		if (!entry.name || shouldIgnoreTreeName(entry.name)) continue;

		const childRel = entry.path;
		const path = joinRemotePath(handle, childRel);
		if (entry.isDir) {
			const node = await buildDirNodeRemote(
				handle,
				path,
				entry.name,
				childRel,
				depth,
				shallowOnly,
			);
			nodes.push(node);
		} else if (entry.isFile) {
			nodes.push({
				id: path,
				name: entry.name,
				path,
				kind: "file",
			});
		}
	}

	return sortNodes(nodes);
}

async function buildDirNodeRemote(
	handle: string,
	path: string,
	name: string,
	childRel: string,
	depth: number,
	shallowOnly: boolean,
): Promise<FileNode> {
	if (shallowOnly) {
		return {
			id: path,
			name,
			path,
			kind: "directory",
			children: [],
			childrenPending: true,
		};
	}
	if (isEagerTreeRel(childRel)) {
		const children = await buildTreeRemote(handle, childRel, depth + 1, false);
		return {
			id: path,
			name,
			path,
			kind: "directory",
			children,
		};
	}
	const children = await buildTreeRemote(handle, childRel, depth + 1, true);
	return {
		id: path,
		name,
		path,
		kind: "directory",
		children,
		childrenPending: false,
	};
}

/**
 * List one directory level only (used when expanding a lazy folder).
 * Nested directories stay `childrenPending` (expand again to go deeper).
 */
export async function listVaultDirChildren(
	rootPath: string,
	dirAbsPath: string,
): Promise<FileNode[]> {
	if (isRemoteVaultHandle(rootPath)) {
		const sessionId = remoteSessionIdFromHandle(rootPath);
		if (!sessionId) return [];
		const rel = remoteRelFromJoined(rootPath, dirAbsPath);
		// Expanding a non-eager folder: only one more level; subdirs stay pending.
		return buildTreeRemote(rootPath, rel, 0, true);
	}
	// Local: dirAbsPath is absolute; rel only used for eager checks (disabled here).
	return buildTreeLocal(dirAbsPath, "", 0, true);
}

/**
 * Paths of directory nodes that still need listing, among `expandedPaths`.
 * Used to load children when the user expands a lazy folder.
 */
export function pendingDirsAmongExpanded(
	nodes: FileNode[],
	expandedPaths: ReadonlySet<string>,
): string[] {
	const out: string[] = [];
	const walk = (list: FileNode[]) => {
		for (const n of list) {
			if (n.kind !== "directory") continue;
			if (n.childrenPending && expandedPaths.has(n.path)) {
				out.push(n.path);
			}
			if (n.children?.length) walk(n.children);
		}
	};
	walk(nodes);
	return out;
}

/** Immutable replace of a directory node's children (by absolute path). */
export function replaceTreeNodeChildren(
	nodes: FileNode[],
	dirPath: string,
	children: FileNode[],
): FileNode[] {
	const key = normalizePathKey(dirPath);
	const walk = (list: FileNode[]): FileNode[] =>
		list.map((n) => {
			if (normalizePathKey(n.path) === key && n.kind === "directory") {
				return {
					...n,
					children,
					childrenPending: false,
				};
			}
			if (n.children?.length) {
				return { ...n, children: walk(n.children) };
			}
			return n;
		});
	return walk(nodes);
}

/** True if any directory under `nodes` still needs listing. */
export function treeHasPendingChildren(nodes: FileNode[]): boolean {
	for (const n of nodes) {
		if (n.kind === "directory" && n.childrenPending) return true;
		if (n.children?.length && treeHasPendingChildren(n.children)) return true;
	}
	return false;
}

/**
 * Build the vault file tree.
 *
 * - Eager recursive: `papers/`, `notes/`, `plans/`, `.agents/`
 * - Shallow elsewhere: vault-root extras (`src/`, `thesis/`, …) appear as
 *   one level with `childrenPending`; expand via {@link listVaultDirChildren}.
 * - Ignored names ({@link TREE_IGNORE_NAMES} / dots / `*.egg-info`) are never listed.
 */
export async function loadVaultTree(rootPath: string): Promise<FileNode[]> {
	if (isRemoteVaultHandle(rootPath)) {
		return buildTreeRemote(rootPath, "");
	}
	await ensureLocalFsScope(rootPath);
	return buildTreeLocal(rootPath, "");
}
