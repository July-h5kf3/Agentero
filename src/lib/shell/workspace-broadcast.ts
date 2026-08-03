/**
 * Cross-window active-document broadcast for feature popout windows.
 * Main App windows emit; feature windows listen and follow active path.
 */

import { isTauri } from "@/lib/core/tauri";

export const WORKSPACE_ACTIVE_CHANGED_EVENT = "workspace:active-changed";
export const AGENT_OPEN_SESSION_EVENT = "agent:open-session";

export type WorkspaceActiveChangedPayload = {
	path: string | null;
	vaultPath: string | null;
	/** Paper title when known (Agent header etc.). */
	paperTitle?: string | null;
};

/** Emit from full App windows when the active dock document changes. */
export function broadcastWorkspaceActive(
	payload: WorkspaceActiveChangedPayload,
): void {
	if (!isTauri()) return;
	void (async () => {
		try {
			const { emit } = await import("@tauri-apps/api/event");
			await emit(WORKSPACE_ACTIVE_CHANGED_EVENT, payload);
		} catch {
			// non-fatal
		}
	})();
}

/** Subscribe in feature windows (and tests). */
export async function listenWorkspaceActive(
	handler: (payload: WorkspaceActiveChangedPayload) => void,
): Promise<() => void> {
	if (!isTauri()) return () => {};
	const { listen } = await import("@tauri-apps/api/event");
	const unlisten = await listen<WorkspaceActiveChangedPayload>(
		WORKSPACE_ACTIVE_CHANGED_EVENT,
		(event) => {
			handler(event.payload);
		},
	);
	return unlisten;
}

/** Forward PDF pin → Agent open requests into a popped-out agent window. */
export function broadcastAgentOpenSession(payload: unknown): void {
	if (!isTauri()) return;
	void (async () => {
		try {
			const { emit } = await import("@tauri-apps/api/event");
			await emit(AGENT_OPEN_SESSION_EVENT, payload);
		} catch {
			// non-fatal
		}
	})();
}

export async function listenAgentOpenSession(
	handler: (payload: unknown) => void,
): Promise<() => void> {
	if (!isTauri()) return () => {};
	const { listen } = await import("@tauri-apps/api/event");
	const unlisten = await listen(AGENT_OPEN_SESSION_EVENT, (event) => {
		handler(event.payload);
	});
	return unlisten;
}
