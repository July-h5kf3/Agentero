/**
 * Apple system color–inspired tag palette.
 * Stored as short ids in catalog tags_json when colored.
 */

export const TAG_COLOR_IDS = [
	"red",
	"orange",
	"yellow",
	"green",
	"teal",
	"blue",
	"indigo",
	"purple",
] as const;

export type TagColorId = (typeof TAG_COLOR_IDS)[number];

export type PaperTag = {
	name: string;
	/** Preset id; omit / null = default muted chip */
	color?: TagColorId | null;
};

/** Accept catalog / API payloads: bare string or `{ name, color? }`. */
export type PaperTagInput = string | PaperTag;

type TagColorTokens = {
	/** Solid swatch (picker + leading dot) */
	swatch: string;
	/** Chip background */
	bg: string;
	/** Chip text */
	fg: string;
};

/**
 * Apple system color–inspired tag palette.
 * Vibrant swatches, light tinted backgrounds, dark foregrounds for WCAG contrast.
 */
const TOKENS: Record<TagColorId, TagColorTokens> = {
	red: {
		swatch: "oklch(0.62 0.22 25)",
		bg: "oklch(0.88 0.06 25)",
		fg: "oklch(0.38 0.14 25)",
	},
	orange: {
		swatch: "oklch(0.72 0.17 55)",
		bg: "oklch(0.9 0.055 55)",
		fg: "oklch(0.4 0.12 55)",
	},
	yellow: {
		swatch: "oklch(0.78 0.14 85)",
		bg: "oklch(0.92 0.045 85)",
		fg: "oklch(0.42 0.1 85)",
	},
	green: {
		swatch: "oklch(0.65 0.17 145)",
		bg: "oklch(0.88 0.055 145)",
		fg: "oklch(0.33 0.11 145)",
	},
	teal: {
		swatch: "oklch(0.65 0.12 185)",
		bg: "oklch(0.89 0.045 185)",
		fg: "oklch(0.33 0.08 185)",
	},
	blue: {
		swatch: "oklch(0.62 0.18 250)",
		bg: "oklch(0.88 0.055 250)",
		fg: "oklch(0.35 0.12 250)",
	},
	indigo: {
		swatch: "oklch(0.55 0.18 285)",
		bg: "oklch(0.87 0.055 285)",
		fg: "oklch(0.33 0.12 285)",
	},
	purple: {
		swatch: "oklch(0.58 0.19 305)",
		bg: "oklch(0.87 0.06 305)",
		fg: "oklch(0.35 0.13 305)",
	},
};

export function isTagColorId(v: unknown): v is TagColorId {
	return (
		typeof v === "string" && (TAG_COLOR_IDS as readonly string[]).includes(v)
	);
}

export function tagColorTokens(
	id: TagColorId | null | undefined,
): TagColorTokens | null {
	if (!id || !isTagColorId(id)) return null;
	return TOKENS[id];
}

/** Chip inline style when a color is set; undefined = default muted classes. */
export function tagChipStyle(
	id: TagColorId | null | undefined,
): { backgroundColor: string; color: string } | undefined {
	const t = tagColorTokens(id);
	if (!t) return undefined;
	return { backgroundColor: t.bg, color: t.fg };
}

export function tagSwatchStyle(
	id: TagColorId | null | undefined,
): { backgroundColor: string } | undefined {
	const t = tagColorTokens(id);
	if (!t) return undefined;
	return { backgroundColor: t.swatch };
}

export function normalizePaperTag(raw: PaperTagInput): PaperTag | null {
	if (typeof raw === "string") {
		const name = raw.trim();
		return name ? { name } : null;
	}
	if (!raw || typeof raw !== "object") return null;
	const name = typeof raw.name === "string" ? raw.name.trim() : "";
	if (!name) return null;
	const color = isTagColorId(raw.color) ? raw.color : undefined;
	return color ? { name, color } : { name };
}

/** Dedupe by name (case-insensitive); first casing wins; later color fills if empty. */
export function normalizePaperTags(tags: readonly PaperTagInput[]): PaperTag[] {
	const out: PaperTag[] = [];
	for (const raw of tags) {
		const t = normalizePaperTag(raw);
		if (!t) continue;
		const existing = out.find(
			(x) => x.name.toLocaleLowerCase() === t.name.toLocaleLowerCase(),
		);
		if (existing) {
			if (!existing.color && t.color) existing.color = t.color;
			continue;
		}
		out.push({ ...t });
	}
	return out;
}

export function tagName(t: PaperTagInput): string {
	return typeof t === "string" ? t : t.name;
}

export function tagColorOf(t: PaperTagInput): TagColorId | undefined {
	if (typeof t === "string") return undefined;
	return isTagColorId(t.color) ? t.color : undefined;
}

/** Coerce API/catalog tags (string[] or mixed) into PaperTag[]. */
export function coercePaperTags(tags: unknown): PaperTag[] {
	if (!Array.isArray(tags)) return [];
	return normalizePaperTags(tags as PaperTagInput[]);
}
