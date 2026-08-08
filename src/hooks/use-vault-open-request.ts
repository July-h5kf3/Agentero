/**
 * Listen for Host vault open requests (CLI deep link / second instance).
 */

import { useEffect } from "react";
import { takePendingVaultOpen } from "@/lib/cli/api";
import { notifyError } from "@/lib/core/notify";
import { isTauri } from "@/lib/core/tauri";
import { openLocalVaultPath } from "@/lib/vault/actions";

type OpenPayload = { path: string };

export function useVaultOpenRequest(): void {
	useEffect(() => {
		if (!isTauri()) return;
		let unlistenOpen: (() => void) | undefined;
		let unlistenError: (() => void) | undefined;
		let cancelled = false;
		/** In-flight path so event + pending take do not double-activate. */
		let inflight: string | null = null;
		let generation = 0;

		const handlePath = async (path: string | undefined | null) => {
			const trimmed = path?.trim();
			if (!trimmed || cancelled) return;
			// Host emits and also queues pending; drain + dedupe the concurrent pair.
			if (inflight === trimmed) return;
			const gen = ++generation;
			inflight = trimmed;
			try {
				try {
					await takePendingVaultOpen();
				} catch {
					// Older Host or no pending — fine.
				}
				if (cancelled || gen !== generation) return;
				await openLocalVaultPath(trimmed);
			} finally {
				if (gen === generation) {
					inflight = null;
				}
			}
		};

		void (async () => {
			const { listen } = await import("@tauri-apps/api/event");
			if (cancelled) return;

			unlistenOpen = await listen<OpenPayload>(
				"vault:open-request",
				(event) => {
					void handlePath(event.payload?.path);
				},
			);
			unlistenError = await listen<{ message?: string }>(
				"vault:open-error",
				(event) => {
					const msg = event.payload?.message;
					if (msg) notifyError(msg);
				},
			);

			// Startup race: Host may have queued a path before the listener attached.
			try {
				const pending = await takePendingVaultOpen();
				if (!cancelled && pending) {
					await handlePath(pending);
				}
			} catch {
				// Non-fatal when the command is unavailable (older Host).
			}
		})();

		return () => {
			cancelled = true;
			unlistenOpen?.();
			unlistenError?.();
		};
	}, []);
}
