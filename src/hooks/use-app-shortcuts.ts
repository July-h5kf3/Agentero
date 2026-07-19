import { useEffect, useRef } from "react";
import { resolveShortcutId, type ShortcutId } from "@/lib/shortcuts";

/** One handler per global keyboard shortcut. */
export type ShortcutHandlers = Record<ShortcutId, () => void>;

/**
 * Bind the global keyboard shortcuts once and dispatch each to its handler.
 * Handlers are read from a ref so the listener never needs to re-bind.
 *
 * @param overlayOpen - any app modal/sheet open (settings, dialogs, palette…).
 *   Gates `whenSettingsOpen` / `whenSettingsClosed` shortcut rules.
 */
export function useAppShortcuts(
	overlayOpen: boolean,
	handlers: ShortcutHandlers,
): void {
	const overlayOpenRef = useRef(overlayOpen);
	overlayOpenRef.current = overlayOpen;
	const handlersRef = useRef(handlers);
	handlersRef.current = handlers;

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const id = resolveShortcutId(event, {
				settingsOpen: overlayOpenRef.current,
				overlayOpen: overlayOpenRef.current,
			});
			if (!id) return;

			// Editor-native combos — only claim them outside text fields:
			// ⌘⌫ delete-to-line-start; ⌘← / ⇧⌘← jump/select to line start (macOS).
			if (
				id === "deleteTreeItem" ||
				id === "collapseTreeCurrent" ||
				id === "collapseTreeDefault"
			) {
				const el = event.target;
				if (
					el instanceof HTMLElement &&
					el.closest(
						"input, textarea, select, [contenteditable='true'], [role='textbox']",
					)
				) {
					return;
				}
			}

			event.preventDefault();
			handlersRef.current[id]();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
}
