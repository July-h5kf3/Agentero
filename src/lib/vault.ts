import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";

import i18n from "@/i18n";
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
				{
					id: `${root}/notes/attention.md`,
					name: "attention.md",
					path: `${root}/notes/attention.md`,
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
				paperNode(root, "1706.03762"),
				paperNode(root, "1810.04805"),
				paperNode(root, "2005.14165"),
				paperNode(root, "1412.6980"),
				paperNode(root, "1512.03385"),
			],
		},
	];
}

function paperNode(root: string, id: string): FileNode {
	const path = `${root}/papers/${id}`;
	return {
		id: path,
		name: id,
		path,
		kind: "directory",
		children: [
			{
				id: `${path}/NOTES.md`,
				name: "NOTES.md",
				path: `${path}/NOTES.md`,
				kind: "file",
			},
			{
				id: `${path}/metadata.json`,
				name: "metadata.json",
				path: `${path}/metadata.json`,
				kind: "file",
			},
		],
	};
}

function demoMeta(opts: {
	id: string;
	title: string;
	authors: string[];
	year: number;
	abstract: string;
	tags: string[];
	bibtex: string;
}): string {
	return `{
  "id": "${opts.id}",
  "type": "arxiv",
  "title": ${JSON.stringify(opts.title)},
  "authors": ${JSON.stringify(opts.authors)},
  "year": ${opts.year},
  "abstract": ${JSON.stringify(opts.abstract)},
  "tags": ${JSON.stringify(opts.tags)},
  "arxiv_id": "${opts.id}",
  "doi": "10.48550/arXiv.${opts.id}",
  "pdf_url": "https://arxiv.org/pdf/${opts.id}",
  "html_url": "https://arxiv.org/html/${opts.id}",
  "source_url": "https://arxiv.org/abs/${opts.id}",
  "body_source": "latex",
  "body_quality": "high",
  "bibtex_key": "${opts.bibtex}",
  "status": "completed",
  "added_at": "2026-07-01T10:00:00.000Z",
  "updated_at": "2026-07-01T10:00:00.000Z"
}`;
}

const DEMO_CONTENTS: Record<string, string> = {
	"demo-vault/AGENTS.md": `# AGENTS.md

Rules for agents working in this vault.

- Prefer reading PAPERS.md first, then NOTES.md.
- Always cite local file paths.
`,
	"demo-vault/PAPERS.md": `# Papers index

- [[papers/1706.03762/NOTES]] — Attention Is All You Need
- [[papers/1810.04805/NOTES]] — BERT
- [[papers/2005.14165/NOTES]] — GPT-3
- [[papers/1412.6980/NOTES]] — Adam
- [[papers/1512.03385/NOTES]] — ResNet
`,
	"demo-vault/notes/idea.md": `# Idea

Compare attention mechanisms across transformer variants.

Related: [[papers/1706.03762/NOTES]] · [[papers/1810.04805/NOTES]] · [[notes/attention]]
`,
	"demo-vault/notes/attention.md": `# Attention

Core concept shared by Transformers and later LMs.

Papers:

- [[papers/1706.03762/NOTES]]
- [[papers/1810.04805/NOTES]]
- [[papers/2005.14165/NOTES]]
`,
	"demo-vault/papers/1706.03762/NOTES.md": `# NOTES — Attention Is All You Need

## Summary

Introduces the Transformer architecture based solely on attention.

## Method

Multi-head self-attention + positional encoding.

## Related

- Concept: [[notes/attention]]
- Idea: [[notes/idea]]
- Follow-ups: [[papers/1810.04805/NOTES]] · [[papers/2005.14165/NOTES]]
- Index: [[PAPERS]]
`,
	"demo-vault/papers/1810.04805/NOTES.md": `# NOTES — BERT

## Summary

Bidirectional pre-training for language understanding.

## Related

- Base architecture: [[papers/1706.03762/NOTES]]
- Concept: [[notes/attention]]
- Scaling: [[papers/2005.14165/NOTES]]
- Index: [[PAPERS]]
`,
	"demo-vault/papers/2005.14165/NOTES.md": `# NOTES — GPT-3

## Summary

Few-shot learners via large-scale language models.

## Related

- Transformer: [[papers/1706.03762/NOTES]]
- BERT contrast: [[papers/1810.04805/NOTES]]
- Optimizers often used: [[papers/1412.6980/NOTES]]
- Index: [[PAPERS]]
`,
	"demo-vault/papers/1412.6980/NOTES.md": `# NOTES — Adam

## Summary

Adaptive moment estimation optimizer, widely used for deep nets.

## Related

- Used in: [[papers/1706.03762/NOTES]] · [[papers/2005.14165/NOTES]]
- Vision backbone era: [[papers/1512.03385/NOTES]]
- Index: [[PAPERS]]
`,
	"demo-vault/papers/1512.03385/NOTES.md": `# NOTES — ResNet

## Summary

Deep residual learning for image recognition.

## Related

- Optimizers: [[papers/1412.6980/NOTES]]
- Index: [[PAPERS]]
`,
	"demo-vault/papers/1706.03762/metadata.json": demoMeta({
		id: "1706.03762",
		title: "Attention Is All You Need",
		authors: [
			"Ashish Vaswani",
			"Noam Shazeer",
			"Niki Parmar",
			"Jakob Uszkoreit",
			"Llion Jones",
			"Aidan N. Gomez",
			"Łukasz Kaiser",
			"Illia Polosukhin",
		],
		year: 2017,
		abstract:
			"We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.",
		tags: ["transformer", "attention", "nlp"],
		bibtex: "vaswani2017attention",
	}),
	"demo-vault/papers/1810.04805/metadata.json": demoMeta({
		id: "1810.04805",
		title:
			"BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
		authors: [
			"Jacob Devlin",
			"Ming-Wei Chang",
			"Kenton Lee",
			"Kristina Toutanova",
		],
		year: 2019,
		abstract:
			"We introduce BERT, designed to pre-train deep bidirectional representations from unlabeled text.",
		tags: ["bert", "pretraining", "nlp"],
		bibtex: "devlin2019bert",
	}),
	"demo-vault/papers/2005.14165/metadata.json": demoMeta({
		id: "2005.14165",
		title: "Language Models are Few-Shot Learners",
		authors: ["Tom B. Brown", "Benjamin Mann", "Nick Ryder", "Melanie Subbiah"],
		year: 2020,
		abstract:
			"We train GPT-3, an autoregressive language model with 175 billion parameters, and test its performance in the few-shot setting.",
		tags: ["gpt", "llm", "few-shot"],
		bibtex: "brown2020language",
	}),
	"demo-vault/papers/1412.6980/metadata.json": demoMeta({
		id: "1412.6980",
		title: "Adam: A Method for Stochastic Optimization",
		authors: ["Diederik P. Kingma", "Jimmy Ba"],
		year: 2015,
		abstract:
			"We introduce Adam, an algorithm for first-order gradient-based optimization of stochastic objective functions.",
		tags: ["optimization", "adam"],
		bibtex: "kingma2015adam",
	}),
	"demo-vault/papers/1512.03385/metadata.json": demoMeta({
		id: "1512.03385",
		title: "Deep Residual Learning for Image Recognition",
		authors: ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
		year: 2016,
		abstract:
			"We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously.",
		tags: ["resnet", "vision", "cnn"],
		bibtex: "he2016deep",
	}),
};

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

/** Sync read for inlined demo text files (no network). */
export function getDemoTextContent(path: string): string | null {
	return DEMO_CONTENTS[path] ?? null;
}

export async function readVaultFile(path: string): Promise<string> {
	if (path.startsWith("demo-vault/")) {
		return (
			DEMO_CONTENTS[path] ??
			`# ${path}\n\n${i18n.t("app:vault.demoNoContent")}\n`
		);
	}

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
	if (path.startsWith("demo-vault/")) {
		DEMO_CONTENTS[path] = content;
		return;
	}

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

export function vaultDisplayName(rootPath: string | null): string {
	if (!rootPath) return i18n.t("app:vault.demoName");
	const parts = rootPath.replace(/[\\/]+$/, "").split(/[\\/]/);
	return parts[parts.length - 1] || rootPath;
}
