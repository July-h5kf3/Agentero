export {
	basenameOf,
	createPlaceholderTab,
	ensureFullLibraryTab,
	insertPlaceholderTab,
	normalizeTabPath,
	patchTab,
	removeTab,
	removeTabsUnderPath,
	tabIdForPath,
} from "@/lib/workspace/tabs/model";
export {
	createNotesSplitPane,
	isPaperContentTab,
	paperReadingPlacements,
	readingPairCloseIds,
	reseedMarkdownTab,
	reseedNotesTab,
	syncTabSeedsForPath,
	tabHasNotesSplit,
	tabIsPaperNotes,
	tabNotesEligible,
} from "@/lib/workspace/tabs/notes-split";
export {
	extractTabsFromLayout,
	loadPersistedTabs,
	panelPersistParams,
	savePersistedTabs,
} from "@/lib/workspace/tabs/persist";
export {
	loadTabResources,
	revokeTabMediaSources,
} from "@/lib/workspace/tabs/resources";
export type {
	DocTab,
	OpenPlacement,
	SplitDirection,
} from "@/lib/workspace/tabs/types";
