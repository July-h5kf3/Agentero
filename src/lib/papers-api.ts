/**
 * Catalog paper list/get helpers (SQLite via Host).
 */
import { invoke } from "@tauri-apps/api/core";
import type { PaperMetadata } from "@/lib/paper-metadata";
import { isTauri } from "@/lib/tauri";

/**
 * Virtual file-tree path for the papers library table.
 * Not a real filesystem path — never passed to Host fs APIs.
 */
export const LIBRARY_VIRTUAL_PATH = "motif:library";

export function isLibraryVirtualPath(path: string | null | undefined): boolean {
	return path === LIBRARY_VIRTUAL_PATH;
}

type ApiResult<T> = {
	ok: boolean;
	data?: T;
	error?: { code: string; message: string };
};

export async function listPapers(vaultPath: string): Promise<PaperMetadata[]> {
	if (!isTauri()) return [];
	const res = await invoke<ApiResult<PaperMetadata[]>>("paper_list", {
		args: { vaultPath },
	});
	if (!res.ok || !res.data) {
		throw new Error(res.error?.message ?? "paper_list failed");
	}
	return res.data;
}
