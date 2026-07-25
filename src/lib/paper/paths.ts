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

/** `<paperDir>/metadata.json` — write-side projection for rescan / external tools. */
export function metadataPathForPaper(paperDir: string): string {
	const sep = paperDir.endsWith("/") ? "" : "/";
	return `${paperDir}${sep}metadata.json`;
}

/** `<paperDir>/NOTES.md` — structured notes for the paper. */
export function notesPathForPaper(paperDir: string): string {
	const sep = paperDir.endsWith("/") ? "" : "/";
	return `${paperDir}${sep}NOTES.md`;
}
