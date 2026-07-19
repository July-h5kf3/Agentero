import type { LucideIcon } from "lucide-react";
import {
	FileCode2,
	FileImage,
	FileJson,
	FileText,
	FileType2,
	Folder,
	ScrollText,
} from "lucide-react";

/**
 * Normalize a vault-relative (or absolute-looking) path for kind / icon lookup.
 * Strips trailing slashes; keeps internal case (Vault paths are case-sensitive on some FS).
 */
export function normalizeContextPath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "").replace(/^\.\//, "");
}

/** Build a Set of normalized paths for O(1) chip kind lookup. */
export function toPathSet(
	paths: Iterable<string> | null | undefined,
): ReadonlySet<string> {
	const set = new Set<string>();
	if (!paths) return set;
	for (const p of paths) {
		const n = normalizeContextPath(p);
		if (n) set.add(n);
	}
	return set;
}

/** @deprecated Use `toPathSet` — same implementation. */
export const toDirectoryPathSet = toPathSet;

export type ContextPathIconOptions = {
	/** Vault-relative directories (org folders, notes dirs, paper folders, …). */
	directoryPaths?: ReadonlySet<string> | null;
	/**
	 * Vault-relative **paper** folder paths (marker-based leaves under `papers/`).
	 * Takes priority over generic folder icon — matches file-tree `ScrollText`.
	 */
	paperPaths?: ReadonlySet<string> | null;
};

/**
 * Whether a context path should use a folder icon.
 *
 * Priority:
 * 1. Trailing slash on the raw path → directory
 * 2. Exact match in `directoryPaths` (from Vault tree) → directory
 * 3. Basename has a file-like extension → file
 * 4. No extension → directory (paper folders, org folders, notes dirs)
 */
export function isDirectoryContextPath(
	path: string,
	directoryPaths?: ReadonlySet<string> | null,
): boolean {
	const raw = path.replace(/\\/g, "/");
	if (raw.endsWith("/")) return true;

	const norm = normalizeContextPath(path);
	if (!norm) return false;

	if (directoryPaths?.has(norm)) return true;

	const base = norm.includes("/") ? (norm.split("/").pop() ?? norm) : norm;
	// Dotfiles like `.gitignore` count as files; `v1.0`-style dirs rely on tree set.
	if (hasFileLikeExtension(base)) return false;

	// Unknown path with no extension: treat as folder (drag of paper / org dir).
	return true;
}

export function isPaperContextPath(
	path: string,
	paperPaths?: ReadonlySet<string> | null,
): boolean {
	if (!paperPaths?.size) return false;
	const norm = normalizeContextPath(path);
	return Boolean(norm && paperPaths.has(norm));
}

/** Basename looks like `name.ext` with a short alnum extension. */
function hasFileLikeExtension(base: string): boolean {
	if (!base || base === "." || base === "..") return false;
	// Leading-dot only (`.env`) → file; `name.tar.gz` → file via last segment.
	const m = base.match(/\.([a-z0-9]{1,12})$/i);
	if (!m) return false;
	return true;
}

/**
 * Lucide icon for a Vault context chip / mention row.
 * Paper folders → ScrollText (same as file tree); other folders → Folder;
 * files → type-specific (PDF, image, code, …).
 */
function isPathSet(
	value: ContextPathIconOptions | ReadonlySet<string> | null | undefined,
): value is ReadonlySet<string> {
	return (
		value != null &&
		typeof value === "object" &&
		typeof (value as ReadonlySet<string>).has === "function" &&
		typeof (value as ReadonlySet<string>).size === "number" &&
		!("directoryPaths" in value) &&
		!("paperPaths" in value)
	);
}

export function contextPathIcon(
	path: string,
	options?: ContextPathIconOptions | ReadonlySet<string> | null,
): LucideIcon {
	// Backward-compatible: second arg may be a directory Set only.
	const opts: ContextPathIconOptions = isPathSet(options)
		? { directoryPaths: options }
		: (options ?? {});

	if (isPaperContextPath(path, opts.paperPaths)) {
		return ScrollText;
	}
	if (isDirectoryContextPath(path, opts.directoryPaths)) {
		return Folder;
	}
	const base = normalizeContextPath(path).split("/").pop()?.toLowerCase() ?? "";
	if (/\.pdf$/i.test(base)) return FileType2;
	if (/\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(base)) return FileImage;
	if (/\.json$/i.test(base)) return FileJson;
	if (/\.(ts|tsx|js|jsx|rs|toml|py|go|java|c|cpp|h|hpp)$/i.test(base)) {
		return FileCode2;
	}
	if (/\.(html?|xml|css|scss)$/i.test(base)) return FileCode2;
	// Markdown and everything else
	return FileText;
}
