import { FolderOpen } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePanelRef } from "react-resizable-panels";
import { ErrorBoundary } from "@/components/error-boundary";
import { AgentPanel } from "@/components/layout/agent/agent-panel";
import { CommandPalette } from "@/components/layout/dialogs/command-palette";
import { ImportLocalPdfDialog } from "@/components/layout/dialogs/import-local-pdf-dialog";
import { MovePapersDialog } from "@/components/layout/dialogs/move-papers-dialog";
import { ZoteroMigrateDialog } from "@/components/layout/dialogs/zotero-migrate-dialog";
import { BackgroundTasksPanel } from "@/components/layout/shell/background-tasks-panel";
import {
	ResizableGroup,
	ResizableHandle,
	ResizablePanel,
} from "@/components/layout/shell/resizable";
import { VaultWelcome } from "@/components/layout/shell/vault-welcome";
import { WorkspaceHeader } from "@/components/layout/shell/workspace-header";
import { BacklinksPanel } from "@/components/layout/sidebar/backlinks-panel";
import {
	FileTree,
	type FileTreeHandle,
	type TreeCreateDraft,
	type TreeCreateKind,
	VaultSidebarHeader,
} from "@/components/layout/sidebar/file-tree";
import { GraphPanel } from "@/components/layout/sidebar/graph-panel";
import { PaperInfoPanel } from "@/components/layout/sidebar/paper-info-panel";
import {
	TabWorkspace,
	type TabWorkspaceHandle,
	type WorkspaceExternalDrop,
} from "@/components/layout/workspace/tab-workspace";
import {
	type SettingsSection,
	SettingsWindow,
} from "@/components/settings-window";
import {
	type AnnotationRow,
	AnnotationsPanel,
	type AskRow,
} from "@/components/viewer/annotations-panel";
import type { PdfViewerHandle } from "@/components/viewer/embed/pdf-viewer";
import { useAppShortcuts } from "@/hooks/use-app-shortcuts";
import { useExternalFileDrop } from "@/hooks/use-external-file-drop";
import { useNativeMenuEvents } from "@/hooks/use-native-menu-events";
import { useAnyOverlayOpen } from "@/hooks/use-overlay-registration";
import { useVaultFileEvents } from "@/hooks/use-vault-file-events";
import i18n, { resolveLocale } from "@/i18n";
import {
	completeBackgroundTask,
	failBackgroundTask,
	isBackgroundTaskCancelledError,
	runBackgroundTask,
	runQueuedBackgroundTask,
	startBackgroundTask,
	updateBackgroundTask,
} from "@/lib/background-tasks";
import type { AppCommand, PaletteMode } from "@/lib/commands/types";
import {
	type ConnectorItemSaved,
	type ConnectorProgress,
	connectorSetEnabled,
	connectorSetParentDir,
	connectorSetVault,
} from "@/lib/connector";
import {
	cleanupImportTempPaths,
	isImportTempPath,
} from "@/lib/external-file-drop";
import {
	addPapersByIdentifiers,
	downloadPaperAssets,
	importLocalPdfs,
	type LocalPdfImportEntry,
} from "@/lib/lookup";
import {
	notifyError,
	notifySuccess,
	notifyUndo,
	notifyWarning,
} from "@/lib/notify";
import { closeTopOverlay } from "@/lib/overlay-stack";
import {
	collectPaperFoldersFromTree,
	collectPapersNeedingAssetDownload,
	detectPaperDirectory,
	isPaperDirectory,
	notesPathForPaper,
	type PaperMetadata,
	type PaperTag,
	paperCatalogPath,
	paperDirFromPath,
	resolvePapersParentDir,
} from "@/lib/paper-metadata";
import {
	maybeAutoRunPaperReader,
	paperAssetsReadyForReader,
	runPaperReaderWorkflow,
} from "@/lib/paper-read";
import {
	exportLibraryToFile,
	importLibraryFromFile,
	isLibraryVirtualPath,
	isTrashVirtualPath,
	LIBRARY_VIRTUAL_PATH,
	listPapers,
	listTrash,
	movePaperFolder,
	purgeAllTrash,
	rescanPapers,
	setPaperTags,
	TRASH_VIRTUAL_PATH,
	trashPaths,
} from "@/lib/papers-api";
import type { PdfAskThread } from "@/lib/pdf-ask/types";
import { normalizeHighlightColor } from "@/lib/pdf-highlight/palette";
import type { PdfHighlight } from "@/lib/pdf-highlight/types";
import {
	clearRemoteSessionMeta,
	isRemoteVaultHandle,
	rememberRecentRemoteVault,
	remoteConnect,
	remoteDisconnect,
	remoteSessionIdFromHandle,
	saveRemoteSessionMeta,
} from "@/lib/remote-vault";
import { openInTerminal, revealInFileManager } from "@/lib/reveal";
import {
	type AppSettings,
	type LibraryColumnPref,
	loadSettings,
	saveSettings,
	subscribeSettings,
	UI_SCALE_PRESETS,
} from "@/lib/settings";
import {
	basenameOf,
	createNotesSplitPane,
	createPlaceholderTab,
	type DocTab,
	ensureFullLibraryTab,
	insertPlaceholderTab,
	loadPersistedTabs,
	loadTabResources,
	normalizeTabPath,
	type OpenPlacement,
	patchTab,
	removeTab,
	removeTabsUnderPath,
	reseedMarkdownTab,
	reseedNotesTab,
	revokeTabMediaSources,
	savePersistedTabs,
	syncTabSeedsForPath,
	tabHasNotesSplit,
	tabIdForPath,
	tabIsPaperNotes,
	tabNotesEligible,
} from "@/lib/tabs";
import { isMacOS, isTauri } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import {
	collectDirectoryRelPaths,
	collectMarkdownRelPaths,
	createVault,
	createVaultDirectory,
	ensureLocalFsScope,
	ensureVault,
	type FileNode,
	getRecentVaults,
	getSavedVaultPath,
	isMarkdownPath,
	isValidVaultEntryName,
	joinVaultPath,
	listVaultDirChildren,
	loadVaultTree,
	openNewWindow,
	pickCreateVaultDirectory,
	pickVaultDirectory,
	readVaultFile,
	removeRecentVault,
	replaceTreeNodeChildren,
	saveVaultPath,
	seededSkillIdsFromCreated,
	vaultDisplayName,
	vaultRelativePath,
	writeVaultFile,
} from "@/lib/vault";
import { type CenterViewMode, preferredModeForPath } from "@/lib/viewer";
import {
	missingNotePath,
	newNoteMarkdown,
	normalizeVaultRel,
	rebuildWikiIndex,
	toVaultRelative,
	type WikiNavTarget,
} from "@/lib/wiki";
import { WikiNavContext } from "@/lib/wiki-nav-context";

/**
 * Number of PDF tabs kept mounted (most recent first). The active PDF tab is
 * always mounted; recently viewed PDF tabs stay mounted so switching between
 * them is instant (re-opening a PDFium document blocks the main thread). Older
 * PDF tabs beyond this cap unmount and release their engine document.
 */
const PDF_TAB_MOUNT_LRU = 4;

export default function App() {
	const { t } = useTranslation(["app", "sidebar", "editor"]);
	const { setTheme } = useTheme();
	const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
	const settingsRef = useRef(settings);
	settingsRef.current = settings;
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [settingsSection, setSettingsSection] =
		useState<SettingsSection>("general");
	const settingsOpenRef = useRef(settingsOpen);
	settingsOpenRef.current = settingsOpen;

	const [vaultPath, setVaultPath] = useState<string | null>(() => {
		if (!isTauri()) return null;
		return getSavedVaultPath({
			allowRestore: loadSettings().restoreLastVault,
		});
	});
	const [tree, setTree] = useState<FileNode[]>([]);
	const [treeLoading, setTreeLoading] = useState(() => Boolean(vaultPath));
	/**
	 * Seed open panels + layout from localStorage on first paint so TabWorkspace
	 * onReady can fromJSON before any membership sync (avoids empty→rebuild race).
	 */
	const persistedSession = useMemo(() => {
		if (!isTauri()) return null;
		return loadPersistedTabs();
	}, []);
	/** Open document panels (flat list; layout owned by global dockview). */
	const [tabs, setTabs] = useState<DocTab[]>(() => {
		if (!persistedSession?.tabs.length) return [];
		return persistedSession.tabs.map((pt) =>
			createPlaceholderTab(pt.path, pt.mode),
		);
	});
	const [activeTabId, setActiveTabId] = useState<string | null>(
		() => persistedSession?.activeId ?? null,
	);
	/** Global dockview grid snapshot (panel ids = tab ids). */
	const [dockLayout, setDockLayout] = useState<unknown | null>(
		() => persistedSession?.layout ?? null,
	);
	/** Imperative open/cycle against live dockview (placement, visual order). */
	const workspaceRef = useRef<TabWorkspaceHandle>(null);
	/** Most-recently-viewed PDF tab ids kept mounted (see PDF_TAB_MOUNT_LRU). */
	const [pdfLru, setPdfLru] = useState<string[]>([]);
	/**
	 * File-tree selection / create-parent context. Follows the active document,
	 * but a folder create can point it at a folder without opening a tab.
	 */
	const [treeSelectedPath, setTreeSelectedPath] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	/** Inline new file/folder draft in the tree (IDE-style). */
	const [createDraft, setCreateDraft] = useState<TreeCreateDraft | null>(null);
	const [recentVaults, setRecentVaults] = useState<string[]>(() =>
		getRecentVaults(),
	);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [libraryPapers, setLibraryPapers] = useState<PaperMetadata[]>([]);
	const [libraryLoading, setLibraryLoading] = useState(false);
	/** Title search query for the papers library view. */
	const [libraryQuery, setLibraryQuery] = useState("");
	/**
	 * Vault-relative folder filter for the single Library tab (e.g. `papers/nlp/pretrain`).
	 * Null = full library. Set by clicking org folders in the tree — does not open new tabs.
	 */
	const [libraryScopePath, setLibraryScopePath] = useState<string | null>(null);

	/**
	 * Right sidebar (⌘L): Agent (default) or Backlinks with Graph below.
	 * Collapsed by default; top-bar icons open a tab.
	 */
	const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
	const [rightSidebarTab, setRightSidebarTab] = useState<
		"agent" | "backlinks" | "annotations"
	>("agent");
	/**
	 * Agent zen / quest mode: hide vault chrome, full-width Agent chat
	 * (Cursor Agents Window / VS Code zen — distraction-free single surface).
	 */
	const [agentZenMode, setAgentZenMode] = useState(false);
	/** Immersive full-window PDF reading: hide chrome, center a comfortable width. */
	const [pdfZenMode, setPdfZenMode] = useState(false);
	/** Keep AgentPanel mounted across sidebar ↔ zen so chat history is not lost. */
	const [agentPanelMounted, setAgentPanelMounted] = useState(false);
	/** Bumped after graph_rebuild so Backlinks/Graph re-fetch. */
	const [wikiIndexRevision, setWikiIndexRevision] = useState(0);
	/** Increment to open magic-wand popover (⇧⌘I). */
	const [lookupOpenSignal, setLookupOpenSignal] = useState(0);
	/** Zotero one-click migration dialog. */
	const [zoteroOpen, setZoteroOpen] = useState(false);
	const sidebarPanelRef = usePanelRef();
	const rightSidebarPanelRef = usePanelRef();
	const sourcePanelRef = usePanelRef();
	const editorPaneRef = useRef<HTMLDivElement>(null);
	const fileTreeRef = useRef<FileTreeHandle>(null);
	const sidebarAsideRef = useRef<HTMLElement>(null);
	const chatInputFocusKey = useRef(0);
	const agentZenModeRef = useRef(false);
	const pdfZenModeRef = useRef(false);
	pdfZenModeRef.current = pdfZenMode;
	const leftCollapsedBeforePdfZenRef = useRef(false);
	const rightOpenBeforePdfZenRef = useRef(false);
	const leftCollapsedBeforeZenRef = useRef(false);
	/** Last expanded left-rail width in px (survive Notes mount remount). */
	const leftWidthPxRef = useRef(200);
	const rightWidthPxRef = useRef(320);

	const isDemo = vaultPath === null;
	// macOS keeps native traffic lights (Overlay title bar); other desktop
	// platforms are frameless and draw their own caption buttons on the right.
	const isMacDesktop = isTauri() && isMacOS();
	const showWindowControls = isTauri() && !isMacOS();
	const vaultMdFiles = useMemo(
		() => collectMarkdownRelPaths(tree, vaultPath),
		[tree, vaultPath],
	);
	/** Directory paths for Agent context chip folder icons. */
	const vaultDirPaths = useMemo(
		() => collectDirectoryRelPaths(tree, vaultPath),
		[tree, vaultPath],
	);
	/** Paper folders at any depth under papers/ (marker-based). */
	const paperFolders = useMemo(() => collectPaperFoldersFromTree(tree), [tree]);
	/** Vault-relative paper paths for Agent chip paper (ScrollText) icons. */
	const vaultPaperPaths = useMemo(
		() =>
			paperFolders
				.map((p) => toVaultRelative(vaultPath, p))
				.filter((p) => p.length > 0),
		[paperFolders, vaultPath],
	);

	const activeTab = useMemo(
		() => tabs.find((t) => t.id === activeTabId) ?? null,
		[tabs, activeTabId],
	);
	// Keep active PDF panels plus a few recently viewed ones mounted.
	useEffect(() => {
		const ids = tabs.filter((t) => t.mode === "pdf").map((t) => t.id);
		const activePdf = activeTab?.mode === "pdf" ? activeTab.id : null;
		if (!activePdf && !ids.length) return;
		setPdfLru((prev) => {
			let next = prev;
			const promote = activePdf ? [activePdf, ...ids] : ids;
			for (const id of promote) {
				if (next[0] === id) continue;
				next = [id, ...next.filter((x) => x !== id)];
			}
			return next.slice(0, PDF_TAB_MOUNT_LRU);
		});
	}, [activeTab?.mode, activeTab?.id, tabs]);
	/** Active document identity — downstream panels read this as before. */
	const selectedPath = activeTab?.path ?? null;
	const paperMeta = activeTab?.paperMeta ?? null;

	// Tree selection / create-parent follows the active document.
	// Scoped library keeps the tree highlight on the org folder, not agentero:library.
	useEffect(() => {
		if (!selectedPath) return;
		if (isLibraryVirtualPath(selectedPath) && libraryScopePath && vaultPath) {
			setTreeSelectedPath(joinVaultPath(vaultPath, libraryScopePath));
			return;
		}
		setTreeSelectedPath(selectedPath);
	}, [selectedPath, libraryScopePath, vaultPath]);

	const paperFoldersRef = useRef(paperFolders);
	paperFoldersRef.current = paperFolders;
	const treeRef = useRef(tree);
	treeRef.current = tree;
	const vaultPathRef = useRef(vaultPath);
	const connectorProgressTasksRef = useRef(new Map<string, string>());
	vaultPathRef.current = vaultPath;
	/** Invalidates in-flight tree loads when the active Vault changes. */
	const treeLoadGenerationRef = useRef(0);
	const restoredVaultPathRef = useRef(vaultPath);
	/** Normalized paths currently being reloaded from disk; suppresses the editor
	 * unmount-flush so an external/Agent write is never clobbered by stale in-memory text. */
	const reseedGuardRef = useRef<Set<string>>(new Set());
	const treeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	/** Debounced wiki/backlinks/graph index rebuild after on-disk changes. */
	const wikiRebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	/** Latest rebuildWikiAndNotify (defined below) for the stable wiki scheduler. */
	const rebuildWikiRef = useRef<(path: string) => Promise<void>>(
		async () => {},
	);

	// Validate the restored local Vault before restoring its tree and tabs.
	// The path can remain in localStorage after the directory is deleted.
	useEffect(() => {
		const restoredPath = restoredVaultPathRef.current;
		if (!isTauri() || !restoredPath || isRemoteVaultHandle(restoredPath)) {
			return;
		}

		let cancelled = false;
		void ensureLocalFsScope(restoredPath)
			.then(() => import("@tauri-apps/plugin-fs"))
			.then(({ exists }) => exists(restoredPath))
			.then((pathExists) => {
				if (cancelled || pathExists || vaultPathRef.current !== restoredPath) {
					return;
				}
				saveVaultPath(null);
				setVaultPath(null);
				setTree([]);
				setTabs([]);
				setActiveTabId(null);
				setTreeSelectedPath(null);
			})
			.catch(() => {
				// Leave the restored state intact when the existence check fails.
			});

		return () => {
			cancelled = true;
		};
	}, []);

	/** Merge a patch into the panel with the given id. */
	const updateTab = useCallback((id: string, patch: Partial<DocTab>) => {
		setTabs((prev) => patchTab(prev, id, patch));
	}, []);

	/**
	 * When the strip would be empty with a Vault open, insert full Library.
	 * Active focus is left to dockview (`onDidActivePanelChange` / sync end).
	 */
	const withLibraryIfEmpty = useCallback((next: DocTab[]): DocTab[] => {
		if (next.length > 0 || !vaultPathRef.current) return next;
		return ensureFullLibraryTab([]).tabs;
	}, []);

	/**
	 * Open a document panel. If already open → activate it.
	 * Otherwise insert a placeholder, imperatively place in dockview, load
	 * resources, and optionally open NOTES as a same-group sibling.
	 */
	const openTab = useCallback(
		(
			path: string,
			opts?: {
				preferMode?: CenterViewMode;
				/** Place relative to an existing panel (file-tree drop / NOTES). */
				placement?: OpenPlacement;
				/** Skip default paper→NOTES companion open. */
				skipDefaultNotes?: boolean;
			},
		) => {
			const id = tabIdForPath(path);
			const existing = tabsRef.current.find((t) => t.id === id);
			if (existing) {
				setActiveTabId(id);
				workspaceRef.current?.activatePanel(id);
				return;
			}
			const { tabs: nextTabs, id: insertedId } = insertPlaceholderTab(
				tabsRef.current,
				path,
				opts?.preferMode,
			);
			const placeholder =
				nextTabs.find((t) => t.id === insertedId) ??
				createPlaceholderTab(path, opts?.preferMode);
			tabsRef.current = nextTabs;
			setTabs(nextTabs);
			setActiveTabId(insertedId);
			workspaceRef.current?.openPanel(placeholder, opts?.placement ?? null);

			void (async () => {
				const res = await loadTabResources(
					path,
					vaultPathRef.current,
					treeRef.current,
					paperFoldersRef.current,
				);
				if (res.error) {
					notifyError(
						res.error === "cannotPreview"
							? t("errors.cannotPreview", { name: basenameOf(path) })
							: res.error,
					);
				}
				const patch: Partial<DocTab> = {
					kind: res.kind,
					title: res.title,
					mode: res.mode,
					paperMeta: res.paperMeta,
					pdfUrl: res.pdfUrl,
					pdfBytes: res.pdfBytes ?? null,
					htmlUrl: res.htmlUrl,
					imageUrl: res.imageUrl,
					notesPath: res.notesPath,
					notesSeed: res.notesSeed,
					markdownSeed: res.markdownSeed,
					seedKey: 1,
					loaded: true,
				};
				updateTab(id, patch);

				// Paper default: open NOTES as a sibling tab in the same group (within).
				const wantDefaultNotes =
					!opts?.skipDefaultNotes &&
					!opts?.placement &&
					res.kind === "paper" &&
					Boolean(res.notesPath) &&
					(res.mode === "pdf" || res.mode === "html");
				if (wantDefaultNotes && res.notesPath) {
					const notesId = tabIdForPath(res.notesPath);
					if (!tabsRef.current.some((t) => t.id === notesId)) {
						const paperLike = {
							...createPlaceholderTab(path, res.mode),
							...patch,
						} as DocTab;
						const notesPane = createNotesSplitPane(paperLike);
						if (notesPane) {
							setTabs((prev) => {
								if (prev.some((t) => t.id === notesPane.id)) return prev;
								const next = [...prev, notesPane];
								tabsRef.current = next;
								return next;
							});
							workspaceRef.current?.openPanel(notesPane, {
								direction: "within",
								referencePanelId: id,
							});
						}
					}
				}

				const vault = vaultPathRef.current;
				if (res.didDownloadAssets && vault) {
					const generation = treeLoadGenerationRef.current;
					try {
						const nodes = await loadVaultTree(vault);
						if (
							vaultPathRef.current === vault &&
							treeLoadGenerationRef.current === generation
						) {
							setTree(nodes);
						}
					} catch {
						// ignore; viewer already has source
					}
				}
			})();
		},
		[t, updateTab],
	);

	/** Close a tab; focus stays with dockview; full Library when emptied. */
	const closeTab = useCallback(
		(id: string) => {
			setTabs((prev) => {
				const { tabs, removed } = removeTab(prev, id);
				if (!removed) return prev;
				revokeTabMediaSources(removed);
				return withLibraryIfEmpty(tabs);
			});
			setPdfHighlightsByTab((prev) => {
				if (!(id in prev)) return prev;
				const next = { ...prev };
				delete next[id];
				return next;
			});
		},
		[withLibraryIfEmpty],
	);

	/** Close every panel whose path is at or under the given path. */
	const closeTabsUnderPath = useCallback(
		(path: string) => {
			let removedIds: string[] = [];
			setTabs((prev) => {
				const { tabs, removed } = removeTabsUnderPath(prev, path);
				if (!removed.length) return prev;
				for (const t of removed) revokeTabMediaSources(t);
				removedIds = removed.map((t) => t.id);
				return withLibraryIfEmpty(tabs);
			});
			if (!removedIds.length) return;
			setPdfHighlightsByTab((prevHl) => {
				let changed = false;
				const next = { ...prevHl };
				for (const rid of removedIds) {
					if (rid in next) {
						delete next[rid];
						changed = true;
					}
				}
				return changed ? next : prevHl;
			});
		},
		[withLibraryIfEmpty],
	);

	const tabsRef = useRef(tabs);
	tabsRef.current = tabs;
	const activeTabIdRef = useRef(activeTabId);
	activeTabIdRef.current = activeTabId;

	/** PDF viewer imperative handles by tab id (for the annotations panel). */
	const pdfViewerHandles = useRef(new Map<string, PdfViewerHandle>());
	/** Latest highlights per PDF tab id, for the annotations panel. */
	const [pdfHighlightsByTab, setPdfHighlightsByTab] = useState<
		Record<string, PdfHighlight[]>
	>({});
	/** Latest PDF ask threads per tab (for the annotations panel conversations). */
	const [pdfAsksByTab, setPdfAsksByTab] = useState<
		Record<string, PdfAskThread[]>
	>({});

	const activeAnnotations = useMemo<AnnotationRow[]>(() => {
		const list = activeTabId ? pdfHighlightsByTab[activeTabId] : undefined;
		if (!list) return [];
		return [...list]
			.sort(
				(a, b) =>
					a.page - b.page || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0),
			)
			.map((h) => ({
				id: h.id,
				page: h.page,
				quote: h.quote,
				comment: h.comment ?? "",
				color: normalizeHighlightColor(h.color),
			}));
	}, [activeTabId, pdfHighlightsByTab]);

	const activeAsks = useMemo<AskRow[]>(() => {
		const list = activeTabId ? pdfAsksByTab[activeTabId] : undefined;
		if (!list) return [];
		return [...list]
			.sort(
				(a, b) =>
					a.anchor.page - b.anchor.page ||
					(a.anchor.rects[0]?.y ?? 0) - (b.anchor.rects[0]?.y ?? 0),
			)
			.map((th) => {
				const firstUser = th.messages.find((m) => m.role === "user");
				const preview =
					firstUser?.content.trim() || th.anchor.quote?.trim() || th.id;
				return {
					id: th.id,
					page: th.anchor.page,
					preview,
					messageCount: th.messages.filter(
						(m) => m.role === "user" || m.role === "assistant",
					).length,
				};
			});
	}, [activeTabId, pdfAsksByTab]);

	const annotationAction = useCallback(
		(fn: (h: PdfViewerHandle) => void) => {
			if (!activeTabId) return;
			const h = pdfViewerHandles.current.get(activeTabId);
			if (h) fn(h);
		},
		[activeTabId],
	);

	const registerPdfHandle = useCallback(
		(tabId: string, handle: PdfViewerHandle | null) => {
			if (handle) pdfViewerHandles.current.set(tabId, handle);
			else pdfViewerHandles.current.delete(tabId);
		},
		[],
	);
	const handlePdfHighlightsChange = useCallback(
		(tabId: string, list: PdfHighlight[]) => {
			setPdfHighlightsByTab((prev) => ({ ...prev, [tabId]: list }));
		},
		[],
	);
	const handlePdfAsksChange = useCallback(
		(tabId: string, list: PdfAskThread[]) => {
			setPdfAsksByTab((prev) => ({ ...prev, [tabId]: list }));
		},
		[],
	);

	/** Cycle the active panel by dockview visual order (api.panels). */
	const cycleActiveTab = useCallback((delta: number) => {
		workspaceRef.current?.cycleActive(delta);
	}, []);

	/**
	 * ⌘W / File → Close:
	 * 1. Top app overlay → dismiss.
	 * 2. Else close the active dockview panel (native close path via React state).
	 * Sole full-library panel → close window.
	 */
	const lastCloseTabOrWindowAt = useRef(0);
	const closeWindow = useCallback(() => {
		if (!isTauri()) return;
		void (async () => {
			try {
				const { getCurrentWindow } = await import("@tauri-apps/api/window");
				await getCurrentWindow().close();
			} catch {
				// window close unavailable outside the desktop shell
			}
		})();
	}, []);

	const closeTabOrWindow = useCallback(() => {
		const now = Date.now();
		if (now - lastCloseTabOrWindowAt.current < 80) return;
		lastCloseTabOrWindowAt.current = now;

		if (closeTopOverlay()) return;

		const list = tabsRef.current;
		const activeId = activeTabIdRef.current ?? list[list.length - 1]?.id;
		const sole = list.length === 1 ? list[0] : null;
		if (sole && isLibraryVirtualPath(sole.path)) {
			closeWindow();
			return;
		}
		if (list.length > 0) {
			if (activeId) closeTab(activeId);
			return;
		}
		closeWindow();
	}, [closeTab, closeWindow]);

	/** Toggle NOTES.md panel for the active paper (⌘\\ / Layout menu). */
	const toggleNotesSplit = useCallback(() => {
		const id = activeTabIdRef.current;
		if (!id) return;
		const tab = tabsRef.current.find((t) => t.id === id);
		// NOTES may be toggled from paper PDF/HTML, or when NOTES panel itself is active.
		const paper =
			tab && tabNotesEligible(tab)
				? tab
				: tabsRef.current.find(
						(t) =>
							tabNotesEligible(t) &&
							t.notesPath &&
							tab?.path &&
							normalizeTabPath(t.notesPath) === normalizeTabPath(tab.path),
					);
		const target = paper ?? tab;
		if (!target?.notesPath) return;
		const notesId = tabIdForPath(target.notesPath);
		if (tabHasNotesSplit(tabsRef.current, target)) {
			closeTab(notesId);
			return;
		}
		if (!tabNotesEligible(target) && target.kind !== "paper") return;
		const notesPane = createNotesSplitPane(target);
		if (!notesPane) return;
		// Same group as the paper panel (tab strip), not a new split.
		setTabs((prev) => {
			if (prev.some((t) => t.id === notesPane.id)) return prev;
			const next = [...prev, notesPane];
			tabsRef.current = next;
			return next;
		});
		workspaceRef.current?.openPanel(notesPane, {
			direction: "within",
			referencePanelId: target.id,
		});
		setActiveTabId(notesPane.id);
	}, [closeTab]);

	/** File-tree path dropped onto a dockview edge → open with placement. */
	const handleWorkspaceDrop = useCallback(
		(drop: WorkspaceExternalDrop) => {
			const path = drop.paths[0];
			if (!path) return;
			openTab(path, {
				placement: {
					direction: drop.direction,
					referencePanelId: drop.referencePanelId,
				},
				skipDefaultNotes: true,
			});
		},
		[openTab],
	);

	const handleLayoutChange = useCallback((layout: unknown) => {
		setDockLayout(layout);
	}, []);

	/** Reseed an open paper tab's NOTES after the reader / download writes it. */
	const refreshTabNotes = useCallback((paperDir: string, content: string) => {
		setTabs((prev) => reseedNotesTab(prev, paperDir, content));
	}, []);

	/** Reseed an open plain-Markdown tab after an external/Agent write. */
	const refreshTabMarkdown = useCallback((absPath: string, content: string) => {
		setTabs((prev) => reseedMarkdownTab(prev, absPath, content));
	}, []);

	// After seeding placeholders from layout, load resources once (mount-only).
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only hydrate
	useEffect(() => {
		if (!isTauri() || !vaultPathRef.current) return;
		if (!tabsRef.current.length) {
			const ensured = ensureFullLibraryTab([]);
			setTabs(ensured.tabs);
			setActiveTabId(ensured.activeId);
			return;
		}
		for (const tab of tabsRef.current) {
			if (tab.loaded) continue;
			void (async () => {
				const res = await loadTabResources(
					tab.path,
					vaultPathRef.current,
					treeRef.current,
					paperFoldersRef.current,
				);
				if (!tabsRef.current.some((t) => t.id === tab.id)) return;
				updateTab(tab.id, {
					kind: res.kind,
					title: res.title,
					mode: res.mode,
					paperMeta: res.paperMeta,
					pdfUrl: res.pdfUrl,
					pdfBytes: res.pdfBytes ?? null,
					htmlUrl: res.htmlUrl,
					imageUrl: res.imageUrl,
					notesPath: res.notesPath,
					notesSeed: res.notesSeed,
					markdownSeed: res.markdownSeed,
					seedKey: 1,
					loaded: true,
				});
			})();
		}
	}, []);

	// Default page: whenever the strip is empty with a Vault open, show full Library.
	useEffect(() => {
		if (!vaultPath) return;
		if (tabs.length > 0) return;
		const ensured = ensureFullLibraryTab([]);
		setTabs(ensured.tabs);
		setActiveTabId(ensured.activeId);
	}, [vaultPath, tabs.length]);

	useEffect(() => {
		setTheme(settings.theme);
	}, [settings.theme, setTheme]);

	useEffect(() => {
		const locale = resolveLocale(settings.locale);
		void i18n.changeLanguage(locale);
		if (typeof document !== "undefined") {
			document.documentElement.lang = locale;
		}
		if (!isTauri()) return;
		void (async () => {
			try {
				const { invoke } = await import("@tauri-apps/api/core");
				await invoke("set_locale", { locale });
			} catch {
				// Native menu keeps its previous locale; non-fatal.
			}
		})();
	}, [settings.locale]);

	useEffect(() => {
		if (typeof document === "undefined") return;
		document.documentElement.style.fontSize = `${16 * settings.uiScale}px`;
		// Note: macOS traffic lights are positioned at build-time via
		// WebviewWindowBuilder::traffic_light_position. The initial main window
		// uses tauri.conf.json's fixed y=18; newly created windows read the
		// current uiScale and position themselves accordingly. Tauri v2 does not
		// expose a runtime setter for the main window's traffic lights.
	}, [settings.uiScale]);

	const updateSettings = useCallback((next: AppSettings) => {
		setSettings(next);
		saveSettings(next);
	}, []);

	// Cross-window settings sync: apply snapshots persisted by the native
	// settings window (or other main windows); skip no-op echoes of own saves.
	useEffect(() => {
		return subscribeSettings((next) => {
			setSettings((prev) =>
				JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
			);
		});
	}, []);

	const SIDEBAR_DEFAULT_PX = 200;
	const RIGHT_SIDEBAR_DEFAULT_PX = 320;

	/** Collapse / expand left file-tree panel without remounting (stable Group layout). */
	const setLeftSidebarCollapsed = useCallback(
		(collapsed: boolean) => {
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
			setSidebarCollapsed(collapsed);
		},
		[sidebarPanelRef],
	);

	/** Collapse / expand right Agent/Backlinks panel; always mounted as collapsible. */
	const setRightSidebarCollapsed = useCallback(
		(collapsed: boolean, opts?: { focusAgent?: boolean }) => {
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
			setRightSidebarOpen(!collapsed);
			if (!collapsed && opts?.focusAgent) {
				chatInputFocusKey.current += 1;
			}
		},
		[rightSidebarPanelRef],
	);

	const toggleSidebar = useCallback(() => {
		if (agentZenMode) return;
		// React state is source of truth — isCollapsed() can lag at 0px.
		setLeftSidebarCollapsed(!sidebarCollapsed);
	}, [agentZenMode, sidebarCollapsed, setLeftSidebarCollapsed]);

	const toggleRightSidebar = useCallback(() => {
		if (agentZenMode) return;
		if (!rightSidebarOpen) setAgentPanelMounted(true);
		setRightSidebarCollapsed(rightSidebarOpen, {
			focusAgent: !rightSidebarOpen && rightSidebarTab === "agent",
		});
	}, [
		agentZenMode,
		rightSidebarOpen,
		rightSidebarTab,
		setRightSidebarCollapsed,
	]);

	/** Open right sidebar on a tab (or switch tab if already open). */
	const openRightTab = useCallback(
		(tab: "agent" | "backlinks" | "annotations") => {
			setRightSidebarTab(tab);
			if (tab === "agent") setAgentPanelMounted(true);
			if (!rightSidebarOpen) {
				setRightSidebarCollapsed(false, { focusAgent: tab === "agent" });
			} else if (tab === "agent") {
				chatInputFocusKey.current += 1;
			}
		},
		[rightSidebarOpen, setRightSidebarCollapsed],
	);

	/** ⌘L — toggle right sidebar (defaults to agent). */
	const toggleChat = useCallback(() => {
		if (agentZenMode) return;
		setRightSidebarCollapsed(rightSidebarOpen, {
			focusAgent: !rightSidebarOpen && rightSidebarTab === "agent",
		});
	}, [
		agentZenMode,
		rightSidebarOpen,
		rightSidebarTab,
		setRightSidebarCollapsed,
	]);

	const expandSidebar = useCallback(() => {
		if (agentZenMode) return;
		setLeftSidebarCollapsed(false);
		requestAnimationFrame(() => {
			sidebarAsideRef.current?.querySelector<HTMLElement>("button")?.focus();
		});
	}, [agentZenMode, setLeftSidebarCollapsed]);

	/**
	 * Enter agent zen mode: collapse left + center, expand Agent rail full width.
	 * Keeps the same AgentPanel instance so conversation state survives.
	 */
	const enterAgentZen = useCallback(() => {
		leftCollapsedBeforeZenRef.current = sidebarCollapsed;
		agentZenModeRef.current = true;
		setAgentZenMode(true);
		setAgentPanelMounted(true);
		setRightSidebarTab("agent");
		setRightSidebarCollapsed(false, { focusAgent: true });
		setLeftSidebarCollapsed(true);
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
	}, [
		sidebarCollapsed,
		setLeftSidebarCollapsed,
		setRightSidebarCollapsed,
		sourcePanelRef,
		rightSidebarPanelRef,
	]);

	const exitAgentZen = useCallback(() => {
		agentZenModeRef.current = false;
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
				setLeftSidebarCollapsed(false);
			}
		});
	}, [setLeftSidebarCollapsed, sourcePanelRef, rightSidebarPanelRef]);

	const toggleAgentZen = useCallback(() => {
		if (agentZenMode) exitAgentZen();
		else enterAgentZen();
	}, [agentZenMode, enterAgentZen, exitAgentZen]);

	/**
	 * Immersive PDF reading: collapse both side rails and hide the center header
	 * so the viewer fills the window (the PdfViewer caps its own width + centers).
	 */
	const enterPdfZen = useCallback(() => {
		leftCollapsedBeforePdfZenRef.current = sidebarCollapsed;
		rightOpenBeforePdfZenRef.current = rightSidebarOpen;
		setPdfZenMode(true);
		setLeftSidebarCollapsed(true);
		setRightSidebarCollapsed(true);
	}, [
		sidebarCollapsed,
		rightSidebarOpen,
		setLeftSidebarCollapsed,
		setRightSidebarCollapsed,
	]);

	const exitPdfZen = useCallback(() => {
		setPdfZenMode(false);
		if (!leftCollapsedBeforePdfZenRef.current) setLeftSidebarCollapsed(false);
		if (rightOpenBeforePdfZenRef.current) setRightSidebarCollapsed(false);
	}, [setLeftSidebarCollapsed, setRightSidebarCollapsed]);

	const togglePdfZen = useCallback(() => {
		if (pdfZenModeRef.current) exitPdfZen();
		else enterPdfZen();
	}, [enterPdfZen, exitPdfZen]);

	// Leave immersive reading on Escape, or when the active tab stops being a PDF.
	useEffect(() => {
		if (!pdfZenMode) return;
		if (activeTab?.mode !== "pdf") {
			exitPdfZen();
			return;
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				exitPdfZen();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [pdfZenMode, activeTab, exitPdfZen]);

	const refreshTree = useCallback(async (path: string) => {
		if (vaultPathRef.current !== path) return;
		const generation = treeLoadGenerationRef.current;
		setTreeLoading(true);
		setBusy(true);
		try {
			const nodes = await loadVaultTree(path);
			if (
				vaultPathRef.current === path &&
				treeLoadGenerationRef.current === generation
			) {
				setTree(nodes);
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			if (
				vaultPathRef.current === path &&
				treeLoadGenerationRef.current === generation
			) {
				notifyError(message);
				setTree([]);
			}
		} finally {
			if (
				vaultPathRef.current === path &&
				treeLoadGenerationRef.current === generation
			) {
				setTreeLoading(false);
				setBusy(false);
			}
		}
	}, []);

	/**
	 * Lazy tree expand: list one level under a non-eager folder (`src/`, …).
	 * Eager roots (`papers/` …) are fully loaded in `loadVaultTree`.
	 */
	const handleLoadDirChildren = useCallback(async (dirPath: string) => {
		const vault = vaultPathRef.current;
		if (!vault) return;
		const generation = treeLoadGenerationRef.current;
		try {
			const children = await listVaultDirChildren(vault, dirPath);
			if (
				vaultPathRef.current === vault &&
				treeLoadGenerationRef.current === generation
			) {
				setTree((prev) => replaceTreeNodeChildren(prev, dirPath, children));
			}
		} catch (e) {
			if (
				vaultPathRef.current === vault &&
				treeLoadGenerationRef.current === generation
			) {
				notifyError(e instanceof Error ? e.message : String(e));
			}
		}
	}, []);

	const handleEditorAssetsChanged = useCallback(() => {
		if (vaultPath) void refreshTree(vaultPath);
	}, [vaultPath, refreshTree]);

	const openAnnotationsTab = useCallback(
		() => openRightTab("annotations"),
		[openRightTab],
	);

	/**
	 * Reload an open editor when its file changed on disk (external editor / Agent).
	 * Reseeds only when disk content differs from the current seed — equal content
	 * means it was our own autosave, so we skip to avoid a remount echo. The path is
	 * guarded briefly so the remount's unmount-flush cannot overwrite the fresh disk text.
	 */
	const applyDiskChange = useCallback(
		async (absPath: string) => {
			const norm = normalizeTabPath(absPath);
			const openTabs = tabsRef.current;
			const notesOwners = openTabs.filter(
				(t) => t.notesPath && normalizeTabPath(t.notesPath) === norm,
			);
			const mdOwners = openTabs.filter(
				(t) => normalizeTabPath(t.path) === norm && isMarkdownPath(t.path),
			);
			if (!notesOwners.length && !mdOwners.length) return;
			let content: string;
			try {
				content = await readVaultFile(absPath);
			} catch {
				return;
			}
			const guard = () => {
				reseedGuardRef.current.add(norm);
				window.setTimeout(() => reseedGuardRef.current.delete(norm), 500);
			};
			const promptReload = (reload: () => void) => {
				const name = absPath.split(/[\\/]/).pop() ?? absPath;
				notifyUndo(t("diskConflict.title", { name }), {
					actionLabel: t("diskConflict.reload"),
					onAction: reload,
					duration: 12000,
				});
			};
			for (const notesTab of notesOwners) {
				if (content === notesTab.notesSeed) continue;
				const paperDir = absPath.replace(/[\\/]NOTES\.md$/i, "");
				const reload = () => {
					guard();
					refreshTabNotes(paperDir, content);
				};
				if (notesTab.notesDirty) promptReload(reload);
				else reload();
			}
			for (const mdTab of mdOwners) {
				if (content === mdTab.markdownSeed) continue;
				const reload = () => {
					guard();
					refreshTabMarkdown(absPath, content);
				};
				if (mdTab.markdownDirty) promptReload(reload);
				else reload();
			}
		},
		[refreshTabNotes, refreshTabMarkdown, t],
	);

	/** Debounced, quiet file-tree reload (no busy flicker) for external create/delete/rename. */
	const scheduleTreeRefresh = useCallback(() => {
		if (treeRefreshTimerRef.current) clearTimeout(treeRefreshTimerRef.current);
		treeRefreshTimerRef.current = setTimeout(() => {
			treeRefreshTimerRef.current = null;
			const vault = vaultPathRef.current;
			if (!vault) return;
			const generation = treeLoadGenerationRef.current;
			void loadVaultTree(vault)
				.then((nodes) => {
					if (
						vaultPathRef.current === vault &&
						treeLoadGenerationRef.current === generation
					) {
						setTree(nodes);
					}
				})
				.catch(() => {
					// best-effort background refresh
				});
		}, 400);
	}, []);

	/**
	 * Debounced wiki / backlinks / graph index rebuild after any on-disk change
	 * (external edit or Agent write). Only `.md` files carry wikilinks, so other
	 * extensions are ignored; the rebuild is full but cheap for a research vault.
	 */
	const scheduleWikiRebuild = useCallback((absPath: string) => {
		if (!/\.md$/i.test(absPath)) return;
		if (wikiRebuildTimerRef.current) clearTimeout(wikiRebuildTimerRef.current);
		wikiRebuildTimerRef.current = setTimeout(() => {
			wikiRebuildTimerRef.current = null;
			const vault = vaultPathRef.current;
			if (!vault) return;
			void rebuildWikiRef.current(vault);
		}, 900);
	}, []);

	// Start/stop the Host Vault filesystem watcher for this window's active Vault.
	// Live-reload open editors + file tree, and keep the wiki index fresh.
	useVaultFileEvents({
		vaultPath,
		onDiskChange: applyDiskChange,
		onStructuralChange: scheduleTreeRefresh,
		onWikiChange: scheduleWikiRebuild,
	});

	/** Rebuild wiki index and notify Backlinks/Graph panels to re-fetch. */
	const rebuildWikiAndNotify = useCallback(async (path: string) => {
		try {
			await rebuildWikiIndex(path);
			setWikiIndexRevision((n) => n + 1);
		} catch {
			// Index rebuild is best-effort; panels re-fetch on next path change.
		}
	}, []);
	rebuildWikiRef.current = rebuildWikiAndNotify;

	const activateVault = useCallback(
		async (path: string) => {
			treeLoadGenerationRef.current += 1;
			if (treeRefreshTimerRef.current) {
				clearTimeout(treeRefreshTimerRef.current);
				treeRefreshTimerRef.current = null;
			}
			setTree([]);
			setTreeLoading(true);
			// Tear down previous remote session so work catalogs are flushed.
			const prev = vaultPathRef.current;
			if (prev && isRemoteVaultHandle(prev) && prev !== path) {
				const prevId = remoteSessionIdFromHandle(prev);
				if (prevId) {
					try {
						await remoteDisconnect(prevId);
					} catch {
						// best-effort
					}
				}
				clearRemoteSessionMeta();
			}
			saveVaultPath(path);
			setVaultPath(path);
			setTabs([]);
			setActiveTabId(null);
			setTreeSelectedPath(null);
			setLibraryQuery("");
			setLibraryScopePath(null);
			setRecentVaults(getRecentVaults());
			// Wiki rebuild needs local fs watcher semantics; remote is best-effort / deferred.
			if (!isRemoteVaultHandle(path)) {
				await rebuildWikiAndNotify(path);
			}
		},
		[rebuildWikiAndNotify],
	);

	/**
	 * After app updates, seed any **new** bundled skills into `.agents/skills/`
	 * (missing files only — never overwrite user edits). Runs on open / restore.
	 * Toast only when at least one skill package was added.
	 */
	useEffect(() => {
		if (!isTauri() || !vaultPath) return;
		const path = vaultPath;
		void ensureVault(path)
			.then((result) => {
				const skills = seededSkillIdsFromCreated(result.created);
				if (skills.length === 0) return;
				// Path may have changed while ensure was in flight.
				if (vaultPathRef.current !== path) return;
				notifySuccess(
					t("vault.skillsSeeded", {
						count: skills.length,
						names: skills.join(", "),
					}),
					{ id: "vault-skills-seeded" },
				);
			})
			.catch(() => {
				// Best-effort: opening the vault must not fail if seed is blocked.
			});
	}, [vaultPath, t]);

	const handleOpenVault = useCallback(async () => {
		try {
			if (!isTauri()) {
				notifyError(t("errors.openVaultDesktopOnly"));
				return;
			}
			setBusy(true);
			const path = await pickVaultDirectory();
			if (!path) return;
			await activateVault(path);
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, [t, activateVault]);

	const handleOpenRemoteVault = useCallback(
		async (args: { host: string; user?: string; remotePath: string }) => {
			try {
				if (!isTauri()) {
					notifyError(t("errors.openVaultDesktopOnly"));
					return;
				}
				setBusy(true);
				const info = await remoteConnect(args);
				saveRemoteSessionMeta(info);
				rememberRecentRemoteVault({
					kind: "remote",
					host: args.host,
					user: args.user,
					remotePath: args.remotePath,
					label: info.displayName,
				});
				// Store pseudo-handle so tree / IO route through Host remote_* commands.
				await activateVault(info.vaultHandle);
				// Prefer display name in recent list under handle key for reopen? handle is ephemeral.
				// Reopen needs host+path — keep rememberRecentRemoteVault only.
			} catch (e) {
				notifyError(
					e instanceof Error ? e.message : t("vault.remoteConnectFailed"),
				);
			} finally {
				setBusy(false);
			}
		},
		[t, activateVault],
	);

	const handleOpenRecentVault = useCallback(
		async (path: string) => {
			try {
				if (!isTauri()) {
					notifyError(t("errors.openVaultDesktopOnly"));
					return;
				}
				setBusy(true);
				await ensureLocalFsScope(path);
				const { exists } = await import("@tauri-apps/plugin-fs");
				if (!(await exists(path))) {
					removeRecentVault(path);
					setRecentVaults(getRecentVaults());
					notifyError(t("vault.recentMissing", { path }));
					return;
				}
				await activateVault(path);
			} catch (e) {
				notifyError(e instanceof Error ? e.message : String(e));
			} finally {
				setBusy(false);
			}
		},
		[t, activateVault],
	);

	const handleRemoveRecentVault = useCallback((path: string) => {
		removeRecentVault(path);
		setRecentVaults(getRecentVaults());
	}, []);

	const handleNewWindow = useCallback(async () => {
		try {
			if (!isTauri()) {
				notifyError(t("errors.openVaultDesktopOnly"));
				return;
			}
			await openNewWindow();
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
		}
	}, [t]);

	const refreshLibrary = useCallback(async () => {
		if (!vaultPath || !isTauri()) {
			setLibraryPapers([]);
			return;
		}
		setLibraryLoading(true);
		try {
			const list = await listPapers(vaultPath);
			setLibraryPapers(list);
		} catch {
			setLibraryPapers([]);
		} finally {
			setLibraryLoading(false);
		}
	}, [vaultPath]);

	// Sync active vault into the Connector server (save target).
	// When Connector is toggled on, the enable effect re-binds vaultPathRef below.
	useEffect(() => {
		if (!isTauri()) return;
		void connectorSetVault(vaultPath).catch((e) => {
			console.warn("[connector] setVault failed", e);
		});
	}, [vaultPath]);

	// Mirror Library folder scope → Connector default collection (org folders under papers/).
	useEffect(() => {
		if (!isTauri() || !settings.connectorEnabled) return;
		const scope = libraryScopePath
			?.replace(/\\/g, "/")
			.replace(/^\/+|\/+$/g, "");
		const parent =
			scope && (scope === "papers" || scope.startsWith("papers/"))
				? scope
				: "papers";
		void connectorSetParentDir(parent).catch(() => {
			/* ignore */
		});
	}, [libraryScopePath, settings.connectorEnabled]);

	// Restore Connector server from settings on launch / toggle.
	useEffect(() => {
		if (!isTauri()) return;
		void connectorSetEnabled(settings.connectorEnabled)
			.then(async (st) => {
				if (settings.connectorEnabled && st.lastError) {
					notifyError(st.lastError);
				}
				// After the HTTP server starts, re-bind vault (Host may have been unbound).
				if (settings.connectorEnabled && vaultPathRef.current) {
					try {
						await connectorSetVault(vaultPathRef.current);
					} catch (e) {
						console.warn("[connector] re-bind vault after enable failed", e);
					}
				}
			})
			.catch((e) => {
				notifyError(e instanceof Error ? e.message : String(e));
			});
	}, [settings.connectorEnabled]);

	const handleRefresh = useCallback(() => {
		if (!vaultPath) return;
		void (async () => {
			await refreshTree(vaultPath);
			await rebuildWikiAndNotify(vaultPath);
			await refreshLibrary();
		})();
	}, [vaultPath, refreshTree, refreshLibrary, rebuildWikiAndNotify]);

	const [rescanning, setRescanning] = useState(false);

	/** Rebuild the catalog from papers/ on disk (recover disk-only papers). */
	const handleRescanPapers = useCallback(async () => {
		if (!vaultPath || rescanning) return;
		setRescanning(true);
		try {
			const n = await rescanPapers(vaultPath);
			await refreshLibrary();
			await refreshTree(vaultPath);
			if (n > 0) {
				notifySuccess(t("sidebar:papersLibrary.rescanned", { count: n }));
			} else {
				notifyWarning(t("sidebar:papersLibrary.rescanEmpty"));
			}
		} catch (e) {
			notifyError(
				e instanceof Error
					? e.message
					: t("sidebar:papersLibrary.rescanFailed"),
			);
		} finally {
			setRescanning(false);
		}
	}, [vaultPath, rescanning, refreshLibrary, refreshTree, t]);

	/** ⌥⌘R — reveal selected vault path in Finder / Explorer. */
	const handleRevealInFinder = useCallback(() => {
		const path = treeSelectedPath;
		if (!path || isLibraryVirtualPath(path) || isTrashVirtualPath(path)) return;
		if (
			(vaultPath && isRemoteVaultHandle(vaultPath)) ||
			path.startsWith("remote:")
		) {
			notifyWarning(t("app:vault.remoteNoFinder"));
			return;
		}
		if (!isTauri()) {
			notifyError(t("sidebar:fileTree.revealDesktopOnly"));
			return;
		}
		void (async () => {
			try {
				await revealInFileManager(path);
			} catch {
				notifyError(t("sidebar:fileTree.revealFailed"));
			}
		})();
	}, [treeSelectedPath, vaultPath, t]);

	/** ⌥⌘T — open system terminal at selected path (dir = self, file = parent). */
	const handleOpenInTerminal = useCallback(() => {
		const path = treeSelectedPath;
		if (!path || isLibraryVirtualPath(path) || isTrashVirtualPath(path)) return;
		if (
			(vaultPath && isRemoteVaultHandle(vaultPath)) ||
			path.startsWith("remote:")
		) {
			notifyWarning(t("app:vault.remoteNoTerminal"));
			return;
		}
		if (!isTauri()) {
			notifyError(t("sidebar:fileTree.openInTerminalDesktopOnly"));
			return;
		}
		void (async () => {
			try {
				await openInTerminal(path);
			} catch {
				notifyError(t("sidebar:fileTree.openInTerminalFailed"));
			}
		})();
	}, [treeSelectedPath, vaultPath, t]);

	/**
	 * Delete vault paths into the recycle bin (local or remote `.agentero/.trash/`).
	 */
	const trashPathsAndNotify = useCallback(
		async (absPaths: string[]) => {
			if (!vaultPath || !isTauri()) {
				notifyError(t("sidebar:fileTree.deleteDesktopOnly"));
				return;
			}
			const rootNorm = vaultPath.replace(/\\/g, "/").replace(/\/+$/, "");
			const valid = absPaths
				.map((p) => p.replace(/\\/g, "/").replace(/\/+$/, ""))
				.filter(
					(p) =>
						p &&
						!isLibraryVirtualPath(p) &&
						!isTrashVirtualPath(p) &&
						p !== rootNorm &&
						p.startsWith(`${rootNorm}/`),
				);
			if (valid.length === 0) return;
			setBusy(true);
			try {
				const rels = valid
					.map((p) => vaultRelativePath(vaultPath, p))
					.filter((r): r is string => Boolean(r));
				await trashPaths(vaultPath, rels);
				for (const p of valid) closeTabsUnderPath(p);
				const treeNorm = treeSelectedPath
					?.replace(/\\/g, "/")
					.replace(/\/+$/, "");
				if (
					treeNorm &&
					valid.some((p) => treeNorm === p || treeNorm.startsWith(`${p}/`))
				) {
					setTreeSelectedPath(null);
				}
				await refreshTree(vaultPath);
				if (!isRemoteVaultHandle(vaultPath)) {
					await rebuildWikiAndNotify(vaultPath);
				}
				await refreshLibrary();
			} catch (e) {
				notifyError(
					e instanceof Error ? e.message : t("sidebar:fileTree.deleteFailed"),
				);
			} finally {
				setBusy(false);
			}
		},
		[
			vaultPath,
			treeSelectedPath,
			closeTabsUnderPath,
			refreshTree,
			rebuildWikiAndNotify,
			refreshLibrary,
			t,
		],
	);

	const handleDeletePath = useCallback(
		(path: string) => {
			void trashPathsAndNotify([path]);
		},
		[trashPathsAndNotify],
	);

	const handleDeleteSelected = useCallback(() => {
		const path = treeSelectedPath;
		if (!path || isLibraryVirtualPath(path) || isTrashVirtualPath(path)) {
			notifyError(t("sidebar:fileTree.deleteNeedsSelection"));
			return;
		}
		void handleDeletePath(path);
	}, [treeSelectedPath, handleDeletePath, t]);

	const handleDeletePaths = useCallback(
		(paths: string[]) => {
			void trashPathsAndNotify(paths);
		},
		[trashPathsAndNotify],
	);

	/** Paths queued for the "move to folder" dialog (null = closed). */
	const [movePaths, setMovePaths] = useState<string[] | null>(null);
	const [commandOpen, setCommandOpen] = useState(false);
	const [commandMode, setCommandMode] = useState<PaletteMode>("go");
	const commandModeRef = useRef(commandMode);
	commandModeRef.current = commandMode;

	/** Bump to force RecycleBinView reload after Empty Recycle Bin. */
	const [trashReloadSignal, setTrashReloadSignal] = useState(0);

	/** Refresh tree / library / wiki after a recycle-bin restore. */
	const handleTrashChanged = useCallback(async () => {
		if (!vaultPath) return;
		setTreeSelectedPath(null);
		await refreshTree(vaultPath);
		await rebuildWikiAndNotify(vaultPath);
		await refreshLibrary();
	}, [vaultPath, refreshTree, rebuildWikiAndNotify, refreshLibrary]);

	/** Empty recycle bin from the trash node context menu (confirm + purge). */
	const handleEmptyTrash = useCallback(async () => {
		if (!vaultPath || !isTauri()) return;
		try {
			const items = await listTrash(vaultPath);
			if (items.length === 0) return;
			if (
				!window.confirm(
					t("sidebar:recycleBin.emptyConfirm", { count: items.length }),
				)
			) {
				return;
			}
			await purgeAllTrash(vaultPath);
			setTrashReloadSignal((n) => n + 1);
		} catch (e) {
			notifyError(
				e instanceof Error ? e.message : t("sidebar:recycleBin.purgeFailed"),
			);
		}
	}, [vaultPath, t]);

	const handleMovePaths = useCallback((paths: string[]) => {
		const valid = paths.filter(
			(p) => !isLibraryVirtualPath(p) && !isTrashVirtualPath(p),
		);
		if (valid.length === 0) return;
		setMovePaths(valid);
	}, []);

	/** Core move loop reused by the dialog and by drag-and-drop. */
	const movePathsTo = useCallback(
		async (rawPaths: string[], destParentRel: string) => {
			if (!vaultPath) return;
			const paths = rawPaths.filter(
				(p) => !isLibraryVirtualPath(p) && !isTrashVirtualPath(p),
			);
			if (paths.length === 0) return;
			setBusy(true);
			let failed = 0;
			try {
				for (const path of paths) {
					const rel = vaultRelativePath(vaultPath, path);
					if (!rel) {
						failed++;
						continue;
					}
					try {
						await movePaperFolder(vaultPath, rel, destParentRel);
						closeTabsUnderPath(path);
					} catch {
						failed++;
					}
				}
				setTreeSelectedPath(null);
				await refreshTree(vaultPath);
				await rebuildWikiAndNotify(vaultPath);
				await refreshLibrary();
				if (failed > 0) {
					notifyWarning(
						t("sidebar:fileTree.movedWithErrors", { count: failed }),
					);
				}
			} catch (e) {
				notifyError(
					e instanceof Error ? e.message : t("sidebar:fileTree.moveFailed"),
				);
			} finally {
				setBusy(false);
			}
		},
		[
			vaultPath,
			closeTabsUnderPath,
			refreshTree,
			rebuildWikiAndNotify,
			refreshLibrary,
			t,
		],
	);

	const runMovePaths = useCallback(
		async (destParentRel: string) => {
			const paths = movePaths;
			setMovePaths(null);
			if (paths) await movePathsTo(paths, destParentRel);
		},
		[movePaths, movePathsTo],
	);

	const openMagicWand = useCallback(() => {
		if (!vaultPath) {
			notifyError(t("sidebar:lookup.needsVault"));
			return;
		}
		// Expand left rail without stealing focus (popover owns focus).
		if (sidebarCollapsed) {
			setLeftSidebarCollapsed(false);
		}
		setLookupOpenSignal((n) => n + 1);
	}, [vaultPath, sidebarCollapsed, setLeftSidebarCollapsed, t]);

	useEffect(() => {
		void refreshLibrary();
	}, [refreshLibrary]);

	const lookupParentDir = useMemo(
		() => resolvePapersParentDir(vaultPath, treeSelectedPath, tree),
		[vaultPath, treeSelectedPath, tree],
	);

	const openSettings = useCallback((section: SettingsSection = "general") => {
		// In-app modal on every platform. The native settings window
		// (`settings_window_open`) renders blank on Windows (second-webview boot),
		// so we use the proven overlay that shares the same `SettingsContent`.
		setSettingsSection(section);
		setSettingsOpen(true);
	}, []);

	const closeSettings = useCallback(() => setSettingsOpen(false), []);

	// Stable handlers passed to TabCenter so its React.memo can bail out on
	// unrelated App re-renders (otherwise every mounted tab's viewer/editor
	// re-renders on any App state change).
	const handleLibraryColumnsChange = useCallback(
		(cols: LibraryColumnPref[]) => {
			updateSettings({ ...settingsRef.current, libraryColumns: cols });
		},
		[updateSettings],
	);
	const handleOpenSettingsTranslate = useCallback(
		() => openSettings("translate"),
		[openSettings],
	);

	useEffect(() => {
		if (!vaultPath) {
			setTree([]);
			setTreeLoading(false);
			return;
		}
		void refreshTree(vaultPath);
	}, [vaultPath, refreshTree]);

	// Layout alone is persisted (panels + order + active + path/mode in params).
	useEffect(() => {
		savePersistedTabs(dockLayout);
	}, [dockLayout]);

	// Persist a specific file's Markdown to disk. The MarkdownEditor calls this with
	// its own fixed path (debounced autosave, ⌘S, and unmount flush), so writes always
	// target the correct file even when switching files quickly.
	const persistFile = useCallback(
		(path: string, md: string, lastSaved: string) => {
			if (!isTauri() || !vaultPath || !path) return;
			// Skip while this path is being reloaded from disk (external/Agent write):
			// the remount's unmount-flush must not clobber the fresh disk content.
			if (reseedGuardRef.current.has(normalizeTabPath(path))) return;
			void (async () => {
				// Conflict guard: if the file changed on disk since we last saved
				// (external editor / Agent), do NOT silently overwrite — keep the
				// user's in-memory edit and warn. (readVaultFile throws when the file
				// is missing → treat as no conflict and create it.)
				try {
					const disk = await readVaultFile(path);
					if (disk !== lastSaved) {
						const name = path.split(/[\\/]/).pop() ?? path;
						notifyWarning(t("diskConflict.saveBlocked", { name }));
						return;
					}
				} catch {
					// Missing/unreadable file → no conflict to guard against.
				}
				// Keep the owning tab's seed in sync so PDF↔Notes / tab switches see latest text.
				setTabs((prev) => syncTabSeedsForPath(prev, path, md));
				try {
					await writeVaultFile(path, md);
				} catch (e) {
					notifyError(e instanceof Error ? e.message : String(e));
				}
			})();
		},
		[vaultPath, t],
	);

	/** Open a paper folder in a tab: center PDF, right Notes (resolved on load).
	 *  Also selects/reveals the paper in the left file tree. */
	const openPaper = useCallback(
		(paperDir: string) => {
			const abs = paperDir.replace(/\\/g, "/").replace(/\/+$/, "");
			setTreeSelectedPath(abs);
			openTab(abs, { preferMode: "pdf" });
		},
		[openTab],
	);

	// Refresh tree/library when the official Zotero Connector saves into the vault;
	// open the paper tab (same as magic-wand import).
	useEffect(() => {
		if (!isTauri()) return;
		let cancelled = false;
		const unsubs: Array<() => void> = [];
		void (async () => {
			const { listen } = await import("@tauri-apps/api/event");
			if (cancelled) return;
			unsubs.push(
				await listen<ConnectorItemSaved>("connector:item-saved", (ev) => {
					const p = ev.payload;
					const vault = vaultPathRef.current;
					if (vault) {
						void refreshTree(vault);
						void refreshLibrary();
					}
					// Open/focus the paper tab (metadata save, attachment upload, or move).
					const rel = (p?.path ?? "")
						.replace(/\\/g, "/")
						.replace(/^\/+|\/+$/g, "");
					if (vault && rel) {
						const paperAbs = `${vault
							.replace(/\\/g, "/")
							.replace(/\/+$/, "")}/${rel}`;
						openPaper(paperAbs);
					}
					if (p?.title) {
						notifySuccess(
							p.deduped
								? t("sidebar:connector.deduped", { title: p.title })
								: t("sidebar:connector.saved", { title: p.title }),
						);
					}
				}),
			);
			unsubs.push(
				await listen<ConnectorProgress>("connector:progress", (ev) => {
					const p = ev.payload;
					if (!p?.key) return;
					let taskId = connectorProgressTasksRef.current.get(p.key);
					if (!taskId) {
						taskId = startBackgroundTask({
							kind: "connector",
							title: p.title || t("tasks.connector"),
							detail: p.detail ?? undefined,
							progress: p.progress ?? null,
						});
						connectorProgressTasksRef.current.set(p.key, taskId);
					} else {
						updateBackgroundTask(taskId, {
							detail: p.detail ?? undefined,
							progress: p.progress ?? null,
						});
					}
					if (p.status === "completed") {
						completeBackgroundTask(
							taskId,
							p.detail ?? t("tasks.connectorComplete"),
						);
						connectorProgressTasksRef.current.delete(p.key);
					} else if (p.status === "failed") {
						failBackgroundTask(
							taskId,
							p.error ?? p.detail ?? t("tasks.connectorFailed"),
						);
						connectorProgressTasksRef.current.delete(p.key);
					}
				}),
			);
			unsubs.push(
				await listen<{ message?: string }>("connector:error", (ev) => {
					const msg = ev.payload?.message?.trim();
					if (msg) notifyError(msg);
				}),
			);
		})();
		return () => {
			cancelled = true;
			for (const u of unsubs) u();
		};
	}, [refreshTree, refreshLibrary, openPaper, t]);

	const handleLookupSubmit = useCallback(
		async (texts: string[]) => {
			if (!vaultPath) {
				throw new Error(t("sidebar:lookup.needsVault"));
			}
			if (texts.length === 0) return;

			const result = await runBackgroundTask(
				{
					kind: "lookup",
					title: t("tasks.lookupImport"),
					detail: texts
						.slice(0, 3)
						.map((t) => t.trim().slice(0, 40))
						.join(", "),
				},
				async ({ id, setDetail }) => {
					setDetail(
						t("tasks.lookupFetching", {
							id: texts.length.toString(),
						}),
					);
					const r = await addPapersByIdentifiers({
						vaultRoot: vaultPath,
						parentDir: lookupParentDir,
						texts,
						settings,
						progressTaskId: id,
					});
					setDetail(
						t("tasks.lookupRefreshing", {
							title: t("sidebar:lookup.batchSummary", {
								imported: r.imported.length,
								skipped: r.skipped.length,
								failed: r.errors.length,
							}),
						}),
					);
					await refreshTree(vaultPath);
					if (!isRemoteVaultHandle(vaultPath)) {
						await rebuildWikiAndNotify(vaultPath);
					}
					await refreshLibrary();
					return r;
				},
			);

			const first = result.imported[0];
			if (first) {
				const paperAbs =
					first.paperDir?.replace(/\\/g, "/").replace(/\/+$/, "") ||
					`${vaultPath.replace(/\\/g, "/").replace(/\/+$/, "")}/${(
						first.path || ""
					)
						.replace(/\\/g, "/")
						.replace(/^\/+|\/+$/g, "")}`;
				openPaper(paperAbs);
			}

			// Summary toast.
			const summary = t("sidebar:lookup.batchSummary", {
				imported: result.imported.length,
				skipped: result.skipped.length,
				failed: result.errors.length,
			});
			if (result.errors.length > 0 || result.imported.length === 0) {
				notifyError(summary);
			} else {
				notifySuccess(summary);
			}

			// Enqueue any newly imported papers that still lack assets.
			const newPaths = result.imported.map((r) => r.path);
			if (newPaths.length > 0) {
				const needing = collectPapersNeedingAssetDownload(tree).filter((p) =>
					newPaths.some((rel) => {
						const n = p.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
						const r = rel.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
						return n === r || n.startsWith(`${r}/`);
					}),
				);
				if (needing.length > 0) {
					for (const paperPath of needing) {
						const rel = toVaultRelative(vaultPath, paperPath)
							.replace(/\\/g, "/")
							.replace(/^\/+|\/+$/g, "");
						void runQueuedBackgroundTask(
							{
								kind: "download",
								title: t("tasks.downloadPaper"),
								detail: rel,
							},
							settings.batchImportConcurrency,
							async ({ id, signal }) => {
								if (signal.aborted) throw new Error("cancelled");
								await downloadPaperAssets({
									vaultRoot: vaultPath,
									paperPath: rel,
									progressTaskId: id,
								});
								await refreshTree(vaultPath);
								await refreshLibrary();
							},
						).catch((e) => {
							if (isBackgroundTaskCancelledError(e)) return;
							notifyError(
								`${rel}: ${e instanceof Error ? e.message : String(e)}`,
							);
						});
					}
				}
			}
		},
		[
			vaultPath,
			lookupParentDir,
			settings,
			refreshTree,
			refreshLibrary,
			openPaper,
			rebuildWikiAndNotify,
			t,
			tree,
		],
	);

	/**
	 * On-demand assets: missing local PDF, and/or arXiv TeX when fetchable but absent.
	 */
	const handleDownloadPaperAssets = useCallback(
		async (node: FileNode) => {
			if (!vaultPath) return;
			const rel = toVaultRelative(vaultPath, node.path)
				.replace(/\\/g, "/")
				.replace(/^\/+|\/+$/g, "");
			try {
				const assets = await runBackgroundTask(
					{
						kind: "download",
						title: t("tasks.downloadPaper"),
						detail: rel,
					},
					async ({ id, setDetail }) => {
						setDetail(rel);
						const r = await downloadPaperAssets({
							vaultRoot: vaultPath,
							paperPath: rel,
							progressTaskId: id,
						});
						setDetail(t("tasks.downloadRefreshing", { path: rel }));
						await refreshTree(vaultPath);
						await refreshLibrary();
						return r;
					},
				);
				// After PDF/TeX/PAPER.md ready → auto paper-reader with task progress
				if (
					paperAssetsReadyForReader({
						pdf: assets.pdf,
						tex: assets.tex,
						paperMd: assets.paperMd,
					})
				) {
					// Fire-and-forget: reader progress shows in the bottom-left task bar.
					// Do NOT await — awaiting keeps every paper row busy during reading.
					void maybeAutoRunPaperReader({
						vaultRoot: vaultPath,
						paperPath: rel,
						assetsReady: true,
					})
						.then(async (started) => {
							if (!started) return;
							await refreshLibrary();
							const notesAbs = notesPathForPaper(node.path);
							try {
								const content = await readVaultFile(notesAbs);
								refreshTabNotes(node.path, content);
							} catch {
								// ignore
							}
						})
						.catch((e) => {
							notifyError(e instanceof Error ? e.message : String(e));
						});
				}
			} catch (e) {
				notifyError(e instanceof Error ? e.message : String(e));
			}
		},
		[vaultPath, refreshTree, refreshLibrary, refreshTabNotes, t],
	);

	/** Catalog rows by vault-relative path (for Zap / is_read). */
	const paperMetaByRelPath = useMemo(() => {
		const map = new Map<string, PaperMetadata>();
		for (const p of libraryPapers) {
			if (!p.path) continue;
			const key = p.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
			map.set(key, p);
		}
		return map;
	}, [libraryPapers]);

	/**
	 * paper-reader workflow: Zap on complete + unread papers.
	 * Progress surfaces in the bottom-left background tasks panel.
	 */
	const handleReadPaper = useCallback(
		async (node: FileNode) => {
			if (!vaultPath) return;
			const rel = toVaultRelative(vaultPath, node.path)
				.replace(/\\/g, "/")
				.replace(/^\/+|\/+$/g, "");
			// Fire-and-forget: reader progress shows in the bottom-left task bar.
			// Do NOT await — awaiting keeps every paper row busy during reading.
			void runPaperReaderWorkflow({
				vaultRoot: vaultPath,
				paperPath: rel,
			})
				.then(async () => {
					await refreshLibrary();
					// Refresh NOTES pane if this paper is open in a tab
					const notesAbs = notesPathForPaper(node.path);
					try {
						const content = await readVaultFile(notesAbs);
						refreshTabNotes(node.path, content);
					} catch {
						// ignore
					}
				})
				.catch((e) => {
					notifyError(e instanceof Error ? e.message : String(e));
				});
		},
		[vaultPath, refreshLibrary, refreshTabNotes],
	);

	/**
	 * Library bulk download: every paper folder missing PDF and/or fetchable TeX.
	 * Walks the file tree so local source/ presence matches the row icons.
	 */
	const [libraryIoBusy, setLibraryIoBusy] = useState<
		"import" | "export" | "import-pdf" | null
	>(null);

	const handleLibraryExport = useCallback(async () => {
		if (!vaultPath || libraryIoBusy) return;
		setLibraryIoBusy("export");
		try {
			await runBackgroundTask(
				{
					kind: "export",
					title: t("tasks.libraryExport"),
				},
				async () => {
					const result = await exportLibraryToFile({
						vaultPath,
						settings,
						format: "bibtex",
					});
					if (!result) {
						// User cancelled dialog — treat as soft cancel, not failure
						return null;
					}
					return result;
				},
			);
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
		} finally {
			setLibraryIoBusy(null);
		}
	}, [vaultPath, settings, libraryIoBusy, t]);

	const handleLibraryImport = useCallback(async () => {
		if (!vaultPath || libraryIoBusy) return;
		setLibraryIoBusy("import");
		try {
			const result = await runBackgroundTask(
				{
					kind: "import",
					title: t("tasks.libraryImport"),
				},
				async ({ setDetail }) => {
					const r = await importLibraryFromFile({
						vaultPath,
						parentDir: lookupParentDir,
						settings,
					});
					if (!r) return null;
					setDetail(
						t("sidebar:papersLibrary.importDone", { count: r.imported }),
					);
					await refreshTree(vaultPath);
					await refreshLibrary();
					return r;
				},
			);
			if (result?.errors.length) {
				notifyWarning(
					`${t("sidebar:papersLibrary.importDone", { count: result.imported })}; ${result.errors.slice(0, 2).join("; ")}`,
				);
			}
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
		} finally {
			setLibraryIoBusy(null);
		}
	}, [
		vaultPath,
		settings,
		libraryIoBusy,
		lookupParentDir,
		refreshTree,
		refreshLibrary,
		t,
	]);

	/**
	 * Import local PDF file(s) → paper folders + catalog + PAPER.md.
	 * - No args: native PDF picker (magic wand).
	 * - `entries` + optional `parentDir`: confirm-dialog drop import.
	 */
	const handleImportLocalPdf = useCallback(
		async (opts?: { entries?: LocalPdfImportEntry[]; parentDir?: string }) => {
			if (!vaultPath || libraryIoBusy) return;
			// Paths under ~/.agentero/import-tmp from path-less WKWebView drops.
			const stagingPaths = (opts?.entries ?? [])
				.map((e) => e.filePath)
				.filter(isImportTempPath);
			setLibraryIoBusy("import-pdf");
			try {
				const result = await runBackgroundTask(
					{
						kind: "import",
						title: t("tasks.importPdf"),
					},
					async ({ setDetail }) => {
						const r = await importLocalPdfs({
							vaultRoot: vaultPath,
							parentDir: opts?.parentDir ?? lookupParentDir,
							entries: opts?.entries,
						});
						if (!r) return null;
						setDetail(
							t("sidebar:papersLibrary.importPdfDone", {
								count: r.papers.length,
							}),
						);
						await refreshTree(vaultPath);
						await rebuildWikiAndNotify(vaultPath);
						await refreshLibrary();
						return r;
					},
				);
				if (result) {
					if (result.papers[0]) openPaper(result.papers[0].paperDir);
					if (result.errors.length) {
						notifyWarning(
							`${t("sidebar:papersLibrary.importPdfDone", { count: result.papers.length })}; ${result.errors.slice(0, 2).join("; ")}`,
						);
					}
				}
			} catch (e) {
				notifyError(e instanceof Error ? e.message : String(e));
			} finally {
				setLibraryIoBusy(null);
				void cleanupImportTempPaths(stagingPaths);
			}
		},
		[
			vaultPath,
			libraryIoBusy,
			lookupParentDir,
			refreshTree,
			refreshLibrary,
			rebuildWikiAndNotify,
			openPaper,
			t,
		],
	);

	/** OS PDF drop onto a papers/ folder → metadata confirm dialog (not silent import). */
	const [importPdfDraft, setImportPdfDraft] = useState<{
		items: Array<{ path: string; sourceName: string }>;
		parentDir: string;
	} | null>(null);

	const handleDropLocalPdfs = useCallback(
		(items: Array<{ path: string; sourceName: string }>, parentDir: string) => {
			if (!items.length) return;
			const paths = items.map((i) => i.path);
			if (!vaultPath) {
				notifyWarning(t("errors.dropPdfNeedsVault"));
				void cleanupImportTempPaths(paths);
				return;
			}
			if (libraryIoBusy) {
				void cleanupImportTempPaths(paths);
				return;
			}
			setImportPdfDraft({
				items,
				parentDir: parentDir || "papers",
			});
		},
		[vaultPath, libraryIoBusy, t],
	);

	const handleConfirmImportLocalPdf = useCallback(
		(entries: LocalPdfImportEntry[], parentDir: string) => {
			setImportPdfDraft(null);
			void handleImportLocalPdf({ entries, parentDir });
		},
		[handleImportLocalPdf],
	);

	const handleImportLocalPdfDialogOpenChange = useCallback(
		(open: boolean) => {
			if (open) return;
			const paths = importPdfDraft?.items.map((i) => i.path) ?? [];
			setImportPdfDraft(null);
			// User cancelled confirm — drop staging copies.
			void cleanupImportTempPaths(paths);
		},
		[importPdfDraft],
	);

	// Cancel WebView navigation on any OS file drop (PDF import is tree-only).
	useExternalFileDrop();

	const handleDownloadAllMissingAssets = useCallback(async () => {
		if (!vaultPath) return;
		const queue = collectPapersNeedingAssetDownload(tree);
		if (!queue.length) return;

		const errors: string[] = [];
		try {
			await runBackgroundTask(
				{
					kind: "downloadAll",
					title: t("tasks.downloadAll"),
					detail: t("tasks.downloadProgress", {
						current: 0,
						total: queue.length,
					}),
				},
				async ({ id, signal, setProgress, setDetail }) => {
					let i = 0;
					for (const paperPath of queue) {
						if (signal.aborted) throw new Error("background task cancelled");
						const rel = toVaultRelative(vaultPath, paperPath)
							.replace(/\\/g, "/")
							.replace(/^\/+|\/+$/g, "");
						i += 1;
						setDetail(
							`${t("tasks.downloadProgress", { current: i, total: queue.length })} · ${rel}`,
						);
						setProgress(Math.round(((i - 1) / queue.length) * 100));
						try {
							await downloadPaperAssets({
								vaultRoot: vaultPath,
								paperPath: rel,
								progressTaskId: id,
							});
						} catch (e) {
							if (signal.aborted) throw e;
							errors.push(
								`${rel}: ${e instanceof Error ? e.message : String(e)}`,
							);
						}
						setProgress(Math.round((i / queue.length) * 100));
					}
					await refreshTree(vaultPath);
					await refreshLibrary();
				},
			);
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
		}
		if (errors.length) {
			notifyError(errors.slice(0, 3).join("; "));
		}
	}, [vaultPath, tree, refreshTree, refreshLibrary, t]);

	const handleOpenLibraryPaper = useCallback(
		(paper: PaperMetadata) => {
			if (!vaultPath || !paper.path) return;
			const abs = joinVaultPath(vaultPath, paper.path);
			openPaper(abs);
		},
		[vaultPath, openPaper],
	);

	const handleLibraryExportClick = useCallback(() => {
		void handleLibraryExport();
	}, [handleLibraryExport]);
	const handleMigrateZoteroOpen = useCallback(() => setZoteroOpen(true), []);

	/**
	 * Memoized TabCenter props — must not be an inline object in JSX, or
	 * TabCenter's React.memo never bails out (see comment on stable handlers).
	 */
	const centerProps = useMemo(
		() => ({
			vaultPath,
			libraryPapers,
			libraryLoading,
			libraryQuery,
			onLibraryQueryChange: setLibraryQuery,
			libraryScopePath,
			libraryColumns: settings.libraryColumns,
			onLibraryColumnsChange: handleLibraryColumnsChange,
			rescanning,
			onOpenLibraryPaper: handleOpenLibraryPaper,
			onRescanPapers: handleRescanPapers,
			onMigrateZotero: handleMigrateZoteroOpen,
			onTrashChanged: handleTrashChanged,
			trashReloadSignal,
			editorFontSize: settings.editorFontSize,
			showEditorToolbar: settings.showEditorToolbar,
			notesPlaceholder: t("editor.notesPlaceholder"),
			markdownPlaceholder: t("editor.markdownPlaceholder"),
			onPersistFile: persistFile,
			onEditorAssetsChanged: handleEditorAssetsChanged,
			onTabPatch: updateTab,
			pdfZen: pdfZenMode,
			onTogglePdfZen: togglePdfZen,
			onOpenAnnotations: openAnnotationsTab,
			onOpenSettings: handleOpenSettingsTranslate,
			registerPdfHandle,
			onPdfHighlightsChange: handlePdfHighlightsChange,
			onPdfAsksChange: handlePdfAsksChange,
		}),
		[
			vaultPath,
			libraryPapers,
			libraryLoading,
			libraryQuery,
			libraryScopePath,
			settings.libraryColumns,
			settings.editorFontSize,
			settings.showEditorToolbar,
			handleLibraryColumnsChange,
			rescanning,
			handleOpenLibraryPaper,
			handleRescanPapers,
			handleMigrateZoteroOpen,
			handleTrashChanged,
			trashReloadSignal,
			t,
			persistFile,
			handleEditorAssetsChanged,
			updateTab,
			pdfZenMode,
			togglePdfZen,
			openAnnotationsTab,
			handleOpenSettingsTranslate,
			registerPdfHandle,
			handlePdfHighlightsChange,
			handlePdfAsksChange,
		],
	);

	/** Persist tags from Paper Info and keep library + open tabs in sync. */
	const handlePaperTagsChange = useCallback(
		async (tags: PaperTag[]) => {
			if (!vaultPath || !paperMeta) return;
			// Prefer catalog path on meta; fall back to the open paper folder so
			// Projection may omit `path`; fall back to the open paper folder.
			let path = (paperMeta.path ?? "")
				.replace(/\\/g, "/")
				.replace(/^\/+|\/+$/g, "");
			if (!path && selectedPath) {
				let paperDir = paperDirFromPath(selectedPath, paperFolders);
				if (!paperDir && (await detectPaperDirectory(selectedPath))) {
					paperDir = selectedPath.replace(/[\\/]+$/, "");
				}
				path = paperCatalogPath(paperDir ?? "", vaultPath) ?? "";
			}
			if (!path) {
				notifyError(t("sidebar:paperInfo.tagsSaveFailed"));
				return;
			}
			try {
				const updated = await setPaperTags(vaultPath, path, tags);
				setLibraryPapers((prev) =>
					prev.map((p) => {
						const key = (p.path ?? "")
							.replace(/\\/g, "/")
							.replace(/^\/+|\/+$/g, "");
						return key === path ? { ...p, ...updated } : p;
					}),
				);
				setTabs((prev) =>
					prev.map((tab) => {
						if (!tab.paperMeta) return tab;
						const key = (tab.paperMeta.path ?? "")
							.replace(/\\/g, "/")
							.replace(/^\/+|\/+$/g, "");
						const samePath = key === path;
						const sameOpenPaper =
							!key &&
							tab.id === activeTabId &&
							tab.paperMeta.id === paperMeta.id;
						if (!samePath && !sameOpenPaper) return tab;
						return {
							...tab,
							paperMeta: {
								...tab.paperMeta,
								...updated,
								path: updated.path ?? path,
							},
						};
					}),
				);
			} catch (e) {
				notifyError(e instanceof Error ? e.message : String(e));
			}
		},
		[vaultPath, paperMeta, selectedPath, paperFolders, activeTabId, t],
	);

	const openPath = useCallback(
		(absoluteOrDemoPath: string) => {
			openTab(absoluteOrDemoPath, {
				preferMode: preferredModeForPath(absoluteOrDemoPath),
			});
		},
		[openTab],
	);

	const handleStartCreate = useCallback(
		(kind: TreeCreateKind, parentPath: string) => {
			if (!vaultPath || !isTauri()) {
				notifyError(t("sidebar:fileTree.needsVault"));
				return;
			}
			setCreateDraft({ kind, parentPath });
		},
		[vaultPath, t],
	);

	const handleCancelCreate = useCallback(() => {
		setCreateDraft(null);
	}, []);

	const handleConfirmCreate = useCallback(
		async (name: string) => {
			if (!createDraft || !vaultPath || !isTauri()) {
				setCreateDraft(null);
				return;
			}
			const trimmed = name.trim();
			if (!isValidVaultEntryName(trimmed)) {
				notifyError(t("sidebar:fileTree.invalidName"));
				setCreateDraft(null);
				return;
			}
			const full = joinVaultPath(createDraft.parentPath, trimmed);
			const kind = createDraft.kind;
			// Clear draft first so the tree can re-render after create.
			setCreateDraft(null);
			try {
				setBusy(true);
				const { exists } = await import("@tauri-apps/plugin-fs");
				if (await exists(full)) {
					notifyError(t("sidebar:fileTree.alreadyExists", { name: trimmed }));
					return;
				}
				if (kind === "file") {
					await writeVaultFile(full, "");
					await refreshTree(vaultPath);
					openPath(full);
				} else {
					await createVaultDirectory(full);
					await refreshTree(vaultPath);
					setTreeSelectedPath(full);
				}
			} catch (e) {
				notifyError(e instanceof Error ? e.message : String(e));
			} finally {
				setBusy(false);
			}
		},
		[createDraft, vaultPath, t, refreshTree, openPath],
	);

	const handleCreateVault = useCallback(async () => {
		try {
			if (!isTauri()) {
				notifyError(t("errors.openVaultDesktopOnly"));
				return;
			}
			setBusy(true);
			const path = await pickCreateVaultDirectory();
			if (!path) return;
			const result = await createVault(path);
			const root = result.path || path;
			await activateVault(root);
			const sep = root.includes("\\") ? "\\" : "/";
			const openRel = result.openPath || "AGENTS.md";
			const openAbs = `${root.replace(/[\\/]+$/, "")}${sep}${openRel.replace(/\//g, sep)}`;
			openPath(openAbs);
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, [activateVault, openPath, t]);

	/** Welcome-page entry: create a vault, then open the Zotero migrate dialog. */
	const handleMigrateZoteroFromWelcome = useCallback(async () => {
		try {
			if (!isTauri()) {
				notifyError(t("errors.openVaultDesktopOnly"));
				return;
			}
			setBusy(true);
			const path = await pickCreateVaultDirectory();
			if (!path) return;
			const result = await createVault(path);
			const root = result.path || path;
			await activateVault(root);
			setZoteroOpen(true);
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, [activateVault, t]);

	const anyOverlayOpen = useAnyOverlayOpen();

	const focusNotesEditor = useCallback(() => {
		const tab = tabsRef.current.find((t) => t.id === activeTabIdRef.current);
		if (
			tab &&
			tabNotesEligible(tab) &&
			!tabHasNotesSplit(tabsRef.current, tab)
		) {
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
	}, [toggleNotesSplit]);

	const focusEditorPane = useCallback(() => {
		editorPaneRef.current
			?.querySelector<HTMLElement>("[contenteditable='true']")
			?.focus();
	}, []);

	const openPalette = useCallback(
		(mode: PaletteMode) => {
			if (commandOpen && commandModeRef.current === mode) {
				setCommandOpen(false);
				return;
			}
			setCommandMode(mode);
			setCommandOpen(true);
		},
		[commandOpen],
	);

	const paletteCommands = useMemo((): AppCommand[] => {
		const hasVault = () => Boolean(vaultPath);
		return [
			{
				id: "settings.open",
				titleKey: "commands.settingsOpen",
				categoryKey: "commands.catApp",
				keywords: ["preferences", "settings"],
				run: () => openSettings(),
			},
			{
				id: "settings.close",
				titleKey: "commands.settingsClose",
				categoryKey: "commands.catApp",
				when: () => settingsOpenRef.current,
				run: () => closeSettings(),
			},
			{
				id: "vault.open",
				titleKey: "commands.vaultOpen",
				categoryKey: "commands.catVault",
				run: () => void handleOpenVault(),
			},
			{
				id: "vault.create",
				titleKey: "commands.vaultCreate",
				categoryKey: "commands.catVault",
				run: () => void handleCreateVault(),
			},
			{
				id: "vault.refresh",
				titleKey: "commands.vaultRefresh",
				categoryKey: "commands.catVault",
				when: hasVault,
				run: () => handleRefresh(),
			},
			{
				id: "vault.reveal",
				titleKey: "commands.vaultReveal",
				categoryKey: "commands.catVault",
				when: hasVault,
				run: () => handleRevealInFinder(),
			},
			{
				id: "vault.terminal",
				titleKey: "commands.vaultTerminal",
				categoryKey: "commands.catVault",
				when: hasVault,
				run: () => handleOpenInTerminal(),
			},
			{
				id: "vault.collapseTreeCurrent",
				titleKey: "commands.vaultCollapseTreeCurrent",
				categoryKey: "commands.catVault",
				when: hasVault,
				keywords: ["collapse", "folder", "tree", "fold"],
				run: () => fileTreeRef.current?.collapseSelected(),
			},
			{
				id: "vault.collapseTreeDefault",
				titleKey: "commands.vaultCollapseTreeDefault",
				categoryKey: "commands.catVault",
				when: hasVault,
				keywords: ["collapse", "default", "papers", "tree", "fold"],
				run: () => fileTreeRef.current?.collapseToDefault(),
			},
			{
				id: "view.toggleSidebar",
				titleKey: "commands.viewToggleSidebar",
				categoryKey: "commands.catView",
				run: () => toggleSidebar(),
			},
			{
				id: "view.toggleChat",
				titleKey: "commands.viewToggleChat",
				categoryKey: "commands.catView",
				keywords: ["agent", "chat"],
				run: () => toggleChat(),
			},
			{
				id: "view.agentZen",
				titleKey: "commands.viewAgentZen",
				categoryKey: "commands.catView",
				run: () => toggleAgentZen(),
			},
			{
				id: "view.focusSidebar",
				titleKey: "commands.viewFocusSidebar",
				categoryKey: "commands.catView",
				run: () => expandSidebar(),
			},
			{
				id: "view.focusEditor",
				titleKey: "commands.viewFocusEditor",
				categoryKey: "commands.catView",
				run: () => focusEditorPane(),
			},
			{
				id: "view.focusNotes",
				titleKey: "commands.viewFocusNotes",
				categoryKey: "commands.catView",
				run: () => focusNotesEditor(),
			},
			{
				id: "library.focus",
				titleKey: "commands.libraryFocus",
				categoryKey: "commands.catLibrary",
				when: hasVault,
				run: () => {
					setTreeSelectedPath(LIBRARY_VIRTUAL_PATH);
					setLibraryScopePath(null);
					openTab(LIBRARY_VIRTUAL_PATH);
					void refreshLibrary();
				},
			},
			{
				id: "tab.close",
				titleKey: "commands.tabClose",
				categoryKey: "commands.catTab",
				run: () => closeTabOrWindow(),
			},
			{
				id: "tab.next",
				titleKey: "commands.tabNext",
				categoryKey: "commands.catTab",
				run: () => cycleActiveTab(1),
			},
			{
				id: "tab.prev",
				titleKey: "commands.tabPrev",
				categoryKey: "commands.catTab",
				run: () => cycleActiveTab(-1),
			},
			{
				id: "wand.open",
				titleKey: "commands.wandOpen",
				categoryKey: "commands.catVault",
				keywords: ["import", "arxiv", "doi", "lookup"],
				when: hasVault,
				run: () => openMagicWand(),
			},
		];
	}, [
		vaultPath,
		openSettings,
		closeSettings,
		handleOpenVault,
		handleCreateVault,
		handleRefresh,
		handleRevealInFinder,
		handleOpenInTerminal,
		toggleSidebar,
		toggleChat,
		toggleAgentZen,
		expandSidebar,
		focusEditorPane,
		focusNotesEditor,
		openTab,
		refreshLibrary,
		closeTabOrWindow,
		cycleActiveTab,
		openMagicWand,
	]);

	useAppShortcuts(anyOverlayOpen, {
		settings: () => {
			if (settingsOpenRef.current) closeSettings();
			else openSettings();
		},
		// Esc → dismiss top overlay (settings, palette, dialogs…)
		closeSheet: () => {
			closeTopOverlay();
		},
		newWindow: () => void handleNewWindow(),
		openVault: () => void handleOpenVault(),
		createVault: () => void handleCreateVault(),
		refreshTree: handleRefresh,
		revealInFinder: handleRevealInFinder,
		openInTerminal: handleOpenInTerminal,
		deleteTreeItem: handleDeleteSelected,
		collapseTreeCurrent: () => fileTreeRef.current?.collapseSelected(),
		collapseTreeDefault: () => fileTreeRef.current?.collapseToDefault(),
		magicWand: openMagicWand,
		quickOpen: () => openPalette("go"),
		commandPalette: () => openPalette("commands"),
		toggleSidebar,
		toggleChat,
		toggleAgentZen,
		focusSidebar: expandSidebar,
		focusEditor: focusEditorPane,
		focusNotes: focusNotesEditor,
		closeTab: closeTabOrWindow,
		nextTab: () => cycleActiveTab(1),
		prevTab: () => cycleActiveTab(-1),
		zoomIn: () => {
			const current = settingsRef.current.uiScale;
			const idx = UI_SCALE_PRESETS.findIndex((s) => s > current);
			const next = idx === -1 ? current : UI_SCALE_PRESETS[idx];
			if (next !== current) {
				updateSettings({ ...settingsRef.current, uiScale: next });
			}
		},
		zoomOut: () => {
			const current = settingsRef.current.uiScale;
			let next = current;
			for (let i = UI_SCALE_PRESETS.length - 1; i >= 0; i--) {
				if (UI_SCALE_PRESETS[i] < current) {
					next = UI_SCALE_PRESETS[i];
					break;
				}
			}
			if (next !== current) {
				updateSettings({ ...settingsRef.current, uiScale: next });
			}
		},
		zoomReset: () => {
			if (settingsRef.current.uiScale !== 1) {
				updateSettings({ ...settingsRef.current, uiScale: 1 });
			}
		},
	});

	useNativeMenuEvents({
		onSettings: openSettings,
		onOpenVault: handleOpenVault,
		onCreateVault: handleCreateVault,
		onRefresh: handleRefresh,
		onToggleSidebar: toggleSidebar,
		onToggleChat: toggleChat,
		onCloseTabOrWindow: closeTabOrWindow,
	});

	const handleSelectLibrary = useCallback(() => {
		setTreeSelectedPath(LIBRARY_VIRTUAL_PATH);
		setLibraryScopePath(null);
		openTab(LIBRARY_VIRTUAL_PATH);
		void refreshLibrary();
	}, [openTab, refreshLibrary]);

	const handleSelectTrash = useCallback(() => {
		setTreeSelectedPath(TRASH_VIRTUAL_PATH);
		openTab(TRASH_VIRTUAL_PATH);
	}, [openTab]);

	/**
	 * Org folder click: expand happens in the tree; center shows the same Library
	 * tab filtered by path prefix — never opens a new tab for the folder.
	 */
	const openFolderLibrary = useCallback(
		(folderAbs: string) => {
			const abs = folderAbs.replace(/\\/g, "/").replace(/\/+$/, "");
			setTreeSelectedPath(abs);
			const vault = vaultPathRef.current;
			const rel = vault
				? toVaultRelative(vault, abs)
						.replace(/\\/g, "/")
						.replace(/^\/+|\/+$/g, "")
				: "";
			setLibraryScopePath(rel || null);
			// Reuse / focus the single full-library tab only.
			openTab(LIBRARY_VIRTUAL_PATH);
		},
		[openTab],
	);

	const handleSelectFile = (node: FileNode) => {
		if (isLibraryVirtualPath(node.path)) {
			handleSelectLibrary();
			return;
		}
		if (isTrashVirtualPath(node.path)) {
			handleSelectTrash();
			return;
		}
		if (
			node.kind === "directory" &&
			isPaperDirectory(node.path, node.children)
		) {
			openPaper(node.path);
			return;
		}
		// Org / plain folders → in-place scope on the Library tab (no new tab).
		if (node.kind === "directory") {
			openFolderLibrary(node.path);
			return;
		}
		if (node.kind !== "file") return;
		openPath(node.path);
	};

	/** Open a vault-relative path from backlinks (e.g. `notes/idea.md`). */
	const handleOpenVaultRel = useCallback(
		(rel: string) => {
			if (!vaultPath) {
				notifyError(t("errors.openVaultForLinks"));
				return;
			}
			const clean = normalizeVaultRel(rel);
			const full = `${vaultPath.replace(/[\\/]+$/, "")}/${clean}`;
			openPath(full);
		},
		[vaultPath, openPath, t],
	);

	/** Graph: paper NOTES / paper folder → open paper (PDF + Notes). */
	const handleGraphOpenPath = useCallback(
		(rel: string) => {
			if (!vaultPath) {
				notifyError(t("errors.openVaultForGraph"));
				return;
			}
			const clean = normalizeVaultRel(rel);
			const root = vaultPath.replace(/[\\/]+$/, "");
			// paperFolders are absolute paths from the file tree
			const paperAbs = paperDirFromPath(`${root}/${clean}`, paperFolders);
			if (paperAbs) {
				openPaper(paperAbs);
				return;
			}
			// Collapsed graph node may already be the paper folder rel path
			void (async () => {
				const candidate = `${root}/${clean}`;
				if (await detectPaperDirectory(candidate)) {
					openPaper(candidate);
					return;
				}
				handleOpenVaultRel(clean);
			})();
		},
		[vaultPath, openPaper, handleOpenVaultRel, paperFolders, t],
	);

	const handleWikiNavigate = useCallback(
		async (nav: WikiNavTarget) => {
			if (nav.exists && nav.path) {
				handleOpenVaultRel(nav.path);
				return;
			}
			if (!vaultPath) {
				notifyError(t("errors.openVaultForCreate"));
				return;
			}
			const createRel = missingNotePath(nav.targetRaw);
			const ok = window.confirm(
				t("confirm.createNote", {
					target: nav.targetRaw,
					path: createRel,
				}),
			);
			if (!ok) return;

			const content = newNoteMarkdown(nav.targetRaw);
			const full = `${vaultPath.replace(/[\\/]+$/, "")}/${createRel}`;

			try {
				await writeVaultFile(full, content);
				await rebuildWikiAndNotify(vaultPath);
				await refreshTree(vaultPath);
				openPath(full);
			} catch (e) {
				notifyError(e instanceof Error ? e.message : String(e));
			}
		},
		[
			vaultPath,
			handleOpenVaultRel,
			openPath,
			refreshTree,
			rebuildWikiAndNotify,
			t,
		],
	);

	const wikiNavValue = useMemo(
		() => ({
			onWikiNavigate: (nav: WikiNavTarget) => void handleWikiNavigate(nav),
			mdFiles: vaultMdFiles,
		}),
		[handleWikiNavigate, vaultMdFiles],
	);

	/** NOTES toggle: eligible when active panel is a paper PDF/HTML, or its NOTES. */
	const notesEligiblePaper = useMemo(() => {
		if (!activeTab) return null;
		if (tabNotesEligible(activeTab)) return activeTab;
		// Active is NOTES.md of some open paper.
		if (activeTab.notesPath && tabIsPaperNotes(activeTab)) {
			const paperDir = activeTab.notesPath.replace(/[\\/]NOTES\.md$/i, "");
			return (
				tabs.find(
					(t) =>
						t.kind === "paper" &&
						normalizeTabPath(t.path) === normalizeTabPath(paperDir),
				) ?? null
			);
		}
		return null;
	}, [activeTab, tabs]);
	const notesEligible = Boolean(notesEligiblePaper);
	const notesSplitOpen = notesEligiblePaper
		? tabHasNotesSplit(tabs, notesEligiblePaper)
		: false;

	return (
		<WikiNavContext.Provider value={wikiNavValue}>
			<div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-background text-foreground">
				{/*
				  macOS title bar (traffic lights row): Tauri Overlay + hiddenTitle.
				  Left: panel collapse after traffic lights; right: agent / backlinks / panel.
				  Drag window via data-tauri-drag-region (empty middle).
				*/}
				{/*
				  Title bar height must match trafficLightPosition math in tao:
				  titleBarH ≈ closeButtonH(~14) + y(18) ≈ 32 → h-8
				*/}
				<WorkspaceHeader
					isMacDesktop={isMacDesktop}
					showWindowControls={showWindowControls}
					agentZenMode={agentZenMode}
					sidebarCollapsed={sidebarCollapsed}
					notesEligible={notesEligible}
					showNotes={notesSplitOpen}
					rightSidebarOpen={rightSidebarOpen}
					rightSidebarTab={rightSidebarTab}
					onExitAgentZen={exitAgentZen}
					onToggleSidebar={toggleSidebar}
					onToggleNotes={() => toggleNotesSplit()}
					onToggleRightSidebar={toggleRightSidebar}
					onToggleAgentZen={toggleAgentZen}
					onOpenRightTab={openRightTab}
					onOpenSettings={openSettings}
				/>

				<ErrorBoundary label="workspace">
					<ResizableGroup
						orientation="horizontal"
						className="h-full min-h-0 flex-1 overflow-hidden"
					>
						<ResizablePanel
							id="sidebar"
							panelRef={sidebarPanelRef}
							defaultSize={SIDEBAR_DEFAULT_PX}
							minSize={160}
							maxSize={420}
							collapsible
							collapsedSize={0}
							// Keep pixel width when the right rail or Notes column appears/disappears.
							groupResizeBehavior="preserve-pixel-size"
							className="min-h-0 overflow-hidden"
							onResize={(size) => {
								// Only mark collapsed after a real collapse (near 0px), never mid-drag.
								if (size.inPixels <= 1) setSidebarCollapsed(true);
								else if (size.inPixels >= 80) {
									setSidebarCollapsed(false);
									leftWidthPxRef.current = size.inPixels;
								}
							}}
						>
							<aside
								ref={sidebarAsideRef}
								className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20"
							>
								<div className="shrink-0">
									<VaultSidebarHeader
										title={
											vaultPath && isRemoteVaultHandle(vaultPath)
												? `${vaultDisplayName(vaultPath)} · ${t("app:vault.remoteBadge")}`
												: vaultDisplayName(vaultPath)
										}
										lookupParentDir={lookupParentDir}
										onLookupSubmit={handleLookupSubmit}
										onImportBibliography={() => void handleLibraryImport()}
										onImportLocalPdf={() => void handleImportLocalPdf()}
										importBusy={libraryIoBusy === "import"}
										importPdfBusy={libraryIoBusy === "import-pdf"}
										busy={busy || libraryIoBusy !== null}
										isDemo={isDemo}
										lookupOpenSignal={lookupOpenSignal}
										recentVaults={recentVaults}
										vaultPath={vaultPath}
										onOpenRecent={(p) => void handleOpenRecentVault(p)}
										onRemoveRecent={handleRemoveRecentVault}
										onOpenVault={() => void handleOpenVault()}
										onCreateVault={() => void handleCreateVault()}
										onOpenRemoteVault={(args) =>
											void handleOpenRemoteVault(args)
										}
									/>
								</div>
								<div className="flex min-h-0 flex-1 flex-col px-1">
									<FileTree
										ref={fileTreeRef}
										nodes={tree}
										loading={treeLoading}
										selectedPath={treeSelectedPath}
										vaultPath={vaultPath}
										createDraft={createDraft}
										onConfirmCreate={(name) => void handleConfirmCreate(name)}
										onCancelCreate={handleCancelCreate}
										onDeletePath={(path) => void handleDeletePath(path)}
										onDeletePaths={(paths) => void handleDeletePaths(paths)}
										onMovePaths={handleMovePaths}
										onMoveTo={(paths, dest) => void movePathsTo(paths, dest)}
										onDropLocalPdfs={handleDropLocalPdfs}
										onSelectFile={(n) => handleSelectFile(n)}
										onSelectLibrary={handleSelectLibrary}
										onSelectTrash={handleSelectTrash}
										onEmptyTrash={() => void handleEmptyTrash()}
										onExportLibrary={handleLibraryExportClick}
										libraryExportBusy={libraryIoBusy === "export"}
										onStartCreate={handleStartCreate}
										onDownloadPaperAssets={handleDownloadPaperAssets}
										onDownloadAllMissingAssets={handleDownloadAllMissingAssets}
										paperMetaByRelPath={paperMetaByRelPath}
										paperTreeLabelMode={settings.paperTreeLabelMode}
										paperTreeSortMode={settings.paperTreeSortMode}
										onReadPaper={handleReadPaper}
										onLoadDirChildren={handleLoadDirChildren}
									/>
								</div>
								{/* Paper info only when a specific paper is selected */}
								{paperMeta ? (
									<PaperInfoPanel
										meta={paperMeta}
										onTagsChange={handlePaperTagsChange}
									/>
								) : null}
							</aside>
						</ResizablePanel>

						{sidebarCollapsed || agentZenMode || pdfZenMode ? null : (
							<ResizableHandle />
						)}

						<ResizablePanel
							id="source"
							panelRef={sourcePanelRef}
							defaultSize="40"
							minSize={agentZenMode ? 0 : 200}
							collapsible
							collapsedSize={0}
							className="min-h-0 min-w-0 overflow-hidden"
						>
							<div
								ref={editorPaneRef}
								className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
							>
								{/* Document panels + library toolbar live inside dockview. */}
								{!vaultPath ? (
									isTauri() ? (
										<VaultWelcome
											recentVaults={recentVaults}
											busy={busy}
											onOpenVault={() => void handleOpenVault()}
											onOpenRemoteVault={(args) =>
												void handleOpenRemoteVault(args)
											}
											onCreateVault={() => void handleCreateVault()}
											onMigrateZotero={() =>
												void handleMigrateZoteroFromWelcome()
											}
											onOpenRecent={(path) => void handleOpenRecentVault(path)}
											onRemoveRecent={handleRemoveRecentVault}
										/>
									) : (
										<div className="agentero-scroll flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-muted/30 p-6 text-center">
											<FolderOpen className="size-10 text-muted-foreground" />
											<div className="max-w-xs space-y-2">
												<p className="font-medium text-sm">
													{t("vault.noVaultOpenTitle")}
												</p>
												<p className="text-muted-foreground text-xs">
													{t("vault.runTauriPrefix")}{" "}
													<code className="rounded bg-muted px-1 py-0.5">
														pnpm tauri dev
													</code>{" "}
													{t("vault.runTauriSuffix")}
												</p>
											</div>
										</div>
									)
								) : (
									<div className="relative min-h-0 flex-1 overflow-hidden">
										<TabWorkspace
											ref={workspaceRef}
											tabs={tabs}
											activePanelId={activeTabId}
											layout={dockLayout}
											pdfKeepMountedIds={[
												...pdfLru,
												...(activeTab?.mode === "pdf" && activeTab
													? [activeTab.id]
													: []),
											]}
											centerProps={centerProps}
											onActivePanelChange={setActiveTabId}
											onClosePanel={closeTab}
											onLayoutChange={handleLayoutChange}
											onExternalDrop={handleWorkspaceDrop}
										/>
									</div>
								)}
							</div>
						</ResizablePanel>

						{/*
						  Right sidebar: always mounted + collapsible (same as left).
						  Conditional mount used to remount the Group when toggling ⌘L,
						  which redistributed left panel size and caused visual overlap.
						*/}
						{rightSidebarOpen && !agentZenMode && !pdfZenMode ? (
							<ResizableHandle />
						) : null}
						<ResizablePanel
							id="right-sidebar"
							panelRef={rightSidebarPanelRef}
							defaultSize={0}
							minSize={agentZenMode || pdfZenMode ? 0 : 260}
							maxSize={agentZenMode ? "100%" : 520}
							collapsible
							collapsedSize={0}
							groupResizeBehavior="preserve-pixel-size"
							className="min-h-0 overflow-hidden"
							onResize={(size) => {
								if (agentZenModeRef.current) return;
								if (size.inPixels <= 1) setRightSidebarOpen(false);
								else if (size.inPixels >= 80) {
									setRightSidebarOpen(true);
									rightWidthPxRef.current = size.inPixels;
								}
							}}
						>
							{/* Keep AgentPanel alive across sidebar ↔ zen (no remount / lost chat). */}
							{(agentPanelMounted ||
								agentZenMode ||
								(rightSidebarOpen && rightSidebarTab === "agent")) && (
								<div
									className={cn(
										"h-full min-h-0",
										!agentZenMode &&
											(!rightSidebarOpen || rightSidebarTab !== "agent") &&
											"hidden",
									)}
								>
									<AgentPanel
										vaultPath={vaultPath}
										selectedPath={selectedPath}
										selectedPaperTitle={paperMeta?.title ?? null}
										vaultMarkdownPaths={vaultMdFiles}
										vaultDirectoryPaths={vaultDirPaths}
										vaultPaperPaths={vaultPaperPaths}
										paperMetaByRelPath={paperMetaByRelPath}
										paperTreeLabelMode={settings.paperTreeLabelMode}
										className="min-h-0 h-full"
										title={t("labels.agent")}
										variant={agentZenMode ? "zen" : "sidebar"}
										autoFocus={
											agentZenMode ||
											(rightSidebarOpen && rightSidebarTab === "agent")
										}
										onOpenAgentSettings={() => openSettings("agent")}
									/>
								</div>
							)}
							{rightSidebarOpen &&
							!agentZenMode &&
							rightSidebarTab === "backlinks" ? (
								<div className="flex h-full min-h-0 flex-col overflow-hidden">
									<BacklinksPanel
										vaultPath={vaultPath}
										selectedPath={selectedPath}
										onOpenPath={handleOpenVaultRel}
										className="min-h-0 basis-[42%] border-b"
										wikiIndexRevision={wikiIndexRevision}
									/>
									<GraphPanel
										vaultPath={vaultPath}
										selectedPath={selectedPath}
										onOpenPath={handleGraphOpenPath}
										className="min-h-0 flex-1"
										wikiIndexRevision={wikiIndexRevision}
									/>
								</div>
							) : null}
							{rightSidebarOpen &&
							!agentZenMode &&
							rightSidebarTab === "annotations" ? (
								<AnnotationsPanel
									items={activeAnnotations}
									asks={activeAsks}
									onJump={(id) =>
										annotationAction((h) => h.scrollToHighlight(id))
									}
									onEdit={(id) => annotationAction((h) => h.editComment(id))}
									onDelete={(id) =>
										annotationAction((h) => h.deleteHighlight(id))
									}
									onJumpAsk={(id) => annotationAction((h) => h.scrollToAsk(id))}
									onDeleteAsk={(id) => annotationAction((h) => h.deleteAsk(id))}
									onClose={() => setRightSidebarCollapsed(true)}
								/>
							) : null}
						</ResizablePanel>
					</ResizableGroup>
				</ErrorBoundary>

				<SettingsWindow
					open={settingsOpen}
					section={settingsSection}
					onSectionChange={setSettingsSection}
					onClose={closeSettings}
					settings={settings}
					onChange={updateSettings}
					vaultPath={vaultPath}
				/>

				<ZoteroMigrateDialog
					open={zoteroOpen}
					onOpenChange={setZoteroOpen}
					vaultPath={vaultPath}
					onDone={handleRefresh}
				/>

				<MovePapersDialog
					open={movePaths !== null}
					onOpenChange={(o) => {
						if (!o) setMovePaths(null);
					}}
					nodes={tree}
					vaultPath={vaultPath}
					count={movePaths?.length ?? 0}
					sourcePaths={movePaths ?? []}
					onConfirm={(dest) => void runMovePaths(dest)}
				/>

				<ImportLocalPdfDialog
					open={importPdfDraft !== null}
					onOpenChange={handleImportLocalPdfDialogOpenChange}
					items={importPdfDraft?.items ?? []}
					parentDir={importPdfDraft?.parentDir ?? "papers"}
					onConfirm={handleConfirmImportLocalPdf}
					busy={libraryIoBusy === "import-pdf"}
				/>

				<CommandPalette
					open={commandOpen}
					onOpenChange={setCommandOpen}
					mode={commandMode}
					vaultPath={vaultPath}
					papers={libraryPapers}
					commands={paletteCommands}
					onOpenPaper={(rel) => {
						if (vaultPath)
							openPaper(`${vaultPath.replace(/[\\/]+$/, "")}/${rel}`);
					}}
					onOpenVaultRel={handleOpenVaultRel}
				/>

				{/* IDE-style background tasks (bottom-left floater); hide in zen */}
				{agentZenMode ? null : <BackgroundTasksPanel />}
			</div>
		</WikiNavContext.Provider>
	);
}
