import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/tauri";

export type LinkFragment =
	| { kind: "heading"; path: string[] }
	| { kind: "block"; id: string };

export type LinkResolutionStatus =
	| "resolved"
	| "missing"
	| "ambiguous"
	| "invalidFragment";

export type InternalLinkSyntax = "wikilink" | "markdown";

export type InternalLinkOccurrence = {
	source: string;
	targetRaw: string;
	syntax: InternalLinkSyntax;
	embed: boolean;
	displayText?: string;
	fragment?: LinkFragment;
	sourceRange: { start: number; end: number };
	line: number;
	context?: string;
};

export type ResolvedLink = {
	occurrence: InternalLinkOccurrence;
	status: LinkResolutionStatus;
	targetPath?: string;
	candidates?: string[];
};

export type Backlink = ResolvedLink;

export type BacklinksResponse = {
	path: string;
	backlinks: Backlink[];
};

export type OutgoingLinksResponse = {
	path: string;
	outgoing: ResolvedLink[];
};

export type WikiSearchCandidate = {
	kind: "file" | "heading" | "block";
	path: string;
	insertText: string;
	label: string;
	/** Display alias chosen by the user; `insertText` stays canonical. */
	alias?: string;
	fragment?: LinkFragment;
};

export type RebuildResult = {
	indexedFiles: number;
	edges: number;
	nodes: number;
};

export type WikiRenameRollback =
	| "not-needed"
	| "completed"
	| "manual-recovery-required";

export type WikiRenameSkipped = {
	path: string;
	reason: string;
};

export type WikiRenameResult = {
	movedPath: string;
	updatedSources: string[];
	skipped: WikiRenameSkipped[];
	rollback: WikiRenameRollback;
};

/** Host-held pre-rename snapshot for an externally observed local move. */
export type WikiExternalRenamePreview = {
	candidateId: string;
	from: string;
	to: string;
	affectedSources: string[];
	skipped: WikiRenameSkipped[];
};

export type GraphNodeType = "paper" | "note" | "index" | "stub";

export type GraphNode = {
	id: string;
	label: string;
	type: GraphNodeType;
	path?: string;
};

export type GraphEdge = {
	id: string;
	source: string;
	target: string;
	targetRaw?: string;
};

export type GraphResponse = {
	nodes: GraphNode[];
	edges: GraphEdge[];
	center?: string | null;
	depth: number;
};

type ApiResult<T> = {
	ok: boolean;
	data?: T;
	error?: { code: string; message: string };
};

async function invokeApi<T>(
	cmd: string,
	args?: Record<string, unknown>,
): Promise<T> {
	if (!isTauri()) {
		throw new Error("Wiki index requires the Tauri desktop app.");
	}
	const res = await invoke<ApiResult<T>>(cmd, args);
	if (!res.ok || res.data === undefined) {
		throw new Error(res.error?.message ?? `Command ${cmd} failed`);
	}
	return res.data;
}

/** Rename or move a local Vault path and repair resolved internal links. */
export async function moveVaultPath(
	vaultPath: string,
	fromRel: string,
	toRel: string,
	dirtyPaths: string[],
): Promise<WikiRenameResult> {
	return invokeApi<WikiRenameResult>("wiki_move", {
		args: { vaultPath, fromRel, toRel, dirtyPaths },
	});
}

/** Create a no-write repair candidate from a trustworthy external rename pair. */
export async function previewExternalRenameRepair(
	vaultPath: string,
	fromRel: string,
	toRel: string,
	dirtyPaths: string[],
): Promise<WikiExternalRenamePreview> {
	return invokeApi<WikiExternalRenamePreview>("wiki_external_rename_preview", {
		args: { vaultPath, fromRel, toRel, dirtyPaths },
	});
}

/** Apply a previously previewed external rename repair after a fresh dirty check. */
export async function applyExternalRenameRepair(
	vaultPath: string,
	candidateId: string,
	dirtyPaths: string[],
): Promise<WikiRenameResult> {
	return invokeApi<WikiRenameResult>("wiki_apply_external_rename_repair", {
		args: { vaultPath, candidateId, dirtyPaths },
	});
}

/** Normalize vault-relative path (forward slashes, no leading ./). */
export function normalizeVaultRel(path: string): string {
	return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

/** Strip vault root prefix when path is absolute. */
export function toVaultRelative(
	vaultPath: string | null,
	path: string,
): string {
	const n = normalizeVaultRel(path);
	if (!vaultPath) {
		return n;
	}
	const root = normalizeVaultRel(vaultPath);
	if (n === root) return "";
	if (n.startsWith(`${root}/`)) return n.slice(root.length + 1);
	return n;
}

type Extracted = {
	targetRaw: string;
	alias?: string;
	embed?: boolean;
	fragment?: LinkFragment;
	line?: number;
	context?: string;
};

function parseLinkBody(
	body: string,
): { targetRaw: string; alias?: string; fragment?: LinkFragment } | null {
	const trimmed = body.trim();
	if (!trimmed) return null;
	const pipe = trimmed.indexOf("|");
	const main = (pipe >= 0 ? trimmed.slice(0, pipe) : trimmed).trim();
	const aliasRaw = pipe >= 0 ? trimmed.slice(pipe + 1).trim() : "";
	if (!main) return null;
	const hash = main.indexOf("#");
	const targetRaw = (hash >= 0 ? main.slice(0, hash) : main).trim();
	const fragmentRaw = hash >= 0 ? main.slice(hash + 1).trim() : "";
	const fragment = fragmentRaw
		? fragmentRaw.startsWith("^")
			? { kind: "block" as const, id: fragmentRaw.slice(1) }
			: {
					kind: "heading" as const,
					path: fragmentRaw
						.split("#")
						.map((part) => part.trim())
						.filter(Boolean),
				}
		: undefined;
	if (!targetRaw && !fragment) return null;
	return {
		targetRaw,
		alias: aliasRaw || undefined,
		fragment,
	};
}

function maskInlineCode(line: string): string {
	const chars = [...line];
	const out: string[] = [];
	let i = 0;
	while (i < chars.length) {
		if (chars[i] === "`") {
			const start = i;
			i += 1;
			while (i < chars.length && chars[i] !== "`") i += 1;
			if (i < chars.length) {
				for (let k = start; k <= i; k++) out.push(" ");
				i += 1;
			} else {
				for (let k = start; k < chars.length; k++) out.push(" ");
				break;
			}
		} else {
			out.push(chars[i]);
			i += 1;
		}
	}
	return out.join("");
}

/** Client-side extract for demo / offline (mirrors Rust extract rules). */
export function extractWikilinks(md: string): Extracted[] {
	const results: Extracted[] = [];
	let inFence = false;
	const lines = md.split(/\r?\n/);
	for (let idx = 0; idx < lines.length; idx++) {
		const line = lines[idx];
		const lineNo = idx + 1;
		const trimmed = line.trimStart();
		if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;

		const searchable = maskInlineCode(line);
		const chars = [...searchable];
		const orig = [...line];
		let i = 0;
		while (i + 1 < chars.length) {
			const embed = chars[i] === "!" && chars[i + 1] === "[";
			const opening = embed ? i + 1 : i;
			if (chars[opening] === "[" && chars[opening + 1] === "[") {
				let j = opening + 2;
				while (j + 1 < chars.length) {
					if (chars[j] === "]" && chars[j + 1] === "]") {
						const body = orig.slice(opening + 2, j).join("");
						const parsed = parseLinkBody(body);
						if (parsed) {
							const ctx = line.trim();
							results.push({
								...parsed,
								embed,
								line: lineNo,
								context: ctx || undefined,
							});
						}
						i = j + 2;
						break;
					}
					j += 1;
				}
				if (j + 1 >= chars.length) break;
			} else {
				i += 1;
			}
		}
	}
	return results;
}

/** Resolve a wikilink target against vault-relative Markdown paths. */
export function resolveWikiTarget(
	targetRaw: string,
	files: string[],
): string | null {
	const t = normalizeVaultRel(targetRaw.trim());
	if (!t || files.length === 0) return null;
	const candidates = [t, `${t}.md`, `${t}.mdx`, `${t}.markdown`];
	for (const c of candidates) {
		const hit = files.find((f) => f === c);
		if (hit) return hit;
	}
	for (const c of candidates) {
		const hit = files.find((f) => f.toLowerCase() === c.toLowerCase());
		if (hit) return hit;
	}
	const suffixHits: string[] = [];
	for (const c of candidates) {
		const needle = `/${c}`;
		for (const f of files) {
			if ((f === c || f.endsWith(needle)) && !suffixHits.includes(f)) {
				suffixHits.push(f);
			}
		}
	}
	if (suffixHits.length === 1) return suffixHits[0];
	if (suffixHits.length > 1) return null;
	const stem = (p: string) => {
		const base = p.split("/").pop() ?? p;
		return base.replace(/\.(md|mdx|markdown)$/i, "");
	};
	const want = stem(t);
	const stemHits = files.filter(
		(f) => stem(f).toLowerCase() === want.toLowerCase(),
	);
	if (stemHits.length === 1) return stemHits[0];
	return null;
}

/**
 * Minimal semantic resolver for the browser-only demo. Desktop production paths
 * call `wiki_resolve` in Rust; this duplicate is intentionally fixture-tested so
 * the demo never presents a more precise result than the Host can justify.
 */
export function resolveDemoWikiReference(
	sourcePath: string,
	linkText: string,
	documents: Array<{ path: string; content: string }>,
): Pick<ResolvedLink, "status" | "targetPath" | "candidates"> & {
	fragment?: LinkFragment;
} {
	const hash = linkText.indexOf("#");
	const targetRaw = (hash >= 0 ? linkText.slice(0, hash) : linkText).trim();
	const fragmentRaw = hash >= 0 ? linkText.slice(hash + 1).trim() : "";
	const fragment = fragmentRaw
		? fragmentRaw.startsWith("^")
			? { kind: "block" as const, id: fragmentRaw.slice(1) }
			: {
					kind: "heading" as const,
					path: fragmentRaw
						.split("#")
						.map((part) => part.trim())
						.filter(Boolean),
				}
		: undefined;
	const key = (value: string) =>
		value.trim().replace(/\s+/g, " ").toLowerCase();
	const addExtensions = (value: string) => {
		const normalized = normalizeVaultRel(value);
		if (!normalized) return [];
		return /\.(md|mdx|markdown)$/i.test(normalized)
			? [normalized]
			: [
					normalized,
					`${normalized}.md`,
					`${normalized}.mdx`,
					`${normalized}.markdown`,
				];
	};
	const aliasesFor = (content: string) => {
		const lines = content.split(/\r?\n/);
		if (lines[0]?.trim() !== "---") return [];
		const aliases: string[] = [];
		let reading = false;
		for (const line of lines.slice(1)) {
			const trimmed = line.trim();
			if (trimmed === "---" || trimmed === "...") break;
			if (trimmed.startsWith("aliases:")) {
				reading = true;
				const inline = trimmed.slice("aliases:".length).trim();
				if (inline.startsWith("[") && inline.endsWith("]")) {
					aliases.push(
						...inline
							.slice(1, -1)
							.split(",")
							.map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
							.filter(Boolean),
					);
					reading = false;
				}
			} else if (reading && trimmed.startsWith("-")) {
				aliases.push(
					trimmed
						.slice(1)
						.trim()
						.replace(/^['"]|['"]$/g, ""),
				);
			} else if (trimmed && !/^\s/.test(line)) {
				reading = false;
			}
		}
		return aliases;
	};
	const choose = (matches: string[]) => {
		const unique = [...new Set(matches)].sort();
		return unique.length === 1
			? { path: unique[0] }
			: unique.length
				? { candidates: unique }
				: null;
	};
	let selected: { path?: string; candidates?: string[] } | null;
	if (!targetRaw) {
		selected = choose(
			documents
				.filter((document) => document.path === sourcePath)
				.map((document) => document.path),
		);
	} else {
		const candidates = addExtensions(targetRaw);
		const exact = choose(
			documents
				.filter((document) => candidates.includes(document.path))
				.map((document) => document.path),
		);
		const insensitive = choose(
			documents
				.filter((document) =>
					candidates.some(
						(candidate) =>
							candidate.toLowerCase() === document.path.toLowerCase(),
					),
				)
				.map((document) => document.path),
		);
		const suffix = choose(
			documents
				.filter((document) =>
					candidates.some(
						(candidate) =>
							document.path.endsWith(`/${candidate}`) ||
							document.path === candidate,
					),
				)
				.map((document) => document.path),
		);
		const stem =
			targetRaw
				.split("/")
				.pop()
				?.replace(/\.(md|mdx|markdown)$/i, "") ?? targetRaw;
		const stemMatch = choose(
			documents
				.filter(
					(document) =>
						document.path
							.split("/")
							.pop()
							?.replace(/\.(md|mdx|markdown)$/i, "")
							.toLowerCase() === stem.toLowerCase(),
				)
				.map((document) => document.path),
		);
		const alias = choose(
			documents
				.filter((document) =>
					aliasesFor(document.content).some(
						(value) => key(value) === key(targetRaw),
					),
				)
				.map((document) => document.path),
		);
		selected = exact ?? insensitive ?? suffix ?? stemMatch ?? alias;
	}
	if (!selected) return { status: "missing", fragment };
	if (!selected.path)
		return { status: "ambiguous", candidates: selected.candidates, fragment };
	if (!fragment) return { status: "resolved", targetPath: selected.path };
	const content =
		documents.find((document) => document.path === selected.path)?.content ??
		"";
	const matches =
		fragment.kind === "block"
			? [...content.matchAll(new RegExp(`\\^${fragment.id}(?=\\s*$)`, "gm"))]
					.length
			: content
					.split(/\r?\n/)
					.filter((line) => /^#{1,6}\s+/.test(line))
					.filter(
						(line) =>
							key(line.replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "")) ===
							key(fragment.path.at(-1) ?? ""),
					).length;
	return matches === 1
		? { status: "resolved", targetPath: selected.path, fragment }
		: matches > 1
			? { status: "ambiguous", targetPath: selected.path, fragment }
			: { status: "invalidFragment", targetPath: selected.path, fragment };
}

/** Protocol for preview-only markdown links generated from `[[wikilinks]]`. */
export const WIKI_HREF_PREFIX = "agentero-wiki:";

export type WikiNavTarget = {
	targetRaw: string;
	/** Resolved vault-relative path when exists */
	path: string | null;
	status: LinkResolutionStatus;
	fragment?: LinkFragment;
};

/** Encode navigation payload into a markdown-safe href. */
export function encodeWikiHref(nav: WikiNavTarget): string {
	const payload = [
		nav.status,
		encodeURIComponent(nav.targetRaw),
		encodeURIComponent(nav.path ?? ""),
		encodeURIComponent(nav.fragment ? JSON.stringify(nav.fragment) : ""),
	].join("/");
	return `${WIKI_HREF_PREFIX}${payload}`;
}

export function parseWikiHref(href: string): WikiNavTarget | null {
	if (!href.startsWith(WIKI_HREF_PREFIX)) return null;
	const rest = href.slice(WIKI_HREF_PREFIX.length);
	const parts = rest.split("/");
	if (parts.length < 3) return null;
	const [statusRaw, rawTarget, rawPath, rawFragment] = parts;
	const targetRaw = decodeURIComponent(rawTarget ?? "");
	const path = decodeURIComponent(rawPath ?? "");
	const fragmentRaw = decodeURIComponent(rawFragment ?? "");
	if (!targetRaw && !fragmentRaw) return null;
	return {
		targetRaw,
		path: path || null,
		status: isLinkResolutionStatus(statusRaw) ? statusRaw : "missing",
		fragment: fragmentRaw
			? (JSON.parse(fragmentRaw) as LinkFragment)
			: undefined,
	};
}

function isLinkResolutionStatus(
	value: string | undefined,
): value is LinkResolutionStatus {
	return (
		value === "resolved" ||
		value === "missing" ||
		value === "ambiguous" ||
		value === "invalidFragment"
	);
}

function escapeMdLabel(label: string): string {
	return label.replace(/[[\]]/g, "\\$&");
}

/**
 * Rewrite `[[wikilinks]]` to markdown links for Plate preview.
 * Code fences / inline code are left untouched (same rules as extract).
 */
export function rewriteWikilinksForPreview(
	md: string,
	files: string[],
): string {
	let inFence = false;
	const lines = md.split(/\r?\n/);
	const out: string[] = [];

	for (const line of lines) {
		const trimmed = line.trimStart();
		if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
			inFence = !inFence;
			out.push(line);
			continue;
		}
		if (inFence) {
			out.push(line);
			continue;
		}

		const searchable = maskInlineCode(line);
		const chars = [...searchable];
		const orig = [...line];
		let i = 0;
		let rebuilt = "";
		while (i < chars.length) {
			if (i + 1 < chars.length && chars[i] === "[" && chars[i + 1] === "[") {
				let j = i + 2;
				let found = false;
				while (j + 1 < chars.length) {
					if (chars[j] === "]" && chars[j + 1] === "]") {
						const body = orig.slice(i + 2, j).join("");
						const parsed = parseLinkBody(body);
						if (parsed) {
							const resolved = resolveWikiTarget(parsed.targetRaw, files);
							const label = escapeMdLabel(parsed.alias ?? parsed.targetRaw);
							const href = encodeWikiHref({
								targetRaw: parsed.targetRaw,
								path: resolved,
								status: resolved ? "resolved" : "missing",
								fragment: parsed.fragment,
							});
							rebuilt += `[${label}](${href})`;
						} else {
							rebuilt += orig.slice(i, j + 2).join("");
						}
						i = j + 2;
						found = true;
						break;
					}
					j += 1;
				}
				if (!found) {
					rebuilt += orig.slice(i).join("");
					break;
				}
			} else {
				rebuilt += orig[i];
				i += 1;
			}
		}
		out.push(rebuilt);
	}

	return out.join("\n");
}

/** Default path for a missing wikilink (Obsidian-ish: notes/<name>.md). */
export function missingNotePath(targetRaw: string): string {
	const t = normalizeVaultRel(targetRaw.trim());
	if (!t) return "notes/untitled.md";
	if (t.includes("/")) {
		return /\.(md|mdx|markdown)$/i.test(t) ? t : `${t}.md`;
	}
	const stem = t.replace(/\.(md|mdx|markdown)$/i, "");
	const slug =
		stem
			.replace(/[^\w\u4e00-\u9fff.-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.toLowerCase() || "untitled";
	return `notes/${slug}.md`;
}

/** Seed content for a newly created note. */
export function newNoteMarkdown(targetRaw: string): string {
	const title =
		normalizeVaultRel(targetRaw)
			.split("/")
			.pop()
			?.replace(/\.(md|mdx|markdown)$/i, "") || "Untitled";
	return `# ${title}\n\n`;
}

export async function getBacklinks(
	vaultPath: string | null,
	path: string,
): Promise<BacklinksResponse> {
	if (!path) {
		return { path: "", backlinks: [] };
	}
	if (!vaultPath || !isTauri()) {
		return { path: toVaultRelative(vaultPath, path), backlinks: [] };
	}
	return invokeApi<BacklinksResponse>("graph_get_backlinks", {
		vaultPath,
		path,
	});
}

export async function getOutgoingLinks(
	vaultPath: string | null,
	path: string,
): Promise<OutgoingLinksResponse> {
	if (!path) return { path: "", outgoing: [] };
	if (!vaultPath || !isTauri()) {
		return { path: toVaultRelative(vaultPath, path), outgoing: [] };
	}
	return invokeApi<OutgoingLinksResponse>("wiki_get_outgoing", {
		vaultPath,
		path,
	});
}

export async function resolveWikiReference(
	vaultPath: string | null,
	sourcePath: string,
	linkText: string,
): Promise<ResolvedLink | null> {
	if (!vaultPath || !isTauri()) return null;
	const response = await invokeApi<{ link: ResolvedLink }>("wiki_resolve", {
		vaultPath,
		sourcePath,
		linkText,
	});
	return response.link;
}

export async function searchWikiLinks(
	vaultPath: string | null,
	query: string,
): Promise<WikiSearchCandidate[]> {
	if (!vaultPath || !isTauri()) return [];
	return invokeApi<WikiSearchCandidate[]>("wiki_search", { vaultPath, query });
}

export async function rebuildWikiIndex(
	vaultPath: string,
): Promise<RebuildResult> {
	return invokeApi<RebuildResult>("graph_rebuild", { vaultPath });
}

export async function getGraph(
	vaultPath: string | null,
	opts?: { center?: string | null; depth?: number | null },
): Promise<GraphResponse> {
	const depth = opts?.depth ?? 2;
	const center = opts?.center ?? null;
	if (!vaultPath || !isTauri()) {
		return { nodes: [], edges: [], center: null, depth };
	}
	return invokeApi<GraphResponse>("graph_get_graph", {
		vaultPath,
		center,
		depth,
	});
}
