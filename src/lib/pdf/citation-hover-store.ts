/**
 * Cross-component citation hover state: the PDF viewer publishes the text of
 * the citation link under the pointer (e.g. `[12]` / `Vaswani et al., 2017`),
 * the References sidebar resolves it against the sidecar and highlights the
 * matching card. Keyed by workspace tab id (=== PDF docId) so background tabs
 * stay inert.
 */

import { createStore } from "zustand/vanilla";

type CitationHoverStore = {
	tabId: string | null;
	/** Raw link anchor text from the PDF text layer. */
	marker: string | null;
};

export const citationHoverStore = createStore<CitationHoverStore>(() => ({
	tabId: null,
	marker: null,
}));

export function setCitationHover(tabId: string, marker: string): void {
	const s = citationHoverStore.getState();
	if (s.tabId === tabId && s.marker === marker) return;
	citationHoverStore.setState({ tabId, marker });
}

/** Clear only if the hover still belongs to `tabId` (avoids cross-tab races). */
export function clearCitationHover(tabId: string): void {
	if (citationHoverStore.getState().tabId !== tabId) return;
	citationHoverStore.setState({ tabId: null, marker: null });
}
