import { invoke } from "@tauri-apps/api/core";
import { readDir, readFile } from "@tauri-apps/plugin-fs";
import { arxivUrls } from "@/lib/arxiv";
import { isTauri } from "@/lib/tauri";
import { type FileNode, readVaultFile } from "@/lib/vault";
import { toVaultRelative } from "@/lib/wiki";

/**
 * Paper metadata: **authoritative store is** Vault `.agentero/catalog.sqlite`.
 * `metadata.json` is a projection synced after catalog writes (not the read path).
 *
 * **Paper folder = minimal unit** under `papers/` at any depth.
 * PDF preview: **local file first** → download if missing → remote `pdf_url` fallback.
 * HTML preview: remote `html_url` only.
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
	/**
	 * Whether paper-reader workflow has finished for this paper.
	 * Catalog schema v3; default false when missing (legacy rows).
	 */
	is_read?: boolean;
	added_at: string;
	updated_at: string;
};

/** Remote http(s) URL (HTML preview; PDF download candidate / fallback). */
export type RemoteAsset = { url: string };

/** How the PDF viewer source was resolved. */
export type PaperPdfOrigin = "local" | "remote";

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
 * Reasons a paper row should show the Download icon (for hover tooltip).
 * Keys are i18n suffixes under `sidebar:fileTree.downloadReason.*`.
 *
 * Readable body: **TeX OR PAPER.md** is enough (prefer TeX — if TeX exists, PAPER.md is not required).
 */
export type PaperDownloadReason = "noPdf" | "noBody";

/**
 * Missing local assets that warrant a Download control:
 * - no PDF (at paper folder root or nested), or
 * - no TeX **and** no `PAPER.md` (either body form is sufficient; TeX preferred)
 *
 * Click: download PDF to paper folder root; arXiv TeX into `source/`; if no TeX → liteparse PAPER.md.
 * Note: `source/` is only required for TeX archives — PDF alone does not require `source/`.
 */
export function paperAssetDownloadReasons(
	node: TreeWalkNode,
): PaperDownloadReason[] {
	const reasons: PaperDownloadReason[] = [];
	if (!paperHasLocalPdf(node)) reasons.push("noPdf");
	// Body: TeX wins; only flag when neither TeX nor PAPER.md exists
	if (!paperHasLocalTex(node) && !paperHasLocalPaperMd(node)) {
		reasons.push("noBody");
	}
	return reasons;
}

/**
 * Show file-tree Download when PDF / source / readable body is incomplete.
 * (`canFetchTex` kept for call-site compatibility; no longer gates visibility.)
 */
export function paperNeedsAssetDownload(
	node: TreeWalkNode,
	_opts?: { canFetchTex?: boolean },
): boolean {
	return paperAssetDownloadReasons(node).length > 0;
}

/**
 * Local assets are complete enough for reading / paper-reader:
 * PDF present, and TeX or PAPER.md as readable body.
 */
export function paperAssetsComplete(node: TreeWalkNode): boolean {
	return paperAssetDownloadReasons(node).length === 0;
}

/**
 * Show file-tree Zap when assets are complete and catalog says not yet read.
 */
export function paperNeedsRead(
	node: TreeWalkNode,
	meta: { is_read?: boolean } | null | undefined,
): boolean {
	if (!paperAssetsComplete(node)) return false;
	return !(meta?.is_read === true);
}

/**
 * @deprecated Prefer paperNeedsAssetDownload / paperNeedsRead.
 * Kept for residual callers: missing PAPER.md path when no TeX.
 */
export function paperNeedsBodyParse(node: TreeWalkNode): boolean {
	return (
		paperHasLocalPdf(node) &&
		!paperHasLocalTex(node) &&
		!paperHasLocalPaperMd(node)
	);
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

/** Paper folders (at any depth) that still need an asset download, by path. */
export function collectPapersNeedingAssetDownload(nodes: FileNode[]): string[] {
	const out: string[] = [];
	const walk = (list: FileNode[]) => {
		for (const n of list) {
			if (n.kind === "directory" && isPaperDirectory(n.path, n.children)) {
				if (paperNeedsAssetDownload(n)) out.push(n.path);
			} else if (n.children?.length) {
				walk(n.children);
			}
		}
	};
	walk(nodes);
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

/** Accept only remote http(s) URLs (catalog fields / arxiv-derived). */
export function resolveRemoteUrl(
	ref: string | undefined | null,
): string | null {
	if (!ref?.trim()) return null;
	const value = ref.trim();
	if (/^https?:\/\//i.test(value)) return value;
	return null;
}

/** True when a string can be passed to PDF.js `Document` `file`. */
export function isPdfViewerSource(
	source: string | null | undefined,
): source is string {
	if (!source?.trim()) return false;
	const s = source.trim();
	// blob: (local bytes) or remote https — not asset:// (PDF.js XHR fails on asset protocol)
	if (/^(https?|blob):/i.test(s)) return true;
	return false;
}

/**
 * Read a local file into a `blob:` URL for in-app viewers (PDF.js, img tags).
 *
 * Prefer this over `convertFileSrc` / `asset://`: PDF.js issues range/XHR
 * requests that often fail on Tauri's asset protocol ("Unexpected server response (0)").
 * Caller should `URL.revokeObjectURL` when replacing the source.
 */
export async function localBytesToViewerSource(
	absPath: string,
	mimeType: string,
): Promise<string | null> {
	if (!isTauri() || !absPath?.trim()) return null;
	try {
		const bytes = await readFile(absPath);
		// Copy so Blob owns a stable ArrayBuffer (plugin may return a view)
		const copy = new Uint8Array(bytes.byteLength);
		copy.set(bytes);
		const blob = new Blob([copy], { type: mimeType });
		return URL.createObjectURL(blob);
	} catch {
		return null;
	}
}

/**
 * Read a local PDF into a `blob:` URL for PDF.js.
 * @see localBytesToViewerSource
 */
export async function localPdfToViewerSource(
	absPath: string,
): Promise<string | null> {
	return localBytesToViewerSource(absPath, "application/pdf");
}

/**
 * Read a local image into a `blob:` URL for the image viewer.
 * MIME is inferred from the file extension.
 */
export async function localImageToViewerSource(
	absPath: string,
	mimeType: string,
): Promise<string | null> {
	return localBytesToViewerSource(absPath, mimeType);
}

/** Revoke a blob: URL created by local*ToViewerSource (no-op for others). */
export function revokePdfViewerSource(source: string | null | undefined): void {
	if (source?.startsWith("blob:")) {
		try {
			URL.revokeObjectURL(source);
		} catch {
			// ignore
		}
	}
}

function joinDir(parent: string, name: string): string {
	const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
	const base = parent.replace(/[/\\]+$/, "");
	return `${base}${sep}${name}`;
}

/**
 * Find first local PDF under a paper folder.
 * Prefer root-level `*.pdf` (canonical `{id}.pdf`), then shallow recursive
 * (legacy under `source/`, etc.). Max depth 4.
 */
export async function findLocalPdfPath(
	paperDir: string,
): Promise<string | null> {
	if (!isTauri() || !paperDir?.trim()) return null;
	const root = paperDir.replace(/[/\\]+$/, "");
	try {
		const entries = await readDir(root);
		const rootPdfs: string[] = [];
		for (const e of entries) {
			if (!e.name || !e.isFile) continue;
			if (PDF_NAME_RE.test(e.name)) {
				rootPdfs.push(joinDir(root, e.name));
			}
		}
		if (rootPdfs.length > 0) {
			// Prefer shorter names / id-like: stable sort
			rootPdfs.sort((a, b) => a.localeCompare(b));
			return rootPdfs[0] ?? null;
		}
		return await findPdfUnder(root, 1, 4);
	} catch {
		return null;
	}
}

async function findPdfUnder(
	dir: string,
	depth: number,
	maxDepth: number,
): Promise<string | null> {
	if (depth > maxDepth) return null;
	let entries: Awaited<ReturnType<typeof readDir>>;
	try {
		entries = await readDir(dir);
	} catch {
		return null;
	}
	const subdirs: string[] = [];
	for (const e of entries) {
		if (!e.name) continue;
		if (e.name.startsWith(".")) continue;
		const full = joinDir(dir, e.name);
		if (e.isFile && PDF_NAME_RE.test(e.name)) return full;
		if (e.isDirectory) subdirs.push(full);
	}
	// Prefer source/ before other nested dirs
	subdirs.sort((a, b) => {
		const an = a.replace(/\\/g, "/").toLowerCase();
		const bn = b.replace(/\\/g, "/").toLowerCase();
		const aSrc = an.endsWith("/source") || an.includes("/source/") ? 0 : 1;
		const bSrc = bn.endsWith("/source") || bn.includes("/source/") ? 0 : 1;
		if (aSrc !== bSrc) return aSrc - bSrc;
		return an.localeCompare(bn);
	});
	for (const sub of subdirs) {
		const found = await findPdfUnder(sub, depth + 1, maxDepth);
		if (found) return found;
	}
	return null;
}

/**
 * Whether we should attempt `paper_download_assets` when local PDF is missing.
 * Needs a remote candidate (pdf_url or arxiv_id / arxiv-like folder id).
 */
export function canAttemptPdfDownload(
	meta: PaperMetadata | null,
	remotePdfUrl: string | null,
): boolean {
	if (remotePdfUrl) return true;
	if (meta?.arxiv_id?.trim()) return true;
	if (meta?.type === "arxiv") return true;
	return false;
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
 * How paper folders are labeled in the file tree (Settings → General).
 * Disk folder names stay unchanged; this is display-only.
 */
export type PaperTreeLabelMode =
	| "title-author"
	| "title"
	| "author-year-title"
	| "folder";

export const PAPER_TREE_LABEL_MODES: readonly PaperTreeLabelMode[] = [
	"title-author",
	"title",
	"author-year-title",
	"folder",
] as const;

export function isPaperTreeLabelMode(v: unknown): v is PaperTreeLabelMode {
	return (
		typeof v === "string" &&
		(PAPER_TREE_LABEL_MODES as readonly string[]).includes(v)
	);
}

/** Compact author list for tree rows (1–2 names, else first + et al.). */
export function formatAuthorsShort(
	authors: string[] | undefined | null,
): string {
	if (!authors?.length) return "";
	const clean = authors.map((a) => a.trim()).filter(Boolean);
	if (clean.length === 0) return "";
	if (clean.length === 1) return clean[0] ?? "";
	if (clean.length === 2) return `${clean[0]}, ${clean[1]}`;
	return `${clean[0]} et al.`;
}

/**
 * Display label for a paper folder in the file tree.
 * Falls back to `folderName` when catalog metadata / title is missing.
 */
export function formatPaperTreeLabel(
	mode: PaperTreeLabelMode,
	meta: Pick<PaperMetadata, "title" | "authors" | "year"> | null | undefined,
	folderName: string,
): string {
	const folder = folderName.trim() || folderName;
	if (mode === "folder" || !meta) return folder;

	const title = (meta.title ?? "").trim();
	const authors = formatAuthorsShort(meta.authors);
	const year =
		typeof meta.year === "number" && Number.isFinite(meta.year)
			? String(meta.year)
			: "";

	if (mode === "title") {
		return title || folder;
	}

	if (mode === "title-author") {
		if (title && authors) return `${title} · ${authors}`;
		return title || authors || folder;
	}

	// author-year-title — e.g. "Vaswani et al. (2017) · Attention Is All You Need"
	const headParts: string[] = [];
	if (authors) headParts.push(authors);
	if (year) headParts.push(`(${year})`);
	const head = headParts.join(" ");
	if (head && title) return `${head} · ${title}`;
	return head || title || folder;
}

/**
 * Remote PDF/HTML URLs from catalog metadata.
 * Prefer metadata fields; fall back to arxiv_id-derived URLs.
 * PDF remote URL is a **download candidate / fallback**, not the only preview path.
 * HTML remote URL is the iframe source.
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
