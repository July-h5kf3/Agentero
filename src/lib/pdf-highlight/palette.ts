/** PDF annotation color palette (highlight fill + underline bar). */

export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "purple";

export const HIGHLIGHT_COLORS: HighlightColor[] = [
	"yellow",
	"green",
	"blue",
	"pink",
	"purple",
];

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "yellow";

/** Coerce an arbitrary stored color string to a known palette key. */
export function normalizeHighlightColor(
	color: string | undefined,
): HighlightColor {
	return HIGHLIGHT_COLORS.includes(color as HighlightColor)
		? (color as HighlightColor)
		: DEFAULT_HIGHLIGHT_COLOR;
}

// Static class maps (Tailwind cannot see dynamically built class names).
const FILL: Record<HighlightColor, string> = {
	yellow: "bg-amber-300/40 dark:bg-amber-400/30",
	green: "bg-green-300/40 dark:bg-green-400/30",
	blue: "bg-sky-300/40 dark:bg-sky-400/30",
	pink: "bg-pink-300/40 dark:bg-pink-400/30",
	purple: "bg-purple-300/40 dark:bg-purple-400/30",
};

const FILL_ACTIVE: Record<HighlightColor, string> = {
	yellow: "bg-amber-300/60 dark:bg-amber-400/45",
	green: "bg-green-300/60 dark:bg-green-400/45",
	blue: "bg-sky-300/60 dark:bg-sky-400/45",
	pink: "bg-pink-300/60 dark:bg-pink-400/45",
	purple: "bg-purple-300/60 dark:bg-purple-400/45",
};

const LINE: Record<HighlightColor, string> = {
	yellow: "bg-amber-500",
	green: "bg-green-500",
	blue: "bg-sky-500",
	pink: "bg-pink-500",
	purple: "bg-purple-500",
};

const SWATCH: Record<HighlightColor, string> = {
	yellow: "bg-amber-400",
	green: "bg-green-400",
	blue: "bg-sky-400",
	pink: "bg-pink-400",
	purple: "bg-purple-400",
};

/** Translucent fill class for a highlight band. */
export function highlightFillClass(
	color: string | undefined,
	active: boolean,
): string {
	const c = normalizeHighlightColor(color);
	return active ? FILL_ACTIVE[c] : FILL[c];
}

/** Solid bar class for an underline annotation. */
export function underlineColorClass(color: string | undefined): string {
	return LINE[normalizeHighlightColor(color)];
}

/** Solid dot class for the color picker swatch. */
export function swatchColorClass(color: HighlightColor): string {
	return SWATCH[color];
}
