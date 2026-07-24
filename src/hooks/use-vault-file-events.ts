import { useEffect } from "react";
import {
	startVaultWatch,
	stopVaultWatch,
	VAULT_FILE_CHANGED_EVENT,
	type VaultFileChangedPayload,
} from "@/lib/fs-watch";
import { isTauri } from "@/lib/tauri";

type VaultFileEventsParams = {
	vaultPath: string | null;
	/** Reload the matching open editor(s) after a file's content changed on disk. */
	onDiskChange: (absPath: string) => void;
	/** Refresh the file tree after a structural change (create/delete/rename). */
	onStructuralChange: () => void;
	/**
	 * Any touched path (content or structural). Used to (debounced) rebuild the
	 * wiki / backlinks / graph index so it never goes stale after external writes.
	 */
	onWikiChange?: (absPath: string) => void;
	/** Ignore a known self-authored transaction event so it does not re-run refresh work. */
	shouldIgnoreEvent?: (payload: VaultFileChangedPayload) => boolean;
	/** Inspect a trustworthy external rename pair before the regular index rebuild. */
	onExternalRename?: (
		rename: NonNullable<VaultFileChangedPayload["rename"]>,
		payload: VaultFileChangedPayload,
	) => Promise<void> | void;
	/** Report a rename event that did not include a safe old/new path pair. */
	onUnverifiedRename?: (payload: VaultFileChangedPayload) => void;
};

/**
 * Start/stop the Host filesystem watcher for the active vault and reload open
 * editors + file tree when files change on disk (external tools / Agent writes).
 */
export function useVaultFileEvents({
	vaultPath,
	onDiskChange,
	onStructuralChange,
	onWikiChange,
	shouldIgnoreEvent,
	onExternalRename,
	onUnverifiedRename,
}: VaultFileEventsParams): void {
	// start() replaces any existing watcher for this window, so a Vault switch needs
	// only a fresh start (no cleanup-stop, which could race the new start). Window
	// close is handled by the Host's on_window_event(Destroyed).
	useEffect(() => {
		if (!isTauri()) return;
		if (!vaultPath) {
			void stopVaultWatch().catch(() => {});
			return;
		}
		// watcher is best-effort; editor still works without live reload
		void startVaultWatch(vaultPath).catch(() => {});
	}, [vaultPath]);

	useEffect(() => {
		if (!isTauri()) return;
		let cancelled = false;
		let unsub: (() => void) | undefined;
		void (async () => {
			const { listen } = await import("@tauri-apps/api/event");
			if (cancelled) return;
			unsub = await listen<VaultFileChangedPayload>(
				VAULT_FILE_CHANGED_EVENT,
				async ({ payload }) => {
					if (shouldIgnoreEvent?.(payload)) return;
					if (payload.rename) {
						await onExternalRename?.(payload.rename, payload);
					} else if (payload.kind === "rename") {
						onUnverifiedRename?.(payload);
					}
					for (const p of payload.paths) {
						onDiskChange(p);
						onWikiChange?.(p);
					}
					// Structural changes affect the tree; plain content edits don't.
					if (payload.kind !== "modify") onStructuralChange();
				},
			);
		})();
		return () => {
			cancelled = true;
			unsub?.();
		};
	}, [
		onDiskChange,
		onExternalRename,
		onUnverifiedRename,
		onStructuralChange,
		onWikiChange,
		shouldIgnoreEvent,
	]);
}
