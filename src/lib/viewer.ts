export type CenterViewMode = "markdown" | "pdf" | "html";

export function isPdfPath(path: string): boolean {
	return /\.pdf$/i.test(path);
}

export function isHtmlPath(path: string): boolean {
	return /\.html?$/i.test(path);
}

export function preferredModeForPath(path: string | null): CenterViewMode {
	if (!path) return "markdown";
	if (isPdfPath(path)) return "pdf";
	if (isHtmlPath(path)) return "html";
	return "markdown";
}
