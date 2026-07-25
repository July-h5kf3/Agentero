/** Convert backslashes to forward slashes. */
export function normalizeSlashes(path: string): string {
	return path.replace(/\\/g, "/");
}

/** Forward slashes, no trailing slashes. */
export function normalizePath(path: string): string {
	return normalizeSlashes(path).replace(/\/+$/, "");
}

/** Forward slashes, no leading `./` or `/`, no trailing slashes. */
export function normalizeRelPath(path: string): string {
	return normalizePath(path).replace(/^\.?\//, "");
}

/** Last path segment, or the original string for a single segment. */
export function basenameOf(path: string): string {
	return normalizeSlashes(path).replace(/\/+$/, "").split("/").pop() ?? path;
}

/** Parent directory (forward slashes); empty when there is no parent. */
export function dirnameOf(path: string): string {
	const normalized = normalizeSlashes(path).replace(/\/+$/, "");
	const idx = normalized.lastIndexOf("/");
	return idx <= 0 ? "" : normalized.slice(0, idx);
}

/**
 * Join two path segments using the parent's separator style.
 * Falls back to forward slashes.
 */
export function joinPath(parent: string, name: string): string {
	if (!parent) return name;
	const sep = parent.includes("\\") ? "\\" : "/";
	return parent.endsWith(sep) ? `${parent}${name}` : `${parent}${sep}${name}`;
}

/** Strip vault root prefix when path is absolute. */
export function toVaultRelative(
	vaultPath: string | null,
	path: string,
): string {
	const n = normalizeRelPath(path);
	if (!vaultPath) {
		return n;
	}
	const root = normalizeRelPath(vaultPath);
	if (n === root) return "";
	if (n.startsWith(`${root}/`)) return n.slice(root.length + 1);
	return n;
}
