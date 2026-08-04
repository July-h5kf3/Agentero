/**
 * HTML `accept` attribute matching for File inputs and drag/drop.
 * Supports MIME types, `type/*` wildcards, and `.ext` extensions.
 */

const IMAGE_EXT_RE =
	/\.(png|jpe?g|webp|gif|bmp|heic|heif|avif|svg|ico|tif|tiff)$/i;

/** True when the basename has a known image extension. */
export function hasImageExtension(name: string): boolean {
	return IMAGE_EXT_RE.test(name.trim());
}

/**
 * Match a File against an HTML `accept` attribute value (comma-separated
 * MIME types, `type/*` wildcards, and/or `.ext` extensions).
 */
export function fileMatchesAccept(
	file: File,
	accept: string | undefined,
): boolean {
	if (!accept?.trim()) return true;
	const patterns = accept
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	if (patterns.length === 0) return true;

	const type = (file.type || "").trim().toLowerCase();
	const name = (file.name || "").trim().toLowerCase();
	const dot = name.lastIndexOf(".");
	const ext = dot >= 0 ? name.slice(dot) : "";

	return patterns.some((pattern) => {
		if (pattern.startsWith(".")) {
			return ext === pattern;
		}
		if (pattern.endsWith("/*")) {
			const prefix = pattern.slice(0, -1); // e.g. "image/"
			if (type.startsWith(prefix)) return true;
			// Empty MIME + image/* → allow known image extensions
			if (!type && prefix === "image/" && IMAGE_EXT_RE.test(name)) return true;
			return false;
		}
		if (type && type === pattern) return true;
		// MIME listed but File.type empty: map common image types via extension
		if (!type && pattern.startsWith("image/") && IMAGE_EXT_RE.test(name)) {
			return true;
		}
		return false;
	});
}

function basenameFromPathOrUrl(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return "";
	let path = trimmed;
	if (/^file:/i.test(path)) {
		try {
			path = decodeURIComponent(new URL(path).pathname);
		} catch {
			path = path.replace(/^file:\/\//i, "");
		}
	}
	const parts = path.replace(/\\/g, "/").split("/");
	return parts.at(-1) || "";
}

/** Collect best-effort file names available during drag (before drop). */
export function fileNamesFromDataTransfer(
	dt: DataTransfer | null | undefined,
): string[] {
	if (!dt) return [];
	const names: string[] = [];
	const push = (name: string) => {
		const n = name.trim();
		if (n) names.push(n);
	};

	try {
		for (const file of dt.files ?? []) {
			if (file?.name) push(file.name);
		}
	} catch {
		// ignore
	}

	try {
		const items = dt.items;
		if (items) {
			for (const item of items) {
				if (item.kind !== "file") continue;
				const file = item.getAsFile?.();
				if (file?.name) push(file.name);
			}
		}
	} catch {
		// ignore
	}

	// Some desktop webviews expose paths mid-drag (others only on drop).
	for (const type of ["text/uri-list", "text/plain"] as const) {
		try {
			if (![...dt.types].includes(type)) continue;
			const text = dt.getData(type);
			if (!text) continue;
			for (const line of text.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith("#")) continue;
				// Prefer path-like lines; skip prose.
				if (
					!trimmed.includes("/") &&
					!trimmed.includes("\\") &&
					!/^file:/i.test(trimmed)
				) {
					continue;
				}
				const base = basenameFromPathOrUrl(trimmed);
				if (base) push(base);
			}
		} catch {
			// getData may throw mid-drag on some platforms
		}
	}

	return names;
}

/**
 * Best-effort check while a drag is in progress (before drop).
 *
 * Prefer **no false positives**: when MIME/names prove non-image (PDF, .md, …)
 * return false. When everything is unknown (empty MIME + no names — common on
 * some macOS image drags), return false so arbitrary files do not flash the
 * "drop image" overlay; image drops still work without the highlight.
 */
export function dataTransferLooksLikeImages(
	dt: DataTransfer | null | undefined,
): boolean {
	if (!dt?.types) return false;
	const hasFiles = [...dt.types].some(
		(t) => t === "Files" || t === "application/x-moz-file",
	);
	if (!hasFiles) return false;

	let sawImage = false;
	let sawNonImage = false;

	const items = dt.items;
	if (items?.length) {
		for (const item of items) {
			if (item.kind !== "file") continue;
			const type = (item.type || "").trim().toLowerCase();
			if (!type) continue;
			if (type.startsWith("image/")) {
				sawImage = true;
			} else {
				sawNonImage = true;
			}
		}
	}

	const names = fileNamesFromDataTransfer(dt);
	for (const name of names) {
		if (hasImageExtension(name)) {
			sawImage = true;
		} else if (/\.[a-z0-9]+$/i.test(name)) {
			// Has a non-image extension (.md, .pdf, .txt, …)
			sawNonImage = true;
		}
	}

	if (sawImage) return true;
	if (sawNonImage) return false;
	// Unknown payload (no MIME, no names) — do not show image drop chrome.
	return false;
}
