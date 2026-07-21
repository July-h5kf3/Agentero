import tweakcnThemes from "@/themes/tweakcn.json";

/**
 * Bundled tweakcn UI theme presets (colors + radius only; fonts/shadows are
 * intentionally excluded so the packaged Geist font stays intact).
 * Refresh with `node scripts/fetch-tweakcn-themes.mjs`.
 */
export type UiThemeDef = {
	name: string;
	title: string;
	light: Record<string, string>;
	dark: Record<string, string>;
};

export const UI_THEMES = tweakcnThemes as UiThemeDef[];

/** Built-in look from index.css — no variable overrides injected. */
export const DEFAULT_UI_THEME = "default";

export function isKnownUiTheme(name: unknown): name is string {
	return (
		name === DEFAULT_UI_THEME ||
		(typeof name === "string" && UI_THEMES.some((t) => t.name === name))
	);
}

const STYLE_ID = "agentero-ui-theme";

function toCssBlock(selector: string, vars: Record<string, string>): string {
	const body = Object.entries(vars)
		.map(([k, v]) => `\t--${k}: ${v};`)
		.join("\n");
	return `${selector} {\n${body}\n}`;
}

/**
 * Override index.css variables by appending a <style> at the end of <head>
 * (same specificity, later order wins). `default`/unknown removes the override.
 */
export function applyUiTheme(name: string): void {
	if (typeof document === "undefined") return;
	const theme = UI_THEMES.find((t) => t.name === name);
	const existing = document.getElementById(STYLE_ID);
	if (!theme) {
		existing?.remove();
		return;
	}
	const el =
		(existing as HTMLStyleElement | null) ?? document.createElement("style");
	el.id = STYLE_ID;
	el.textContent = `${toCssBlock(":root", theme.light)}\n${toCssBlock(".dark", theme.dark)}`;
	// Re-append so it stays after any stylesheet Vite injects later (dev HMR).
	document.head.appendChild(el);
}
