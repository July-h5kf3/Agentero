import {
	Download,
	FolderOpen,
	Loader2,
	NotebookPen,
	PanelTop,
	Search,
	X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePanelRef } from "react-resizable-panels";
import { ErrorBoundary } from "@/components/error-boundary";
import { ZoteroIcon } from "@/components/icons/zotero-icon";
import { AgentPanel } from "@/components/layout/agent-panel";
import { BackgroundTasksPanel } from "@/components/layout/background-tasks-panel";
import { BacklinksPanel } from "@/components/layout/backlinks-panel";
import {
	FileTree,
	type TreeCreateDraft,
	VaultSidebarHeader,
} from "@/components/layout/file-tree";
import { GraphPanel } from "@/components/layout/graph-panel";
import { MovePapersDialog } from "@/components/layout/move-papers-dialog";
import { NotesEditorTab } from "@/components/layout/notes-editor-tab";
import { PaneHeader } from "@/components/layout/pane-header";
import { PaperInfoPanel } from "@/components/layout/paper-info-panel";
import {
	ResizableGroup,
	ResizableHandle,
	ResizablePanel,
} from "@/components/layout/resizable";
import { ShortcutsDialog } from "@/components/layout/shortcuts-dialog";
import { TabCenter } from "@/components/layout/tab-center";
import { VaultWelcome } from "@/components/layout/vault-welcome";
import { WorkspaceHeader } from "@/components/layout/workspace-header";
import { ZoteroMigrateDialog } from "@/components/layout/zotero-migrate-dialog";
import {
	type SettingsSection,
	SettingsWindow,
} from "@/components/settings-window";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	type AnnotationRow,
	AnnotationsPanel,
} from "@/components/viewer/annotations-panel";
import type { PdfViewerHandle } from "@/components/viewer/pdf-viewer";
import { ViewModeToggle } from "@/components/viewer/view-mode-toggle";
import { useAppShortcuts } from "@/hooks/use-app-shortcuts";
import { useNativeMenuEvents } from "@/hooks/use-native-menu-events";
import { useVaultFileEvents } from "@/hooks/use-vault-file-events";
import i18n, { resolveLocale } from "@/i18n";
import { runBackgroundTask } from "@/lib/background-tasks";
import {
	type ConnectorItemSaved,
	connectorSetEnabled,
	connectorSetParentDir,
	connectorSetVault,
} from "@/lib/connector";
import {
	addPaperByIdentifier,
	downloadPaperAssets,
	importLocalPdfs,
} from "@/lib/lookup";
import {
	notifyError,
	notifySuccess,
	notifyUndo,
	notifyWarning,
} from "@/lib/notify";
import {
	collectPaperFoldersFromTree,
	collectPapersNeedingAssetDownload,
	detectPaperDirectory,
	isPaperDirectory,
	notesPathForPaper,
	type PaperMetadata,
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
	movePaperFolder,
	rescanPapers,
	setPaperTags,
	TRASH_VIRTUAL_PATH,
	trashPaths,
} from "@/lib/papers-api";
import { normalizeHighlightColor } from "@/lib/pdf-highlight/palette";
import type { PdfHighlight } from "@/lib/pdf-highlight/types";
import { openInTerminal, revealInFileManager } from "@/lib/reveal";
import { type AppSettings, loadSettings, saveSettings } from "@/lib/settings";
import {
	basenameOf,
	cycleActiveTabId,
	type DocTab,
	ensureFullLibraryTab,
	insertPlaceholderTab,
	loadPersistedTabs,
	loadTabResources,
	moveTab,
	normalizeTabPath,
	patchTab,
	removeTab,
	removeTabsUnderPath,
	reseedMarkdownTab,
	reseedNotesTab,
	revokeTabPdfSource,
	savePersistedTabs,
	syncTabSeedsForPath,
	tabIdForPath,
	tabIsPaperNotes,
	tabNotesEligible,
} from "@/lib/tabs";
import { isMacOS, isTauri } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import {
	collectMarkdownRelPaths,
	createVault,
	createVaultDirectory,
	type FileNode,
	getRecentVaults,
	getSavedVaultPath,
	isMarkdownPath,
	isValidVaultEntryName,
	joinVaultPath,
	loadVaultTree,
	openNewWindow,
	pickCreateVaultDirectory,
	pickVaultDirectory,
	readVaultFile,
	removeRecentVault,
	resolveCreateParent,
	saveVaultPath,
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

export default function App() {
	const { t } = useTranslation(["app", "sidebar", "editor"]);
	const { setTheme } = useTheme();
	const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
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
	/** Open documents in the center tab strip (browser-style multi-tab). */
	const [tabs, setTabs] = useState<DocTab[]>([]);
	const [activeTabId, setActiveTabId] = useState<string | null>(null);
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
	/** Tag filter for the papers library view (exact match). */
	const [libraryTagFilter, setLibraryTagFilter] = useState<string | null>(null);
	/**
	 * Vault-relative folder filter for the single Library tab (e.g. `papers/nlp/pretrain`).
	 * Null = full library. Set by clicking org folders in the tree — does not open new tabs.
	 */
	const [libraryScopePath, setLibraryScopePath] = useState<string | null>(null);
	/** Whether the side Notes column is shown while viewing a paper PDF/HTML. */
	const [showNotes, setShowNotes] = useState(true);
	const showNotesRef = useRef(showNotes);
	showNotesRef.current = showNotes;
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
	const notesPaneRef = useRef<HTMLDivElement>(null);
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
	/** Paper folders at any depth under papers/ (marker-based). */
	const paperFolders = useMemo(() => collectPaperFoldersFromTree(tree), [tree]);

	const activeTab = useMemo(
		() => tabs.find((t) => t.id === activeTabId) ?? null,
		[tabs, activeTabId],
	);
	/** Active document identity — downstream panels read this as before. */
	const selectedPath = activeTab?.path ?? null;
	const centerMode = activeTab?.mode ?? "markdown";
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

	const modeAvailable: Record<CenterViewMode, boolean> = {
		markdown: true,
		pdf: Boolean(activeTab?.pdfUrl),
		html: Boolean(activeTab?.htmlUrl),
		image: Boolean(activeTab?.imageUrl),
	};

	const paperFoldersRef = useRef(paperFolders);
	paperFoldersRef.current = paperFolders;
	const treeRef = useRef(tree);
	treeRef.current = tree;
	const vaultPathRef = useRef(vaultPath);
	vaultPathRef.current = vaultPath;
	/** Normalized paths currently being reloaded from disk; suppresses the editor
	 * unmount-flush so an external/Agent write is never clobbered by stale in-memory text. */
	const reseedGuardRef = useRef<Set<string>>(new Set());
	const treeRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	/** Merge a patch into the tab with the given id. */
	const updateTab = useCallback((id: string, patch: Partial<DocTab>) => {
		setTabs((prev) => patchTab(prev, id, patch));
	}, []);

	/**
	 * Open a document in a tab. If a tab for this path already exists we just
	 * activate it (keeps its mounted viewer/editor state — like a browser tab).
	 * Otherwise a placeholder is inserted, then its resources load asynchronously.
	 */
	const openTab = useCallback(
		(path: string, opts?: { preferMode?: CenterViewMode }) => {
			const id = tabIdForPath(path);
			let exists = false;
			setTabs((prev) => {
				const result = insertPlaceholderTab(prev, path, opts?.preferMode);
				exists = result.exists;
				return result.tabs;
			});
			setActiveTabId(id);

			if (exists) return;
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
				updateTab(id, {
					kind: res.kind,
					title: res.title,
					mode: res.mode,
					paperMeta: res.paperMeta,
					pdfUrl: res.pdfUrl,
					htmlUrl: res.htmlUrl,
					imageUrl: res.imageUrl,
					notesPath: res.notesPath,
					notesSeed: res.notesSeed,
					markdownSeed: res.markdownSeed,
					loaded: true,
				});
				// Auto-download for preview may have written local PDF — refresh tree icons
				const vault = vaultPathRef.current;
				if (res.didDownloadAssets && vault) {
					try {
						const nodes = await loadVaultTree(vault);
						setTree(nodes);
					} catch {
						// ignore; viewer already has source
					}
				}
			})();
		},
		[t, updateTab],
	);

	/** Close a tab; move focus to a neighbor, or full Library when emptied. */
	const closeTab = useCallback((id: string) => {
		setTabs((prev) => {
			const { tabs, removed, activeId } = removeTab(
				prev,
				id,
				activeTabIdRef.current,
			);
			if (!removed) return prev;
			revokeTabPdfSource(removed);
			if (tabs.length === 0 && vaultPathRef.current) {
				const ensured = ensureFullLibraryTab([]);
				setActiveTabId(ensured.activeId);
				return ensured.tabs;
			}
			setActiveTabId(activeId);
			return tabs;
		});
		setPdfHighlightsByTab((prev) => {
			if (!(id in prev)) return prev;
			const next = { ...prev };
			delete next[id];
			return next;
		});
	}, []);

	/** Close every tab whose path is at or under the given path. */
	const closeTabsUnderPath = useCallback((path: string) => {
		setTabs((prev) => {
			const { tabs, removed, activeId } = removeTabsUnderPath(
				prev,
				path,
				activeTabIdRef.current,
			);
			if (!removed.length) return prev;
			for (const t of removed) revokeTabPdfSource(t);
			if (tabs.length === 0 && vaultPathRef.current) {
				const ensured = ensureFullLibraryTab([]);
				setActiveTabId(ensured.activeId);
				setPdfHighlightsByTab((prevHl) => {
					let changed = false;
					const next = { ...prevHl };
					for (const t of removed) {
						if (t.id in next) {
							delete next[t.id];
							changed = true;
						}
					}
					return changed ? next : prevHl;
				});
				return ensured.tabs;
			}
			setActiveTabId(activeId);
			setPdfHighlightsByTab((prevHl) => {
				let changed = false;
				const next = { ...prevHl };
				for (const t of removed) {
					if (t.id in next) {
						delete next[t.id];
						changed = true;
					}
				}
				return changed ? next : prevHl;
			});
			return tabs;
		});
	}, []);

	const reorderTabs = useCallback((fromId: string, toId: string) => {
		setTabs((prev) => moveTab(prev, fromId, toId));
	}, []);

	const setActiveTabMode = useCallback(
		(mode: CenterViewMode) => {
			if (!activeTabId) return;
			updateTab(activeTabId, { mode });
		},
		[activeTabId, updateTab],
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

	/** Stable empty list so non-library tabs don't re-render on library changes. */
	const noPapers = useMemo<PaperMetadata[]>(() => [], []);

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

	/** Cycle the active tab by delta (wraps). */
	const cycleActiveTab = useCallback((delta: number) => {
		setActiveTabId((cur) => cycleActiveTabId(tabsRef.current, cur, delta));
	}, []);

	/**
	 * ⌘W / File → Close: close the active document tab one at a time.
	 * Sole full-library tab → close window (Library is the default page).
	 * Closing the last non-library tab reopens full Library via `closeTab`.
	 * Debounced so macOS menu accelerator + keydown do not close two tabs at once.
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

		const list = tabsRef.current;
		const sole = list.length === 1 ? list[0] : null;
		if (sole && isLibraryVirtualPath(sole.path)) {
			closeWindow();
			return;
		}
		if (list.length > 0) {
			const id = activeTabIdRef.current ?? list[list.length - 1]?.id;
			if (id) closeTab(id);
			return;
		}
		closeWindow();
	}, [closeTab, closeWindow]);

	/** Tab strip X: same as ⌘W when sole full Library; otherwise close that tab. */
	const handleCloseTab = useCallback(
		(id: string) => {
			const list = tabsRef.current;
			if (
				list.length === 1 &&
				list[0]?.id === id &&
				isLibraryVirtualPath(list[0].path)
			) {
				closeTabOrWindow();
				return;
			}
			closeTab(id);
		},
		[closeTab, closeTabOrWindow],
	);

	/** Reseed an open paper tab's NOTES after the reader / download writes it. */
	const refreshTabNotes = useCallback((paperDir: string, content: string) => {
		setTabs((prev) => reseedNotesTab(prev, paperDir, content));
	}, []);

	/** Reseed an open plain-Markdown tab after an external/Agent write. */
	const refreshTabMarkdown = useCallback((absPath: string, content: string) => {
		setTabs((prev) => reseedMarkdownTab(prev, absPath, content));
	}, []);

	// Restore the previous window's open tabs once on mount (per-window session).
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only restore
	useEffect(() => {
		if (!isTauri() || !vaultPathRef.current) return;
		const persisted = loadPersistedTabs();
		if (!persisted?.tabs.length) {
			// No saved layout → default page is full Library.
			const ensured = ensureFullLibraryTab([]);
			setTabs(ensured.tabs);
			setActiveTabId(ensured.activeId);
			return;
		}
		for (const pt of persisted.tabs) {
			openTab(pt.path, { preferMode: pt.mode });
		}
		const active = persisted.tabs[persisted.activeIndex];
		if (active) setActiveTabId(tabIdForPath(active.path));
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

	const updateSettings = useCallback((next: AppSettings) => {
		setSettings(next);
		saveSettings(next);
	}, []);

	const SIDEBAR_DEFAULT_PX = 200;
	const RIGHT_SIDEBAR_DEFAULT_PX = 320;
	const NOTES_DEFAULT_PCT = "30";

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
		setBusy(true);
		try {
			const nodes = await loadVaultTree(path);
			setTree(nodes);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			notifyError(message);
			setTree([]);
		} finally {
			setBusy(false);
		}
	}, []);

	const handleEditorAssetsChanged = useCallback(() => {
		if (vaultPath) void refreshTree(vaultPath);
	}, [vaultPath, refreshTree]);

	const openAnnotationsTab = useCallback(
		() => openRightTab("annotations"),
		[openRightTab],
	);

	const handleNotesDirty = useCallback(
		(id: string, dirty: boolean) => updateTab(id, { notesDirty: dirty }),
		[updateTab],
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
			const notesTab = openTabs.find(
				(t) => t.notesPath && normalizeTabPath(t.notesPath) === norm,
			);
			const mdTab = openTabs.find(
				(t) => normalizeTabPath(t.path) === norm && isMarkdownPath(t.path),
			);
			if (!notesTab && !mdTab) return;
			let content: string;
			try {
				content = await readVaultFile(absPath);
			} catch {
				// File removed / unreadable → leave editor; tree refresh reflects removal.
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
			if (notesTab && content !== notesTab.notesSeed) {
				const paperDir = (notesTab.notesPath ?? "").replace(
					/[\\/]NOTES\.md$/i,
					"",
				);
				const reload = () => {
					guard();
					refreshTabNotes(paperDir, content);
				};
				if (notesTab.notesDirty) promptReload(reload);
				else reload();
			}
			if (mdTab && content !== mdTab.markdownSeed) {
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
			void loadVaultTree(vault)
				.then((nodes) => setTree(nodes))
				.catch(() => {
					// best-effort background refresh
				});
		}, 400);
	}, []);

	// Start/stop the Host Vault filesystem watcher for this window's active Vault.
	// Live-reload open editors + file tree when files change on disk (external / Agent).
	useVaultFileEvents({
		vaultPath,
		onDiskChange: applyDiskChange,
		onStructuralChange: scheduleTreeRefresh,
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

	const activateVault = useCallback(
		async (path: string) => {
			saveVaultPath(path);
			setVaultPath(path);
			setTabs([]);
			setActiveTabId(null);
			setTreeSelectedPath(null);
			setLibraryQuery("");
			setLibraryTagFilter(null);
			setLibraryScopePath(null);
			setRecentVaults(getRecentVaults());
			await rebuildWikiAndNotify(path);
		},
		[rebuildWikiAndNotify],
	);

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

	const handleOpenRecentVault = useCallback(
		async (path: string) => {
			try {
				if (!isTauri()) {
					notifyError(t("errors.openVaultDesktopOnly"));
					return;
				}
				setBusy(true);
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
	useEffect(() => {
		if (!isTauri()) return;
		void connectorSetVault(vaultPath).catch(() => {
			/* ignore */
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
			.then((st) => {
				if (settings.connectorEnabled && st.lastError) {
					notifyError(st.lastError);
				}
			})
			.catch((e) => {
				notifyError(e instanceof Error ? e.message : String(e));
			});
	}, [settings.connectorEnabled]);

	// Refresh tree/library when the official Zotero Connector saves into the vault.
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
	}, [refreshTree, refreshLibrary, t]);

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
	}, [treeSelectedPath, t]);

	/** ⌥⌘T — open system terminal at selected path (dir = self, file = parent). */
	const handleOpenInTerminal = useCallback(() => {
		const path = treeSelectedPath;
		if (!path || isLibraryVirtualPath(path) || isTrashVirtualPath(path)) return;
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
	}, [treeSelectedPath, t]);

	/**
	 * Delete vault paths into the recycle bin (`.agentero/.trash/`).
	 * Recoverable from the Recycle Bin view; catalog rows are snapshotted too.
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
				await rebuildWikiAndNotify(vaultPath);
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
	const [shortcutsOpen, setShortcutsOpen] = useState(false);

	/** Refresh tree / library / wiki after a recycle-bin restore. */
	const handleTrashChanged = useCallback(async () => {
		if (!vaultPath) return;
		setTreeSelectedPath(null);
		await refreshTree(vaultPath);
		await rebuildWikiAndNotify(vaultPath);
		await refreshLibrary();
	}, [vaultPath, refreshTree, rebuildWikiAndNotify, refreshLibrary]);

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
		setSettingsSection(section);
		setSettingsOpen(true);
	}, []);

	const closeSettings = useCallback(() => setSettingsOpen(false), []);

	useEffect(() => {
		if (!vaultPath) {
			setTree([]);
			return;
		}
		void refreshTree(vaultPath);
	}, [vaultPath, refreshTree]);

	useEffect(() => {
		savePersistedTabs(tabs, activeTabId);
	}, [tabs, activeTabId]);

	// Persist a specific file's Markdown to disk. The MarkdownEditor calls this with
	// its own fixed path (debounced autosave, ⌘S, and unmount flush), so writes always
	// target the correct file even when switching files quickly.
	const persistFile = useCallback(
		(path: string, md: string) => {
			if (!isTauri() || !vaultPath || !path) return;
			// Skip while this path is being reloaded from disk (external/Agent write):
			// the remount's unmount-flush must not clobber the fresh disk content.
			if (reseedGuardRef.current.has(normalizeTabPath(path))) return;
			// Keep the owning tab's seed in sync so PDF↔Notes / tab switches see latest text.
			setTabs((prev) => syncTabSeedsForPath(prev, path, md));
			void writeVaultFile(path, md).catch((e) => {
				notifyError(e instanceof Error ? e.message : String(e));
			});
		},
		[vaultPath],
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

	const handleLookupSubmit = useCallback(
		async (text: string) => {
			if (!vaultPath) {
				throw new Error(t("sidebar:lookup.needsVault"));
			}
			const result = await runBackgroundTask(
				{
					kind: "lookup",
					title: t("tasks.lookupImport"),
					detail: text.trim().slice(0, 80),
				},
				async ({ setDetail, setProgress }) => {
					setDetail(
						t("tasks.lookupFetching", { id: text.trim().slice(0, 80) }),
					);
					setProgress(15);
					const r = await addPaperByIdentifier({
						vaultRoot: vaultPath,
						parentDir: lookupParentDir,
						text,
						settings,
					});
					setProgress(70);
					setDetail(
						t("tasks.lookupRefreshing", {
							title: r.title?.slice(0, 60) || r.path,
						}),
					);
					await refreshTree(vaultPath);
					await rebuildWikiAndNotify(vaultPath);
					await refreshLibrary();
					setProgress(100);
					return r;
				},
			);
			// Prefer absolute paperDir; fall back to vault + relative path.
			const paperAbs =
				result.paperDir?.replace(/\\/g, "/").replace(/\/+$/, "") ||
				`${vaultPath.replace(/\\/g, "/").replace(/\/+$/, "")}/${(
					result.path || ""
				)
					.replace(/\\/g, "/")
					.replace(/^\/+|\/+$/g, "")}`;
			openPaper(paperAbs);
			// Surface download failure without failing the whole import
			if (result.pdf === false) {
				const detail =
					result.assetMessages
						?.filter((m) => /pdf/i.test(m))
						.slice(-2)
						.join("; ") ?? "";
				notifyError(
					detail
						? t("sidebar:lookup.pdfDownloadFailedDetail", { detail })
						: t("sidebar:lookup.pdfDownloadFailed"),
				);
			}
			// Assets ready → auto paper-reader (progress in bottom-left)
			const rel = (result.path || "")
				.replace(/\\/g, "/")
				.replace(/^\/+|\/+$/g, "");
			if (
				rel &&
				paperAssetsReadyForReader({
					pdf: result.pdf,
					tex: result.tex,
					paperMd: result.paperMd,
				})
			) {
				// Fire-and-forget: reader progress shows in the bottom-left task bar.
				// Do NOT await — awaiting keeps the sidebar busy and blocks new imports.
				void maybeAutoRunPaperReader({
					vaultRoot: vaultPath,
					paperPath: rel,
					assetsReady: true,
				})
					.then(async (started) => {
						if (!started) return;
						await refreshLibrary();
						// We just opened this paper — reload NOTES after reader writes
						const notesAbs = notesPathForPaper(result.paperDir);
						try {
							const content = await readVaultFile(notesAbs);
							refreshTabNotes(result.paperDir, content);
						} catch {
							// ignore
						}
					})
					.catch((e) => {
						notifyError(e instanceof Error ? e.message : String(e));
					});
			}
		},
		[
			vaultPath,
			lookupParentDir,
			settings,
			refreshTree,
			refreshLibrary,
			openPaper,
			refreshTabNotes,
			rebuildWikiAndNotify,
			t,
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
					async ({ setDetail, setProgress }) => {
						setDetail(rel);
						setProgress(20);
						const r = await downloadPaperAssets({
							vaultRoot: vaultPath,
							paperPath: rel,
						});
						setProgress(85);
						setDetail(t("tasks.downloadRefreshing", { path: rel }));
						await refreshTree(vaultPath);
						await refreshLibrary();
						setProgress(100);
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

	/** Vault-relative paths that can fetch LaTeX (for tree Download icon). */
	const arxivPaperRelPaths = useMemo(() => {
		const set = new Set<string>();
		for (const p of libraryPapers) {
			if (!p.path) continue;
			if (p.arxiv_id || p.type === "arxiv") {
				set.add(p.path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
			}
		}
		return set;
	}, [libraryPapers]);

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

	/** Import local PDF file(s) via native picker → paper folders + catalog + PAPER.md. */
	const handleImportLocalPdf = useCallback(async () => {
		if (!vaultPath || libraryIoBusy) return;
		setLibraryIoBusy("import-pdf");
		try {
			const result = await runBackgroundTask(
				{
					kind: "import",
					title: t("tasks.importPdf"),
				},
				async ({ setDetail, setProgress }) => {
					setProgress(10);
					const r = await importLocalPdfs({
						vaultRoot: vaultPath,
						parentDir: lookupParentDir,
					});
					if (!r) return null;
					setProgress(70);
					setDetail(
						t("sidebar:papersLibrary.importPdfDone", {
							count: r.papers.length,
						}),
					);
					await refreshTree(vaultPath);
					await rebuildWikiAndNotify(vaultPath);
					await refreshLibrary();
					setProgress(100);
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
		}
	}, [
		vaultPath,
		libraryIoBusy,
		lookupParentDir,
		refreshTree,
		refreshLibrary,
		rebuildWikiAndNotify,
		openPaper,
		t,
	]);

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
				async ({ setProgress, setDetail }) => {
					let i = 0;
					for (const paperPath of queue) {
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
							});
						} catch (e) {
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

	/** Persist tags from Paper Info and keep library + open tabs in sync. */
	const handlePaperTagsChange = useCallback(
		async (tags: string[]) => {
			if (!vaultPath || !paperMeta) return;
			// Prefer catalog path on meta; fall back to the open paper folder so
			// Zotero/legacy rows whose projection omitted `path` can still be edited.
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

	const startCreate = useCallback(
		(kind: TreeCreateDraft["kind"]) => {
			if (!vaultPath || !isTauri()) {
				notifyError(t("sidebar:fileTree.needsVault"));
				return;
			}
			const parent = resolveCreateParent(vaultPath, treeSelectedPath, tree);
			setCreateDraft({ kind, parentPath: parent });
		},
		[vaultPath, treeSelectedPath, tree, t],
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

	useAppShortcuts(settingsOpen, {
		settings: () => {
			if (settingsOpenRef.current) closeSettings();
			else openSettings();
		},
		closeSheet: closeSettings,
		showShortcuts: () => setShortcutsOpen(true),
		newWindow: () => void handleNewWindow(),
		openVault: () => void handleOpenVault(),
		createVault: () => void handleCreateVault(),
		refreshTree: handleRefresh,
		revealInFinder: handleRevealInFinder,
		openInTerminal: handleOpenInTerminal,
		deleteTreeItem: handleDeleteSelected,
		magicWand: openMagicWand,
		toggleSidebar,
		toggleChat,
		toggleAgentZen,
		focusSidebar: expandSidebar,
		focusEditor: () =>
			editorPaneRef.current
				?.querySelector<HTMLElement>("[contenteditable='true']")
				?.focus(),
		focusNotes: () => {
			const focusNotesEditor = () =>
				notesPaneRef.current
					?.querySelector<HTMLElement>("[contenteditable='true']")
					?.focus();
			if (!showNotesRef.current) {
				// Notes hidden: reveal it first, then focus once it mounts.
				setShowNotes(true);
				requestAnimationFrame(() => requestAnimationFrame(focusNotesEditor));
			} else {
				focusNotesEditor();
			}
		},
		closeTab: closeTabOrWindow,
		nextTab: () => cycleActiveTab(1),
		prevTab: () => cycleActiveTab(-1),
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

	const handleCenterModeChange = (mode: CenterViewMode) => {
		if (!modeAvailable[mode]) return;
		setActiveTabMode(mode);
	};

	const showLibrary = Boolean(vaultPath) && activeTab?.kind === "library";
	/** Full catalog (no folder scope); Zotero migrate only here. */
	const showFullLibrary = showLibrary && !libraryScopePath;
	const showTrash = Boolean(vaultPath) && activeTab?.kind === "trash";
	/** Notes column is relevant: paper open + PDF/HTML center (not when Notes is already center). */
	const notesEligible = tabNotesEligible(activeTab);
	/** Side Notes column actually renders when relevant and the user hasn't hidden it. */
	const showNotesOnRight = notesEligible && showNotes;

	/**
	 * Center markdown mode while a paper is selected edits NOTES.md live (WYSIWYG),
	 * not a separate read-only preview of another document.
	 */
	const centerIsPaperNotes = tabIsPaperNotes(activeTab);

	/**
	 * Notes still mounts/unmounts with paper selection (needs a real defaultSize
	 * to appear — collapsible expand-from-0 was unreliable). After remount,
	 * re-assert left/right rail pixel widths so Library ↔ paper does not jump.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run on Notes mount; restore rail widths
	useEffect(() => {
		if (agentZenMode) return;
		const id = requestAnimationFrame(() => {
			const left = sidebarPanelRef.current;
			const right = rightSidebarPanelRef.current;
			if (sidebarCollapsed) {
				try {
					left?.collapse();
				} catch {
					// ignore
				}
			} else {
				try {
					left?.resize(leftWidthPxRef.current || SIDEBAR_DEFAULT_PX);
				} catch {
					// ignore
				}
			}
			if (!rightSidebarOpen) {
				try {
					right?.collapse();
				} catch {
					// ignore
				}
			} else {
				try {
					right?.resize(rightWidthPxRef.current || RIGHT_SIDEBAR_DEFAULT_PX);
				} catch {
					// ignore
				}
			}
		});
		return () => cancelAnimationFrame(id);
	}, [showNotesOnRight, sidebarCollapsed, rightSidebarOpen, agentZenMode]);

	const activeFileLabel = activeTab?.title ?? t("labels.untitled");

	const editorFontSize = settings.editorFontSize;

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
					hasVault={Boolean(vaultPath)}
					tabs={tabs}
					activeTabId={activeTabId}
					notesEligible={notesEligible}
					showNotes={showNotes}
					rightSidebarOpen={rightSidebarOpen}
					rightSidebarTab={rightSidebarTab}
					onExitAgentZen={exitAgentZen}
					onToggleSidebar={toggleSidebar}
					onSelectTab={setActiveTabId}
					onCloseTab={handleCloseTab}
					onReorderTabs={reorderTabs}
					onToggleNotes={setShowNotes}
					onToggleRightSidebar={toggleRightSidebar}
					onToggleAgentZen={toggleAgentZen}
					onEnterAgentZen={enterAgentZen}
					onOpenRightTab={openRightTab}
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
										title={vaultDisplayName(vaultPath)}
										onNewFile={() => startCreate("file")}
										onNewFolder={() => startCreate("folder")}
										lookupParentDir={lookupParentDir}
										onLookupSubmit={handleLookupSubmit}
										onImportBibliography={() => void handleLibraryImport()}
										onImportLocalPdf={() => void handleImportLocalPdf()}
										importBusy={libraryIoBusy === "import"}
										importPdfBusy={libraryIoBusy === "import-pdf"}
										busy={busy || libraryIoBusy !== null}
										isDemo={isDemo}
										lookupOpenSignal={lookupOpenSignal}
									/>
								</div>
								<div className="flex min-h-0 flex-1 flex-col px-1">
									<FileTree
										nodes={tree}
										selectedPath={treeSelectedPath}
										vaultPath={vaultPath}
										createDraft={createDraft}
										onConfirmCreate={(name) => void handleConfirmCreate(name)}
										onCancelCreate={handleCancelCreate}
										onDeletePath={(path) => void handleDeletePath(path)}
										onDeletePaths={(paths) => void handleDeletePaths(paths)}
										onMovePaths={handleMovePaths}
										onMoveTo={(paths, dest) => void movePathsTo(paths, dest)}
										onSelectFile={(n) => handleSelectFile(n)}
										onSelectLibrary={handleSelectLibrary}
										onSelectTrash={handleSelectTrash}
										onDownloadPaperAssets={handleDownloadPaperAssets}
										onDownloadAllMissingAssets={handleDownloadAllMissingAssets}
										arxivPaperRelPaths={arxivPaperRelPaths}
										paperMetaByRelPath={paperMetaByRelPath}
										paperTreeLabelMode={settings.paperTreeLabelMode}
										onReadPaper={handleReadPaper}
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
							<div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
								{/* Document tabs live in the window title bar (same row as zen icon). */}
								{/* Center header: library search / view mode left; actions right.
								    Trash has its own toolbar inside RecycleBinView — skip the
								    redundant title + close row here. */}
								{vaultPath && activeTab && !pdfZenMode && !showTrash ? (
									<div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
										<div
											className={cn(
												"flex h-7 items-center",
												showLibrary ? "min-w-0 flex-1" : "shrink-0",
											)}
										>
											{showLibrary ? (
												<div className="relative w-full max-w-[280px]">
													<Search
														className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
														aria-hidden
													/>
													<Input
														type="search"
														value={libraryQuery}
														onChange={(e) => setLibraryQuery(e.target.value)}
														placeholder={t("sidebar:papersLibrary.search")}
														aria-label={t("sidebar:papersLibrary.search")}
														className="h-7 pl-7 text-xs"
													/>
												</div>
											) : (
												<ViewModeToggle
													value={centerMode}
													onChange={handleCenterModeChange}
													available={modeAvailable}
												/>
											)}
										</div>
										<div className="flex h-7 min-w-0 flex-1 items-center justify-end gap-1.5">
											{!showLibrary &&
											centerMode === "markdown" &&
											(centerIsPaperNotes
												? activeTab.notesDirty
												: activeTab.markdownDirty) ? (
												<span
													className="size-1.5 shrink-0 rounded-full bg-muted-foreground/70"
													role="img"
													aria-label={t("editor.unsaved")}
													title={t("editor.unsaved")}
												/>
											) : null}
											{showLibrary ? (
												<>
													{showFullLibrary ? (
														<Tooltip>
															<TooltipTrigger asChild>
																<Button
																	type="button"
																	variant="ghost"
																	size="icon-xs"
																	className="size-7 shrink-0"
																	aria-label={t("sidebar:zoteroMigrate.button")}
																	disabled={!vaultPath}
																	onClick={() => setZoteroOpen(true)}
																>
																	<ZoteroIcon className="size-3.5" />
																</Button>
															</TooltipTrigger>
															<TooltipContent side="bottom">
																{t("sidebar:zoteroMigrate.button")}
															</TooltipContent>
														</Tooltip>
													) : null}
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																type="button"
																variant="ghost"
																size="icon-xs"
																className="size-7 shrink-0"
																aria-label={t("sidebar:papersLibrary.export")}
																disabled={
																	!vaultPath ||
																	libraryIoBusy !== null ||
																	libraryPapers.length === 0
																}
																onClick={() => void handleLibraryExport()}
															>
																{libraryIoBusy === "export" ? (
																	<Loader2 className="size-3.5 animate-spin" />
																) : (
																	<Download className="size-3.5" />
																)}
															</Button>
														</TooltipTrigger>
														<TooltipContent side="bottom">
															{t("sidebar:papersLibrary.export")}
														</TooltipContent>
													</Tooltip>
												</>
											) : (
												<>
													<span
														className="block min-w-0 truncate text-right text-muted-foreground text-xs leading-7"
														title={
															paperMeta
																? `${paperMeta.title} · ${activeFileLabel}`
																: (activeFileLabel ?? undefined)
														}
													>
														{paperMeta?.title ?? activeFileLabel}
													</span>
													{notesEligible ? (
														<Tooltip>
															<TooltipTrigger asChild>
																<Button
																	type="button"
																	variant="ghost"
																	size="icon-xs"
																	className={cn(
																		"size-7 shrink-0",
																		showNotes && "bg-muted text-foreground",
																	)}
																	aria-label={
																		showNotes
																			? t("titlebar.hideNotes")
																			: t("titlebar.showNotes")
																	}
																	aria-pressed={showNotes}
																	onClick={() => setShowNotes((v) => !v)}
																>
																	<NotebookPen className="size-3.5" />
																</Button>
															</TooltipTrigger>
															<TooltipContent side="bottom">
																{showNotes
																	? t("titlebar.hideNotesHint")
																	: t("titlebar.showNotesHint")}
															</TooltipContent>
														</Tooltip>
													) : null}
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																type="button"
																variant="ghost"
																size="icon-xs"
																className="size-7 shrink-0"
																aria-label={t("titlebar.closeDocument")}
																onClick={() =>
																	activeTabId && handleCloseTab(activeTabId)
																}
															>
																<X className="size-3.5" />
															</Button>
														</TooltipTrigger>
														<TooltipContent side="bottom">
															{t("titlebar.closeDocumentHint")}
														</TooltipContent>
													</Tooltip>
												</>
											)}
										</div>
									</div>
								) : null}
								{!vaultPath ? (
									isTauri() ? (
										<VaultWelcome
											recentVaults={recentVaults}
											busy={busy}
											onOpenVault={() => void handleOpenVault()}
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
								) : !tabs.length ? (
									<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-muted/20 p-6 text-center text-muted-foreground">
										<p className="text-sm">{t("tabs.emptyTitle")}</p>
										<p className="text-xs">{t("tabs.emptyHint")}</p>
									</div>
								) : (
									<div className="relative min-h-0 flex-1 overflow-hidden">
										{tabs.map((tab) => (
											<div
												key={tab.id}
												hidden={tab.id !== activeTabId}
												ref={tab.id === activeTabId ? editorPaneRef : undefined}
												className="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden"
											>
												<TabCenter
													tab={tab}
													active={tab.id === activeTabId}
													vaultPath={vaultPath}
													libraryPapers={
														tab.kind === "library" ? libraryPapers : noPapers
													}
													libraryLoading={
														tab.kind === "library" ? libraryLoading : false
													}
													libraryQuery={
														tab.kind === "library" ? libraryQuery : ""
													}
													libraryScopePath={
														tab.kind === "library" ? libraryScopePath : null
													}
													libraryTagFilter={
														tab.kind === "library" ? libraryTagFilter : null
													}
													rescanning={
														tab.kind === "library" ? rescanning : false
													}
													onLibraryTagFilterChange={setLibraryTagFilter}
													onOpenLibraryPaper={handleOpenLibraryPaper}
													onRescanPapers={handleRescanPapers}
													onTrashChanged={handleTrashChanged}
													editorFontSize={editorFontSize}
													showEditorToolbar={settings.showEditorToolbar}
													notesPlaceholder={t("editor.notesPlaceholder")}
													markdownPlaceholder={t("editor.markdownPlaceholder")}
													onPersistFile={persistFile}
													onEditorAssetsChanged={handleEditorAssetsChanged}
													onTabPatch={updateTab}
													pdfZen={pdfZenMode}
													onTogglePdfZen={togglePdfZen}
													onOpenAnnotations={openAnnotationsTab}
													registerPdfHandle={registerPdfHandle}
													onPdfHighlightsChange={handlePdfHighlightsChange}
												/>
											</div>
										))}
									</div>
								)}
							</div>
						</ResizablePanel>

						{showNotesOnRight && !agentZenMode && !pdfZenMode ? (
							<ResizableHandle />
						) : null}

						{showNotesOnRight && !agentZenMode && !pdfZenMode ? (
							<ResizablePanel
								id="notes"
								defaultSize={rightSidebarOpen ? NOTES_DEFAULT_PCT : "40"}
								minSize={200}
								className="min-h-0 overflow-hidden"
							>
								<div
									ref={notesPaneRef}
									className="flex h-full min-h-0 flex-col overflow-hidden"
									style={{ fontSize: editorFontSize }}
								>
									<PaneHeader
										trailing={
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														type="button"
														variant="ghost"
														size="icon-xs"
														aria-label={
															settings.showEditorToolbar
																? t("editor:toolbar.hide")
																: t("editor:toolbar.show")
														}
														aria-pressed={settings.showEditorToolbar}
														onClick={() =>
															updateSettings({
																...settings,
																showEditorToolbar: !settings.showEditorToolbar,
															})
														}
													>
														<PanelTop className="size-3.5" />
													</Button>
												</TooltipTrigger>
												<TooltipContent side="bottom">
													{settings.showEditorToolbar
														? t("editor:toolbar.hide")
														: t("editor:toolbar.show")}
												</TooltipContent>
											</Tooltip>
										}
									>
										<span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium text-sm">
											{t("labels.notes")}
											{activeTab?.notesDirty ? (
												<span
													className="size-1.5 shrink-0 rounded-full bg-muted-foreground/70"
													role="img"
													aria-label={t("editor.unsaved")}
													title={t("editor.unsaved")}
												/>
											) : null}
										</span>
									</PaneHeader>
									<div className="relative min-h-0 flex-1 overflow-hidden">
										{/* Live WYSIWYG NOTES.md — one editor per paper tab, kept mounted. */}
										{tabs
											.filter((tab) => tab.notesPath)
											.map((tab) => (
												<NotesEditorTab
													key={tab.id}
													tab={tab}
													active={tab.id === activeTabId}
													fontSize={editorFontSize}
													showToolbar={settings.showEditorToolbar}
													placeholder={t("editor.notesPlaceholder")}
													onPersist={persistFile}
													onAssetsChanged={handleEditorAssetsChanged}
													onDirty={handleNotesDirty}
												/>
											))}
									</div>
								</div>
							</ResizablePanel>
						) : null}

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
										vaultMarkdownPaths={vaultMdFiles}
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
										variant="sidebar"
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
									onJump={(id) =>
										annotationAction((h) => h.scrollToHighlight(id))
									}
									onEdit={(id) => annotationAction((h) => h.editComment(id))}
									onDelete={(id) =>
										annotationAction((h) => h.deleteHighlight(id))
									}
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

				<ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

				{/* IDE-style background tasks (bottom-left floater); hide in zen */}
				{agentZenMode ? null : <BackgroundTasksPanel />}
			</div>
		</WikiNavContext.Provider>
	);
}
