import { invoke } from "@tauri-apps/api/core";
import { arxivUrls } from "@/lib/arxiv";
import { isTauri } from "@/lib/tauri";
import { readVaultFile } from "@/lib/vault";
import { toVaultRelative } from "@/lib/wiki";

/**
 * Paper metadata: **authoritative store is** Vault `.motif/catalog.sqlite`.
 * `metadata.json` is a projection synced after catalog writes (not the read path).
 *
 * **Paper folder = minimal unit** under `papers/` at any depth.
 * PDF/HTML viewers use **remote URLs** from catalog fields.
 */
/** Creator from Translator / Zotero item mapping. */
export type PaperCreator = {
	firstName?: string;
	lastName?: string;
	name?: string;
	creatorType?: string;
};

/**
 * Paper metadata: catalog.sqlite row (see docs/backend/catalog.md).
 * Magic-wand / Translator results map **directly** into these fields.
 */
export type PaperMetadata = {
	id: string;
	/** Vault-relative paper folder path when known (catalog). */
	path?: string;
	type: "arxiv" | "pdf" | "html" | "doi" | "other";
	title: string;
	/** Display names */
	authors: string[];
	/** Full creators (roles preserved from Translator) */
	creators?: PaperCreator[];
	year?: number;
	/** Raw date string from Translator */
	date?: string;
	abstract?: string;
	tags: string[];
	arxiv_id?: string;
	doi?: string;
	isbn?: string;
	issn?: string;
	pmid?: string;
	/** Journal / proceedings / book title */
	publication?: string;
	volume?: string;
	issue?: string;
	pages?: string;
	publisher?: string;
	place?: string;
	series?: string;
	language?: string;
	/** Remote PDF URL only (e.g. https://arxiv.org/pdf/1706.03762) */
	pdf_url?: string;
	/** Remote HTML URL only (e.g. https://arxiv.org/html/1706.03762) */
	html_url?: string;
	source_url?: string;
	body_source?: "latex" | "html" | "pdf" | "ocr";
	body_quality?: "high" | "medium" | "low";
	bibtex_key?: string;
	citation_count?: number;
	/** Translator itemType, e.g. journalArticle */
	zotero_item_type?: string;
	/** libraryCatalog, e.g. DOI.org (Crossref) */
	meta_source?: string;
	/** Translator extra residue */
	extra?: string;
	summary?: string;
	status: "pending" | "importing" | "completed" | "failed";
	added_at: string;
	updated_at: string;
};

/** Only remote http(s) URLs are used for PDF/HTML preview. */
export type RemoteAsset = { url: string };

/** Direct-child names that mark a directory as a paper folder. */
export const PAPER_FILE_MARKERS = [
	"NOTES.md",
	"highlights.md",
	"PAPER.md",
	"metadata.json",
] as const;

/** Direct-child directory names that mark a paper folder. */
export const PAPER_DIR_MARKERS = ["source", "assets"] as const;

const PDF_NAME_RE = /\.pdf$/i;
const TEX_NAME_RE = /\.(tex|ltx)$/i;
const PAPER_MD_RE = /^paper\.md$/i;

type TreeWalkNode = {
	name: string;
	kind?: string;
	path?: string;
	children?: Array<{
		name: string;
		kind?: string;
		path?: string;
		children?: unknown[];
	}>;
};

/** Walk tree node names for a matching extension. */
function treeHasFileExt(node: TreeWalkNode, re: RegExp): boolean {
	if (node.kind !== "directory" && re.test(node.name)) return true;
	for (const child of node.children ?? []) {
		if (treeHasFileExt(child as TreeWalkNode, re)) return true;
	}
	return false;
}

export function paperHasLocalPdf(node: TreeWalkNode): boolean {
	return treeHasFileExt(node, PDF_NAME_RE);
}

export function paperHasLocalTex(node: TreeWalkNode): boolean {
	return treeHasFileExt(node, TEX_NAME_RE);
}

/** True when the paper folder has a direct-child `PAPER.md` (any depth name match). */
export function paperHasLocalPaperMd(node: TreeWalkNode): boolean {
	if (node.kind !== "directory" && PAPER_MD_RE.test(node.name)) return true;
	for (const child of node.children ?? []) {
		if (paperHasLocalPaperMd(child as TreeWalkNode)) return true;
	}
	return false;
}

/** True when paper folder has a direct child directory named `source`. */
export function paperHasLocalSourceDir(node: TreeWalkNode): boolean {
	for (const child of node.children ?? []) {
		if (
			(child.kind === "directory" || !child.kind) &&
			/^source$/i.test(child.name)
		) {
			return true;
		}
	}
	return false;
}

/**
 * Show file-tree eye (parse body) when:
 * - local PDF exists,
 * - no local `.tex`/`.ltx`,
 * - no `PAPER.md` yet.
 */
export function paperNeedsBodyParse(node: TreeWalkNode): boolean {
	return (
		paperHasLocalPdf(node) &&
		!paperHasLocalTex(node) &&
		!paperHasLocalPaperMd(node)
	);
}

/**
 * Show file-tree Download when local archive is incomplete:
 * - no local PDF, or
 * - no `source/` directory, or
 * - TeX is fetchable (arXiv) but no local `.tex`/`.ltx` yet.
 *
 * Click handler: download PDF; if arXiv also try TeX; if still no TeX → liteparse PAPER.md.
 *
 * `canFetchTex`: true if catalog has arxiv_id / type=arxiv, or folder name looks like arXiv id.
 */
export function paperNeedsAssetDownload(
	node: TreeWalkNode,
	opts?: { canFetchTex?: boolean },
): boolean {
	const hasPdf = paperHasLocalPdf(node);
	const hasSource = paperHasLocalSourceDir(node);
	const hasTex = paperHasLocalTex(node);

	// No PDF and/or no source/ → need download (demo shells, failed import, etc.)
	if (!hasPdf || !hasSource) return true;

	const canTex =
		opts?.canFetchTex === true ||
		// Heuristic when catalog map not ready: folder name is arXiv id
		Boolean(node.name && folderNameLooksLikeArxivId(node.name));
	if (canTex && !hasTex) return true;
	return false;
}

/** Folder-name heuristic: looks like bare arXiv id. */
export function folderNameLooksLikeArxivId(name: string): boolean {
	return /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/i.test(
		name.trim(),
	);
}

type NameKind = { name: string; kind?: "file" | "directory" | string };

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** True when path is the `papers` directory itself (Vault-relative or absolute). */
export function isPapersRoot(path: string | null): boolean {
	if (!path) return false;
	const norm = normalizePath(path);
	return /(^|\/)papers$/i.test(norm);
}

/**
 * True when path is somewhere under a `papers` root (not the root itself).
 * Absolute: `…/papers/…` ; Vault-relative: `papers/…`.
 */
export function isUnderPapers(path: string | null): boolean {
	if (!path || isPapersRoot(path)) return false;
	const norm = normalizePath(path);
	return /(^|\/)papers\//i.test(norm);
}

/**
 * Vault-relative parent for magic-wand import: `papers` or `papers/<org>/…`.
 * Never returns a paper folder itself (uses parent of paper when selection is inside one).
 *
 * @see docs/backend/identifier-lookup.md §1.2
 */
export function resolvePapersParentDir(
	vaultRoot: string | null,
	selectedPath: string | null,
	tree: Array<{
		path: string;
		kind: "file" | "directory";
		children?: Array<{
			path: string;
			kind: "file" | "directory";
			name: string;
			children?: unknown[];
		}>;
	}>,
): string {
	const papersRel = "papers";
	if (!vaultRoot) return papersRel;

	const rootNorm = normalizePath(vaultRoot);
	const toRel = (abs: string): string => {
		const n = normalizePath(abs);
		if (n === rootNorm) return "";
		const prefix = `${rootNorm}/`;
		if (n.startsWith(prefix)) return n.slice(prefix.length);
		// Already vault-relative?
		if (n === "papers" || n.startsWith("papers/")) return n;
		return n;
	};

	const findNode = (
		nodes: typeof tree,
		absPath: string,
	): (typeof tree)[0] | null => {
		const key = normalizePath(absPath).toLowerCase();
		for (const n of nodes) {
			if (normalizePath(n.path).toLowerCase() === key) return n;
			if (n.children?.length) {
				const hit = findNode(n.children as typeof tree, absPath);
				if (hit) return hit;
			}
		}
		return null;
	};

	const paperFolders = collectPaperFoldersFromTree(tree);
	if (!selectedPath) return papersRel;

	const paperRoot = paperDirFromPath(selectedPath, paperFolders);
	if (paperRoot) {
		const parentAbs = paperRoot.replace(/[\\/][^\\/]+$/, "");
		const rel = toRel(parentAbs);
		if (
			!rel ||
			rel === "papers" ||
			isPapersRoot(rel) ||
			isPapersRoot(parentAbs)
		) {
			return papersRel;
		}
		if (rel.startsWith("papers/") || isUnderPapers(parentAbs)) {
			return rel.replace(/\\/g, "/");
		}
		return papersRel;
	}

	const node = findNode(tree, selectedPath);
	if (node?.kind === "directory") {
		const rel = toRel(selectedPath);
		if (isPapersRoot(selectedPath) || rel === "papers" || isPapersRoot(rel)) {
			return papersRel;
		}
		if (isUnderPapers(selectedPath) || rel.startsWith("papers/")) {
			return rel.replace(/\\/g, "/");
		}
	} else {
		const parentAbs = selectedPath.replace(/[\\/][^\\/]+$/, "");
		if (parentAbs && parentAbs !== selectedPath) {
			const rel = toRel(parentAbs);
			if (isPapersRoot(parentAbs) || rel === "papers") return papersRel;
			if (isUnderPapers(parentAbs) || rel.startsWith("papers/")) {
				return rel.replace(/\\/g, "/");
			}
		}
	}

	return papersRel;
}

/** Whether direct children indicate a paper folder (minimal unit). */
export function directoryHasPaperMarkers(
	children: NameKind[] | undefined | null,
): boolean {
	if (!children?.length) return false;
	for (const c of children) {
		const name = c.name;
		const lower = name.toLowerCase();
		if (
			lower === "notes.md" ||
			lower === "highlights.md" ||
			lower === "paper.md" ||
			lower === "metadata.json"
		) {
			return true;
		}
		const isDir =
			c.kind === "directory" ||
			// name-only lists: treat known dir markers as dirs
			(!c.kind && (lower === "source" || lower === "assets"));
		if (isDir && (lower === "source" || lower === "assets")) {
			return true;
		}
	}
	return false;
}

/**
 * True when `path` is a paper folder (minimal unit under `papers/`).
 * Prefer passing `children` from the file tree so nested org folders are not treated as papers.
 * Path-only: returns false for bare directories (use markers or `paperDirFromPath` for files).
 */
export function isPaperDirectory(
	path: string | null,
	children?: NameKind[] | null,
): boolean {
	if (!path || !isUnderPapers(path)) return false;
	if (children !== undefined && children !== null) {
		return directoryHasPaperMarkers(children);
	}
	return false;
}

/**
 * Extract the paper folder path from any file/dir path under that paper.
 * Supports nested layout: `…/papers/topic/1706.03762/NOTES.md` → `…/papers/topic/1706.03762`.
 *
 * Uses path structure (known internal files / source|assets), not a single path segment.
 * Optional `paperFolders` (sorted vault-relative or absolute paper roots) picks the longest matching prefix.
 */
export function paperDirFromPath(
	path: string | null,
	paperFolders?: string[] | null,
): string | null {
	if (!path || !isUnderPapers(path)) return null;
	const norm = normalizePath(path);

	if (paperFolders?.length) {
		const folders = [...paperFolders]
			.map(normalizePath)
			.filter(Boolean)
			.sort((a, b) => b.length - a.length);
		for (const folder of folders) {
			if (norm === folder || norm.startsWith(`${folder}/`)) {
				return folder;
			}
		}
	}

	// Known paper-root files → parent is paper folder
	const fileMarker = /\/(NOTES\.md|highlights\.md|PAPER\.md|metadata\.json)$/i;
	if (fileMarker.test(norm)) {
		return norm.replace(fileMarker, "") || null;
	}

	// …/source/… or …/assets/… → paper is parent of source|assets
	const nestedAsset = norm.match(
		/^(.*\/papers\/.+?)\/(source|assets)(?:\/|$)/i,
	);
	if (nestedAsset?.[1]) {
		return nestedAsset[1];
	}
	// Vault-relative without leading drive: papers/…/source/…
	const nestedAssetRel = norm.match(/^(papers\/.+?)\/(source|assets)(?:\/|$)/i);
	if (nestedAssetRel?.[1]) {
		return nestedAssetRel[1];
	}

	// Path is a directory under papers with no further hint → not enough to claim paper unit
	return null;
}

/**
 * Collect paper folder paths from a file tree (any depth under `papers/`).
 */
export function collectPaperFoldersFromTree(
	nodes: Array<{
		path: string;
		kind: "file" | "directory";
		children?: unknown[];
		name?: string;
	}>,
): string[] {
	const out: string[] = [];
	const walk = (
		list: Array<{
			path: string;
			kind: "file" | "directory";
			children?: Array<{
				path: string;
				kind: "file" | "directory";
				name: string;
				children?: unknown[];
			}>;
			name?: string;
		}>,
	) => {
		for (const n of list) {
			if (n.kind === "directory") {
				const children = n.children as
					| Array<{ name: string; kind: "file" | "directory" }>
					| undefined;
				if (isUnderPapers(n.path) && directoryHasPaperMarkers(children)) {
					out.push(normalizePath(n.path));
					// Do not walk into paper internals for nested papers
					continue;
				}
				if (n.children?.length) {
					walk(
						n.children as Array<{
							path: string;
							kind: "file" | "directory";
							children?: Array<{
								path: string;
								kind: "file" | "directory";
								name: string;
								children?: unknown[];
							}>;
							name?: string;
						}>,
					);
				}
			}
		}
	};
	walk(
		nodes as Array<{
			path: string;
			kind: "file" | "directory";
			children?: Array<{
				path: string;
				kind: "file" | "directory";
				name: string;
				children?: unknown[];
			}>;
			name?: string;
		}>,
	);
	return out;
}

export function metadataPathForPaper(paperDir: string): string {
	const sep = paperDir.endsWith("/") ? "" : "/";
	return `${paperDir}${sep}metadata.json`;
}

/** `<paperDir>/NOTES.md` — structured notes for the paper. */
export function notesPathForPaper(paperDir: string): string {
	const sep = paperDir.endsWith("/") ? "" : "/";
	return `${paperDir}${sep}NOTES.md`;
}

/** Accept only remote http(s) URLs for streaming preview (never local vault paths). */
export function resolveRemoteUrl(
	ref: string | undefined | null,
): string | null {
	if (!ref?.trim()) return null;
	const value = ref.trim();
	if (/^https?:\/\//i.test(value)) return value;
	return null;
}

/** Normalize legacy camelCase keys from early Host writes. */
function normalizeMetadataKeys(
	raw: Record<string, unknown>,
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...raw };
	const aliases: [string, string][] = [
		["pdfUrl", "pdf_url"],
		["htmlUrl", "html_url"],
		["sourceUrl", "source_url"],
		["arxivId", "arxiv_id"],
		["bibtexKey", "bibtex_key"],
		["zoteroItemType", "zotero_item_type"],
		["metaSource", "meta_source"],
		["bodySource", "body_source"],
		["bodyQuality", "body_quality"],
		["citationCount", "citation_count"],
		["addedAt", "added_at"],
		["updatedAt", "updated_at"],
	];
	for (const [camel, snake] of aliases) {
		if (out[snake] == null && out[camel] != null) {
			out[snake] = out[camel];
		}
	}
	return out;
}

function enrichArxivUrls(data: PaperMetadata): PaperMetadata {
	if (!data.arxiv_id) return data;
	const urls = arxivUrls(data.arxiv_id);
	if (!urls) return data;
	if (!data.pdf_url) data.pdf_url = urls.pdf;
	if (!data.html_url) data.html_url = urls.html;
	if (!data.source_url) data.source_url = urls.abs;
	return data;
}

type ApiResult<T> = {
	ok: boolean;
	data?: T;
	error?: { code: string; message: string };
};

/**
 * Load paper metadata. Prefer catalog.sqlite via Host `paper_get`.
 * Falls back to `metadata.json` only when catalog has no row (legacy).
 *
 * @param paperDir absolute paper folder path
 * @param vaultRoot absolute vault root (needed for catalog lookup)
 */
export async function loadPaperMetadata(
	paperDir: string,
	vaultRoot?: string | null,
): Promise<PaperMetadata | null> {
	// Primary: SQLite catalog
	if (isTauri() && vaultRoot) {
		const path = toVaultRelative(vaultRoot, paperDir).replace(/\\/g, "/");
		if (path && path !== ".") {
			try {
				const res = await invoke<ApiResult<PaperMetadata>>("paper_get", {
					args: { vaultPath: vaultRoot, path },
				});
				if (res.ok && res.data?.id) {
					return enrichArxivUrls({
						...res.data,
						path: res.data.path ?? path,
					});
				}
			} catch {
				// fall through
			}
		}
	}

	// Legacy projection only
	try {
		const raw = await readVaultFile(metadataPathForPaper(paperDir));
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const data = normalizeMetadataKeys(parsed) as unknown as PaperMetadata;
		if (!data?.id) return null;
		return enrichArxivUrls(data);
	} catch {
		return null;
	}
}

/**
 * Async paper-folder check when tree children are unavailable
 * (graph navigation, session restore). Probes marker files on disk.
 */
export async function detectPaperDirectory(path: string): Promise<boolean> {
	if (!isUnderPapers(path) || isPapersRoot(path)) return false;
	try {
		await readVaultFile(notesPathForPaper(path));
		return true;
	} catch {
		// continue
	}
	try {
		await readVaultFile(metadataPathForPaper(path));
		return true;
	} catch {
		return false;
	}
}

/**
 * Remote PDF/HTML URLs for viewers.
 * Prefer metadata fields; fall back to arxiv_id-derived URLs.
 * Never resolves vault-relative paths (no local download).
 */
export function paperRemoteAssetsFromMetadata(meta: PaperMetadata | null): {
	pdfUrl: string | null;
	htmlUrl: string | null;
} {
	if (!meta) return { pdfUrl: null, htmlUrl: null };

	let pdfUrl = resolveRemoteUrl(meta.pdf_url);
	let htmlUrl = resolveRemoteUrl(meta.html_url);

	const arxiv = meta.arxiv_id ? arxivUrls(meta.arxiv_id) : null;
	if (!pdfUrl && arxiv) pdfUrl = arxiv.pdf;
	if (!htmlUrl && arxiv) htmlUrl = arxiv.html;

	return { pdfUrl, htmlUrl };
}
