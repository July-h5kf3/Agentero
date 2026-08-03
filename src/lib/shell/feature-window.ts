/**
 * Native singleton feature windows (Agent / Backlinks / Annotations / References).
 *
 * Policy: at most one surface per view. If a feature window is open, all open
 * intents focus that window and the main right-rail / agent zen must not host
 * a second instance of the same view.
 */

import { notifyError } from "@/lib/core/notify";
import { isTauri } from "@/lib/core/tauri";
import {
	layout,
	type RightSidebarTab,
	setAgentPanelMounted,
	setAgentZenMode,
	setFeaturePoppedOut,
	setRightSidebarTab,
	uiStore,
} from "@/lib/shell/ui-store";
import { getVaultPath } from "@/lib/vault/store";

/** Same set as right-rail tabs / leaf feature views. */
export type FeatureViewType = RightSidebarTab;

const FEATURE_TAB_ORDER: RightSidebarTab[] = [
	"agent",
	"backlinks",
	"annotations",
	"references",
];

export function featureWindowLabel(view: FeatureViewType): string {
	return `feature-${view}`;
}

/**
 * Drop main-window *content* for a view that now lives in a singleton window
 * (avoids dual Agent panels, etc.). Does **not** collapse the right rail —
 * title-bar feature switcher buttons must stay available for other views.
 */
function clearMainHostForFeature(view: FeatureViewType): void {
	setFeaturePoppedOut(view, true);
	if (view === "agent") {
		setAgentPanelMounted(false);
		if (uiStore.getState().agentZenMode) {
			// Prefer layout exit so panel sizes restore; fall back to flag only.
			const ctrl = layout();
			if (ctrl) ctrl.exitAgentZen();
			else setAgentZenMode(false);
		}
	}
	// Rail stays open. If the selected rail tab is the one now in a window,
	// switch to another non-popped-out tab so the switcher + content remain usable.
	const { rightSidebarTab, featurePoppedOut } = uiStore.getState();
	if (rightSidebarTab !== view) return;
	const next = FEATURE_TAB_ORDER.find(
		(t) => t !== view && !featurePoppedOut[t],
	);
	if (!next) return;
	setRightSidebarTab(next);
	if (next === "agent") setAgentPanelMounted(true);
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
		const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
		const existed =
			(await WebviewWindow.getByLabel(featureWindowLabel(view))) != null;
		const { invoke } = await import("@tauri-apps/api/core");
		await invoke("feature_window_open", {
			view,
			vaultPath: getVaultPath(),
			activePath: active?.path ?? null,
			paperTitle: active?.paperMeta?.title ?? null,
		});
		clearMainHostForFeature(view);
		// Existing feature windows only get focused — re-broadcast so they follow.
		const { broadcastWorkspaceActive, scheduleAgentSessionHandoffFromMain } =
			await import("@/lib/shell/workspace-broadcast");
		broadcastWorkspaceActive({
			path: active?.path ?? null,
			vaultPath: getVaultPath(),
			paperTitle: active?.paperMeta?.title ?? null,
		});
		// New Agent window only: push the open conversation so the popout
		// continues the same chat (do not re-handoff on focus — would clobber
		// in-window progress with a stale main snapshot).
		if (view === "agent" && !existed) {
			scheduleAgentSessionHandoffFromMain();
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

/**
 * Probe whether the singleton feature Webview exists and focus it.
 * Updates `featurePoppedOut` from live window state (not only the in-memory flag).
 */
export async function focusFeatureWindow(
	view: FeatureViewType,
): Promise<boolean> {
	if (!isTauri()) return false;
	try {
		const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
		const win = await WebviewWindow.getByLabel(featureWindowLabel(view));
		if (!win) {
			setFeaturePoppedOut(view, false);
			return false;
		}
		await win.setFocus();
		clearMainHostForFeature(view);
		return true;
	} catch {
		setFeaturePoppedOut(view, false);
		return false;
	}
}

/**
 * Prefer an existing singleton feature window over the main right rail.
 * Returns true when the window was found and focused.
 */
export async function preferFeatureWindow(
	view: FeatureViewType,
): Promise<boolean> {
	return focusFeatureWindow(view);
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
