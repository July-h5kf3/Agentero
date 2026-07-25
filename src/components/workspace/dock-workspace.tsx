/**
 * Side-effect import: dockview 7 registers optional modules
 * (ContextMenu, TabGroupChips, AdvancedDnD, Accessibility/keyboard dock)
 * only when the `dockview` package is evaluated. Importing `dockview-react`
 * alone can tree-shake that registration, leaving contextMenuService
 * undefined so tab right-click silently does nothing.
 */
import "dockview";
import {
	type DockviewApi,
	DockviewDefaultTab,
	type DockviewDidDropEvent,
	type DockviewDndOverlayEvent,
	type DockviewPanelRenderer,
	DockviewReact,
	type DockviewReadyEvent,
	type DockviewTabGroupColorEntry,
	type DockviewWillDropEvent,
	type DropOverlayModelParams,
	type GetTabContextMenuItemsParams,
	type GetTabGroupChipContextMenuItemsParams,
	type IDockviewPanel,
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
import { useTranslation } from "react-i18next";
import { DocView, type DocViewProps } from "@/components/workspace/doc-view";
import { cn } from "@/lib/core/utils";
import { TAG_COLOR_IDS, tagSwatchStyle } from "@/lib/ui/tag-colors";
import { agenteroDockTheme } from "@/lib/workspace/dockview-theme";
import {
	isSplitDragPayload,
	readDraggedVaultPaths,
} from "@/lib/workspace/tab-dnd";
import {
	type DocTab,
	type OpenPlacement,
	panelPersistParams,
	type SplitDirection,
} from "@/lib/workspace/tabs";
import type { CenterViewMode } from "@/lib/workspace/viewer";

/** Grey + paper tag palette (same swatches as library tags). */
const TAB_GROUP_COLORS = ["grey", ...TAG_COLOR_IDS] as const;

export type WorkspaceExternalDrop = {
	paths: string[];
	direction: SplitDirection;
	referencePanelId: string | null;
};

/** Imperative API for App: open with placement, cycle focus (visual dockview order). */
export type DockWorkspaceHandle = {
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
	centerProps: Omit<DocViewProps, "tab" | "active" | "pdfKeepMounted">;
	pdfKeepMountedIds: Set<string>;
};

const WorkspaceContext = createContext<WorkspaceCtx | null>(null);

function useWorkspace(): WorkspaceCtx {
	const ctx = useContext(WorkspaceContext);
	if (!ctx) throw new Error("DockWorkspace context missing");
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
			<DocView
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

/**
 * True when the drag is a dockview-internal panel/group move (PanelTransfer
 * present). Group drags may have `panelId: null` — still internal. External
 * file-tree path drops return undefined from getData().
 */
function isInternalDockDrag(getData: () => unknown): boolean {
	return getData() != null;
}

/**
 * Per-target overlay geometry. Content gets a slightly larger edge activation
 * than dockview's 20% default so left/right/above/below splits are easier in
 * wide panels; header void stays generous for "merge as sibling tab".
 */
function resolveDropOverlayModel({ location }: DropOverlayModelParams):
	| {
			size?: { value: number; type: "percentage" };
			activationSize?: { value: number; type: "percentage" };
	  }
	| undefined {
	if (location === "content") {
		return {
			activationSize: { value: 25, type: "percentage" },
			size: { value: 50, type: "percentage" },
		};
	}
	if (location === "header_space") {
		return {
			activationSize: { value: 50, type: "percentage" },
		};
	}
	// tab / edge: keep dockview defaults (edge shaped by dndEdges).
	return undefined;
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

/**
 * PDF panels use dockview `renderer: 'always'` so inactive sibling tabs keep
 * their React shell mounted (enables App-level PDF LRU keep-alive).
 * Other modes stay `onlyWhenVisible` to free DOM when not shown.
 */
function rendererForMode(mode: CenterViewMode): DockviewPanelRenderer {
	return mode === "pdf" ? "always" : "onlyWhenVisible";
}

function applyPanelRenderer(panel: IDockviewPanel, mode: CenterViewMode): void {
	const want = rendererForMode(mode);
	if (panel.api.renderer !== want) {
		panel.api.setRenderer(want);
	}
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
		renderer: rendererForMode(tab.mode),
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

/** Push React tab title / persist params / renderer onto an existing dockview panel. */
function applyTabPanelMeta(panel: IDockviewPanel, tab: DocTab): void {
	if (panel.title !== tab.title) {
		panel.api.setTitle(tab.title);
	}
	panel.api.updateParameters(panelPersistParams(tab));
	applyPanelRenderer(panel, tab.mode);
}

/**
 * Align dockview panel membership with React `tabs[]`:
 * drop stale panels, add missing ones (default placement).
 */
function reconcilePanelMembership(api: DockviewApi, list: DocTab[]): void {
	const wantIds = new Set(list.map((t) => t.id));
	for (const panel of [...api.panels]) {
		if (!wantIds.has(panel.id)) {
			api.removePanel(panel);
		}
	}
	for (const tab of list) {
		if (api.getPanel(tab.id)) continue;
		addPanelWithPlacement(api, tab, null);
	}
}

/**
 * After fromJSON restore: refresh meta for surviving panels, then membership.
 */
function reconcileAfterLayoutRestore(api: DockviewApi, list: DocTab[]): void {
	for (const tab of list) {
		const panel = api.getPanel(tab.id);
		if (!panel) continue;
		// Always re-apply: fromJSON may restore older title/params/renderer.
		panel.api.setTitle(tab.title);
		panel.api.updateParameters(panelPersistParams(tab));
		applyPanelRenderer(panel, tab.mode);
	}
	reconcilePanelMembership(api, list);
}

type DockWorkspaceProps = {
	tabs: DocTab[];
	activePanelId: string | null;
	/** Global dockview layout snapshot (null = rebuild from panel list). */
	layout: unknown | null;
	pdfKeepMountedIds: string[];
	centerProps: Omit<DocViewProps, "tab" | "active" | "pdfKeepMounted">;
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
export const DockWorkspace = memo(
	forwardRef<DockWorkspaceHandle, DockWorkspaceProps>(function DockWorkspace(
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
		const { t } = useTranslation("app");
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

		const tabGroupColors = useMemo<DockviewTabGroupColorEntry[]>(
			() =>
				TAB_GROUP_COLORS.map((id) => ({
					id,
					value:
						id === "grey"
							? "var(--muted-foreground)"
							: (tagSwatchStyle(id)?.backgroundColor ?? ""),
					label: t(`tabs.tabGroupColor.${id}` as const),
				})),
			[t],
		);

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
				syncingRef.current = true;
				try {
					reconcilePanelMembership(api, tabsRef.current);
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
					// Veto overlay for unknown external drags (keep internal + path drops).
					api.onWillShowOverlay((e) => {
						if (isInternalDockDrag(() => e.getData())) return;
						if (!isExternalPathDrag(e.nativeEvent)) {
							e.preventDefault();
						}
					}),
					api.onDidActivePanelChange((ev) => {
						if (syncingRef.current) return;
						onActiveRef.current(ev.panel?.id ?? null);
					}),
					api.onDidRemovePanel((panel) => {
						if (syncingRef.current) return;
						onCloseRef.current(panel.id);
					}),
					// Single layout-save path (debounce). Programmatic + user changes
					// (incl. tab-group rename / color / membership via toJSON).
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
						// fromJSON may restore older title/params/renderer; drop stale /
						// add missing panels.
						reconcileAfterLayoutRestore(api, list);
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

		// Title + persist params + renderer channel (mode/path without full membership).
		const metaKey = tabs.map((t) => `${t.id}:${t.title}:${t.mode}`).join("|");
		useEffect(() => {
			void metaKey;
			const api = apiRef.current;
			if (!api) return;
			for (const tab of tabsRef.current) {
				const panel = api.getPanel(tab.id);
				if (!panel) continue;
				applyTabPanelMeta(panel, tab);
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

		/** Cancel drop for unknown external payloads; internal moves always ok. */
		const handleWillDrop = useCallback((e: DockviewWillDropEvent) => {
			if (isInternalDockDrag(() => e.getData())) return;
			if (!isExternalPathDrag(e.nativeEvent)) {
				e.preventDefault();
			}
		}, []);

		/**
		 * Tab right-click menu (dockview opt-in). Close actions + tab-group
		 * create/remove. Closures go through panel.api.close() → onDidRemovePanel.
		 */
		const getTabContextMenuItems = useCallback(
			({ panel, group, api }: GetTabContextMenuItemsParams) => {
				const hasOthers = group.panels.length > 1;
				const existing = api.getTabGroupForPanel({
					groupId: group.id,
					panelId: panel.id,
				});
				const menu: Array<
					| "separator"
					| { label: string; disabled?: boolean; action: () => void }
				> = [
					{
						label: t("tabs.contextClose"),
						action: () => panel.api.close(),
					},
					{
						label: t("tabs.contextCloseOthers"),
						disabled: !hasOthers,
						action: () => {
							for (const p of group.panels) {
								if (p !== panel) p.api.close();
							}
						},
					},
					{
						label: t("tabs.contextCloseAll"),
						action: () => {
							for (const p of [...group.panels]) {
								p.api.close();
							}
						},
					},
					"separator",
				];

				if (existing) {
					menu.push({
						label: t("tabs.contextRemoveFromTabGroup"),
						action: () => {
							api.removePanelFromTabGroup({
								groupId: group.id,
								panelId: panel.id,
							});
						},
					});
				} else {
					menu.push({
						label: t("tabs.contextCreateTabGroup"),
						action: () => {
							const tg = api.createTabGroup({
								groupId: group.id,
								label: t("tabs.tabGroupDefaultName"),
								color: "blue",
							});
							api.addPanelToTabGroup({
								groupId: group.id,
								tabGroupId: tg.id,
								panelId: panel.id,
							});
						},
					});
				}

				return menu;
			},
			[t],
		);

		const getTabGroupChipContextMenuItems = useCallback(
			({ tabGroup, group, api }: GetTabGroupChipContextMenuItemsParams) => {
				return [
					"rename" as const,
					"colorPicker" as const,
					"separator" as const,
					{
						label: t("tabs.tabGroupDissolve"),
						action: () => {
							api.dissolveTabGroup({
								groupId: group.id,
								tabGroupId: tabGroup.id,
							});
						},
					},
				];
			},
			[t],
		);

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
						// Tauri WKWebView: HTML5 DnD is unreliable; pointer covers mouse+touch.
						// Floating/popout already disabled — no cross-window HTML5 drag needed.
						dndStrategy="pointer"
						dndEdges={{ size: { value: 24, type: "pixels" } }}
						dropOverlayModel={resolveDropOverlayModel}
						// Within-group tabs + between groups + Ctrl+M keyboard dock.
						// Orthogonal to App ⌥⌘←/→ which cycles all panels by visual order.
						keyboardNavigation
						tabGroupAccent="palette"
						tabGroupColors={tabGroupColors}
						getTabContextMenuItems={getTabContextMenuItems}
						getTabGroupChipContextMenuItems={getTabGroupChipContextMenuItems}
						onReady={onReady}
						onWillDrop={handleWillDrop}
						onDidDrop={handleExternalDrop}
					/>
				</div>
			</WorkspaceContext.Provider>
		);
	}),
);

DockWorkspace.displayName = "DockWorkspace";
