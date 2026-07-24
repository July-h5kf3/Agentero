import i18n from "@/i18n";
import { notesPathForPaper } from "@/lib/paper";
import {
	createPlaceholderTab,
	normalizeTabPath,
	tabIdForPath,
} from "@/lib/workspace/tabs/model";
import type { DocTab } from "@/lib/workspace/tabs/types";

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
