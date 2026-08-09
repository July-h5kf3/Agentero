import { normalizePath } from "@/lib/core/path";

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
 * True when path is inside a paper folder's internal asset dirs
 * (`<paper>/source|assets|marks/…`). Highlight/LaTeX/image writes there never
 * change catalog rows, so they must not trigger library refreshes.
 */
export function isPaperAssetPath(path: string | null): boolean {
	if (!path) return false;
	const norm = normalizePath(path);
	return /(^|\/)papers\/.+?\/(source|assets|marks)(\/|$)/i.test(norm);
}

/** `<paperDir>/NOTES.md` — structured notes for the paper. */
export function notesPathForPaper(paperDir: string): string {
	const sep = paperDir.endsWith("/") ? "" : "/";
	return `${paperDir}${sep}NOTES.md`;
}
