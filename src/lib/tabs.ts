import i18n from "@/i18n";
import { runBackgroundTask } from "@/lib/background-tasks";
import { downloadPaperAssets } from "@/lib/lookup";
import {
	canAttemptPdfDownload,
	detectPaperDirectory,
	findLocalPdfPath,
	isPaperDirectory,
	loadPaperMetadata,
	localImageToViewerSource,
	localPdfToViewerSource,
	notesPathForPaper,
	type PaperMetadata,
	paperDirFromPath,
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
import { type FileNode, isTextOpenable, readVaultFile } from "@/lib/vault";
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

/** One open document in the center tab strip (browser-style multi-tab). */
export type DocTab = {
	/** Stable id derived from the normalized path (dedupe / reorder). */
	id: string;
	/** Absolute path, or the Library virtual path. */
	path: string;
	kind: DocTabKind;
	title: string;
	/** Current view for this tab. */
	mode: CenterViewMode;
	paperMeta: PaperMetadata | null;
	pdfUrl: string | null;
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

function findChildren(nodes: FileNode[], path: string): FileNode[] | undefined {
	const key = normalizeTabPath(path);
	const walk = (list: FileNode[]): FileNode[] | undefined => {
		for (const n of list) {
			if (normalizeTabPath(n.path) === key) return n.children;
			if (n.children?.length) {
				const hit = walk(n.children);
				if (hit) return hit;
			}
		}
		return undefined;
	};
	return walk(nodes);
}

/** Fields loadTabResources fills in on top of a placeholder tab. */
export type TabResources = {
	kind: DocTabKind;
	title: string;
	mode: CenterViewMode;
	paperMeta: PaperMetadata | null;
	pdfUrl: string | null;
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

/**
 * PDF for a paper tab: local file (blob:) → auto-download if missing → remote pdf_url.
 * Avoids Tauri asset:// which PDF.js cannot XHR ("Unexpected server response (0)").
 */
async function resolvePaperPdfSource(
	paperDir: string,
	vaultPath: string | null,
	meta: PaperMetadata | null,
	remotePdf: string | null,
): Promise<{ pdfUrl: string | null; didDownload: boolean }> {
	const localPath = await findLocalPdfPath(paperDir);
	if (localPath) {
		const blob = await localPdfToViewerSource(localPath);
		return { pdfUrl: blob ?? remotePdf, didDownload: false };
	}

	if (!isTauri() || !vaultPath || !canAttemptPdfDownload(meta, remotePdf)) {
		return { pdfUrl: remotePdf, didDownload: false };
	}

	const rel = toVaultRelative(vaultPath, paperDir)
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
	if (!rel || pdfAutoDownloadTried.has(rel)) {
		return { pdfUrl: remotePdf, didDownload: false };
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
			async ({ setDetail, setProgress }) => {
				setDetail(rel);
				setProgress(25);
				const r = await downloadPaperAssets({
					vaultRoot: vaultPath,
					paperPath: rel,
				});
				setProgress(100);
				return r;
			},
		);
		didDownload = true;
	} catch {
		// fall through to remote
	}

	const after = await findLocalPdfPath(paperDir);
	if (after) {
		const blob = await localPdfToViewerSource(after);
		return { pdfUrl: blob ?? remotePdf, didDownload };
	}
	return { pdfUrl: remotePdf, didDownload };
}

/** Revoke blob: media sources held by closed tabs (PDF + image). */
export function revokeTabPdfSource(
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

	let paperDir = paperDirFromPath(path, paperFolders);
	if (!paperDir && (await detectPaperDirectory(path))) {
		paperDir = path.replace(/[\\/]+$/, "");
	}

	if (paperDir) {
		const meta = await loadPaperMetadata(paperDir, vaultPath);
		const { pdfUrl: remotePdf, htmlUrl } = paperRemoteAssetsFromMetadata(meta);
		const { pdfUrl: paperPdf, didDownload } = await resolvePaperPdfSource(
			paperDir,
			vaultPath,
			meta,
			remotePdf,
		);
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
			const mode: CenterViewMode = paperPdf
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
		let imageUrl: string | null = null;

		if (isPdfPath(path)) {
			// Prefer the exact file the user clicked (may differ from canonical {id}.pdf).
			const exact = await localPdfToViewerSource(path);
			if (exact) {
				if (paperPdf && paperPdf !== exact) {
					revokePdfViewerSource(paperPdf);
				}
				pdfUrl = exact;
			} else {
				pdfUrl = paperPdf;
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

		return {
			kind: "file",
			title: basenameOf(path),
			mode,
			paperMeta: meta,
			pdfUrl,
			htmlUrl,
			imageUrl,
			notesPath,
			notesSeed,
			markdownSeed: "",
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
		htmlUrl: null as string | null,
		imageUrl: null as string | null,
		notesPath: null,
		notesSeed: "",
		markdownSeed: "",
		loaded: true as const,
	};

	if (isPdfPath(path)) {
		const pdfUrl = await localPdfToViewerSource(path);
		if (!pdfUrl) {
			return { ...base, mode: "pdf", error: "cannotPreview" };
		}
		return { ...base, mode: "pdf", pdfUrl };
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
	return Boolean(tab?.paperMeta) && tab?.mode === "markdown";
}
