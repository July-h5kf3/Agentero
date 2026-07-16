import {
	detectPaperDirectory,
	isPaperDirectory,
	loadPaperMetadata,
	notesPathForPaper,
	type PaperMetadata,
	paperDirFromPath,
	paperRemoteAssetsFromMetadata,
} from "@/lib/paper-metadata";
import { isLibraryVirtualPath, LIBRARY_VIRTUAL_PATH } from "@/lib/papers-api";
import { type FileNode, isTextOpenable, readVaultFile } from "@/lib/vault";
import {
	type CenterViewMode,
	isHtmlPath,
	isPdfPath,
	preferredModeForPath,
} from "@/lib/viewer";

export type DocTabKind = "library" | "paper" | "file";

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
	notesPath: string | null;
	notesSeed: string;
	markdownSeed: string;
	loaded: true;
	/** Non-fatal message to surface (e.g. unpreviewable file). */
	error?: string;
};

/**
 * Resolve everything a tab needs to render, mirroring App.tsx's former
 * per-`selectedPath` loading effect (paper metadata, remote PDF/HTML URLs,
 * NOTES seed, initial view mode, plain-file text).
 */
export async function loadTabResources(
	path: string,
	vaultPath: string | null,
	tree: FileNode[],
	paperFolders: string[],
): Promise<TabResources> {
	if (isLibraryVirtualPath(path)) {
		return {
			kind: "library",
			title: "Library",
			mode: "markdown",
			paperMeta: null,
			pdfUrl: null,
			htmlUrl: null,
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
		const { pdfUrl, htmlUrl } = paperRemoteAssetsFromMetadata(meta);
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
			const mode: CenterViewMode = pdfUrl
				? "pdf"
				: htmlUrl
					? "html"
					: "markdown";
			return {
				kind: "paper",
				title: meta?.title || basenameOf(paperDir),
				mode,
				paperMeta: meta,
				pdfUrl,
				htmlUrl,
				notesPath,
				notesSeed,
				markdownSeed: "",
				loaded: true,
			};
		}

		// A file inside a paper folder (e.g. NOTES.md opened via wikilink).
		return {
			kind: "file",
			title: basenameOf(path),
			mode: preferredModeForPath(path),
			paperMeta: meta,
			pdfUrl,
			htmlUrl,
			notesPath,
			notesSeed,
			markdownSeed: "",
			loaded: true,
		};
	}

	// Plain file, not under a paper folder.
	const mode = preferredModeForPath(path);
	const base = {
		kind: "file" as const,
		title: basenameOf(path),
		mode,
		paperMeta: null,
		pdfUrl: null,
		htmlUrl: null,
		notesPath: null,
		notesSeed: "",
		markdownSeed: "",
		loaded: true as const,
	};

	if (isPdfPath(path) || isHtmlPath(path)) {
		// Bare .pdf/.html without paper metadata: no remote preview (matches prior behavior).
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
