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
	findNotesColumnAnchor,
	findPaperColumnAnchor,
	findReadingCompanion,
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
	DocTabKind,
	OpenPlacement,
	PanelPersistParams,
	PersistedTab,
	PersistedTabs,
	SplitDirection,
	TabResources,
} from "@/lib/workspace/tabs/types";
export { NOTES_PLACEHOLDER } from "@/lib/workspace/tabs/types";
