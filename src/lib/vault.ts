import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";

import i18n from "@/i18n";
import { isTauri } from "@/lib/tauri";
import { toVaultRelative } from "@/lib/wiki";

export type CreateVaultResult = {
	path: string;
	created: string[];
	openPath: string;
};

type ApiResult<T> = {
	ok: boolean;
	data?: T;
	error?: { code: string; message: string };
};

export type FileNode = {
	id: string;
	name: string;
	path: string;
	kind: "file" | "directory";
	children?: FileNode[];
};

const IGNORE_NAMES = new Set([
	".git",
	".DS_Store",
	"node_modules",
	"target",
	"dist",
	".agentero",
]);

/** Per-window vault (sessionStorage — isolated across ⌘N windows). */
const SESSION_VAULT_KEY = "agentero-vault-path";
/** Last opened vault for “restore last vault” on the primary window. */
const LAST_VAULT_KEY = "agentero-vault-path";
/** MRU list for welcome screen (localStorage, shared). */
const RECENT_VAULTS_KEY = "agentero-recent-vaults";
const MAX_RECENT_VAULTS = 8;

/** True when this window was opened via ⌘N / New Window (`?fresh=1`). */
export function isFreshWindow(): boolean {
	try {
		return new URLSearchParams(window.location.search).get("fresh") === "1";
	} catch {
		return false;
	}
}

export function getSessionVaultPath(): string | null {
	try {
		return sessionStorage.getItem(SESSION_VAULT_KEY);
	} catch {
		return null;
	}
}

/** Last vault path (localStorage) — used when restore-last is enabled. */
export function getLastVaultPath(): string | null {
	try {
		return localStorage.getItem(LAST_VAULT_KEY);
	} catch {
		return null;
	}
}

/**
 * Resolve initial vault for this window:
 * 1. Session path if already chosen in this window
 * 2. Never auto-open on fresh (⌘N) windows
 * 3. Otherwise last vault when caller enables restore
 */
export function getSavedVaultPath(opts?: {
	allowRestore?: boolean;
}): string | null {
	const session = getSessionVaultPath();
	if (session) return session;
	if (isFreshWindow()) return null;
	if (opts?.allowRestore === false) return null;
	return getLastVaultPath();
}

export function getRecentVaults(): string[] {
	try {
		const raw = localStorage.getItem(RECENT_VAULTS_KEY);
		if (!raw) {
			// Migrate single last-vault into recents once.
			const last = getLastVaultPath();
			return last ? [last] : [];
		}
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(p): p is string => typeof p === "string" && p.length > 0,
		);
	} catch {
		return [];
	}
}

export function rememberRecentVault(path: string): void {
	const normalized = path.replace(/[\\/]+$/, "");
	if (!normalized) return;
	try {
		const next = [
			normalized,
			...getRecentVaults().filter(
				(p) => p.replace(/[\\/]+$/, "") !== normalized,
			),
		].slice(0, MAX_RECENT_VAULTS);
		localStorage.setItem(RECENT_VAULTS_KEY, JSON.stringify(next));
	} catch {
		// ignore
	}
}

export function removeRecentVault(path: string): void {
	const normalized = path.replace(/[\\/]+$/, "");
	try {
		const next = getRecentVaults().filter(
			(p) => p.replace(/[\\/]+$/, "") !== normalized,
		);
		localStorage.setItem(RECENT_VAULTS_KEY, JSON.stringify(next));
	} catch {
		// ignore
	}
}

export function saveVaultPath(path: string | null): void {
	try {
		if (path) {
			sessionStorage.setItem(SESSION_VAULT_KEY, path);
			localStorage.setItem(LAST_VAULT_KEY, path);
			rememberRecentVault(path);
		} else {
			sessionStorage.removeItem(SESSION_VAULT_KEY);
		}
	} catch {
		// ignore quota / private mode
	}
}

/** Open a new Agentero window without restoring a vault (desktop only). */
export async function openNewWindow(): Promise<void> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.openDesktopOnly"));
	}
	await invoke("window_new");
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

async function buildTree(dirPath: string, depth = 0): Promise<FileNode[]> {
	if (depth > 12) return [];

	const entries = await readDir(dirPath);
	const nodes: FileNode[] = [];

	for (const entry of entries) {
		if (!entry.name || IGNORE_NAMES.has(entry.name)) continue;
		if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;

		const path = joinPath(dirPath, entry.name);
		if (entry.isDirectory) {
			const children = await buildTree(path, depth + 1);
			nodes.push({
				id: path,
				name: entry.name,
				path,
				kind: "directory",
				children,
			});
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

export async function pickVaultDirectory(): Promise<string | null> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.openDesktopOnly"));
	}

	const selected = await open({
		directory: true,
		multiple: false,
		title: i18n.t("app:vault.dialogTitle"),
	});

	if (selected === null) return null;
	const path = Array.isArray(selected) ? selected[0] : selected;
	return path ?? null;
}

/** Pick a directory that will be scaffolded as a new Agentero vault. */
export async function pickCreateVaultDirectory(): Promise<string | null> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.createDesktopOnly"));
	}

	const selected = await open({
		directory: true,
		multiple: false,
		title: i18n.t("app:vault.createDialogTitle"),
	});

	if (selected === null) return null;
	const path = Array.isArray(selected) ? selected[0] : selected;
	return path ?? null;
}

/**
 * Scaffold a Agentero vault at `path` (Host: vault_create).
 * Creates papers/notes/plans/.agentero, AGENTS.md, catalog.sqlite.
 * Does not create PAPERS.md / library.bib.
 */
export async function createVault(path: string): Promise<CreateVaultResult> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.createDesktopOnly"));
	}

	const result = await invoke<ApiResult<CreateVaultResult>>("vault_create", {
		path,
	});
	if (!result.ok || !result.data) {
		throw new Error(result.error?.message ?? i18n.t("app:vault.createFailed"));
	}
	return result.data;
}

export async function loadVaultTree(rootPath: string): Promise<FileNode[]> {
	return buildTree(rootPath);
}

export function isMarkdownPath(path: string): boolean {
	return /\.(md|mdx|markdown)$/i.test(path);
}

export function isTextOpenable(path: string): boolean {
	return (
		isMarkdownPath(path) ||
		/\.(txt|json|bib|tex|html?|css|ts|tsx|js|jsx|rs|toml|yaml|yml)$/i.test(path)
	);
}

export async function readVaultFile(path: string): Promise<string> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.readDesktopOnly"));
	}

	return readTextFile(path);
}

/** Write text file (creates parent dirs when possible). */
export async function writeVaultFile(
	path: string,
	content: string,
): Promise<void> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.writeDesktopOnly"));
	}

	const { mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");
	const parent = path.replace(/[\\/][^\\/]+$/, "");
	if (parent && parent !== path) {
		try {
			await mkdir(parent, { recursive: true });
		} catch {
			// Parent may already exist
		}
	}
	await writeTextFile(path, content);
}

/** Write binary file (creates parent dirs when possible). Used for Markdown `./assets/` images. */
export async function writeVaultBytes(
	path: string,
	bytes: Uint8Array,
): Promise<void> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.writeDesktopOnly"));
	}

	const { mkdir, writeFile } = await import("@tauri-apps/plugin-fs");
	const parent = path.replace(/[\\/][^\\/]+$/, "");
	if (parent && parent !== path) {
		try {
			await mkdir(parent, { recursive: true });
		} catch {
			// Parent may already exist
		}
	}
	await writeFile(path, bytes);
}

/** Create a directory (and parents) under the vault. */
export async function createVaultDirectory(path: string): Promise<void> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.writeDesktopOnly"));
	}

	const { mkdir } = await import("@tauri-apps/plugin-fs");
	await mkdir(path, { recursive: true });
}

/**
 * Remove a file or directory under the vault.
 * Directories are removed recursively (including non-empty).
 */
export async function removeVaultPath(path: string): Promise<void> {
	if (!isTauri()) {
		throw new Error(i18n.t("app:vault.writeDesktopOnly"));
	}
	const trimmed = path.trim();
	if (!trimmed || trimmed.startsWith("agentero:")) {
		throw new Error(i18n.t("sidebar:fileTree.deleteInvalid"));
	}
	const { remove } = await import("@tauri-apps/plugin-fs");
	await remove(trimmed, { recursive: true });
}

/** Vault-relative path from absolute path, or null if outside vault. */
export function vaultRelativePath(
	vaultRoot: string,
	absPath: string,
): string | null {
	const root = vaultRoot.replace(/\\/g, "/").replace(/\/+$/, "");
	const abs = absPath.replace(/\\/g, "/").replace(/\/+$/, "");
	if (abs === root) return "";
	const prefix = `${root}/`;
	if (abs.startsWith(prefix)) return abs.slice(prefix.length);
	if (abs === "papers" || abs.startsWith("papers/")) return abs;
	return null;
}

/** Join parent + name with the parent's path separator style. */
export function joinVaultPath(parent: string, name: string): string {
	return joinPath(parent, name);
}

/** True if name is a single path segment (no separators / traversal). */
export function isValidVaultEntryName(name: string): boolean {
	const trimmed = name.trim();
	if (!trimmed) return false;
	if (trimmed === "." || trimmed === "..") return false;
	if (/[\\/]/.test(trimmed)) return false;
	return true;
}

export function vaultDisplayName(rootPath: string | null): string {
	if (!rootPath) return i18n.t("app:vault.noVaultName");
	const parts = rootPath.replace(/[\\/]+$/, "").split(/[\\/]/);
	return parts[parts.length - 1] || rootPath;
}

// --- File-tree path helpers (unit-tested in test/vault-tree.test.ts) ---

/** Normalize an absolute path for case-insensitive equality (forward slashes, no trailing slash). */
export function normalizePathKey(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Find a tree node by absolute path (case-insensitive, separator-agnostic). */
export function treeFindNode(
	nodes: FileNode[],
	path: string,
): FileNode | undefined {
	const key = normalizePathKey(path);
	const walk = (list: FileNode[]): FileNode | undefined => {
		for (const n of list) {
			if (normalizePathKey(n.path) === key) return n;
			if (n.children?.length) {
				const hit = walk(n.children);
				if (hit) return hit;
			}
		}
		return undefined;
	};
	return walk(nodes);
}

/** Parent dir for a new file/folder: selected folder, or parent of selected file, else vault root. */
export function resolveCreateParent(
	vaultRoot: string,
	selectedPath: string | null,
	tree: FileNode[],
): string {
	if (!selectedPath) return vaultRoot;
	const node = treeFindNode(tree, selectedPath);
	if (node?.kind === "directory") return selectedPath;
	const parent = selectedPath.replace(/[\\/][^\\/]+$/, "");
	return parent && parent !== selectedPath ? parent : vaultRoot;
}

/** Flatten the tree to vault-relative Markdown paths (for wikilink resolution). */
export function collectMarkdownRelPaths(
	nodes: FileNode[],
	vaultPath: string | null,
): string[] {
	const out: string[] = [];
	const walk = (list: FileNode[]) => {
		for (const n of list) {
			if (n.kind === "directory" && n.children) walk(n.children);
			else if (n.kind === "file" && isMarkdownPath(n.path)) {
				out.push(toVaultRelative(vaultPath, n.path));
			}
		}
	};
	walk(nodes);
	return out;
}

/** Vault-relative paper folder path derived from a `.../NOTES.md` absolute path. */
export function paperRelFromNotes(
	notesPath: string | null,
	vaultPath: string | null,
): string | null {
	if (!notesPath || !vaultPath) return null;
	const abs = notesPath.replace(/[\\/]NOTES\.md$/i, "").replace(/\\/g, "/");
	const root = vaultPath.replace(/\\/g, "/").replace(/\/$/, "");
	if (abs === root) return "";
	if (abs.startsWith(`${root}/`)) return abs.slice(root.length + 1);
	return abs;
}
