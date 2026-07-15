/**
 * Catalog paper list/get helpers (SQLite via Host).
 */
import { invoke } from "@tauri-apps/api/core";
import type { PaperMetadata } from "@/lib/paper-metadata";
import { isTauri } from "@/lib/tauri";

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
