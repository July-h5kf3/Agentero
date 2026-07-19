/**
 * Unified on-disk layout for PDF selection marks:
 *
 *   papers/<id>/marks/<id>.json
 *
 * Pretty JSON with required `kind`: "ask" | "highlight" | "translate".
 */
import { readDir } from "@tauri-apps/plugin-fs";

import { isTauri } from "@/lib/tauri";
import { joinVaultPath, readVaultFile, writeVaultFile } from "@/lib/vault";

export const MARKS_FOLDER = "marks";

export type PdfMarkKind = "ask" | "highlight" | "translate";

export function marksDir(paperAbsPath: string): string {
	return joinVaultPath(paperAbsPath, MARKS_FOLDER);
}

export function markPath(paperAbsPath: string, id: string): string {
	return joinVaultPath(marksDir(paperAbsPath), `${id}.json`);
}

/** Read + JSON.parse every `*.json` under `marks/` (skip corrupt). */
export async function listMarkRaw(paperAbsPath: string): Promise<unknown[]> {
	if (!paperAbsPath || !isTauri()) return [];
	const dir = marksDir(paperAbsPath);
	let names: string[] = [];
	try {
		const entries = await readDir(dir);
		names = entries
			.map((e) => e.name)
			.filter((n): n is string => Boolean(n?.endsWith(".json")));
	} catch {
		return [];
	}
	const out: unknown[] = [];
	for (const name of names) {
		try {
			const raw = await readVaultFile(joinVaultPath(dir, name));
			out.push(JSON.parse(raw) as unknown);
		} catch {
			// skip
		}
	}
	return out;
}

export async function readMarkRaw(
	paperAbsPath: string,
	id: string,
): Promise<unknown | null> {
	if (!paperAbsPath || !id || !isTauri()) return null;
	try {
		const raw = await readVaultFile(markPath(paperAbsPath, id));
		return JSON.parse(raw) as unknown;
	} catch {
		return null;
	}
}

export async function writeMarkFile(
	paperAbsPath: string,
	id: string,
	payload: unknown,
): Promise<void> {
	await writeVaultFile(
		markPath(paperAbsPath, id),
		`${JSON.stringify(payload, null, 2)}\n`,
	);
}

export async function deleteMarkFile(
	paperAbsPath: string,
	id: string,
): Promise<void> {
	if (!isTauri() || !paperAbsPath || !id) return;
	try {
		const { remove } = await import("@tauri-apps/plugin-fs");
		await remove(markPath(paperAbsPath, id));
	} catch {
		// missing is fine
	}
}
