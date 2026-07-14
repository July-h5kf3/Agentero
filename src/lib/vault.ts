import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";

import { isTauri } from "@/lib/tauri";

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
	".motif",
]);

const VAULT_PATH_KEY = "motif-vault-path";

export function getSavedVaultPath(): string | null {
	try {
		return localStorage.getItem(VAULT_PATH_KEY);
	} catch {
		return null;
	}
}

export function saveVaultPath(path: string | null): void {
	try {
		if (path) localStorage.setItem(VAULT_PATH_KEY, path);
		else localStorage.removeItem(VAULT_PATH_KEY);
	} catch {
		// ignore quota / private mode
	}
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

/** Demo vault used outside Tauri or before a folder is opened. */
export function getDemoTree(): FileNode[] {
	const root = "demo-vault";
	return [
		{
			id: `${root}/AGENTS.md`,
			name: "AGENTS.md",
			path: `${root}/AGENTS.md`,
			kind: "file",
		},
		{
			id: `${root}/PAPERS.md`,
			name: "PAPERS.md",
			path: `${root}/PAPERS.md`,
			kind: "file",
		},
		{
			id: `${root}/notes`,
			name: "notes",
			path: `${root}/notes`,
			kind: "directory",
			children: [
				{
					id: `${root}/notes/idea.md`,
					name: "idea.md",
					path: `${root}/notes/idea.md`,
					kind: "file",
				},
			],
		},
		{
			id: `${root}/papers`,
			name: "papers",
			path: `${root}/papers`,
			kind: "directory",
			children: [
				{
					id: `${root}/papers/1706.03762`,
					name: "1706.03762",
					path: `${root}/papers/1706.03762`,
					kind: "directory",
					children: [
						{
							id: `${root}/papers/1706.03762/NOTES.md`,
							name: "NOTES.md",
							path: `${root}/papers/1706.03762/NOTES.md`,
							kind: "file",
						},
						{
							id: `${root}/papers/1706.03762/metadata.json`,
							name: "metadata.json",
							path: `${root}/papers/1706.03762/metadata.json`,
							kind: "file",
						},
					],
				},
			],
		},
	];
}

const DEMO_CONTENTS: Record<string, string> = {
	"demo-vault/AGENTS.md": `# AGENTS.md

Rules for agents working in this vault.

- Prefer reading PAPERS.md first, then NOTES.md.
- Always cite local file paths.
`,
	"demo-vault/PAPERS.md": `# Papers index

- [[papers/1706.03762/NOTES]] — Attention Is All You Need
`,
	"demo-vault/notes/idea.md": `# Idea

Compare attention mechanisms across transformer variants.

Related: [[papers/1706.03762/NOTES]]
`,
	"demo-vault/papers/1706.03762/NOTES.md": `# NOTES — Attention Is All You Need

## Summary

Introduces the Transformer architecture based solely on attention.

## Method

Multi-head self-attention + positional encoding.

## Open questions

- How do later variants change the attention bottleneck?
`,
	"demo-vault/papers/1706.03762/metadata.json": `{
  "id": "1706.03762",
  "title": "Attention Is All You Need",
  "type": "arxiv"
}
`,
};

export async function pickVaultDirectory(): Promise<string | null> {
	if (!isTauri()) {
		throw new Error("Open vault is only available in the Tauri app.");
	}

	const selected = await open({
		directory: true,
		multiple: false,
		title: "Select Motif vault folder",
	});

	if (selected === null) return null;
	const path = Array.isArray(selected) ? selected[0] : selected;
	return path ?? null;
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
	if (path.startsWith("demo-vault/")) {
		return (
			DEMO_CONTENTS[path] ?? `# ${path}\n\n(Demo file has no sample content.)\n`
		);
	}

	if (!isTauri()) {
		throw new Error("Reading local files requires the Tauri app.");
	}

	return readTextFile(path);
}

export function vaultDisplayName(rootPath: string | null): string {
	if (!rootPath) return "Demo vault";
	const parts = rootPath.replace(/[\\/]+$/, "").split(/[\\/]/);
	return parts[parts.length - 1] || rootPath;
}
