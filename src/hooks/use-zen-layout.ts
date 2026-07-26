/**
 * Zen / rail layout controller: owns the resizable panel refs and the
 * imperative collapse / expand / zen transitions, and registers them into the
 * ui-store so plain actions (palette, shortcuts, agent) can drive layout.
 */

import { type RefObject, useEffect, useMemo, useRef } from "react";
import { usePanelRef } from "react-resizable-panels";
import {
	registerLayoutController,
	setAgentPanelMounted,
	setAgentZenMode,
	setPdfZenMode,
	setRightSidebarOpenState,
	setRightSidebarTab,
	setSidebarCollapsedState,
	uiStore,
} from "@/lib/shell/ui-store";
import { toggleNotesSplit } from "@/lib/workspace/actions";
import { getActiveTabId, getTabs } from "@/lib/workspace/store";
import { tabHasNotesSplit, tabNotesEligible } from "@/lib/workspace/tabs";

export const SIDEBAR_DEFAULT_PX = 200;
export const RIGHT_SIDEBAR_DEFAULT_PX = 320;

export type ZenLayout = {
	sidebarPanelRef: ReturnType<typeof usePanelRef>;
	rightSidebarPanelRef: ReturnType<typeof usePanelRef>;
	sourcePanelRef: ReturnType<typeof usePanelRef>;
	sidebarAsideRef: RefObject<HTMLElement | null>;
	editorPaneRef: RefObject<HTMLDivElement | null>;
	/** Last expanded rail widths in px (survive collapse / zen round-trips). */
	leftWidthPxRef: RefObject<number>;
	rightWidthPxRef: RefObject<number>;
};

export function useZenLayout(): ZenLayout {
	const sidebarPanelRef = usePanelRef();
	const rightSidebarPanelRef = usePanelRef();
	const sourcePanelRef = usePanelRef();
	const sidebarAsideRef = useRef<HTMLElement>(null);
	const editorPaneRef = useRef<HTMLDivElement>(null);
	const leftWidthPxRef = useRef(SIDEBAR_DEFAULT_PX);
	const rightWidthPxRef = useRef(RIGHT_SIDEBAR_DEFAULT_PX);
	const leftCollapsedBeforeZenRef = useRef(false);
	const leftCollapsedBeforePdfZenRef = useRef(false);
	const rightOpenBeforePdfZenRef = useRef(false);

	const controller = useMemo(() => {
		/** Collapse / expand left file-tree panel without remounting. */
		const setLeftCollapsed = (collapsed: boolean) => {
			const panel = sidebarPanelRef.current;
			if (panel) {
				if (collapsed) {
					try {
						panel.collapse();
					} catch {
						// ignore
					}
				} else {
					try {
						panel.expand();
					} catch {
						// ignore
					}
					try {
						panel.resize(leftWidthPxRef.current || SIDEBAR_DEFAULT_PX);
					} catch {
						// ignore
					}
				}
			}
			setSidebarCollapsedState(collapsed);
		};

		/** Collapse / expand right Agent/Backlinks panel (always mounted). */
		const setRightCollapsed = (
			collapsed: boolean,
			_opts?: { focusAgent?: boolean },
		) => {
			const panel = rightSidebarPanelRef.current;
			if (panel) {
				if (collapsed) {
					try {
						panel.collapse();
					} catch {
						// ignore
					}
				} else {
					try {
						panel.expand();
					} catch {
						// ignore
					}
					try {
						panel.resize(rightWidthPxRef.current || RIGHT_SIDEBAR_DEFAULT_PX);
					} catch {
						// ignore
					}
				}
			}
			setRightSidebarOpenState(!collapsed);
		};

		/**
		 * Enter agent zen mode: collapse left + center, expand Agent rail full
		 * width. Keeps the same AgentPanel instance so conversation survives.
		 */
		const enterAgentZen = () => {
			leftCollapsedBeforeZenRef.current = uiStore.getState().sidebarCollapsed;
			setAgentZenMode(true);
			setAgentPanelMounted(true);
			setRightSidebarTab("agent");
			setRightCollapsed(false, { focusAgent: true });
			setLeftCollapsed(true);
			requestAnimationFrame(() => {
				try {
					sourcePanelRef.current?.collapse();
				} catch {
					// ignore
				}
				try {
					rightSidebarPanelRef.current?.expand();
				} catch {
					// ignore
				}
				try {
					rightSidebarPanelRef.current?.resize("100%");
				} catch {
					// ignore
				}
			});
		};

		const exitAgentZen = () => {
			setAgentZenMode(false);
			requestAnimationFrame(() => {
				try {
					sourcePanelRef.current?.expand();
				} catch {
					// ignore
				}
				try {
					sourcePanelRef.current?.resize("40");
				} catch {
					// ignore
				}
				try {
					rightSidebarPanelRef.current?.resize(
						rightWidthPxRef.current || RIGHT_SIDEBAR_DEFAULT_PX,
					);
				} catch {
					// ignore
				}
				if (!leftCollapsedBeforeZenRef.current) {
					setLeftCollapsed(false);
				}
			});
		};

		/**
		 * Immersive PDF reading: collapse both side rails and hide the center
		 * header so the viewer fills the window.
		 */
		const enterPdfZen = () => {
			const { sidebarCollapsed, rightSidebarOpen } = uiStore.getState();
			leftCollapsedBeforePdfZenRef.current = sidebarCollapsed;
			rightOpenBeforePdfZenRef.current = rightSidebarOpen;
			setPdfZenMode(true);
			setLeftCollapsed(true);
			setRightCollapsed(true);
		};

		const exitPdfZen = () => {
			setPdfZenMode(false);
			if (!leftCollapsedBeforePdfZenRef.current) setLeftCollapsed(false);
			if (rightOpenBeforePdfZenRef.current) setRightCollapsed(false);
		};

		const focusSidebar = () => {
			if (uiStore.getState().agentZenMode) return;
			setLeftCollapsed(false);
			requestAnimationFrame(() => {
				sidebarAsideRef.current?.querySelector<HTMLElement>("button")?.focus();
			});
		};

		const focusEditorPane = () => {
			editorPaneRef.current
				?.querySelector<HTMLElement>("[contenteditable='true']")
				?.focus();
		};

		const focusNotesEditor = () => {
			const tab = getTabs().find((t) => t.id === getActiveTabId());
			if (tab && tabNotesEligible(tab) && !tabHasNotesSplit(getTabs(), tab)) {
				toggleNotesSplit();
			}
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					// Prefer a NOTES secondary-pane editor when present.
					const root = editorPaneRef.current;
					if (!root) return;
					const editables = root.querySelectorAll<HTMLElement>(
						"[contenteditable='true']",
					);
					const target = editables[editables.length - 1] ?? editables[0];
					target?.focus();
				});
			});
		};

		return {
			setLeftCollapsed,
			setRightCollapsed,
			enterAgentZen,
			exitAgentZen,
			enterPdfZen,
			exitPdfZen,
			focusSidebar,
			focusEditorPane,
			focusNotesEditor,
		};
	}, [sidebarPanelRef, rightSidebarPanelRef, sourcePanelRef]);

	useEffect(() => {
		registerLayoutController(controller);
		return () => registerLayoutController(null);
	}, [controller]);

	return {
		sidebarPanelRef,
		rightSidebarPanelRef,
		sourcePanelRef,
		sidebarAsideRef,
		editorPaneRef,
		leftWidthPxRef,
		rightWidthPxRef,
	};
}
