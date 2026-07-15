import { arxivUrls } from "@/lib/arxiv";
import { readVaultFile } from "@/lib/vault";

/**
 * Paper metadata: target of truth is Vault `.motif/catalog.sqlite` (see docs/backend/catalog.md).
 * Transition: still may load `<paperDir>/metadata.json` until Host paper:* APIs land.
 *
 * **Paper folder = minimal unit** under `papers/` at any depth, e.g.
 *   `papers/1706.03762/`
 *   `papers/nlp/transformers/1706.03762/`
 * Identified by marker children (NOTES.md, highlights.md, source/, …), not by path depth.
 *
 * PDF/HTML viewers use **remote URLs only** (no local download / vault file read).
 */
export type PaperMetadata = {
	id: string;
	/** Vault-relative paper folder path when known (catalog). */
	path?: string;
	type: "arxiv" | "pdf" | "html" | "doi" | "other";
	title: string;
	authors: string[];
	year: number;
	abstract?: string;
	tags: string[];
	arxiv_id?: string;
	doi?: string;
	/** Remote PDF URL only (e.g. https://arxiv.org/pdf/1706.03762) */
	pdf_url?: string;
	/** Remote HTML URL only (e.g. https://arxiv.org/html/1706.03762) */
	html_url?: string;
	source_url?: string;
	body_source?: "latex" | "html" | "pdf" | "ocr";
	body_quality?: "high" | "medium" | "low";
	bibtex_key?: string;
	citation_count?: number;
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

export async function loadPaperMetadata(
	paperDir: string,
): Promise<PaperMetadata | null> {
	try {
		const raw = await readVaultFile(metadataPathForPaper(paperDir));
		const data = JSON.parse(raw) as PaperMetadata;
		if (!data?.id) return null;
		return data;
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
