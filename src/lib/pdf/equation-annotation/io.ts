import { isTauri } from "@/lib/core/tauri";
import {
	type EquationSymbol,
	parseAnnotationMd,
} from "@/lib/pdf/equation-annotation/parse";
import { joinVaultPath, readVaultFile, vaultPathExists } from "@/lib/vault";

/** Fixed filename written by the equation-annotation skill. */
export const ANNOTATION_MD_FILE = "Annotation.md";

/** Absolute path to `{paper}/Annotation.md`. */
export function equationAnnotationPath(paperAbsPath: string): string {
	return joinVaultPath(paperAbsPath.replace(/[\\/]+$/, ""), ANNOTATION_MD_FILE);
}

/**
 * Load and parse `{paper}/Annotation.md` when present.
 * Missing file / read errors → empty list (no throw).
 */
export async function loadEquationAnnotation(
	paperAbsPath: string | null | undefined,
): Promise<EquationSymbol[]> {
	if (!paperAbsPath?.trim() || !isTauri()) return [];
	const path = equationAnnotationPath(paperAbsPath);
	try {
		if (!(await vaultPathExists(path))) return [];
		const raw = await readVaultFile(path);
		return parseAnnotationMd(raw);
	} catch {
		return [];
	}
}
