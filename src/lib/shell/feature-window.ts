/**
 * Native singleton feature windows (Agent / Backlinks / Annotations / References).
 */

import { notifyError } from "@/lib/core/notify";
import { isTauri } from "@/lib/core/tauri";
import {
	type RightSidebarTab,
	setFeaturePoppedOut,
	uiStore,
} from "@/lib/shell/ui-store";
import { getVaultPath } from "@/lib/vault/store";

/** Same set as right-rail tabs / leaf feature views. */
export type FeatureViewType = RightSidebarTab;

export function featureWindowLabel(view: FeatureViewType): string {
	return `feature-${view}`;
}

/** Open or focus the singleton feature window for `view`. */
export async function openFeatureWindow(view: FeatureViewType): Promise<void> {
	if (!isTauri()) {
		notifyError("Feature windows require the desktop app");
		return;
	}
	try {
		const { getActiveTabId, getTabs } = await import("@/lib/workspace/store");
		const activeId = getActiveTabId();
		const active = activeId
			? (getTabs().find((t) => t.id === activeId) ?? null)
			: null;
		const { invoke } = await import("@tauri-apps/api/core");
		await invoke("feature_window_open", {
			view,
			vaultPath: getVaultPath(),
			activePath: active?.path ?? null,
			paperTitle: active?.paperMeta?.title ?? null,
		});
		setFeaturePoppedOut(view, true);
		// Existing feature windows only get focused — re-broadcast so they follow.
		const { broadcastWorkspaceActive } = await import(
			"@/lib/shell/workspace-broadcast"
		);
		broadcastWorkspaceActive({
			path: active?.path ?? null,
			vaultPath: getVaultPath(),
			paperTitle: active?.paperMeta?.title ?? null,
		});
		// Collapse the right rail so the main window doesn't keep a duplicate surface.
		const { layout } = await import("@/lib/shell/ui-store");
		if (uiStore.getState().rightSidebarOpen) {
			layout()?.setRightCollapsed(true);
		}
	} catch (e) {
		notifyError(String(e));
	}
}

export async function closeFeatureWindow(view: FeatureViewType): Promise<void> {
	if (!isTauri()) return;
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		await invoke("feature_window_close", { view });
		setFeaturePoppedOut(view, false);
	} catch (e) {
		notifyError(String(e));
	}
}

export async function focusFeatureWindow(
	view: FeatureViewType,
): Promise<boolean> {
	if (!isTauri()) return false;
	try {
		const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
		const win = await WebviewWindow.getByLabel(featureWindowLabel(view));
		if (!win) return false;
		await win.setFocus();
		return true;
	} catch {
		return false;
	}
}

/** True when this webview is a feature popout (`?window=feature`). */
export function isFeatureWindowRoute(): boolean {
	try {
		return (
			new URLSearchParams(window.location.search).get("window") === "feature"
		);
	} catch {
		return false;
	}
}

export function readFeatureWindowView(): FeatureViewType | null {
	try {
		const view = new URLSearchParams(window.location.search).get("view");
		if (
			view === "agent" ||
			view === "backlinks" ||
			view === "annotations" ||
			view === "references"
		) {
			return view;
		}
		return null;
	} catch {
		return null;
	}
}

/** Subscribe main windows to feature_window_closed and clear popped-out flags. */
export function bindFeatureWindowClosedListener(): () => void {
	if (!isTauri()) return () => {};
	let unlisten: (() => void) | undefined;
	void (async () => {
		const { listen } = await import("@tauri-apps/api/event");
		unlisten = await listen<{ view: string }>("feature_window_closed", (e) => {
			const view = e.payload?.view;
			if (
				view === "agent" ||
				view === "backlinks" ||
				view === "annotations" ||
				view === "references"
			) {
				setFeaturePoppedOut(view, false);
			}
		});
	})();
	return () => {
		unlisten?.();
	};
}

export function isFeaturePoppedOut(view: FeatureViewType): boolean {
	return uiStore.getState().featurePoppedOut[view] === true;
}
