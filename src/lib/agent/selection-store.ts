/**
 * Editor/PDF text-selection → Agent context (zustand vanilla, Cursor-style).
 * `active` follows the latest live selection; `pinned` holds selections the
 * user froze via ⌘L or the PDF selection menu. Never persisted — selections
 * are ephemeral and consumed by the next submitted turn.
 */

import { createStore } from "zustand/vanilla";
import { toVaultRelative } from "@/lib/core/path";
import { vaultStore } from "@/lib/vault/store";

export type SelectionOrigin = "pdf" | "markdown";

export type SelectionContext = {
	id: string;
	text: string;
	/** Vault-relative source path when the file lives inside the Vault. */
	sourcePath: string;
	origin: SelectionOrigin;
	/** 1-based PDF page number. */
	page?: number;
	pinned: boolean;
};

type SelectionStore = {
	active: SelectionContext | null;
	pinned: SelectionContext[];
};

const MAX_SELECTION_CHARS = 4000;
const MAX_PINNED = 4;

export const selectionStore = createStore<SelectionStore>(() => ({
	active: null,
	pinned: [],
}));

let nextSelectionId = 0;

/** Replace the live selection chip (empty text clears it instead). */
export function publishSelection(input: {
	text: string;
	sourcePath: string;
	origin: SelectionOrigin;
	page?: number;
}): void {
	const text = input.text.trim().slice(0, MAX_SELECTION_CHARS);
	if (!text) {
		clearActiveSelection(input.origin);
		return;
	}
	selectionStore.setState({
		active: {
			id: `sel-${++nextSelectionId}`,
			text,
			sourcePath: toVaultRelative(
				vaultStore.getState().vaultPath,
				input.sourcePath,
			),
			origin: input.origin,
			page: input.page,
			pinned: false,
		},
	});
}

/** Drop the live selection (optionally only when it came from `origin`). */
export function clearActiveSelection(origin?: SelectionOrigin): void {
	const active = selectionStore.getState().active;
	if (!active) return;
	if (origin && active.origin !== origin) return;
	selectionStore.setState({ active: null });
}

/** Freeze the live selection as a pinned chip. Returns false when there is none. */
export function pinActiveSelection(): boolean {
	const { active, pinned } = selectionStore.getState();
	if (!active) return false;
	const deduped = pinned.filter(
		(item) =>
			item.text !== active.text || item.sourcePath !== active.sourcePath,
	);
	selectionStore.setState({
		active: null,
		pinned: [...deduped, { ...active, pinned: true }].slice(-MAX_PINNED),
	});
	return true;
}

/** Remove one chip (live or pinned) by id. */
export function removeSelection(id: string): void {
	const { active, pinned } = selectionStore.getState();
	if (active?.id === id) {
		selectionStore.setState({ active: null });
		return;
	}
	selectionStore.setState({ pinned: pinned.filter((item) => item.id !== id) });
}

/** Snapshot chips for a turn: pinned first, live selection last. */
export function currentSelections(): SelectionContext[] {
	const { active, pinned } = selectionStore.getState();
	return active ? [...pinned, active] : pinned;
}

/** Snapshot and clear — a submitted turn consumes its selections. */
export function consumeSelections(): SelectionContext[] {
	const all = currentSelections();
	if (all.length) selectionStore.setState({ active: null, pinned: [] });
	return all;
}

/** Prompt scaffold in English, matching the PDF-ask quote precedent. */
export function selectionsPromptBlock(selections: SelectionContext[]): string {
	return selections
		.map((sel) => {
			const where = sel.page
				? `${sel.sourcePath} (page ${sel.page})`
				: sel.sourcePath;
			const quoted = sel.text
				.split("\n")
				.map((line) => `> ${line}`)
				.join("\n");
			return `Selected text from ${where}:\n${quoted}`;
		})
		.join("\n\n");
}
