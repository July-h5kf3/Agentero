/** True when running inside a Tauri webview (not plain browser). */
export function isTauri(): boolean {
	return (
		typeof window !== "undefined" &&
		("__TAURI_INTERNALS__" in window || "__TAURI__" in window)
	);
}
