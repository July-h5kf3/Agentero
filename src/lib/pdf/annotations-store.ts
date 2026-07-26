/**
 * PDF annotation state per open tab (highlights + ask threads), zustand
 * vanilla. Only the annotations side panel and the owning viewers subscribe —
 * a selection highlight no longer re-renders the whole App.
 */

import { createStore } from "zustand/vanilla";
import type { PdfAskThread } from "@/lib/pdf/ask/types";
import type { PdfHighlight } from "@/lib/pdf/highlight/types";

type AnnotationsStore = {
	highlightsByTab: Record<string, PdfHighlight[]>;
	asksByTab: Record<string, PdfAskThread[]>;
};

export const annotationsStore = createStore<AnnotationsStore>(() => ({
	highlightsByTab: {},
	asksByTab: {},
}));

export function setTabHighlights(tabId: string, list: PdfHighlight[]): void {
	annotationsStore.setState((s) => ({
		highlightsByTab: { ...s.highlightsByTab, [tabId]: list },
	}));
}

export function setTabAsks(tabId: string, list: PdfAskThread[]): void {
	annotationsStore.setState((s) => ({
		asksByTab: { ...s.asksByTab, [tabId]: list },
	}));
}

/** Drop highlight state for closed panels. */
export function removeTabAnnotations(tabIds: string[]): void {
	annotationsStore.setState((s) => {
		let changed = false;
		const next = { ...s.highlightsByTab };
		for (const id of tabIds) {
			if (id in next) {
				delete next[id];
				changed = true;
			}
		}
		return changed ? { highlightsByTab: next } : s;
	});
}

/** Re-key highlight state after a filesystem move changed panel ids. */
export function remapTabAnnotations(
	remap: Array<{ fromId: string; toId: string }>,
): void {
	annotationsStore.setState((s) => {
		const next = { ...s.highlightsByTab };
		for (const { fromId, toId } of remap) {
			if (fromId !== toId && fromId in next) {
				next[toId] = next[fromId];
				delete next[fromId];
			}
		}
		return { highlightsByTab: next };
	});
}
