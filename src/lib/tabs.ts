import i18n from "@/i18n";
import { runBackgroundTask } from "@/lib/background-tasks";
import { downloadPaperAssets } from "@/lib/lookup";
import {
	canAttemptPdfDownload,
	detectPaperDirectory,
	findLocalPdfPath,
	isPaperDirectory,
	loadPaperMetadata,
	localFileToArrayBuffer,
	localImageToViewerSource,
	notesPathForPaper,
	type PaperMetadata,
	paperDirFromPath,
	paperHasLocalPaperMd,
	paperHasLocalPdf,
	paperHasLocalTex,
	paperRemoteAssetsFromMetadata,
	revokePdfViewerSource,
} from "@/lib/paper-metadata";
import {
	isLibraryVirtualPath,
	isTrashVirtualPath,
	LIBRARY_VIRTUAL_PATH,
	TRASH_VIRTUAL_PATH,
} from "@/lib/papers-api";
import { isTauri } from "@/lib/tauri";
import {
	ensureLocalFsScope,
	type FileNode,
	isTextOpenable,
	readVaultFile,
} from "@/lib/vault";
import {
	type CenterViewMode,
	imageMimeFromPath,
	isHtmlPath,
	isImagePath,
	isPdfPath,
	preferredModeForPath,
} from "@/lib/viewer";
import { toVaultRelative } from "@/lib/wiki";

export type DocTabKind = "library" | "trash" | "paper" | "file";

/**
 * One open document panel in the center Dockview workspace.
 * All open documents are peers — layout/split is owned by dockview, not by nesting.
 */
export type DocTab = {
	/** Stable id derived from the normalized path (dedupe). */
	id: string;
	/** Absolute path, or the Library virtual path. */
	path: string;
	kind: DocTabKind;
	title: string;
	/** View mode for this panel (set at open; no in-pane PDF/HTML toggle). */
	mode: CenterViewMode;
	paperMeta: PaperMetadata | null;
	pdfUrl: string | null;
	/** Local PDF bytes fed straight to the engine (avoids fragile `blob:` fetch). */
	pdfBytes: ArrayBuffer | null;
	htmlUrl: string | null;
	/** Local image preview (`blob:`) when mode is image. */
	imageUrl: string | null;
	notesPath: string | null;
	/** Seed content for the NOTES editor (live content lives inside the editor). */
	notesSeed: string;
	/** Seed content for a plain-file Markdown editor. */
	markdownSeed: string;
	markdownDirty: boolean;
	notesDirty: boolean;
	/** Bump to remount + reseed the center Markdown editor. */
	seedKey: number;
	/** Bump to remount + reseed the NOTES editor. */
	notesKey: number;
	loaded: boolean;
};

/**
 * Dockview placement direction.
 * - left/right/above/below → new group (split)
 * - within → same group as a sibling tab
 */
export type SplitDirection = "left" | "right" | "above" | "below" | "within";

/**
 * How a newly opened panel should be placed in dockview.
 * `null` = let dockview activate existing / add to active group (default open).
 */
export type OpenPlacement = {
	direction: SplitDirection;
	/** Existing panel id to place relative to; null = active panel. */
	referencePanelId: string | null;
} | null;

const NOTES_PLACEHOLDER = "# Notes\n\nNo NOTES.md found for this paper.\n";

/** Normalize a path for id / equality (case-insensitive, no trailing slash). */
export function normalizeTabPath(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function tabIdForPath(path: string): string {
	if (isLibraryVirtualPath(path)) return LIBRARY_VIRTUAL_PATH;
	if (isTrashVirtualPath(path)) return TRASH_VIRTUAL_PATH;
	return normalizeTabPath(path);
}

export function basenameOf(path: string): string {
	return (
		path
			.replace(/[\\/]+$/, "")
			.split(/[\\/]/)
			.pop() ?? path
	);
}

function findNode(nodes: FileNode[], path: string): FileNode | undefined {
	const key = normalizeTabPath(path);
	const walk = (list: FileNode[]): FileNode | undefined => {
		for (const n of list) {
			if (normalizeTabPath(n.path) === key) return n;
			if (n.children?.length) {
				const hit = walk(n.children);
				if (hit) return hit;
			}
		}
		return undefined;
	};
	return walk(nodes);
}

function findChildren(nodes: FileNode[], path: string): FileNode[] | undefined {
	return findNode(nodes, path)?.children;
}

/** Fields loadTabResources fills in on top of a placeholder tab. */
export type TabResources = {
	kind: DocTabKind;
	title: string;
	mode: CenterViewMode;
	paperMeta: PaperMetadata | null;
	pdfUrl: string | null;
	pdfBytes?: ArrayBuffer | null;
	htmlUrl: string | null;
	imageUrl: string | null;
	notesPath: string | null;
	notesSeed: string;
	markdownSeed: string;
	loaded: true;
	/** Non-fatal message to surface (e.g. unpreviewable file). */
	error?: string;
	/** True when this load triggered `paper_download_assets` (tree may need refresh). */
	didDownloadAssets?: boolean;
};

/** Session-scoped: vault-rel paper paths already auto-downloaded for preview. */
const pdfAutoDownloadTried = new Set<string>();

/** Session-scoped: vault-rel paper paths already triggered for deferred body resolve. */
const paperParseTried = new Set<string>();

function maybeTriggerDeferredParse(
	paperDir: string,
	vaultPath: string | null,
	treeNode: FileNode | undefined,
): void {
	if (!isTauri() || !vaultPath || !treeNode) return;
	if (
		!paperHasLocalPdf(treeNode) ||
		paperHasLocalTex(treeNode) ||
		paperHasLocalPaperMd(treeNode)
	) {
		return;
	}
	const rel = toVaultRelative(vaultPath, paperDir)
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
	if (!rel || paperParseTried.has(rel)) return;
	paperParseTried.add(rel);

	void runBackgroundTask(
		{
			kind: "download",
			title: i18n.t("app:tasks.downloadPaper"),
			detail: rel,
		},
		async ({ id }) => {
			await downloadPaperAssets({
				vaultRoot: vaultPath,
				paperPath: rel,
				progressTaskId: id,
			});
		},
	).catch(() => {});
}

/**
 * PDF for a paper tab: local file (blob:) → auto-download if missing → remote pdf_url.
 * Avoids Tauri asset:// which PDF.js cannot XHR ("Unexpected server response (0)").
 */
async function resolvePaperPdfSource(
	paperDir: string,
	vaultPath: string | null,
	meta: PaperMetadata | null,
	remotePdf: string | null,
): Promise<{
	pdfUrl: string | null;
	pdfBytes: ArrayBuffer | null;
	didDownload: boolean;
}> {
	const localPath = await findLocalPdfPath(paperDir);
	if (localPath) {
		const bytes = await localFileToArrayBuffer(localPath);
		if (bytes) return { pdfUrl: null, pdfBytes: bytes, didDownload: false };
		return { pdfUrl: remotePdf, pdfBytes: null, didDownload: false };
	}

	if (!isTauri() || !vaultPath || !canAttemptPdfDownload(meta, remotePdf)) {
		return { pdfUrl: remotePdf, pdfBytes: null, didDownload: false };
	}

	const rel = toVaultRelative(vaultPath, paperDir)
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
	if (!rel || pdfAutoDownloadTried.has(rel)) {
		return { pdfUrl: remotePdf, pdfBytes: null, didDownload: false };
	}
	pdfAutoDownloadTried.add(rel);

	let didDownload = false;
	try {
		await runBackgroundTask(
			{
				kind: "download",
				title: i18n.t("app:tasks.downloadPaper"),
				detail: rel,
			},
			async ({ id, setDetail }) => {
				setDetail(rel);
				const r = await downloadPaperAssets({
					vaultRoot: vaultPath,
					paperPath: rel,
					progressTaskId: id,
				});
				return r;
			},
		);
		didDownload = true;
	} catch {
		// fall through to remote
	}

	const after = await findLocalPdfPath(paperDir);
	if (after) {
		const bytes = await localFileToArrayBuffer(after);
		if (bytes) return { pdfUrl: null, pdfBytes: bytes, didDownload };
	}
	return { pdfUrl: remotePdf, pdfBytes: null, didDownload };
}

/** Revoke blob: media sources held by a document panel (PDF + image). */
export function revokeTabMediaSources(
	tab: Pick<DocTab, "pdfUrl" | "imageUrl"> | null,
): void {
	if (!tab) return;
	if (tab.pdfUrl) revokePdfViewerSource(tab.pdfUrl);
	if (tab.imageUrl) revokePdfViewerSource(tab.imageUrl);
}

/**
 * Resolve everything a tab needs to render (paper metadata, local/remote PDF,
 * HTML URL, image blob, NOTES seed, initial view mode, plain-file text).
 */
export async function loadTabResources(
	path: string,
	vaultPath: string | null,
	tree: FileNode[],
	paperFolders: string[],
): Promise<TabResources> {
	if (isTrashVirtualPath(path)) {
		return {
			kind: "trash",
			title: "Recycle Bin",
			mode: "markdown",
			paperMeta: null,
			pdfUrl: null,
			htmlUrl: null,
			imageUrl: null,
			notesPath: null,
			notesSeed: "",
			markdownSeed: "",
			loaded: true,
		};
	}
	if (isLibraryVirtualPath(path)) {
		return {
			kind: "library",
			title: "Library",
			mode: "markdown",
			paperMeta: null,
			pdfUrl: null,
			htmlUrl: null,
			imageUrl: null,
			notesPath: null,
			notesSeed: "",
			markdownSeed: "",
			loaded: true,
		};
	}

	// Restored tabs load concurrently with the tree on startup; ensure the
	// vault dir is in the fs-plugin scope before any read (see ensureLocalFsScope).
	await ensureLocalFsScope(vaultPath);

	let paperDir = paperDirFromPath(path, paperFolders);
	if (!paperDir && (await detectPaperDirectory(path))) {
		paperDir = path.replace(/[\\/]+$/, "");
	}

	const treeNode = findNode(tree, path);
	// Tree markers can identify a paper folder before paperFolders refreshes.
	if (
		!paperDir &&
		treeNode?.kind === "directory" &&
		isPaperDirectory(path, treeNode.children)
	) {
		paperDir = path.replace(/[\\/]+$/, "");
	}

	// Non-paper directory (org folder under papers/, notes/, etc.) → scoped library.
	// Tree may be empty during tab restore before refreshTree completes: fall back to
	// "not an openable file" so folder paths still reopen as library scope tabs.
	const looksLikeOpenableFile =
		isPdfPath(path) ||
		isImagePath(path) ||
		isHtmlPath(path) ||
		isTextOpenable(path);
	if (
		!paperDir &&
		(treeNode?.kind === "directory" ||
			(treeNode == null && !looksLikeOpenableFile))
	) {
		return {
			kind: "library",
			title: treeNode?.name || basenameOf(path),
			mode: "markdown",
			paperMeta: null,
			pdfUrl: null,
			htmlUrl: null,
			imageUrl: null,
			notesPath: null,
			notesSeed: "",
			markdownSeed: "",
			loaded: true,
		};
	}

	if (paperDir) {
		const meta = await loadPaperMetadata(paperDir, vaultPath);
		const { pdfUrl: remotePdf, htmlUrl } = paperRemoteAssetsFromMetadata(meta);
		const {
			pdfUrl: paperPdf,
			pdfBytes: paperBytes,
			didDownload,
		} = await resolvePaperPdfSource(paperDir, vaultPath, meta, remotePdf);
		if (!didDownload) {
			maybeTriggerDeferredParse(paperDir, vaultPath, findNode(tree, paperDir));
		}
		const notesPath = notesPathForPaper(paperDir);
		let notesSeed = NOTES_PLACEHOLDER;
		try {
			notesSeed = await readVaultFile(notesPath);
		} catch {
			// keep placeholder
		}

		const openingPaperRoot =
			normalizeTabPath(path) === normalizeTabPath(paperDir) ||
			isPaperDirectory(path, findChildren(tree, path));

		if (openingPaperRoot) {
			const hasPdf = Boolean(paperPdf || paperBytes);
			const mode: CenterViewMode = hasPdf
				? "pdf"
				: htmlUrl
					? "html"
					: "markdown";
			return {
				kind: "paper",
				title: meta?.title || basenameOf(paperDir),
				mode,
				paperMeta: meta,
				pdfUrl: paperPdf,
				pdfBytes: paperBytes,
				htmlUrl,
				imageUrl: null,
				notesPath,
				notesSeed,
				markdownSeed: "",
				loaded: true,
				didDownloadAssets: didDownload,
			};
		}

		// A file inside a paper folder (e.g. NOTES.md, a nested PDF, or figure).
		const mode = preferredModeForPath(path);
		let pdfUrl = paperPdf;
		let pdfBytes = paperBytes;
		let imageUrl: string | null = null;
		let markdownSeed = "";

		if (isPdfPath(path)) {
			// Prefer the exact file the user clicked (may differ from canonical {id}.pdf).
			const exact = await localFileToArrayBuffer(path);
			if (exact) {
				pdfBytes = exact;
				pdfUrl = null;
			}
		} else if (isImagePath(path)) {
			imageUrl = await localImageToViewerSource(path, imageMimeFromPath(path));
			if (!imageUrl) {
				return {
					kind: "file",
					title: basenameOf(path),
					mode: "image",
					paperMeta: meta,
					pdfUrl: paperPdf,
					pdfBytes: paperBytes,
					htmlUrl,
					imageUrl: null,
					notesPath,
					notesSeed,
					markdownSeed: "",
					loaded: true,
					didDownloadAssets: didDownload,
					error: "cannotPreview",
				};
			}
		}
		if (isTextOpenable(path)) {
			try {
				markdownSeed = await readVaultFile(path);
			} catch {
				// Leave the editor empty when the file cannot be read.
			}
		}

		return {
			kind: "file",
			title: basenameOf(path),
			mode,
			paperMeta: meta,
			pdfUrl,
			pdfBytes,
			htmlUrl,
			imageUrl,
			notesPath,
			notesSeed,
			markdownSeed,
			loaded: true,
			didDownloadAssets: didDownload,
		};
	}

	// Plain file, not under a paper folder (vault root, notes/, etc.).
	const mode = preferredModeForPath(path);
	const base = {
		kind: "file" as const,
		title: basenameOf(path),
		mode,
		paperMeta: null,
		pdfUrl: null as string | null,
		pdfBytes: null as ArrayBuffer | null,
		htmlUrl: null as string | null,
		imageUrl: null as string | null,
		notesPath: null,
		notesSeed: "",
		markdownSeed: "",
		loaded: true as const,
	};

	if (isPdfPath(path)) {
		const pdfBytes = await localFileToArrayBuffer(path);
		if (!pdfBytes) {
			return { ...base, mode: "pdf", error: "cannotPreview" };
		}
		return { ...base, mode: "pdf", pdfBytes };
	}

	if (isImagePath(path)) {
		const imageUrl = await localImageToViewerSource(
			path,
			imageMimeFromPath(path),
		);
		if (!imageUrl) {
			return { ...base, mode: "image", error: "cannotPreview" };
		}
		return { ...base, mode: "image", imageUrl };
	}

	if (isHtmlPath(path)) {
		// Local HTML still has no sandboxed file:// preview (remote only for paper HTML).
		return base;
	}

	if (!isTextOpenable(path)) {
		return { ...base, error: "cannotPreview" };
	}

	try {
		const markdownSeed = await readVaultFile(path);
		return { ...base, markdownSeed };
	} catch (e) {
		return {
			...base,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}

/** Whether the tab's active view exposes the side NOTES column. */
export function tabNotesEligible(tab: DocTab | null): boolean {
	if (!tab) return false;
	return (
		tab.kind !== "library" &&
		Boolean(tab.paperMeta) &&
		(tab.mode === "pdf" || tab.mode === "html")
	);
}

/** Center Markdown mode while a paper is open edits its NOTES.md live. */
export function tabIsPaperNotes(tab: DocTab | null): boolean {
	if (!tab?.paperMeta || tab.mode !== "markdown" || !tab.notesPath) {
		return false;
	}
	const tabPath = normalizeTabPath(tab.path);
	const notesPath = normalizeTabPath(tab.notesPath);
	const paperDir = notesPath.replace(/\/notes\.md$/, "");
	return tabPath === notesPath || tabPath === paperDir;
}

// --- Pure tab-list operations (unit-tested in test/tabs.test.ts) ---

/** Placeholder panel shown immediately while its resources load asynchronously. */
export function createPlaceholderTab(
	path: string,
	preferMode: CenterViewMode = "markdown",
): DocTab {
	const isLibrary = isLibraryVirtualPath(path);
	const isTrash = isTrashVirtualPath(path);
	return {
		id: tabIdForPath(path),
		path: isLibrary
			? LIBRARY_VIRTUAL_PATH
			: isTrash
				? TRASH_VIRTUAL_PATH
				: path,
		kind: isLibrary ? "library" : isTrash ? "trash" : "file",
		title: isLibrary ? "Library" : isTrash ? "Recycle Bin" : basenameOf(path),
		mode: preferMode,
		paperMeta: null,
		pdfUrl: null,
		pdfBytes: null,
		htmlUrl: null,
		imageUrl: null,
		notesPath: null,
		notesSeed: "",
		markdownSeed: "",
		markdownDirty: false,
		notesDirty: false,
		seedKey: 0,
		notesKey: 0,
		loaded: false,
	};
}

/**
 * Ensure the full-library tab exists; returns the next tabs + active id.
 * Used when the tab strip would otherwise be empty (default page).
 */
export function ensureFullLibraryTab(prev: DocTab[]): {
	tabs: DocTab[];
	activeId: string;
	inserted: boolean;
} {
	const existing = prev.find((t) => isLibraryVirtualPath(t.path));
	if (existing) {
		return { tabs: prev, activeId: existing.id, inserted: false };
	}
	const tab: DocTab = {
		...createPlaceholderTab(LIBRARY_VIRTUAL_PATH),
		kind: "library",
		title: "Library",
		loaded: true,
	};
	return { tabs: [...prev, tab], activeId: tab.id, inserted: true };
}

/** Insert a placeholder tab for `path` unless a tab for it already exists. */
export function insertPlaceholderTab(
	prev: DocTab[],
	path: string,
	preferMode: CenterViewMode = "markdown",
): { tabs: DocTab[]; id: string; exists: boolean } {
	const id = tabIdForPath(path);
	if (prev.some((t) => t.id === id)) return { tabs: prev, id, exists: true };
	return {
		tabs: [...prev, createPlaceholderTab(path, preferMode)],
		id,
		exists: false,
	};
}

/** Merge a patch into the tab with the given id (primary pane fields only). */
export function patchTab(
	prev: DocTab[],
	id: string,
	patch: Partial<DocTab>,
): DocTab[] {
	return prev.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

/**
 * Remove a tab from the React list only.
 * Active focus is owned by dockview (`onDidActivePanelChange`); do not pick a neighbor here.
 */
export function removeTab(
	prev: DocTab[],
	id: string,
): { tabs: DocTab[]; removed: DocTab | null } {
	const idx = prev.findIndex((t) => t.id === id);
	if (idx < 0) return { tabs: prev, removed: null };
	const removed = prev[idx] ?? null;
	const tabs = prev.filter((t) => t.id !== id);
	return { tabs, removed };
}

/** Remove every tab at or under `path`; Library/Trash virtual tabs are kept. */
export function removeTabsUnderPath(
	prev: DocTab[],
	path: string,
): {
	tabs: DocTab[];
	removed: DocTab[];
} {
	const key = normalizeTabPath(path);
	const hit = (p: string) => {
		const k = normalizeTabPath(p);
		return k === key || k.startsWith(`${key}/`);
	};
	const survivors: DocTab[] = [];
	const removed: DocTab[] = [];
	for (const t of prev) {
		if (isLibraryVirtualPath(t.path)) {
			survivors.push(t);
			continue;
		}
		if (hit(t.path)) {
			removed.push(t);
			continue;
		}
		survivors.push(t);
	}
	if (!removed.length) {
		return { tabs: prev, removed };
	}
	return { tabs: survivors, removed };
}

// --- Workspace helpers (flat panels; layout owned by dockview) ---

/**
 * NOTES.md panel for a loaded paper (default companion tab when opening a paper).
 * Reuses the paper's notesSeed — no extra IO.
 * Title uses i18n "Notes" so the dockview tab is readable (not NOTES.md).
 */
export function createNotesSplitPane(tab: DocTab): DocTab | null {
	if (!tab.notesPath || !tab.paperMeta) return null;
	return {
		...createPlaceholderTab(tab.notesPath, "markdown"),
		kind: "file",
		title: i18n.t("app:labels.notes"),
		paperMeta: tab.paperMeta,
		notesPath: tab.notesPath,
		notesSeed: tab.notesSeed,
		loaded: true,
	};
}

/** Whether NOTES.md for this paper is already open as a panel. */
export function tabHasNotesSplit(
	tabs: DocTab[],
	paperTab: DocTab | null,
): boolean {
	if (!paperTab?.notesPath) return false;
	const notesId = tabIdForPath(paperTab.notesPath);
	return tabs.some((t) => t.id === notesId);
}

/** Reseed an open paper tab's NOTES editor (bumps notesKey to remount). */
export function reseedNotesTab(
	prev: DocTab[],
	paperDir: string,
	content: string,
): DocTab[] {
	const id = tabIdForPath(paperDir);
	const notesId = tabIdForPath(notesPathForPaper(paperDir));
	return prev.map((t) => {
		if (t.id === id || t.id === notesId) {
			return {
				...t,
				notesSeed: content,
				notesDirty: false,
				notesKey: t.notesKey + 1,
			};
		}
		return t;
	});
}

/** Reseed an open plain-Markdown tab (bumps seedKey to remount). */
export function reseedMarkdownTab(
	prev: DocTab[],
	absPath: string,
	content: string,
): DocTab[] {
	const id = tabIdForPath(absPath);
	return prev.map((t) => {
		if (t.id === id) {
			return {
				...t,
				markdownSeed: content,
				markdownDirty: false,
				seedKey: t.seedKey + 1,
			};
		}
		return t;
	});
}

/** Keep the seed of the tab(s) owning `path` in sync after a disk write. */
export function syncTabSeedsForPath(
	prev: DocTab[],
	path: string,
	content: string,
): DocTab[] {
	const key = path.replace(/\\/g, "/").toLowerCase();
	const pathId = tabIdForPath(path);
	return prev.map((tab) => {
		const notesKey = tab.notesPath?.replace(/\\/g, "/").toLowerCase();
		if (notesKey === key) {
			return { ...tab, notesSeed: content };
		}
		if (
			tab.id === pathId ||
			normalizeTabPath(tab.path) === normalizeTabPath(path)
		) {
			const isNotes = Boolean(
				tab.notesPath &&
					normalizeTabPath(tab.path) === normalizeTabPath(tab.notesPath),
			);
			return {
				...tab,
				...(isNotes || notesKey === key
					? { notesSeed: content }
					: { markdownSeed: content }),
			};
		}
		return tab;
	});
}

// --- Session persistence (dockview layout is the sole source of truth) ---

const TABS_STORAGE_KEY = "agentero-open-tabs";

export type PersistedTab = {
	path: string;
	mode: CenterViewMode;
};

/**
 * Restored session: panel list + active id derived from dockview layout
 * (params carry path/mode; grid carries active group/view).
 */
export type PersistedTabs = {
	tabs: PersistedTab[];
	activeId: string | null;
	/** Global dockview grid snapshot (panel ids = path-derived tab ids). */
	layout: unknown | null;
};

const VALID_MODES = new Set<CenterViewMode>([
	"markdown",
	"pdf",
	"html",
	"image",
]);

function isCenterViewMode(v: unknown): v is CenterViewMode {
	return typeof v === "string" && VALID_MODES.has(v as CenterViewMode);
}

/** Params written into each dockview panel for layout round-trip. */
export type PanelPersistParams = {
	panelId: string;
	path: string;
	mode: CenterViewMode;
};

export function panelPersistParams(tab: DocTab): PanelPersistParams {
	return { panelId: tab.id, path: tab.path, mode: tab.mode };
}

type LayoutPanelState = {
	id?: string;
	params?: { panelId?: string; path?: string; mode?: string };
};

type LayoutLeafData = {
	id?: string;
	views?: string[];
	activeView?: string;
};

/**
 * Walk a SerializedDockview grid for the active panel id
 * (activeGroup → leaf activeView).
 */
function findActivePanelIdInLayout(layout: {
	activeGroup?: string;
	grid?: { root?: unknown };
}): string | null {
	const activeGroup = layout.activeGroup;
	const walk = (node: unknown): string | null => {
		if (!node || typeof node !== "object") return null;
		const n = node as { type?: string; data?: unknown };
		if (n.type === "leaf" && n.data && typeof n.data === "object") {
			const data = n.data as LayoutLeafData;
			if (activeGroup && data.id !== activeGroup) return null;
			return data.activeView ?? data.views?.[0] ?? null;
		}
		if (n.type === "branch" && Array.isArray(n.data)) {
			for (const child of n.data) {
				const hit = walk(child);
				if (hit) return hit;
			}
		}
		return null;
	};
	return walk(layout.grid?.root) ?? null;
}

/**
 * Derive flat panel list + active id from a dockview `toJSON()` snapshot.
 * Prefers `params.path` / `params.mode`; falls back to panel id as path.
 */
export function extractTabsFromLayout(layout: unknown): {
	tabs: PersistedTab[];
	activeId: string | null;
} {
	if (!layout || typeof layout !== "object") {
		return { tabs: [], activeId: null };
	}
	const l = layout as {
		panels?: Record<string, LayoutPanelState>;
		activeGroup?: string;
		grid?: { root?: unknown };
	};
	if (!l.panels || typeof l.panels !== "object") {
		return { tabs: [], activeId: null };
	}
	const tabs: PersistedTab[] = [];
	const seen = new Set<string>();
	for (const [id, panel] of Object.entries(l.panels)) {
		const path =
			typeof panel.params?.path === "string" && panel.params.path
				? panel.params.path
				: id;
		const mode = isCenterViewMode(panel.params?.mode)
			? panel.params.mode
			: "markdown";
		const tabId = tabIdForPath(path);
		if (seen.has(tabId)) continue;
		seen.add(tabId);
		tabs.push({ path, mode });
	}
	const activeId = findActivePanelIdInLayout(l);
	return {
		tabs,
		activeId:
			activeId && seen.has(activeId)
				? activeId
				: tabs[0]
					? tabIdForPath(tabs[0].path)
					: null,
	};
}

/** Read the previously persisted workspace for this window. */
export function loadPersistedTabs(): PersistedTabs | null {
	try {
		const raw = localStorage.getItem(TABS_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as {
			layout?: unknown | null;
			/** @deprecated layout-only storage; still accepted for one-shot restore */
			tabs?: Array<{ path?: string; mode?: string }>;
			/** @deprecated */
			activeIndex?: number;
		};
		if (!parsed || typeof parsed !== "object") return null;

		// Preferred: layout alone (params carry path/mode).
		if (parsed.layout != null && typeof parsed.layout === "object") {
			const extracted = extractTabsFromLayout(parsed.layout);
			if (!extracted.tabs.length) return null;
			return {
				tabs: extracted.tabs,
				activeId: extracted.activeId,
				layout: parsed.layout,
			};
		}

		// Legacy: explicit tabs[] without layout (pre layout-only storage).
		if (!Array.isArray(parsed.tabs) || !parsed.tabs.length) return null;
		const flat: PersistedTab[] = [];
		const seen = new Set<string>();
		for (const pt of parsed.tabs) {
			if (!pt || typeof pt.path !== "string" || !pt.path) continue;
			const id = tabIdForPath(pt.path);
			if (seen.has(id)) continue;
			seen.add(id);
			flat.push({
				path: pt.path,
				mode: isCenterViewMode(pt.mode) ? pt.mode : "markdown",
			});
		}
		if (!flat.length) return null;
		const idx = Math.min(Math.max(0, parsed.activeIndex ?? 0), flat.length - 1);
		const activePath = flat[idx]?.path;
		return {
			tabs: flat,
			activeId: activePath ? tabIdForPath(activePath) : null,
			layout: null,
		};
	} catch {
		return null;
	}
}

/**
 * Persist dockview layout only (panel list, order, active, path/mode in params).
 * Empty / missing layout clears storage.
 */
export function savePersistedTabs(layout: unknown | null): void {
	try {
		if (layout == null || typeof layout !== "object") {
			localStorage.removeItem(TABS_STORAGE_KEY);
			return;
		}
		const panels = (layout as { panels?: Record<string, unknown> }).panels;
		if (!panels || !Object.keys(panels).length) {
			localStorage.removeItem(TABS_STORAGE_KEY);
			return;
		}
		localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ layout }));
	} catch {
		// localStorage may be unavailable; tab restore is best-effort.
	}
}
