import {
	Bot,
	Download,
	Focus,
	FolderOpen,
	Import,
	Link2,
	Loader2,
	NotebookPen,
	PanelLeft,
	PanelRight,
	PanelTop,
	Search,
	X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePanelRef } from "react-resizable-panels";
import {
	MarkdownEditor,
	type MarkdownEditorHandle,
} from "@/components/editor/markdown-editor";
import { ErrorBoundary } from "@/components/error-boundary";
import { AgentPanel } from "@/components/layout/agent-panel";
import { BackgroundTasksPanel } from "@/components/layout/background-tasks-panel";
import { BacklinksPanel } from "@/components/layout/backlinks-panel";
import { DocumentTabBar } from "@/components/layout/document-tab-bar";
import {
	FileTree,
	type TreeCreateDraft,
	VaultSidebarHeader,
} from "@/components/layout/file-tree";
import { GraphPanel } from "@/components/layout/graph-panel";
import { LayoutMenu } from "@/components/layout/layout-menu";
import { PaneHeader } from "@/components/layout/pane-header";
import { PaperInfoPanel } from "@/components/layout/paper-info-panel";
import { PapersLibrary } from "@/components/layout/papers-library";
import {
	ResizableGroup,
	ResizableHandle,
	ResizablePanel,
} from "@/components/layout/resizable";
import { VaultWelcome } from "@/components/layout/vault-welcome";
import { WindowControls } from "@/components/layout/window-controls";
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
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { HtmlViewer } from "@/components/viewer/html-viewer";
import { PdfViewer } from "@/components/viewer/pdf-viewer";
import { ViewModeToggle } from "@/components/viewer/view-mode-toggle";
import i18n, { resolveLocale } from "@/i18n";
import { runBackgroundTask } from "@/lib/background-tasks";
import { addPaperByIdentifier, downloadPaperAssets } from "@/lib/lookup";
import {
	collectPaperFoldersFromTree,
	detectPaperDirectory,
	isPaperDirectory,
	notesPathForPaper,
	type PaperMetadata,
	paperDirFromPath,
	paperNeedsAssetDownload,
	resolvePapersParentDir,
} from "@/lib/paper-metadata";
import {
	maybeAutoRunPaperReader,
	paperAssetsReadyForReader,
	runPaperReaderWorkflow,
} from "@/lib/paper-read";
import {
	deletePapersUnderPath,
	exportLibraryToFile,
	importLibraryFromFile,
	isLibraryVirtualPath,
	LIBRARY_VIRTUAL_PATH,
	listPapers,
} from "@/lib/papers-api";
import { revealInFileManager } from "@/lib/reveal";
import { type AppSettings, loadSettings, saveSettings } from "@/lib/settings";
import { formatShortcutById, resolveShortcutId } from "@/lib/shortcuts";
import {
	basenameOf,
	type DocTab,
	loadTabResources,
	normalizeTabPath,
	revokeTabPdfSource,
	tabIdForPath,
	tabIsPaperNotes,
	tabNotesEligible,
} from "@/lib/tabs";
import { isMacOS, isTauri } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import {
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
	removeVaultPath,
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

/** Platform-formatted shortcut chips for title bar tooltips (⌥⌘… on macOS, Ctrl+… elsewhere). */
const SIDEBAR_SHORTCUT = formatShortcutById("toggleSidebar");
const CHAT_SHORTCUT = formatShortcutById("toggleChat");
const ZEN_SHORTCUT = formatShortcutById("toggleAgentZen");

const TABS_KEY = "agentero-open-tabs";

type PersistedTab = { path: string; mode: CenterViewMode };
type PersistedTabs = { tabs: PersistedTab[]; activeIndex: number };

function loadPersistedTabs(): PersistedTabs | null {
	try {
		const raw = localStorage.getItem(TABS_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as PersistedTabs;
		if (!parsed || !Array.isArray(parsed.tabs)) return null;
		return parsed;
	} catch {
		return null;
	}
}

/** Flatten tree to vault-relative Markdown paths for wikilink resolve. */
function normalizePathKey(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function treeFindNode(nodes: FileNode[], path: string): FileNode | undefined {
	const key = normalizePathKey(path);
	const walk = (list: FileNode[]): FileNode | undefined => {
		for (const n of list) {
			if (normalizePathKey(n.path) === key) return n;
			if (n.children?.length) {
				const hit = walk(n.children);
				if (hit) return hit;
			}
		}
		return undefined;
	};
	return walk(nodes);
}

/** Parent directory for new file/folder: selected folder, or parent of selected file, else vault root. */
function resolveCreateParent(
	vaultRoot: string,
	selectedPath: string | null,
	tree: FileNode[],
): string {
	if (!selectedPath) return vaultRoot;
	const node = treeFindNode(tree, selectedPath);
	if (node?.kind === "directory") return selectedPath;
	const parent = selectedPath.replace(/[\\/][^\\/]+$/, "");
	return parent && parent !== selectedPath ? parent : vaultRoot;
}

function collectMarkdownRelPaths(
	nodes: FileNode[],
	vaultPath: string | null,
): string[] {
	const out: string[] = [];
	const walk = (list: FileNode[]) => {
		for (const n of list) {
			if (n.kind === "directory" && n.children) walk(n.children);
			else if (n.kind === "file" && isMarkdownPath(n.path)) {
				out.push(toVaultRelative(vaultPath, n.path));
			}
		}
	};
	walk(nodes);
	return out;
}

/** Vault-relative paper folder path derived from a `.../NOTES.md` absolute path. */
function paperRelFromNotes(
	notesPath: string | null,
	vaultPath: string | null,
): string | null {
	if (!notesPath || !vaultPath) return null;
	const abs = notesPath.replace(/[\\/]NOTES\.md$/i, "").replace(/\\/g, "/");
	const root = vaultPath.replace(/\\/g, "/").replace(/\/$/, "");
	if (abs === root) return "";
	if (abs.startsWith(`${root}/`)) return abs.slice(root.length + 1);
	return abs;
}

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
	const [error, setError] = useState<string | null>(null);
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
	/** Whether the side Notes column is shown while viewing a paper PDF/HTML. */
	const [showNotes, setShowNotes] = useState(true);
	const showNotesRef = useRef(showNotes);
	showNotesRef.current = showNotes;
	/**
	 * Right sidebar (⌘L): Agent (default) or Backlinks with Graph below.
	 * Collapsed by default; top-bar icons open a tab.
	 */
	const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
	const [rightSidebarTab, setRightSidebarTab] = useState<"agent" | "backlinks">(
		"agent",
	);
	/**
	 * Agent zen / quest mode: hide vault chrome, full-width Agent chat
	 * (Cursor Agents Window / VS Code zen — distraction-free single surface).
	 */
	const [agentZenMode, setAgentZenMode] = useState(false);
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
	useEffect(() => {
		if (selectedPath) setTreeSelectedPath(selectedPath);
	}, [selectedPath]);

	const modeAvailable: Record<CenterViewMode, boolean> = {
		markdown: true,
		pdf: Boolean(activeTab?.pdfUrl),
		html: Boolean(activeTab?.htmlUrl),
	};

	const paperFoldersRef = useRef(paperFolders);
	paperFoldersRef.current = paperFolders;
	const treeRef = useRef(tree);
	treeRef.current = tree;
	const vaultPathRef = useRef(vaultPath);
	vaultPathRef.current = vaultPath;

	/** Merge a patch into the tab with the given id. */
	const updateTab = useCallback((id: string, patch: Partial<DocTab>) => {
		setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
	}, []);

	/**
	 * Open a document in a tab. If a tab for this path already exists we just
	 * activate it (keeps its mounted viewer/editor state — like a browser tab).
	 * Otherwise a placeholder is inserted, then its resources load asynchronously.
	 */
	const openTab = useCallback(
		(path: string, opts?: { preferMode?: CenterViewMode }) => {
			const id = tabIdForPath(path);
			setError(null);
			let exists = false;
			setTabs((prev) => {
				if (prev.some((t) => t.id === id)) {
					exists = true;
					return prev;
				}
				const placeholder: DocTab = {
					id,
					path: isLibraryVirtualPath(path) ? LIBRARY_VIRTUAL_PATH : path,
					kind: isLibraryVirtualPath(path) ? "library" : "file",
					title: isLibraryVirtualPath(path) ? "Library" : basenameOf(path),
					mode: opts?.preferMode ?? "markdown",
					paperMeta: null,
					pdfUrl: null,
					htmlUrl: null,
					notesPath: null,
					notesSeed: "",
					markdownSeed: "",
					markdownDirty: false,
					notesDirty: false,
					seedKey: 0,
					notesKey: 0,
					loaded: false,
				};
				return [...prev, placeholder];
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
					setError(
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

	/** Close a tab; move focus to a neighbor, or Library when emptied. */
	const closeTab = useCallback((id: string) => {
		setTabs((prev) => {
			const idx = prev.findIndex((t) => t.id === id);
			if (idx < 0) return prev;
			const closing = prev[idx];
			if (closing) revokeTabPdfSource(closing);
			const next = prev.filter((t) => t.id !== id);
			setActiveTabId((curActive) => {
				if (curActive !== id) return curActive;
				if (!next.length) return null;
				const neighbor = next[Math.min(idx, next.length - 1)];
				return neighbor?.id ?? null;
			});
			return next;
		});
	}, []);

	/** Close every tab whose path is at or under the given path. */
	const closeTabsUnderPath = useCallback((path: string) => {
		const key = normalizeTabPath(path);
		setTabs((prev) => {
			const survivors: DocTab[] = [];
			let changed = false;
			for (const t of prev) {
				if (isLibraryVirtualPath(t.path)) {
					survivors.push(t);
					continue;
				}
				const tk = normalizeTabPath(t.path);
				if (tk === key || tk.startsWith(`${key}/`)) {
					revokeTabPdfSource(t);
					changed = true;
					continue;
				}
				survivors.push(t);
			}
			if (!changed) return prev;
			setActiveTabId((curActive) =>
				survivors.some((t) => t.id === curActive)
					? curActive
					: (survivors[survivors.length - 1]?.id ?? null),
			);
			return survivors;
		});
	}, []);

	const reorderTabs = useCallback((fromId: string, toId: string) => {
		setTabs((prev) => {
			const from = prev.findIndex((t) => t.id === fromId);
			const to = prev.findIndex((t) => t.id === toId);
			if (from < 0 || to < 0 || from === to) return prev;
			const next = [...prev];
			const [moved] = next.splice(from, 1);
			next.splice(to, 0, moved);
			return next;
		});
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

	/** Cycle the active tab by delta (wraps). */
	const cycleActiveTab = useCallback((delta: number) => {
		const list = tabsRef.current;
		if (list.length < 2) return;
		const idx = list.findIndex((t) => t.id === activeTabIdRef.current);
		const nextIdx = (idx + delta + list.length) % list.length;
		setActiveTabId(list[nextIdx].id);
	}, []);

	const closeActiveTab = useCallback(() => {
		const id = activeTabIdRef.current;
		if (id) closeTab(id);
	}, [closeTab]);

	/** NOTES editor imperative handles by tab id (for PDF "add note"). */
	const notesEditorHandles = useRef(new Map<string, MarkdownEditorHandle>());

	/** Reseed an open paper tab's NOTES after the reader / download writes it. */
	const refreshTabNotes = useCallback((paperDir: string, content: string) => {
		const id = tabIdForPath(paperDir);
		setTabs((prev) =>
			prev.map((t) =>
				t.id === id
					? {
							...t,
							notesSeed: content,
							notesDirty: false,
							notesKey: t.notesKey + 1,
						}
					: t,
			),
		);
	}, []);

	/** Append a selected PDF passage to a paper's NOTES.md as a blockquote. */
	const handleAddPdfNote = useCallback(
		async (tab: DocTab, quote: string) => {
			const q = quote.replace(/\s+/g, " ").trim();
			if (!q || !tab.notesPath) return;
			// Preferred: route through the mounted editor (single writer, no clobber)
			const handle = notesEditorHandles.current.get(tab.id);
			if (handle) {
				handle.appendMarkdown(`> ${q}`);
				return;
			}
			// Fallback: editor not mounted → append on disk and reseed
			const paperDir = tab.notesPath.replace(/[\\/]NOTES\.md$/i, "");
			try {
				let current = "";
				try {
					current = await readVaultFile(tab.notesPath);
				} catch {
					// missing NOTES.md → start fresh
				}
				const base = current.replace(/\s+$/, "");
				const next = `${base}${base ? "\n\n" : ""}> ${q}\n`;
				await writeVaultFile(tab.notesPath, next);
				refreshTabNotes(paperDir, next);
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
			}
		},
		[refreshTabNotes],
	);

	// Restore the previous window's open tabs once on mount (per-window session).
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only restore
	useEffect(() => {
		if (!isTauri() || !vaultPathRef.current) return;
		const persisted = loadPersistedTabs();
		if (!persisted?.tabs.length) return;
		for (const pt of persisted.tabs) {
			openTab(pt.path, { preferMode: pt.mode });
		}
		const active = persisted.tabs[persisted.activeIndex];
		if (active) setActiveTabId(tabIdForPath(active.path));
	}, []);

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
		(tab: "agent" | "backlinks") => {
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

	const refreshTree = useCallback(async (path: string) => {
		setBusy(true);
		setError(null);
		try {
			const nodes = await loadVaultTree(path);
			setTree(nodes);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			setError(message);
			setTree([]);
		} finally {
			setBusy(false);
		}
	}, []);

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
			setRecentVaults(getRecentVaults());
			await rebuildWikiAndNotify(path);
		},
		[rebuildWikiAndNotify],
	);

	const handleOpenVault = useCallback(async () => {
		setError(null);
		try {
			if (!isTauri()) {
				setError(t("errors.openVaultDesktopOnly"));
				return;
			}
			setBusy(true);
			const path = await pickVaultDirectory();
			if (!path) return;
			await activateVault(path);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, [t, activateVault]);

	const handleOpenRecentVault = useCallback(
		async (path: string) => {
			setError(null);
			try {
				if (!isTauri()) {
					setError(t("errors.openVaultDesktopOnly"));
					return;
				}
				setBusy(true);
				const { exists } = await import("@tauri-apps/plugin-fs");
				if (!(await exists(path))) {
					removeRecentVault(path);
					setRecentVaults(getRecentVaults());
					setError(t("vault.recentMissing", { path }));
					return;
				}
				await activateVault(path);
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
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
		setError(null);
		try {
			if (!isTauri()) {
				setError(t("errors.openVaultDesktopOnly"));
				return;
			}
			await openNewWindow();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
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

	const handleRefresh = useCallback(() => {
		if (!vaultPath) return;
		void (async () => {
			await refreshTree(vaultPath);
			await rebuildWikiAndNotify(vaultPath);
			await refreshLibrary();
		})();
	}, [vaultPath, refreshTree, refreshLibrary, rebuildWikiAndNotify]);

	/** ⌥⌘R — reveal selected vault path in Finder / Explorer. */
	const handleRevealInFinder = useCallback(() => {
		const path = treeSelectedPath;
		if (!path || isLibraryVirtualPath(path)) return;
		if (!isTauri()) {
			setError(t("sidebar:fileTree.revealDesktopOnly"));
			return;
		}
		void (async () => {
			try {
				await revealInFileManager(path);
			} catch {
				setError(t("sidebar:fileTree.revealFailed"));
			}
		})();
	}, [treeSelectedPath, t]);

	const findTreeNode = useCallback(
		(path: string): FileNode | null => {
			const key = path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
			const walk = (list: FileNode[]): FileNode | null => {
				for (const n of list) {
					const nk = n.path
						.replace(/\\/g, "/")
						.replace(/\/+$/, "")
						.toLowerCase();
					if (nk === key) return n;
					if (n.children?.length) {
						const hit = walk(n.children);
						if (hit) return hit;
					}
				}
				return null;
			};
			return walk(tree);
		},
		[tree],
	);

	/**
	 * Delete a vault file / folder / paper after confirm.
	 * Removes disk path; if under papers/, also drops matching catalog rows.
	 */
	const handleDeletePath = useCallback(
		async (path: string) => {
			if (!vaultPath || !isTauri()) {
				setError(t("sidebar:fileTree.deleteDesktopOnly"));
				return;
			}
			if (!path || isLibraryVirtualPath(path)) {
				setError(t("sidebar:fileTree.deleteInvalid"));
				return;
			}
			const rootNorm = vaultPath.replace(/\\/g, "/").replace(/\/+$/, "");
			const pathNorm = path.replace(/\\/g, "/").replace(/\/+$/, "");
			if (pathNorm === rootNorm) {
				setError(t("sidebar:fileTree.deleteInvalid"));
				return;
			}
			if (!pathNorm.startsWith(`${rootNorm}/`)) {
				setError(t("sidebar:fileTree.deleteInvalid"));
				return;
			}

			const node = findTreeNode(path);
			const name = node?.name ?? pathNorm.split("/").pop() ?? path;
			const isDir = node?.kind === "directory" || !node;
			const isPaper =
				node?.kind === "directory" &&
				isPaperDirectory(node.path, node.children);

			const confirmMsg = isPaper
				? t("sidebar:fileTree.deleteConfirmPaper", { name })
				: isDir
					? t("sidebar:fileTree.deleteConfirmFolder", { name })
					: t("sidebar:fileTree.deleteConfirmFile", { name });
			if (!window.confirm(confirmMsg)) return;

			setBusy(true);
			setError(null);
			try {
				await removeVaultPath(path);

				const rel = vaultRelativePath(vaultPath, path);
				if (rel && (rel === "papers" || rel.startsWith("papers/"))) {
					try {
						await deletePapersUnderPath(vaultPath, rel);
					} catch {
						// Catalog cleanup is best-effort if row missing.
					}
				}

				// Close any open tabs at or under the deleted path.
				closeTabsUnderPath(path);
				const treeNorm = treeSelectedPath
					?.replace(/\\/g, "/")
					.replace(/\/+$/, "");
				if (
					treeNorm &&
					(treeNorm === pathNorm || treeNorm.startsWith(`${pathNorm}/`))
				) {
					setTreeSelectedPath(null);
				}

				await refreshTree(vaultPath);
				await rebuildWikiAndNotify(vaultPath);
				await refreshLibrary();
			} catch (e) {
				setError(
					e instanceof Error ? e.message : t("sidebar:fileTree.deleteFailed"),
				);
			} finally {
				setBusy(false);
			}
		},
		[
			vaultPath,
			findTreeNode,
			treeSelectedPath,
			closeTabsUnderPath,
			refreshTree,
			rebuildWikiAndNotify,
			refreshLibrary,
			t,
		],
	);

	const handleDeleteSelected = useCallback(() => {
		const path = treeSelectedPath;
		if (!path || isLibraryVirtualPath(path)) {
			setError(t("sidebar:fileTree.deleteNeedsSelection"));
			return;
		}
		void handleDeletePath(path);
	}, [treeSelectedPath, handleDeletePath, t]);

	const openMagicWand = useCallback(() => {
		if (!vaultPath) {
			setError(t("sidebar:lookup.needsVault"));
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
		const onKeyDown = (event: KeyboardEvent) => {
			const id = resolveShortcutId(event, {
				settingsOpen: settingsOpenRef.current,
			});
			if (!id) return;

			// ⌘⌫ is "delete to line start" in editors — only claim it outside text fields.
			if (id === "deleteTreeItem") {
				const el = event.target;
				if (
					el instanceof HTMLElement &&
					el.closest(
						"input, textarea, select, [contenteditable='true'], [role='textbox']",
					)
				) {
					return;
				}
			}

			event.preventDefault();

			switch (id) {
				case "settings":
					if (settingsOpenRef.current) closeSettings();
					else openSettings();
					break;
				case "closeSheet":
					closeSettings();
					break;
				case "newWindow":
					void handleNewWindow();
					break;
				case "openVault":
					void handleOpenVault();
					break;
				case "refreshTree":
					handleRefresh();
					break;
				case "revealInFinder":
					handleRevealInFinder();
					break;
				case "deleteTreeItem":
					handleDeleteSelected();
					break;
				case "magicWand":
					openMagicWand();
					break;
				case "toggleSidebar":
					toggleSidebar();
					break;
				case "toggleChat":
					toggleChat();
					break;
				case "toggleAgentZen":
					toggleAgentZen();
					break;
				case "focusSidebar":
					expandSidebar();
					break;
				case "focusEditor":
					editorPaneRef.current
						?.querySelector<HTMLElement>("[contenteditable='true']")
						?.focus();
					break;
				case "focusNotes": {
					const focusNotesEditor = () =>
						notesPaneRef.current
							?.querySelector<HTMLElement>("[contenteditable='true']")
							?.focus();
					if (!showNotesRef.current) {
						// Notes hidden: reveal it first, then focus once it mounts.
						setShowNotes(true);
						requestAnimationFrame(() =>
							requestAnimationFrame(focusNotesEditor),
						);
					} else {
						focusNotesEditor();
					}
					break;
				}
				case "closeTab":
					closeActiveTab();
					break;
				case "nextTab":
					cycleActiveTab(1);
					break;
				case "prevTab":
					cycleActiveTab(-1);
					break;
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [
		closeSettings,
		expandSidebar,
		handleNewWindow,
		handleOpenVault,
		handleDeleteSelected,
		handleRefresh,
		handleRevealInFinder,
		openMagicWand,
		openSettings,
		toggleAgentZen,
		toggleChat,
		toggleSidebar,
		closeActiveTab,
		cycleActiveTab,
	]);

	// Native menu bar (agentero → Settings…, File, View) — desktop only
	useEffect(() => {
		if (!isTauri()) return;

		let cancelled = false;
		const unsubs: Array<() => void> = [];

		void (async () => {
			const { listen } = await import("@tauri-apps/api/event");
			if (cancelled) return;

			unsubs.push(
				await listen("settings", () => {
					openSettings();
				}),
			);
			// new_window is handled natively in Rust (creates the window directly).
			unsubs.push(
				await listen("open_vault", () => {
					void handleOpenVault();
				}),
			);
			unsubs.push(
				await listen("refresh_tree", () => {
					handleRefresh();
				}),
			);
			unsubs.push(
				await listen("toggle_sidebar", () => {
					toggleSidebar();
				}),
			);
			unsubs.push(
				await listen("toggle_chat", () => {
					toggleChat();
				}),
			);
		})();

		return () => {
			cancelled = true;
			for (const unsub of unsubs) unsub();
		};
	}, [handleOpenVault, handleRefresh, openSettings, toggleChat, toggleSidebar]);

	useEffect(() => {
		if (!vaultPath) {
			setTree([]);
			return;
		}
		void refreshTree(vaultPath);
	}, [vaultPath, refreshTree]);

	useEffect(() => {
		try {
			const payload: PersistedTabs = {
				tabs: tabs.map((t) => ({ path: t.path, mode: t.mode })),
				activeIndex: Math.max(
					0,
					tabs.findIndex((t) => t.id === activeTabId),
				),
			};
			if (payload.tabs.length) {
				localStorage.setItem(TABS_KEY, JSON.stringify(payload));
			} else {
				localStorage.removeItem(TABS_KEY);
			}
		} catch {
			// localStorage may be unavailable; tab restore is best-effort.
		}
	}, [tabs, activeTabId]);

	// Persist a specific file's Markdown to disk. The MarkdownEditor calls this with
	// its own fixed path (debounced autosave, ⌘S, and unmount flush), so writes always
	// target the correct file even when switching files quickly.
	const persistFile = useCallback(
		(path: string, md: string) => {
			if (!isTauri() || !vaultPath || !path) return;
			// Keep the owning tab's seed in sync so PDF↔Notes / tab switches see latest text.
			const key = path.replace(/\\/g, "/").toLowerCase();
			setTabs((prev) =>
				prev.map((tab) => {
					const notesKey = tab.notesPath?.replace(/\\/g, "/").toLowerCase();
					if (notesKey === key) return { ...tab, notesSeed: md };
					if (normalizeTabPath(tab.path) === normalizeTabPath(path)) {
						return { ...tab, markdownSeed: md };
					}
					return tab;
				}),
			);
			void writeVaultFile(path, md).catch((e) => {
				setError(e instanceof Error ? e.message : String(e));
			});
		},
		[vaultPath],
	);

	/** Open a paper folder in a tab: center PDF, right Notes (resolved on load). */
	const openPaper = useCallback(
		(paperDir: string) => {
			openTab(paperDir, { preferMode: "pdf" });
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
			openPaper(result.paperDir);
			// Surface download failure without failing the whole import
			if (result.pdf === false) {
				const detail =
					result.assetMessages
						?.filter((m) => /pdf/i.test(m))
						.slice(-2)
						.join("; ") ?? "";
				setError(
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
						setError(e instanceof Error ? e.message : String(e));
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
							setError(e instanceof Error ? e.message : String(e));
						});
				}
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
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

	/** Catalog rows by vault-relative path (for Eye / is_read). */
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
	 * paper-reader workflow: Eye on complete + unread papers.
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
					setError(e instanceof Error ? e.message : String(e));
				});
		},
		[vaultPath, refreshLibrary, refreshTabNotes],
	);

	/**
	 * Library bulk download: every paper folder missing PDF and/or fetchable TeX.
	 * Walks the file tree so local source/ presence matches the row icons.
	 */
	const [libraryIoBusy, setLibraryIoBusy] = useState<
		"import" | "export" | null
	>(null);

	const handleLibraryExport = useCallback(async () => {
		if (!vaultPath || libraryIoBusy) return;
		setLibraryIoBusy("export");
		setError(null);
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
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLibraryIoBusy(null);
		}
	}, [vaultPath, settings, libraryIoBusy, t]);

	const handleLibraryImport = useCallback(async () => {
		if (!vaultPath || libraryIoBusy) return;
		setLibraryIoBusy("import");
		setError(null);
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
				setError(
					`${t("sidebar:papersLibrary.importDone", { count: result.imported })}; ${result.errors.slice(0, 2).join("; ")}`,
				);
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
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

	const handleDownloadAllMissingAssets = useCallback(async () => {
		if (!vaultPath) return;
		const queue: FileNode[] = [];
		const walk = (list: FileNode[]) => {
			for (const n of list) {
				if (n.kind === "directory" && isPaperDirectory(n.path, n.children)) {
					if (paperNeedsAssetDownload(n)) {
						queue.push(n);
					}
				} else if (n.children?.length) {
					walk(n.children);
				}
			}
		};
		walk(tree);
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
					for (const node of queue) {
						const rel = toVaultRelative(vaultPath, node.path)
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
			setError(e instanceof Error ? e.message : String(e));
		}
		if (errors.length) {
			setError(errors.slice(0, 3).join("; "));
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
			setError(null);
			if (!vaultPath || !isTauri()) {
				setError(t("sidebar:fileTree.needsVault"));
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
				setError(t("sidebar:fileTree.invalidName"));
				setCreateDraft(null);
				return;
			}
			const full = joinVaultPath(createDraft.parentPath, trimmed);
			const kind = createDraft.kind;
			// Clear draft first so the tree can re-render after create.
			setCreateDraft(null);
			try {
				setBusy(true);
				setError(null);
				const { exists } = await import("@tauri-apps/plugin-fs");
				if (await exists(full)) {
					setError(t("sidebar:fileTree.alreadyExists", { name: trimmed }));
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
				setError(e instanceof Error ? e.message : String(e));
			} finally {
				setBusy(false);
			}
		},
		[createDraft, vaultPath, t, refreshTree, openPath],
	);

	const handleCreateVault = useCallback(async () => {
		setError(null);
		try {
			if (!isTauri()) {
				setError(t("errors.openVaultDesktopOnly"));
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
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, [activateVault, openPath, t]);

	// Create Vault shortcut + native menu (after handler is defined)
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const id = resolveShortcutId(event, {
				settingsOpen: settingsOpenRef.current,
			});
			if (id !== "createVault") return;
			event.preventDefault();
			void handleCreateVault();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [handleCreateVault]);

	useEffect(() => {
		if (!isTauri()) return;
		let cancelled = false;
		let unsub: (() => void) | undefined;
		void (async () => {
			const { listen } = await import("@tauri-apps/api/event");
			if (cancelled) return;
			unsub = await listen("create_vault", () => {
				void handleCreateVault();
			});
		})();
		return () => {
			cancelled = true;
			unsub?.();
		};
	}, [handleCreateVault]);

	const handleSelectLibrary = useCallback(() => {
		setError(null);
		setTreeSelectedPath(LIBRARY_VIRTUAL_PATH);
		openTab(LIBRARY_VIRTUAL_PATH);
		void refreshLibrary();
	}, [openTab, refreshLibrary]);

	const handleSelectFile = (node: FileNode) => {
		if (isLibraryVirtualPath(node.path)) {
			handleSelectLibrary();
			return;
		}
		if (
			node.kind === "directory" &&
			isPaperDirectory(node.path, node.children)
		) {
			openPaper(node.path);
			return;
		}
		if (node.kind !== "file") return;
		openPath(node.path);
	};

	/** Open a vault-relative path from backlinks (e.g. `notes/idea.md`). */
	const handleOpenVaultRel = useCallback(
		(rel: string) => {
			if (!vaultPath) {
				setError(t("errors.openVaultForLinks"));
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
				setError(t("errors.openVaultForGraph"));
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
				setError(t("errors.openVaultForCreate"));
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
				setError(e instanceof Error ? e.message : String(e));
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

	/** Center content for one tab (kept mounted; hidden when not active). */
	const renderTabCenter = (tab: DocTab) => {
		if (tab.kind === "library") {
			return (
				<PapersLibrary
					papers={libraryPapers}
					loading={libraryLoading}
					query={libraryQuery}
					onOpenPaper={handleOpenLibraryPaper}
					className="bg-muted/20"
				/>
			);
		}
		const isNotes = tabIsPaperNotes(tab);
		if (tab.mode === "markdown") {
			return (
				<div className="min-h-0 flex-1 overflow-hidden bg-muted/30">
					<MarkdownEditor
						key={
							isNotes
								? `notes-center-${tab.id}-${tab.notesKey}`
								: `file-${tab.id}-${tab.seedKey}`
						}
						className="agentero-scroll h-full min-h-0"
						initialMarkdown={isNotes ? tab.notesSeed : tab.markdownSeed}
						filePath={
							isNotes
								? tab.notesPath
								: isMarkdownPath(tab.path)
									? tab.path
									: null
						}
						fontSize={editorFontSize}
						showToolbar={settings.showEditorToolbar}
						placeholder={
							isNotes
								? t("editor.notesPlaceholder")
								: t("editor.markdownPlaceholder")
						}
						onPersist={persistFile}
						onDirtyChange={(d) =>
							updateTab(
								tab.id,
								isNotes ? { notesDirty: d } : { markdownDirty: d },
							)
						}
					/>
				</div>
			);
		}
		if (tab.mode === "pdf") {
			return (
				<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
					<PdfViewer
						source={tab.pdfUrl}
						paperAbsPath={
							tab.notesPath
								? tab.notesPath.replace(/[\\/]NOTES\.md$/i, "")
								: null
						}
						paperRelPath={
							tab.paperMeta?.path ?? paperRelFromNotes(tab.notesPath, vaultPath)
						}
						vaultPath={vaultPath}
						onAddNote={(quote) => void handleAddPdfNote(tab, quote)}
						className="h-full w-full"
					/>
				</div>
			);
		}
		return (
			<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
				<HtmlViewer srcUrl={tab.htmlUrl} className="h-full w-full" />
			</div>
		);
	};

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
				<header className="flex h-8 shrink-0 items-center border-b select-none">
					{/*
					  Traffic lights: x=14, three ~14px buttons + gaps → ends ~68px.
					  Keep extra gap so the sidebar toggle never hugs the lights.
					*/}
					{isMacDesktop ? (
						<div
							className="w-[92px] shrink-0 self-stretch"
							data-tauri-drag-region
						/>
					) : (
						<div className="w-2 shrink-0 self-stretch" data-tauri-drag-region />
					)}
					<TooltipProvider delayDuration={250}>
						{agentZenMode ? (
							<>
								{/* Zen: drag strip + exit only — chat chrome lives in AgentPanel */}
								<div
									className="min-w-0 flex-1 self-stretch"
									data-tauri-drag-region
								/>
								<div className="flex shrink-0 items-center gap-0.5 pr-2">
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												aria-label={t("titlebar.exitAgentZen")}
												onClick={exitAgentZen}
											>
												<X className="size-3.5" />
											</Button>
										</TooltipTrigger>
										<TooltipContent side="bottom">
											{t("titlebar.exitAgentZenHint", {
												shortcut: ZEN_SHORTCUT,
											})}
										</TooltipContent>
									</Tooltip>
								</div>
							</>
						) : (
							<>
								<div className="flex shrink-0 items-center gap-0.5 pr-1">
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												aria-label={
													sidebarCollapsed
														? t("titlebar.showLeftSidebar")
														: t("titlebar.hideLeftSidebar")
												}
												aria-pressed={!sidebarCollapsed}
												onClick={toggleSidebar}
											>
												<PanelLeft className="size-3.5" />
											</Button>
										</TooltipTrigger>
										<TooltipContent side="bottom">
											{sidebarCollapsed
												? t("titlebar.showSidebarHint", {
														shortcut: SIDEBAR_SHORTCUT,
													})
												: t("titlebar.hideSidebarHint", {
														shortcut: SIDEBAR_SHORTCUT,
													})}
										</TooltipContent>
									</Tooltip>
								</div>
								{/* Document tabs share the title bar row with zen / layout icons */}
								{vaultPath && tabs.length ? (
									<DocumentTabBar
										tabs={tabs}
										activeId={activeTabId}
										onSelect={setActiveTabId}
										onClose={closeTab}
										onReorder={reorderTabs}
									/>
								) : (
									<div
										className="min-w-0 flex-1 self-stretch"
										data-tauri-drag-region
									/>
								)}
								<div className="flex shrink-0 items-center gap-0.5 pr-2">
									<LayoutMenu
										leftSidebarOpen={!sidebarCollapsed}
										onToggleLeftSidebar={toggleSidebar}
										notesAvailable={notesEligible}
										notesOpen={showNotes}
										onToggleNotes={(v) => setShowNotes(v)}
										rightSidebarOpen={rightSidebarOpen}
										onToggleRightSidebar={toggleRightSidebar}
										zenMode={agentZenMode}
										onToggleZen={toggleAgentZen}
									/>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												aria-label={t("titlebar.enterAgentZen")}
												aria-pressed={agentZenMode}
												onClick={enterAgentZen}
											>
												<Focus className="size-3.5" />
											</Button>
										</TooltipTrigger>
										<TooltipContent side="bottom">
											{t("titlebar.enterAgentZenHint", {
												shortcut: ZEN_SHORTCUT,
											})}
										</TooltipContent>
									</Tooltip>
									{rightSidebarOpen ? (
										<>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														type="button"
														variant="ghost"
														size="icon-xs"
														aria-label={t("titlebar.agentPanel")}
														aria-pressed={rightSidebarTab === "agent"}
														className={cn(
															rightSidebarTab === "agent" &&
																"bg-muted text-foreground",
														)}
														onClick={() => openRightTab("agent")}
													>
														<Bot className="size-3.5" />
													</Button>
												</TooltipTrigger>
												<TooltipContent side="bottom">
													{t("labels.agent")}
												</TooltipContent>
											</Tooltip>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														type="button"
														variant="ghost"
														size="icon-xs"
														aria-label={t("titlebar.backlinksPanel")}
														aria-pressed={rightSidebarTab === "backlinks"}
														className={cn(
															rightSidebarTab === "backlinks" &&
																"bg-muted text-foreground",
														)}
														onClick={() => openRightTab("backlinks")}
													>
														<Link2 className="size-3.5" />
													</Button>
												</TooltipTrigger>
												<TooltipContent side="bottom">
													{t("labels.backlinks")}
												</TooltipContent>
											</Tooltip>
										</>
									) : null}
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												aria-label={
													rightSidebarOpen
														? t("titlebar.hideRightSidebar")
														: t("titlebar.showRightSidebar")
												}
												aria-pressed={rightSidebarOpen}
												onClick={toggleRightSidebar}
											>
												<PanelRight className="size-3.5" />
											</Button>
										</TooltipTrigger>
										<TooltipContent side="bottom">
											{rightSidebarOpen
												? t("titlebar.hideRightSidebarHint", {
														shortcut: CHAT_SHORTCUT,
													})
												: t("titlebar.showRightSidebarHint", {
														shortcut: CHAT_SHORTCUT,
													})}
										</TooltipContent>
									</Tooltip>
								</div>
							</>
						)}
						{showWindowControls ? <WindowControls /> : null}
					</TooltipProvider>
				</header>

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
										importBusy={libraryIoBusy === "import"}
										busy={
											busy || Boolean(createDraft) || libraryIoBusy !== null
										}
										error={error}
										isDemo={isDemo}
										lookupOpenSignal={lookupOpenSignal}
									/>
								</div>
								<div className="agentero-scroll min-h-0 flex-1 px-1">
									<FileTree
										nodes={tree}
										selectedPath={treeSelectedPath}
										vaultPath={vaultPath}
										createDraft={createDraft}
										onConfirmCreate={(name) => void handleConfirmCreate(name)}
										onCancelCreate={handleCancelCreate}
										onDeletePath={(path) => void handleDeletePath(path)}
										onSelectFile={(n) => handleSelectFile(n)}
										onSelectLibrary={handleSelectLibrary}
										onDownloadPaperAssets={handleDownloadPaperAssets}
										onDownloadAllMissingAssets={handleDownloadAllMissingAssets}
										arxivPaperRelPaths={arxivPaperRelPaths}
										paperMetaByRelPath={paperMetaByRelPath}
										onReadPaper={handleReadPaper}
									/>
								</div>
								{/* Paper info only when a specific paper is selected */}
								{paperMeta ? <PaperInfoPanel meta={paperMeta} /> : null}
							</aside>
						</ResizablePanel>

						{sidebarCollapsed || agentZenMode ? null : <ResizableHandle />}

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
								{/* Center header: library search / view mode left; actions right */}
								{vaultPath && activeTab ? (
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
																<Import className="size-3.5" />
															</Button>
														</TooltipTrigger>
														<TooltipContent side="bottom">
															{t("sidebar:zoteroMigrate.button")}
														</TooltipContent>
													</Tooltip>
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
																	activeTabId && closeTab(activeTabId)
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
												{renderTabCenter(tab)}
											</div>
										))}
									</div>
								)}
							</div>
						</ResizablePanel>

						{showNotesOnRight && !agentZenMode ? <ResizableHandle /> : null}

						{showNotesOnRight && !agentZenMode ? (
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
												<div
													key={tab.id}
													hidden={tab.id !== activeTabId}
													className="absolute inset-0"
												>
													<MarkdownEditor
														key={`notes-${tab.id}-${tab.notesKey}`}
														ref={(h) => {
															if (h) notesEditorHandles.current.set(tab.id, h);
															else notesEditorHandles.current.delete(tab.id);
														}}
														className="agentero-scroll h-full min-h-0"
														initialMarkdown={tab.notesSeed}
														filePath={tab.notesPath}
														fontSize={editorFontSize}
														showToolbar={settings.showEditorToolbar}
														placeholder={t("editor.notesPlaceholder")}
														onPersist={persistFile}
														onDirtyChange={(d) =>
															updateTab(tab.id, { notesDirty: d })
														}
													/>
												</div>
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
						{rightSidebarOpen && !agentZenMode ? <ResizableHandle /> : null}
						<ResizablePanel
							id="right-sidebar"
							panelRef={rightSidebarPanelRef}
							defaultSize={0}
							minSize={agentZenMode ? 0 : 260}
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
										headerActions={
											agentZenMode ? (
												<Button
													type="button"
													variant="ghost"
													size="icon-xs"
													className="size-7"
													aria-label={t("titlebar.exitAgentZen")}
													onClick={exitAgentZen}
												>
													<X className="size-3.5" />
												</Button>
											) : undefined
										}
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

				{/* IDE-style background tasks (bottom-left floater); hide in zen */}
				{agentZenMode ? null : <BackgroundTasksPanel />}
			</div>
		</WikiNavContext.Provider>
	);
}
