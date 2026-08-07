/**
 * Unified on-disk layout for PDF selection marks:
 *
 *   papers/<id>/marks/<id>.json          # kind: ask | highlight | translate | visual
 *   papers/<id>/marks/annotations.json   # EmbedPDF highlight/批注 transfer blob
 *
 * Per-mark files are pretty JSON with required `kind`.
 * Legacy visual marks used kind `agent-trace` (still readable).
 * `annotations.json` is the aggregate EmbedPDF annotation store (not a mark).
 */
import { readDir } from "@tauri-apps/plugin-fs";

import { isTauri } from "@/lib/core/tauri";
import {
	joinVaultPath,
	readVaultFile,
	removeVaultPath,
	writeVaultFile,
} from "@/lib/vault";

export const MARKS_FOLDER = "marks";

/** Aggregate EmbedPDF annotations file name under `marks/` (not a per-id mark). */
export const ANNOTATIONS_JSON = "annotations.json";

export type PdfMarkKind =
	| "ask"
	| "highlight"
	| "translate"
	| "visual"
	| "agent-trace";

export function marksDir(paperAbsPath: string): string {
	return joinVaultPath(paperAbsPath, MARKS_FOLDER);
}

export function markPath(paperAbsPath: string, id: string): string {
	return joinVaultPath(marksDir(paperAbsPath), `${id}.json`);
}

/** Read + JSON.parse every per-id `*.json` under `marks/` (skip aggregate + corrupt). */
export async function listMarkRaw(paperAbsPath: string): Promise<unknown[]> {
	if (!paperAbsPath || !isTauri()) return [];
	const dir = marksDir(paperAbsPath);
	let names: string[] = [];
	try {
		const entries = await readDir(dir);
		names = entries
			.map((e) => e.name)
			.filter(
				(n): n is string =>
					Boolean(n?.endsWith(".json")) && n !== ANNOTATIONS_JSON,
			);
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
		await removeVaultPath(markPath(paperAbsPath, id));
	} catch {
		// missing is fine
	}
}
