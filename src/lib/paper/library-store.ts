/**
 * Papers library state (zustand vanilla): catalog rows, search query, folder
 * scope, and import/export busy flags. Query keystrokes now only re-render
 * library subscribers instead of the whole App.
 */

import { createStore } from "zustand/vanilla";
import { isTauri } from "@/lib/core/tauri";
import type { PaperMetadata } from "@/lib/paper";
import {
	isLibraryVirtualPath,
	isTrashVirtualPath,
	listPapers,
} from "@/lib/paper/api";
import type { LocalPdfImportEntry } from "@/lib/paper/lookup";
import { getVaultPath } from "@/lib/vault/store";

export type LibraryIoBusy = "import" | "export" | "import-pdf" | null;

export type ImportPdfDraft = {
	items: Array<{ path: string; sourceName: string }>;
	parentDir: string;
};

export type { LocalPdfImportEntry };

type LibraryStore = {
	papers: PaperMetadata[];
	loading: boolean;
	/** Title search query for the papers library view. */
	query: string;
	/**
	 * Vault-relative folder filter for the single Library tab. Null = full
	 * library. Set by clicking org folders in the tree — no new tabs.
	 */
	scopePath: string | null;
	rescanning: boolean;
	ioBusy: LibraryIoBusy;
	/** Paths queued for the "move to folder" dialog (null = closed). */
	movePaths: string[] | null;
	/** OS PDF drop onto papers/ → metadata confirm dialog (not silent import). */
	importPdfDraft: ImportPdfDraft | null;
	/** Bump to force RecycleBinView reload after Empty Recycle Bin. */
	trashReloadSignal: number;
	/** Catalog rows by vault-relative path (for Zap / is_read). */
	paperMetaByRelPath: Map<string, PaperMetadata>;
};

function indexByRelPath(papers: PaperMetadata[]): Map<string, PaperMetadata> {
	const map = new Map<string, PaperMetadata>();
	for (const p of papers) {
		if (!p.path) continue;
		map.set(p.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""), p);
	}
	return map;
}

export const libraryStore = createStore<LibraryStore>(() => ({
	papers: [],
	loading: false,
	query: "",
	scopePath: null,
	rescanning: false,
	ioBusy: null,
	movePaths: null,
	importPdfDraft: null,
	trashReloadSignal: 0,
	paperMetaByRelPath: new Map(),
}));

export function setLibraryPapers(
	next: PaperMetadata[] | ((previous: PaperMetadata[]) => PaperMetadata[]),
): void {
	const papers =
		typeof next === "function" ? next(libraryStore.getState().papers) : next;
	libraryStore.setState({ papers, paperMetaByRelPath: indexByRelPath(papers) });
}

export function setLibraryQuery(query: string): void {
	libraryStore.setState({ query });
}

export function setLibraryScopePath(
	next: string | null | ((previous: string | null) => string | null),
): void {
	if (typeof next === "function") {
		libraryStore.setState((s) => ({ scopePath: next(s.scopePath) }));
		return;
	}
	libraryStore.setState({ scopePath: next });
}

export function setLibraryRescanning(rescanning: boolean): void {
	libraryStore.setState({ rescanning });
}

export function setLibraryIoBusy(ioBusy: LibraryIoBusy): void {
	libraryStore.setState({ ioBusy });
}

export function setMovePaths(paths: string[] | null): void {
	libraryStore.setState({ movePaths: paths });
}

/** Open the "move to folder" dialog for the given (non-virtual) paths. */
export function requestMovePaths(paths: string[]): void {
	const valid = paths.filter(
		(p) => !isLibraryVirtualPath(p) && !isTrashVirtualPath(p),
	);
	if (valid.length === 0) return;
	setMovePaths(valid);
}

export function setImportPdfDraft(draft: ImportPdfDraft | null): void {
	libraryStore.setState({ importPdfDraft: draft });
}

export function bumpTrashReloadSignal(): void {
	libraryStore.setState((s) => ({
		trashReloadSignal: s.trashReloadSignal + 1,
	}));
}

export async function refreshLibrary(): Promise<void> {
	const vaultPath = getVaultPath();
	if (!vaultPath || !isTauri()) {
		setLibraryPapers([]);
		return;
	}
	libraryStore.setState({ loading: true });
	try {
		setLibraryPapers(await listPapers(vaultPath));
	} catch {
		setLibraryPapers([]);
	} finally {
		libraryStore.setState({ loading: false });
	}
}
