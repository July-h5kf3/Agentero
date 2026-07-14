import { arxivUrls } from "@/lib/arxiv";
import { readVaultFile } from "@/lib/vault";

/**
 * papers/<id>/metadata.json — single source of truth for paper meta.
 * See docs/DATA_MODEL.md §3.3.
 *
 * PDF/HTML viewers use **remote URLs only** (no local download / vault file read):
 *   pdf_url  → https://arxiv.org/pdf/{id}
 *   html_url → https://arxiv.org/html/{id}
 * If omitted but `arxiv_id` is set, URLs are derived via `arxivUrls()`.
 */
export type PaperMetadata = {
	id: string;
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

/** Extract `…/papers/<id>` from any file path under that paper. */
export function paperDirFromPath(path: string | null): string | null {
	if (!path) return null;
	const norm = path.replace(/\\/g, "/");
	const m = norm.match(/^(.*\/papers\/[^/]+)/i);
	return m ? m[1] : null;
}

export function metadataPathForPaper(paperDir: string): string {
	const sep = paperDir.endsWith("/") ? "" : "/";
	return `${paperDir}${sep}metadata.json`;
}

/** papers/<id>/NOTES.md — structured notes for the paper. */
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
