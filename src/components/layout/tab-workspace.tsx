import {
	type DockviewApi,
	DockviewDefaultTab,
	type DockviewDidDropEvent,
	type DockviewDndOverlayEvent,
	DockviewReact,
	type DockviewReadyEvent,
	type IDockviewPanelProps,
} from "dockview-react";
import {
	createContext,
	forwardRef,
	memo,
	useCallback,
	useContext,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
} from "react";
import { TabCenter, type TabCenterProps } from "@/components/layout/tab-center";
import { agenteroDockTheme } from "@/lib/dockview-theme";
import { isSplitDragPayload, readDraggedVaultPaths } from "@/lib/tab-dnd";
import {
	type DocTab,
	type OpenPlacement,
	panelPersistParams,
	type SplitDirection,
} from "@/lib/tabs";
import { cn } from "@/lib/utils";

export type WorkspaceExternalDrop = {
	paths: string[];
	direction: SplitDirection;
	referencePanelId: string | null;
};

/** Imperative API for App: open with placement, cycle focus (visual dockview order). */
export type TabWorkspaceHandle = {
	/** Add (or activate) a panel with optional split placement. */
	openPanel: (tab: DocTab, placement?: OpenPlacement) => void;
	/** Cycle active panel by dockview `api.panels` order (wraps). */
	cycleActive: (delta: number) => void;
	/** Activate an existing panel by id. */
	activatePanel: (panelId: string) => void;
};

type WorkspaceCtx = {
	tabsById: Map<string, DocTab>;
	activePanelId: string | null;
	centerProps: Omit<TabCenterProps, "tab" | "active" | "pdfKeepMounted">;
	pdfKeepMountedIds: Set<string>;
};

const WorkspaceContext = createContext<WorkspaceCtx | null>(null);

function useWorkspace(): WorkspaceCtx {
	const ctx = useContext(WorkspaceContext);
	if (!ctx) throw new Error("DockviewWorkspace context missing");
	return ctx;
}

function WorkspacePane(props: IDockviewPanelProps<{ panelId: string }>) {
	const { tabsById, activePanelId, centerProps, pdfKeepMountedIds } =
		useWorkspace();
	const panelId = props.params.panelId;
	const tab = tabsById.get(panelId) ?? null;
	if (!tab) {
		return <div className="h-full w-full bg-background" />;
	}
	const active = activePanelId === panelId;
	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
			<TabCenter
				{...centerProps}
				tab={tab}
				active={active}
				pdfKeepMounted={pdfKeepMountedIds.has(tab.id)}
			/>
		</div>
	);
}

const components = { pane: WorkspacePane };
/** Alias so layout snapshots that stored tabComponent:"default" still resolve. */
const tabComponents = { default: DockviewDefaultTab };

/**
 * Map dockview drop Position → addPanel Direction.
 * dockview uses top/bottom; addPanel uses above/below.
 * center → within (same group as a sibling tab).
 */
function toSplitDirection(
	position: DockviewDidDropEvent["position"],
): SplitDirection {
	if (position === "left") return "left";
	if (position === "top") return "above";
	if (position === "bottom") return "below";
	if (position === "center") return "within";
	return "right";
}

function isExternalPathDrag(native: DragEvent | PointerEvent): boolean {
	if (!(native instanceof DragEvent) || !native.dataTransfer) return false;
	return isSplitDragPayload(native.dataTransfer);
}

function resolveReferencePanel(
	api: DockviewApi,
	placement: OpenPlacement,
): string | undefined {
	if (placement?.referencePanelId && api.getPanel(placement.referencePanelId)) {
		return placement.referencePanelId;
	}
	if (api.activePanel?.id) return api.activePanel.id;
	return api.panels[0]?.id;
}

function addPanelWithPlacement(
	api: DockviewApi,
	tab: DocTab,
	placement: OpenPlacement,
): void {
	const referencePanel = resolveReferencePanel(api, placement);
	const direction = placement?.direction ?? "within";
	api.addPanel({
		id: tab.id,
		component: "pane",
		// Omit tabComponent so dockview uses its built-in default tab.
		// A string like "default" looks up tabComponents["default"] and throws
		// if not registered (undefined is not a React component).
		title: tab.title,
		params: panelPersistParams(tab),
		...(referencePanel
			? {
					position: {
						direction: direction === "within" ? "within" : direction,
						referencePanel,
					},
				}
			: {}),
	});
}

type DockviewWorkspaceProps = {
	tabs: DocTab[];
	activePanelId: string | null;
	/** Global dockview layout snapshot (null = rebuild from panel list). */
	layout: unknown | null;
	pdfKeepMountedIds: string[];
	centerProps: Omit<TabCenterProps, "tab" | "active" | "pdfKeepMounted">;
	onActivePanelChange: (panelId: string | null) => void;
	onClosePanel: (panelId: string) => void;
	onLayoutChange: (layout: unknown) => void;
	/** File-tree path drop into a split zone (title-bar tabs gone — only paths). */
	onExternalDrop: (drop: WorkspaceExternalDrop) => void;
	className?: string;
};

/**
 * Global center workspace: one DockviewReact owns all open document panels.
 * Split, tab chrome, close, reorder, and layout persistence are native dockview.
 *
 * React owns document content (`tabs[]`) + active path for sidebars / Paper Info.
 * Open-with-placement and focus cycling go through the imperative handle.
 *
 * @see https://dockview.dev/docs/core/dnd/external
 */
export const TabWorkspace = memo(
	forwardRef<TabWorkspaceHandle, DockviewWorkspaceProps>(function TabWorkspace(
		{
			tabs,
			activePanelId,
			layout,
			pdfKeepMountedIds,
			centerProps,
			onActivePanelChange,
			onClosePanel,
			onLayoutChange,
			onExternalDrop,
			className,
		},
		ref,
	) {
		const apiRef = useRef<DockviewApi | null>(null);
		const syncingRef = useRef(false);
		const layoutTimerRef = useRef<number | null>(null);
		const disposablesRef = useRef<{ dispose: () => void }[]>([]);
		const tabsRef = useRef(tabs);
		tabsRef.current = tabs;
		const layoutRef = useRef(layout);
		layoutRef.current = layout;
		const onCloseRef = useRef(onClosePanel);
		onCloseRef.current = onClosePanel;
		const onActiveRef = useRef(onActivePanelChange);
		onActiveRef.current = onActivePanelChange;
		const onLayoutRef = useRef(onLayoutChange);
		onLayoutRef.current = onLayoutChange;
		const onDropRef = useRef(onExternalDrop);
		onDropRef.current = onExternalDrop;

		const scheduleLayoutSave = useCallback((api: DockviewApi) => {
			if (layoutTimerRef.current != null) {
				window.clearTimeout(layoutTimerRef.current);
			}
			layoutTimerRef.current = window.setTimeout(() => {
				layoutTimerRef.current = null;
				if (syncingRef.current) {
					// Still mutating — try again after the batch settles.
					scheduleLayoutSave(api);
					return;
				}
				try {
					if (api.panels.length > 0) {
						onLayoutRef.current(api.toJSON());
					}
				} catch {
					// ignore
				}
			}, 120);
		}, []);

		const endSync = useCallback(
			(api: DockviewApi) => {
				requestAnimationFrame(() => {
					syncingRef.current = false;
					onActiveRef.current(api.activePanel?.id ?? null);
					scheduleLayoutSave(api);
				});
			},
			[scheduleLayoutSave],
		);

		const pdfKeepSet = useMemo(
			() => new Set(pdfKeepMountedIds),
			[pdfKeepMountedIds],
		);

		const tabsById = useMemo(() => {
			const m = new Map<string, DocTab>();
			for (const t of tabs) m.set(t.id, t);
			return m;
		}, [tabs]);

		const ctx = useMemo<WorkspaceCtx>(
			() => ({
				tabsById,
				activePanelId,
				centerProps,
				pdfKeepMountedIds: pdfKeepSet,
			}),
			[tabsById, activePanelId, centerProps, pdfKeepSet],
		);

		/** Membership only: add missing / remove closed. Placement is imperative. */
		const syncPanels = useCallback(
			(api: DockviewApi) => {
				const list = tabsRef.current;
				const wantIds = new Set(list.map((t) => t.id));

				syncingRef.current = true;
				try {
					for (const panel of [...api.panels]) {
						if (!wantIds.has(panel.id)) {
							api.removePanel(panel);
						}
					}

					for (const tab of list) {
						if (api.getPanel(tab.id)) continue;
						addPanelWithPlacement(api, tab, null);
					}
				} finally {
					endSync(api);
				}
			},
			[endSync],
		);

		useImperativeHandle(
			ref,
			() => ({
				openPanel(tab, placement = null) {
					const api = apiRef.current;
					if (!api) return;
					const existing = api.getPanel(tab.id);
					if (existing) {
						existing.api.setActive();
						return;
					}
					syncingRef.current = true;
					try {
						addPanelWithPlacement(api, tab, placement);
					} finally {
						endSync(api);
					}
				},
				cycleActive(delta) {
					const api = apiRef.current;
					if (!api || api.panels.length < 2) return;
					const panels = api.panels;
					const cur = api.activePanel?.id;
					const idx = panels.findIndex((p) => p.id === cur);
					const base = idx < 0 ? 0 : idx;
					const nextIdx = (base + delta + panels.length) % panels.length;
					panels[nextIdx]?.api.setActive();
				},
				activatePanel(panelId) {
					apiRef.current?.getPanel(panelId)?.api.setActive();
				},
			}),
			[endSync],
		);

		const onReady = useCallback(
			(event: DockviewReadyEvent) => {
				const api = event.api;
				apiRef.current = api;

				disposablesRef.current = [
					api.onUnhandledDragOver((e: DockviewDndOverlayEvent) => {
						if (!isExternalPathDrag(e.nativeEvent)) return;
						e.accept();
					}),
					api.onDidActivePanelChange((ev) => {
						if (syncingRef.current) return;
						onActiveRef.current(ev.panel?.id ?? null);
					}),
					api.onDidRemovePanel((panel) => {
						if (syncingRef.current) return;
						onCloseRef.current(panel.id);
					}),
					// Single layout-save path (debounce). Programmatic + user changes.
					api.onDidLayoutChange(() => {
						scheduleLayoutSave(api);
					}),
				];

				// Restore layout as the sole geometry source; rebuild only on failure.
				const list = tabsRef.current;
				const snap = layoutRef.current;
				if (snap && typeof snap === "object") {
					syncingRef.current = true;
					try {
						api.fromJSON(snap as Parameters<DockviewApi["fromJSON"]>[0]);
						for (const t of list) {
							const p = api.getPanel(t.id);
							if (!p) continue;
							p.api.setTitle(t.title);
							p.api.updateParameters(panelPersistParams(t));
						}
						// Drop layout panels that are no longer in React (stale ids).
						const want = new Set(list.map((t) => t.id));
						for (const panel of [...api.panels]) {
							if (!want.has(panel.id)) api.removePanel(panel);
						}
						// Add any React tabs missing from the snapshot.
						for (const tab of list) {
							if (!api.getPanel(tab.id)) {
								addPanelWithPlacement(api, tab, null);
							}
						}
						endSync(api);
					} catch {
						api.clear();
						// syncPanels owns endSync
						syncPanels(api);
					}
				} else {
					syncPanels(api);
				}
			},
			[endSync, scheduleLayoutSave, syncPanels],
		);

		// Sync membership when panel ids change (not titles).
		const panelIdsKey = tabs.map((t) => t.id).join("|");
		useEffect(() => {
			void panelIdsKey;
			const api = apiRef.current;
			if (!api) return;
			syncPanels(api);
		}, [panelIdsKey, syncPanels]);

		// Title + persist params channel (mode/path updates without full reconcile).
		const metaKey = tabs.map((t) => `${t.id}:${t.title}:${t.mode}`).join("|");
		useEffect(() => {
			void metaKey;
			const api = apiRef.current;
			if (!api) return;
			for (const tab of tabsRef.current) {
				const panel = api.getPanel(tab.id);
				if (!panel) continue;
				if (panel.title !== tab.title) {
					panel.api.setTitle(tab.title);
				}
				panel.api.updateParameters(panelPersistParams(tab));
			}
		}, [metaKey]);

		// Activate panel when React activePanelId changes (openTab / library).
		useEffect(() => {
			const api = apiRef.current;
			if (!api || !activePanelId || syncingRef.current) return;
			const panel = api.getPanel(activePanelId);
			if (panel && api.activePanel?.id !== activePanelId) {
				panel.api.setActive();
			}
		}, [activePanelId]);

		useEffect(() => {
			return () => {
				if (layoutTimerRef.current != null) {
					window.clearTimeout(layoutTimerRef.current);
					layoutTimerRef.current = null;
				}
				for (const d of disposablesRef.current) d.dispose();
				disposablesRef.current = [];
				apiRef.current = null;
			};
		}, []);

		const handleExternalDrop = useCallback((e: DockviewDidDropEvent) => {
			if (!isExternalPathDrag(e.nativeEvent)) return;
			const native = e.nativeEvent;
			if (!(native instanceof DragEvent) || !native.dataTransfer) return;
			const paths = readDraggedVaultPaths(native.dataTransfer);
			if (!paths.length) return;
			const direction = toSplitDirection(e.position);
			const referencePanelId =
				e.panel?.id ??
				e.group?.activePanel?.id ??
				e.group?.panels[0]?.id ??
				null;
			onDropRef.current({ paths, direction, referencePanelId });
		}, []);

		return (
			<WorkspaceContext.Provider value={ctx}>
				<div
					className={cn(
						"agentero-dockview agentero-dock-global h-full min-h-0 min-w-0 w-full",
						className,
					)}
				>
					<DockviewReact
						className="h-full w-full"
						theme={agenteroDockTheme}
						components={components}
						tabComponents={tabComponents}
						defaultTabComponent={DockviewDefaultTab}
						disableFloatingGroups
						dndEdges={{ size: { value: 24, type: "pixels" } }}
						onReady={onReady}
						onDidDrop={handleExternalDrop}
					/>
				</div>
			</WorkspaceContext.Provider>
		);
	}),
);

TabWorkspace.displayName = "TabWorkspace";
