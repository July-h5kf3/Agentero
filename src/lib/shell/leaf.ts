/**
 * App-level leaf open API: documents and right-rail feature views share one
 * placement vocabulary (dock / right-rail / window). Hosts stay separate;
 * this module only routes open intents.
 */

import { isLibraryVirtualPath, isTrashVirtualPath } from "@/lib/paper/api";
import { openDocWindow } from "@/lib/shell/doc-window";
import { openFeatureWindow } from "@/lib/shell/feature-window";
import { openRightTab, type RightSidebarTab } from "@/lib/shell/ui-store";

/** Right-rail / feature-window view kinds (singleton UI surfaces). */
export type FeatureViewType = RightSidebarTab;

/** All leaf kinds the app can open. */
export type ViewType = "doc" | FeatureViewType;

/**
 * Where a leaf is shown.
 * - `dock` — center Dockview (documents)
 * - `right-rail` — main-window right sidebar (feature default)
 * - `window` — dedicated singleton/feature or per-path doc Webview
 */
export type LeafPlacement = "dock" | "right-rail" | "window";

export type DocLeafState = {
	path: string;
	mode?: string;
};

export type OpenLeafInput =
	| {
			viewType: FeatureViewType;
			placement?: Exclude<LeafPlacement, "dock">;
			state?: Record<string, never>;
	  }
	| {
			viewType: "doc";
			placement?: Extract<LeafPlacement, "dock" | "window">;
			state: DocLeafState;
	  };

export function isFeatureViewType(view: ViewType): view is FeatureViewType {
	return (
		view === "agent" ||
		view === "backlinks" ||
		view === "annotations" ||
		view === "references"
	);
}

function defaultPlacement(viewType: ViewType): LeafPlacement {
	return viewType === "doc" ? "dock" : "right-rail";
}

/**
 * Open a leaf at the given placement.
 */
export function openLeaf(input: OpenLeafInput): void {
	const placement = input.placement ?? defaultPlacement(input.viewType);

	if (input.viewType === "doc") {
		if (placement === "window") {
			void moveDocToWindow(input.state.path, input.state.mode);
			return;
		}
		void import("@/lib/workspace/actions").then(({ openTab }) => {
			openTab(input.state.path, {
				preferMode: input.state.mode as
					| "pdf"
					| "html"
					| "markdown"
					| "image"
					| undefined,
			});
		});
		return;
	}

	if (placement === "window") {
		void moveFeatureToWindow(input.viewType);
		return;
	}

	openRightTab(input.viewType);
}

/** Move (or open) a feature view in its singleton native window. */
export async function moveFeatureToWindow(
	view: FeatureViewType,
): Promise<void> {
	await openFeatureWindow(view);
}

/**
 * Move a document path into a dedicated native window and close the source
 * dock panel when present.
 */
export async function moveDocToWindow(
	path: string,
	mode?: string,
): Promise<void> {
	if (isLibraryVirtualPath(path) || isTrashVirtualPath(path)) {
		return;
	}
	await openDocWindow(path, mode);
	const [{ closeTab }, { tabIdForPath }] = await Promise.all([
		import("@/lib/workspace/actions"),
		import("@/lib/workspace/tabs"),
	]);
	closeTab(tabIdForPath(path));
}
