import { useEffect } from "react";
import { isTauri } from "@/lib/core/tauri";

type NativeMenuHandlers = {
	onSettings: () => void;
	onOpenVault: () => void;
	onCreateVault: () => void;
	onRefresh: () => void;
	onToggleSidebar: () => void;
	onToggleChat: () => void;
	onCloseTabOrWindow: () => void;
};

/**
 * Subscribe to the desktop native menu bar events (Agentero → Settings…, File,
 * View). No-op outside the Tauri shell. `new_window` is handled natively in Rust.
 */
export function useNativeMenuEvents(handlers: NativeMenuHandlers): void {
	const {
		onSettings,
		onOpenVault,
		onCreateVault,
		onRefresh,
		onToggleSidebar,
		onToggleChat,
		onCloseTabOrWindow,
	} = handlers;

	useEffect(() => {
		if (!isTauri()) return;

		let cancelled = false;
		const unsubs: Array<() => void> = [];

		void (async () => {
			const { listen } = await import("@tauri-apps/api/event");
			if (cancelled) return;

			unsubs.push(await listen("settings", () => onSettings()));
			unsubs.push(await listen("open_vault", () => onOpenVault()));
			unsubs.push(await listen("create_vault", () => onCreateVault()));
			unsubs.push(await listen("refresh_tree", () => onRefresh()));
			unsubs.push(await listen("toggle_sidebar", () => onToggleSidebar()));
			unsubs.push(await listen("toggle_chat", () => onToggleChat()));
			// File → Close / ⌘W (macOS menu accelerator; keydown also handles non-macOS)
			unsubs.push(
				await listen("close_tab_or_window", () => onCloseTabOrWindow()),
			);
		})();

		return () => {
			cancelled = true;
			for (const unsub of unsubs) unsub();
		};
	}, [
		onSettings,
		onOpenVault,
		onCreateVault,
		onRefresh,
		onToggleSidebar,
		onToggleChat,
		onCloseTabOrWindow,
	]);
}
