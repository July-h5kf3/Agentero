/**
 * One-click Zotero migration: read a local Zotero data directory (zotero.sqlite
 * + storage/) via the Host and write papers into the catalog. Fully local.
 */
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { isTauri } from "@/lib/tauri";

type ApiResult<T> = {
	ok: boolean;
	data?: T;
	error?: { code: string; message: string };
};

export type ZoteroCollectionInfo = {
	id: number;
	path: string;
	itemCount: number;
};

export type ZoteroScan = {
	valid: boolean;
	itemCount: number;
	withPdfCount: number;
	noteCount: number;
	collections: ZoteroCollectionInfo[];
	warning?: string;
};

export type ZoteroMigrateResult = {
	imported: number;
	skipped: number;
	copiedPdfs: number;
	paths: string[];
	errors: string[];
};

/** Folder picker for the Zotero data directory. Returns null when cancelled. */
export async function pickZoteroDir(): Promise<string | null> {
	const selected = await open({ directory: true, multiple: false });
	if (!selected) return null;
	return Array.isArray(selected) ? (selected[0] ?? null) : selected;
}

/** Read-only preview: how many references, and how many have a local PDF. */
export async function scanZotero(zoteroDir: string): Promise<ZoteroScan> {
	if (!isTauri()) {
		throw new Error(i18n.t("sidebar:zoteroMigrate.desktopOnly"));
	}
	const res = await invoke<ApiResult<ZoteroScan>>("zotero_scan", {
		args: { zoteroDir },
	});
	if (!res.ok || !res.data) {
		throw new Error(res.error?.message ?? "zotero_scan failed");
	}
	return res.data;
}

/** Migrate the Zotero library into `parentDir` + catalog; optionally copy PDFs. */
export async function migrateZotero(opts: {
	vaultPath: string;
	zoteroDir: string;
	parentDir?: string;
	copyPdfs: boolean;
	preserveCollections: boolean;
	migrateNotes: boolean;
	includeCollections?: number[];
}): Promise<ZoteroMigrateResult> {
	if (!isTauri()) {
		throw new Error(i18n.t("sidebar:zoteroMigrate.desktopOnly"));
	}
	const res = await invoke<ApiResult<ZoteroMigrateResult>>("zotero_migrate", {
		args: {
			vaultPath: opts.vaultPath,
			zoteroDir: opts.zoteroDir,
			parentDir: opts.parentDir ?? "papers",
			copyPdfs: opts.copyPdfs,
			preserveCollections: opts.preserveCollections,
			migrateNotes: opts.migrateNotes,
			includeCollections: opts.includeCollections ?? null,
		},
	});
	if (!res.ok || !res.data) {
		throw new Error(res.error?.message ?? "zotero_migrate failed");
	}
	return res.data;
}
