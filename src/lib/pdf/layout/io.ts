import type { PdfLayoutKind, PdfLayoutRegion } from "@/lib/pdf/layout/types";
import { joinVaultPath, readVaultFile, writeVaultFile } from "@/lib/vault";

export const LAYOUT_SIDECAR_SCHEMA_VERSION = 1;
export const LAYOUT_SIDECAR_FILE = "layout.json";

export type PdfLayoutSidecar = {
	schemaVersion: number;
	source: {
		mode: "embedpdf-layout";
		generatedAt: string;
	};
	/** Raw text-enriched model regions, before caption/formula merge. */
	regions: PdfLayoutRegion[];
};

const LAYOUT_KINDS = new Set<PdfLayoutKind>([
	"image",
	"table",
	"algorithm",
	"formula",
	"formula_number",
	"chart",
	"figure_title",
	"header",
	"text",
]);

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function parseRect(value: unknown): PdfLayoutRegion["rect"] | null {
	if (!isObject(value)) return null;
	const { x, y, w, h } = value;
	if (
		!isFiniteNumber(x) ||
		!isFiniteNumber(y) ||
		!isFiniteNumber(w) ||
		!isFiniteNumber(h)
	) {
		return null;
	}
	return { x, y, w, h };
}

function parseRegion(value: unknown): PdfLayoutRegion | null {
	if (!isObject(value)) return null;
	const { id, pageIndex, kind, label, score, readingOrder, rect, bbox } = value;
	if (
		typeof id !== "string" ||
		!isFiniteNumber(pageIndex) ||
		typeof kind !== "string" ||
		!LAYOUT_KINDS.has(kind as PdfLayoutKind) ||
		typeof label !== "string" ||
		!isFiniteNumber(score) ||
		!isFiniteNumber(readingOrder)
	) {
		return null;
	}
	const parsedRect = parseRect(rect);
	const parsedBbox = parseRect(bbox);
	if (!parsedRect || !parsedBbox) return null;
	const out: PdfLayoutRegion = {
		id,
		pageIndex,
		kind: kind as PdfLayoutKind,
		label,
		score,
		readingOrder,
		rect: parsedRect,
		bbox: parsedBbox,
	};
	if (typeof value.title === "string") out.title = value.title;
	const titleBbox = parseRect(value.titleBbox);
	if (titleBbox) out.titleBbox = titleBbox;
	if (
		value.captionRole === "figure_main" ||
		value.captionRole === "table_main" ||
		value.captionRole === "algorithm_main" ||
		value.captionRole === "subpanel" ||
		value.captionRole === "other"
	) {
		out.captionRole = value.captionRole;
	}
	return out;
}

export function layoutSidecarPath(paperAbsPath: string): string {
	return joinVaultPath(
		joinVaultPath(paperAbsPath, "source"),
		LAYOUT_SIDECAR_FILE,
	);
}

export function parseLayoutSidecar(raw: unknown): PdfLayoutSidecar | null {
	if (!isObject(raw)) return null;
	if (raw.schemaVersion !== LAYOUT_SIDECAR_SCHEMA_VERSION) return null;
	if (!isObject(raw.source) || raw.source.mode !== "embedpdf-layout") {
		return null;
	}
	if (typeof raw.source.generatedAt !== "string") return null;
	if (!Array.isArray(raw.regions)) return null;
	const regions = raw.regions.map(parseRegion);
	if (regions.some((r) => !r)) return null;
	return {
		schemaVersion: LAYOUT_SIDECAR_SCHEMA_VERSION,
		source: {
			mode: "embedpdf-layout",
			generatedAt: raw.source.generatedAt,
		},
		regions: regions as PdfLayoutRegion[],
	};
}

export async function readLayoutSidecar(
	paperAbsPath: string | null | undefined,
): Promise<PdfLayoutSidecar | null> {
	if (!paperAbsPath) return null;
	try {
		const text = await readVaultFile(layoutSidecarPath(paperAbsPath));
		return parseLayoutSidecar(JSON.parse(text));
	} catch {
		return null;
	}
}

export async function writeLayoutSidecar(
	paperAbsPath: string | null | undefined,
	regions: PdfLayoutRegion[],
): Promise<void> {
	if (!paperAbsPath) return;
	const sidecar: PdfLayoutSidecar = {
		schemaVersion: LAYOUT_SIDECAR_SCHEMA_VERSION,
		source: {
			mode: "embedpdf-layout",
			generatedAt: new Date().toISOString(),
		},
		regions,
	};
	await writeVaultFile(
		layoutSidecarPath(paperAbsPath),
		`${JSON.stringify(sidecar, null, 2)}\n`,
	);
}
