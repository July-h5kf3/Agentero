/**
 * Wiki / rename state (zustand vanilla): index revision signal, in-app rename
 * dialog draft, and external-rename repair flow. Also owns the debounced wiki
 * rebuild scheduler and the internal-rename watcher-echo filter (module-level
 * timers replace the old App refs).
 */

import { createStore } from "zustand/vanilla";
import type { VaultFileChangedPayload } from "@/lib/vault/fs-watch";
import { getVaultPath } from "@/lib/vault/store";
import { rebuildWikiIndex, type WikiExternalRenamePreview } from "@/lib/wiki";
import { notifyWikiEmbedTargets } from "@/lib/wiki-embed-refresh";
import { normalizeTabPath } from "@/lib/workspace/tabs";

export type RenameDraft = {
	path: string;
	currentName: string;
	value: string;
};

export type ExternalRenameFailure = {
	from: string;
	to: string;
	error: string;
	affectedSources: number | null;
	zeroWrite: boolean;
	rollback?: string;
};

type WikiStore = {
	/** Bumped after graph_rebuild so Backlinks/Graph re-fetch. */
	wikiIndexRevision: number;
	/** Awaiting the user's decision for one verified external local rename. */
	externalRenamePreview: WikiExternalRenamePreview | null;
	externalRenameVaultPath: string | null;
	externalRenameRepairing: boolean;
	/** A no-write preflight failure that still needs an actionable review surface. */
	externalRenameFailure: ExternalRenameFailure | null;
	/** App-native rename input; WebView JavaScript prompts are not portable. */
	renameDraft: RenameDraft | null;
	renameBusy: boolean;
	renameError: string | null;
};

export const wikiStore = createStore<WikiStore>(() => ({
	wikiIndexRevision: 0,
	externalRenamePreview: null,
	externalRenameVaultPath: null,
	externalRenameRepairing: false,
	externalRenameFailure: null,
	renameDraft: null,
	renameBusy: false,
	renameError: null,
}));

export function bumpWikiIndexRevision(): void {
	wikiStore.setState((s) => ({ wikiIndexRevision: s.wikiIndexRevision + 1 }));
}

export function setRenameDraft(
	next:
		| RenameDraft
		| null
		| ((previous: RenameDraft | null) => RenameDraft | null),
): void {
	if (typeof next === "function") {
		wikiStore.setState((s) => ({ renameDraft: next(s.renameDraft) }));
		return;
	}
	wikiStore.setState({ renameDraft: next });
}

export function setRenameBusy(busy: boolean): void {
	wikiStore.setState({ renameBusy: busy });
}

export function setRenameError(error: string | null): void {
	wikiStore.setState({ renameError: error });
}

export function setExternalRenamePreview(
	preview: WikiExternalRenamePreview | null,
): void {
	wikiStore.setState({ externalRenamePreview: preview });
}

export function setExternalRenameVaultPath(path: string | null): void {
	wikiStore.setState({ externalRenameVaultPath: path });
}

export function setExternalRenameRepairing(repairing: boolean): void {
	wikiStore.setState({ externalRenameRepairing: repairing });
}

export function setExternalRenameFailure(
	failure: ExternalRenameFailure | null,
): void {
	wikiStore.setState({ externalRenameFailure: failure });
}

/** Rebuild wiki index and notify Backlinks/Graph panels to re-fetch. */
export async function rebuildWikiAndNotify(path: string): Promise<void> {
	try {
		await rebuildWikiIndex(path);
		bumpWikiIndexRevision();
	} catch {
		// Index rebuild is best-effort; panels re-fetch on next path change.
	}
}

/** Debounced wiki/backlinks/graph rebuild after on-disk changes. */
let wikiRebuildTimer: ReturnType<typeof setTimeout> | null = null;
/** Watcher paths collected for the current debounced Wiki rebuild. */
const wikiRebuildPaths = new Set<string>();

/**
 * Markdown files carry references; images and PDFs are canonical targets
 * whose create/remove/modify events also invalidate link resolution and
 * embedded attachment projections.
 */
export function scheduleWikiRebuild(absPath: string): void {
	if (
		!/\.(md|mdx|markdown|pdf|png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(
			absPath,
		)
	) {
		return;
	}
	wikiRebuildPaths.add(absPath);
	if (wikiRebuildTimer) clearTimeout(wikiRebuildTimer);
	wikiRebuildTimer = setTimeout(() => {
		wikiRebuildTimer = null;
		const changedPaths = [...wikiRebuildPaths];
		wikiRebuildPaths.clear();
		const vault = getVaultPath();
		if (!vault) return;
		void rebuildWikiAndNotify(vault).finally(() =>
			notifyWikiEmbedTargets(changedPaths),
		);
	}, 900);
}

/** Host watcher paths caused by a committed rename transaction. */
const internalRenamePaths = new Map<string, number>();

export function trackInternalRenamePaths(
	paths: string[],
	expiresAt: number,
): void {
	for (const path of paths) {
		internalRenamePaths.set(normalizeTabPath(path), expiresAt);
	}
}

export function shouldIgnoreInternalRenameEvent(
	payload: VaultFileChangedPayload,
): boolean {
	const now = Date.now();
	for (const [path, expiresAt] of internalRenamePaths) {
		if (expiresAt <= now) internalRenamePaths.delete(path);
	}
	if (payload.paths.length === 0 || internalRenamePaths.size === 0) {
		return false;
	}
	return payload.paths.every((path) => {
		const normalized = normalizeTabPath(path);
		for (const tracked of internalRenamePaths.keys()) {
			if (
				normalized === tracked ||
				normalized.startsWith(`${tracked}/`) ||
				(normalized.includes(".agentero-rename-") &&
					normalized.slice(0, normalized.lastIndexOf("/")) ===
						tracked.slice(0, tracked.lastIndexOf("/")))
			) {
				return true;
			}
		}
		return false;
	});
}
