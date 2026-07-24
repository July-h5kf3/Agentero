import { useEffect } from "react";
import { isTauri } from "@/lib/core/tauri";
import {
	startVaultWatch,
	stopVaultWatch,
	VAULT_FILE_CHANGED_EVENT,
	type VaultFileChangedPayload,
} from "@/lib/vault/fs-watch";

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
				({ payload }) => {
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
	}, [onDiskChange, onStructuralChange, onWikiChange]);
}
