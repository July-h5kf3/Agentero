/**
 * Imperative dockview handle registry. The DockWorkspace component registers
 * its handle here so plain action modules (openTab/closeTab/…) can place and
 * activate panels without threading a React ref through every call site.
 * The shape mirrors `DockWorkspaceHandle` structurally (lib must not import
 * components — see .dependency-cruiser.cjs).
 */

import type { DocTab, OpenPlacement } from "@/lib/workspace/tabs";

export type DockHandle = {
	/** Add (or activate) a panel with optional split placement. */
	openPanel: (tab: DocTab, placement?: OpenPlacement) => void;
	/** Replace a panel id after a filesystem move while preserving its group. */
	remapPanel: (previousPanelId: string, tab: DocTab) => void;
	/** Cycle active panel by dockview `api.panels` order (wraps). */
	cycleActive: (delta: number) => void;
	/** Activate an existing panel by id. */
	activatePanel: (panelId: string) => void;
};

let handle: DockHandle | null = null;

export function registerDockHandle(next: DockHandle | null): void {
	handle = next;
}

export function dockHandle(): DockHandle | null {
	return handle;
}
