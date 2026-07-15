/**
 * Catalog paper list/get helpers (SQLite via Host).
 * Import/export go through Translator `/import` and `/export` (Zotero JSON).
 */
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import i18n from "@/i18n";
import type { PaperMetadata } from "@/lib/paper-metadata";
import { type AppSettings, DEFAULT_TRANSLATOR_BASE_URL } from "@/lib/settings";
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

export type PaperExportResult = {
	format: string;
	content: string;
	count: number;
	filename: string;
};

export type PaperImportResult = {
	imported: number;
	skipped: number;
	paths: string[];
	titles: string[];
	errors: string[];
};

function translatorBase(settings?: AppSettings): string {
	const raw =
		settings?.translatorBaseUrl?.trim() || DEFAULT_TRANSLATOR_BASE_URL;
	return raw.replace(/\/+$/, "");
}

/**
 * Export catalog via Host → Translator `POST /export`.
 * Host converts catalog rows to a **Zotero API JSON array** (required body shape).
 */
export async function exportLibrary(opts: {
	vaultPath: string;
	settings?: AppSettings;
	/** Default bibtex */
	format?: string;
}): Promise<PaperExportResult> {
	if (!isTauri()) {
		throw new Error(i18n.t("sidebar:papersLibrary.desktopOnly"));
	}
	const res = await invoke<ApiResult<PaperExportResult>>("paper_export", {
		args: {
			vaultPath: opts.vaultPath,
			format: opts.format ?? "bibtex",
			translatorBaseUrl: translatorBase(opts.settings),
		},
	});
	if (!res.ok || !res.data) {
		throw new Error(
			res.error?.message ?? i18n.t("sidebar:papersLibrary.exportFailed"),
		);
	}
	return res.data;
}

/**
 * Save-dialog wrapper: export library then write file.
 * Returns null if user cancels the save dialog.
 */
export async function exportLibraryToFile(opts: {
	vaultPath: string;
	settings?: AppSettings;
	format?: string;
}): Promise<PaperExportResult | null> {
	const data = await exportLibrary(opts);
	const path = await save({
		defaultPath: data.filename,
		filters: [
			{
				name: data.format,
				extensions: [data.filename.split(".").pop() || "bib"],
			},
		],
	});
	if (!path) return null;
	await writeTextFile(path, data.content);
	return data;
}

/**
 * Import BibTeX/RIS via Translator `POST /import` → catalog + paper folders.
 */
export async function importLibraryText(opts: {
	vaultPath: string;
	content: string;
	parentDir?: string;
	settings?: AppSettings;
}): Promise<PaperImportResult> {
	if (!isTauri()) {
		throw new Error(i18n.t("sidebar:papersLibrary.desktopOnly"));
	}
	const res = await invoke<ApiResult<PaperImportResult>>("paper_import", {
		args: {
			vaultPath: opts.vaultPath,
			parentDir: opts.parentDir ?? "papers",
			content: opts.content,
			translatorBaseUrl: translatorBase(opts.settings),
		},
	});
	if (!res.ok || !res.data) {
		throw new Error(
			res.error?.message ?? i18n.t("sidebar:papersLibrary.importFailed"),
		);
	}
	return res.data;
}

/**
 * Open-dialog wrapper: pick .bib/.ris/… then import.
 * Returns null if user cancels.
 */
export async function importLibraryFromFile(opts: {
	vaultPath: string;
	parentDir?: string;
	settings?: AppSettings;
}): Promise<PaperImportResult | null> {
	const selected = await open({
		multiple: false,
		filters: [
			{
				name: "Bibliography",
				extensions: ["bib", "ris", "enw", "xml", "json", "txt"],
			},
		],
	});
	if (!selected) return null;
	const path = Array.isArray(selected) ? selected[0] : selected;
	if (!path) return null;
	const content = await readTextFile(path);
	return importLibraryText({
		vaultPath: opts.vaultPath,
		content,
		parentDir: opts.parentDir,
		settings: opts.settings,
	});
}
