/** True when running inside a Tauri webview (not plain browser). */
export function isTauri(): boolean {
	return (
		typeof window !== "undefined" &&
		("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
	);
}

/**
 * Best-effort desktop OS detection from the webview UA.
 * Mirrors the platform checks in `shortcuts.ts` / `reveal.ts`.
 */
export function getPlatformOS(): "macos" | "windows" | "linux" | "other" {
	if (typeof navigator === "undefined") return "other";
	const platform = navigator.platform ?? "";
	const ua = navigator.userAgent ?? "";
	if (/Mac|iPhone|iPad|iPod/.test(platform)) return "macos";
	if (/Win/.test(platform) || /Windows/.test(ua)) return "windows";
	if (/Linux|X11/.test(platform)) return "linux";
	return "other";
}

/**
 * macOS keeps native traffic lights via the Overlay title bar; other desktop
 * platforms use a frameless window with custom caption buttons.
 */
export function isMacOS(): boolean {
	return getPlatformOS() === "macos";
}
