import { useEffect, useRef, useSyncExternalStore } from "react";

import {
	getOverlayStackSnapshot,
	isAnyOverlayOpen,
	pushOverlay,
	subscribeOverlayStack,
} from "@/lib/core/overlay-stack";

/**
 * While `open` is true, register this overlay on the app stack so
 * Esc / ⌘W can dismiss it via {@link closeTopOverlay}.
 */
export function useOverlayRegistration(
	id: string,
	open: boolean,
	close: () => void,
): void {
	const closeRef = useRef(close);
	closeRef.current = close;

	useEffect(() => {
		if (!open) return;
		return pushOverlay({
			id,
			close: () => {
				closeRef.current();
			},
		});
	}, [id, open]);
}

/** True when any registered app overlay (settings, dialogs, palette…) is open. */
export function useAnyOverlayOpen(): boolean {
	return useSyncExternalStore(
		subscribeOverlayStack,
		isAnyOverlayOpen,
		() => false,
	);
}

/** Debug / tests: current stack ids top-last. */
export function useOverlayStackIds(): string[] {
	return useSyncExternalStore(
		subscribeOverlayStack,
		() => getOverlayStackSnapshot().map((h) => h.id),
		() => [] as string[],
	);
}
