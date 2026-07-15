import {
	Bot,
	Download,
	FolderOpen,
	Link2,
	Loader2,
	PanelLeft,
	PanelRight,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePanelRef } from "react-resizable-panels";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { ErrorBoundary } from "@/components/error-boundary";
import { AgentPanel } from "@/components/layout/agent-panel";
import { BackgroundTasksPanel } from "@/components/layout/background-tasks-panel";
import { BacklinksPanel } from "@/components/layout/backlinks-panel";
import {
	FileTree,
	type TreeCreateDraft,
	VaultSidebarHeader,
} from "@/components/layout/file-tree";
import { GraphPanel } from "@/components/layout/graph-panel";
import { PaneHeader } from "@/components/layout/pane-header";
import { PaperInfoPanel } from "@/components/layout/paper-info-panel";
import { PapersLibrary } from "@/components/layout/papers-library";
import {
	ResizableGroup,
	ResizableHandle,
	ResizablePanel,
} from "@/components/layout/resizable";
import { VaultWelcome } from "@/components/layout/vault-welcome";
import {
	type SettingsSection,
	SettingsWindow,
} from "@/components/settings-window";
import { Button } from "@/components/ui/button";
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
	isPapersRoot,
	loadPaperMetadata,
	notesPathForPaper,
	type PaperMetadata,
	paperDirFromPath,
	paperNeedsAssetDownload,
	paperRemoteAssetsFromMetadata,
	resolvePapersParentDir,
} from "@/lib/paper-metadata";
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
import { resolveShortcutId } from "@/lib/shortcuts";
import { isTauri } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import {
	createVault,
	createVaultDirectory,
	type FileNode,
	getRecentVaults,
	getSavedVaultPath,
	isMarkdownPath,
	isTextOpenable,
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
import {
	type CenterViewMode,
	isHtmlPath,
	isPdfPath,
	preferredModeForPath,
} from "@/lib/viewer";
import {
	missingNotePath,
	newNoteMarkdown,
	normalizeVaultRel,
	rebuildWikiIndex,
	toVaultRelative,
	type WikiNavTarget,
} from "@/lib/wiki";
import { WikiNavContext } from "@/lib/wiki-nav-context";

const STORAGE_KEY = "motif-editor-content";
const OPEN_FILE_KEY = "motif-open-file";

const defaultMarkdown = `### Title

> This is a quote.

With some **bold** text for emphasis!
`;

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

function treeFindChildren(
	nodes: FileNode[],
	path: string,
): FileNode[] | undefined {
	return treeFindNode(nodes, path)?.children;
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

/** Library table view: virtual tree node, or vault root / papers/ selection. */
function isLibraryHome(
	vaultPath: string | null,
	selectedPath: string | null,
): boolean {
	if (!vaultPath) return false;
	if (isLibraryVirtualPath(selectedPath)) return true;
	if (!selectedPath) return true;
	const sel = selectedPath.replace(/\\/g, "/").replace(/\/+$/, "");
	const root = vaultPath.replace(/\\/g, "/").replace(/\/+$/, "");
	if (sel === root) return true;
	if (isPapersRoot(sel)) return true;
	return false;
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

export default function App() {
	const { t } = useTranslation(["app", "sidebar"]);
	const { setTheme } = useTheme();
	const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [settingsSection, setSettingsSection] =
		useState<SettingsSection>("general");
	const settingsOpenRef = useRef(settingsOpen);
	settingsOpenRef.current = settingsOpen;

	const [markdown, setMarkdown] = useState(() => {
		const saved = localStorage.getItem(STORAGE_KEY);
		const hasVault =
			isTauri() &&
			Boolean(
				getSavedVaultPath({ allowRestore: loadSettings().restoreLastVault }),
			);
		if (!hasVault) return defaultMarkdown;
		return saved ?? defaultMarkdown;
	});
	const [vaultPath, setVaultPath] = useState<string | null>(() => {
		if (!isTauri()) return null;
		return getSavedVaultPath({
			allowRestore: loadSettings().restoreLastVault,
		});
	});
	const [tree, setTree] = useState<FileNode[]>([]);
	const [selectedPath, setSelectedPath] = useState<string | null>(() => {
		// Fresh windows and empty vaults should not restore a previous file.
		if (!isTauri()) return null;
		const vault = getSavedVaultPath({
			allowRestore: loadSettings().restoreLastVault,
		});
		return vault ? localStorage.getItem(OPEN_FILE_KEY) : null;
	});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/** Inline new file/folder draft in the tree (IDE-style). */
	const [createDraft, setCreateDraft] = useState<TreeCreateDraft | null>(null);
	const [recentVaults, setRecentVaults] = useState<string[]>(() =>
		getRecentVaults(),
	);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [centerMode, setCenterMode] = useState<CenterViewMode>(() => {
		const saved = localStorage.getItem(OPEN_FILE_KEY);
		if (saved && paperDirFromPath(saved)) {
			return "pdf";
		}
		// Paper folder root (no marker in path alone) — prefer pdf until meta loads
		if (saved && /(?:^|\/)papers\//i.test(saved.replace(/\\/g, "/"))) {
			return "pdf";
		}
		return saved ? preferredModeForPath(saved) : "markdown";
	});
	const [paperMeta, setPaperMeta] = useState<PaperMetadata | null>(null);
	const [libraryPapers, setLibraryPapers] = useState<PaperMetadata[]>([]);
	const [libraryLoading, setLibraryLoading] = useState(false);
	/** Remote streaming URLs only — never local vault file / blob download */
	const [pdfUrl, setPdfUrl] = useState<string | null>(null);
	const [htmlSrcUrl, setHtmlSrcUrl] = useState<string | null>(null);
	/** NOTES.md for the current paper — shown on the right when viewing PDF/HTML */
	const [paperNotes, setPaperNotes] = useState("");
	/**
	 * Right sidebar (⌘L): Agent (default) or Backlinks with Graph below.
	 * Collapsed by default; top-bar icons open a tab.
	 */
	const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
	const [rightSidebarTab, setRightSidebarTab] = useState<"agent" | "backlinks">(
		"agent",
	);
	/** Bumped after graph_rebuild so Backlinks/Graph re-fetch. */
	const [wikiIndexRevision, setWikiIndexRevision] = useState(0);
	/** Increment to open magic-wand popover (⇧⌘I). */
	const [lookupOpenSignal, setLookupOpenSignal] = useState(0);
	const sidebarPanelRef = usePanelRef();
	const rightSidebarPanelRef = usePanelRef();
	const editorPaneRef = useRef<HTMLDivElement>(null);
	const previewPaneRef = useRef<HTMLDivElement>(null);
	const sidebarAsideRef = useRef<HTMLElement>(null);
	const chatInputFocusKey = useRef(0);

	// Editor seed key: bumps when a file's content (re)loads to remount + reseed.
	const [editorKey, setEditorKey] = useState(0);
	const [markdownDirty, setMarkdownDirty] = useState(false);
	// Paper NOTES.md editing (right pane during PDF/HTML view).
	const [notesPath, setNotesPath] = useState<string | null>(null);
	const [notesKey, setNotesKey] = useState(0);
	const [notesDirty, setNotesDirty] = useState(false);

	const isDemo = vaultPath === null;
	const vaultMdFiles = useMemo(
		() => collectMarkdownRelPaths(tree, vaultPath),
		[tree, vaultPath],
	);
	/** Paper folders at any depth under papers/ (marker-based). */
	const paperFolders = useMemo(() => collectPaperFoldersFromTree(tree), [tree]);

	const modeAvailable: Record<CenterViewMode, boolean> = {
		markdown: true,
		pdf: Boolean(pdfUrl),
		html: Boolean(htmlSrcUrl),
	};

	// Load remote PDF/HTML URLs from metadata (no local file download)
	useEffect(() => {
		let cancelled = false;

		void (async () => {
			let paperDir = paperDirFromPath(selectedPath, paperFolders);
			if (
				!paperDir &&
				selectedPath &&
				(await detectPaperDirectory(selectedPath))
			) {
				paperDir = selectedPath.replace(/[\\/]+$/, "");
			}

			// Selecting a bare .pdf/.html path without paper metadata: no remote preview
			if (!paperDir) {
				if (cancelled) return;
				setPaperMeta(null);
				setPaperNotes("");
				setPdfUrl(null);
				setHtmlSrcUrl(null);
				setNotesPath(null);
				setNotesDirty(false);
				return;
			}

			const meta = await loadPaperMetadata(paperDir, vaultPath);
			if (cancelled) return;
			setPaperMeta(meta);

			const { pdfUrl: remotePdf, htmlUrl: remoteHtml } =
				paperRemoteAssetsFromMetadata(meta);
			setPdfUrl(remotePdf);
			setHtmlSrcUrl(remoteHtml);

			// Notes stay local (Markdown only)
			const resolvedNotesPath = notesPathForPaper(paperDir);
			let notes = "# Notes\n\nNo NOTES.md found for this paper.\n";
			try {
				notes = await readVaultFile(resolvedNotesPath);
			} catch {
				// keep placeholder
			}
			if (cancelled) return;
			setPaperNotes(notes);
			setNotesPath(resolvedNotesPath);
			setNotesDirty(false);
			setNotesKey((k) => k + 1);

			// Opening a paper folder: prefer PDF, fall back HTML, else NOTES as markdown
			const openingPaperRoot =
				selectedPath != null &&
				(normalizePathKey(selectedPath) === normalizePathKey(paperDir) ||
					isPaperDirectory(selectedPath, treeFindChildren(tree, selectedPath)));
			if (openingPaperRoot) {
				if (remotePdf) setCenterMode("pdf");
				else if (remoteHtml) setCenterMode("html");
				else {
					setMarkdown(notes);
					setMarkdownDirty(false);
					setEditorKey((k) => k + 1);
					setCenterMode("markdown");
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [selectedPath, paperFolders, tree, vaultPath]);

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
						panel.resize(SIDEBAR_DEFAULT_PX);
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
						panel.resize(RIGHT_SIDEBAR_DEFAULT_PX);
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
		// React state is source of truth — isCollapsed() can lag at 0px.
		setLeftSidebarCollapsed(!sidebarCollapsed);
	}, [sidebarCollapsed, setLeftSidebarCollapsed]);

	const toggleRightSidebar = useCallback(() => {
		setRightSidebarCollapsed(rightSidebarOpen, {
			focusAgent: !rightSidebarOpen && rightSidebarTab === "agent",
		});
	}, [rightSidebarOpen, rightSidebarTab, setRightSidebarCollapsed]);

	/** Open right sidebar on a tab (or switch tab if already open). */
	const openRightTab = useCallback(
		(tab: "agent" | "backlinks") => {
			setRightSidebarTab(tab);
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
		setRightSidebarCollapsed(rightSidebarOpen, {
			focusAgent: !rightSidebarOpen && rightSidebarTab === "agent",
		});
	}, [rightSidebarOpen, rightSidebarTab, setRightSidebarCollapsed]);

	const expandSidebar = useCallback(() => {
		setLeftSidebarCollapsed(false);
		requestAnimationFrame(() => {
			sidebarAsideRef.current?.querySelector<HTMLElement>("button")?.focus();
		});
	}, [setLeftSidebarCollapsed]);

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
			setSelectedPath(null);
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
		const path = selectedPath;
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
	}, [selectedPath, t]);

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

				const selectedNorm = selectedPath
					?.replace(/\\/g, "/")
					.replace(/\/+$/, "");
				if (
					selectedNorm &&
					(selectedNorm === pathNorm || selectedNorm.startsWith(`${pathNorm}/`))
				) {
					setSelectedPath(LIBRARY_VIRTUAL_PATH);
					setMarkdown("");
					setMarkdownDirty(false);
					setNotesPath(null);
					setPaperMeta(null);
					setCenterMode("markdown");
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
			selectedPath,
			refreshTree,
			rebuildWikiAndNotify,
			refreshLibrary,
			t,
		],
	);

	const handleDeleteSelected = useCallback(() => {
		const path = selectedPath;
		if (!path || isLibraryVirtualPath(path)) {
			setError(t("sidebar:fileTree.deleteNeedsSelection"));
			return;
		}
		void handleDeletePath(path);
	}, [selectedPath, handleDeletePath, t]);

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
		() => resolvePapersParentDir(vaultPath, selectedPath, tree),
		[vaultPath, selectedPath, tree],
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
				case "focusSidebar":
					expandSidebar();
					break;
				case "focusEditor":
					editorPaneRef.current
						?.querySelector<HTMLElement>("[contenteditable='true']")
						?.focus();
					break;
				case "focusPreview":
					previewPaneRef.current
						?.querySelector<HTMLElement>("[contenteditable='true']")
						?.focus();
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
		toggleChat,
		toggleSidebar,
	]);

	// Native menu bar (motif → Settings…, File, View) — desktop only
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
		localStorage.setItem(STORAGE_KEY, markdown);
	}, [markdown]);

	useEffect(() => {
		if (selectedPath) localStorage.setItem(OPEN_FILE_KEY, selectedPath);
		else localStorage.removeItem(OPEN_FILE_KEY);
	}, [selectedPath]);

	// Persist a specific file's Markdown to disk. The MarkdownEditor calls this with
	// its own fixed path (debounced autosave, ⌘S, and unmount flush), so writes always
	// target the correct file even when switching files quickly.
	const persistFile = useCallback(
		(path: string, md: string) => {
			if (!isTauri() || !vaultPath || !path) return;
			void writeVaultFile(path, md).catch((e) => {
				setError(e instanceof Error ? e.message : String(e));
			});
		},
		[vaultPath],
	);

	/** Open a paper folder: center PDF, right Notes (via metadata effect). */
	const openPaper = useCallback((paperDir: string) => {
		setSelectedPath(paperDir);
		setError(null);
		// Mode is refined after metadata loads (pdf → html → notes).
		setCenterMode("pdf");
	}, []);

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
				async ({ setDetail }) => {
					setDetail(text.trim().slice(0, 80));
					const r = await addPaperByIdentifier({
						vaultRoot: vaultPath,
						parentDir: lookupParentDir,
						text,
						settings,
					});
					await refreshTree(vaultPath);
					await rebuildWikiAndNotify(vaultPath);
					await refreshLibrary();
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
		],
	);

	/**
	 * On-demand assets: missing local PDF, and/or arXiv TeX when fetchable but absent.
	 */
	const handleDownloadPaperAssets = useCallback(
		async (node: FileNode) => {
			if (!vaultPath) return;
			const rel = toVaultRelative(vaultPath, node.path).replace(/\\/g, "/");
			try {
				await runBackgroundTask(
					{
						kind: "download",
						title: t("tasks.downloadPaper"),
						detail: rel,
					},
					async ({ setDetail }) => {
						setDetail(rel);
						await downloadPaperAssets({
							vaultRoot: vaultPath,
							paperPath: rel,
						});
						await refreshTree(vaultPath);
						await refreshLibrary();
					},
				);
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
			}
		},
		[vaultPath, refreshTree, refreshLibrary, t],
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
		async (absoluteOrDemoPath: string) => {
			const children = treeFindChildren(tree, absoluteOrDemoPath);
			if (
				isPaperDirectory(absoluteOrDemoPath, children) ||
				(await detectPaperDirectory(absoluteOrDemoPath))
			) {
				openPaper(absoluteOrDemoPath);
				return;
			}

			const name =
				absoluteOrDemoPath.split(/[\\/]/).pop() ?? absoluteOrDemoPath;
			const node: FileNode = {
				id: absoluteOrDemoPath,
				name,
				path: absoluteOrDemoPath,
				kind: "file",
			};
			setSelectedPath(node.path);
			setError(null);

			// File under a paper: prefer PDF if available later; set by extension first
			const paperDir = paperDirFromPath(node.path, paperFolders);
			if (paperDir && isMarkdownPath(node.path)) {
				// Opening NOTES.md etc. from wiki/backlink still shows notes; PDF if user toggles
				setCenterMode(preferredModeForPath(node.path));
			} else {
				setCenterMode(preferredModeForPath(node.path));
			}

			if (isPdfPath(node.path) || isHtmlPath(node.path)) {
				return;
			}

			if (!isTextOpenable(node.path)) {
				setError(t("errors.cannotPreview", { name: node.name }));
				return;
			}

			setBusy(true);
			try {
				const content = await readVaultFile(node.path);
				setMarkdown(content);
				setMarkdownDirty(false);
				setEditorKey((k) => k + 1);
				if (!isMarkdownPath(node.path) && !isHtmlPath(node.path)) {
					setCenterMode("markdown");
				}
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
			} finally {
				setBusy(false);
			}
		},
		[openPaper, paperFolders, t, tree],
	);

	const startCreate = useCallback(
		(kind: TreeCreateDraft["kind"]) => {
			setError(null);
			if (!vaultPath || !isTauri()) {
				setError(t("sidebar:fileTree.needsVault"));
				return;
			}
			const parent = resolveCreateParent(vaultPath, selectedPath, tree);
			setCreateDraft({ kind, parentPath: parent });
		},
		[vaultPath, selectedPath, tree, t],
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
					await openPath(full);
				} else {
					await createVaultDirectory(full);
					await refreshTree(vaultPath);
					setSelectedPath(full);
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
			await openPath(openAbs);
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
		setSelectedPath(LIBRARY_VIRTUAL_PATH);
		setPaperMeta(null);
		setPdfUrl(null);
		setHtmlSrcUrl(null);
		setNotesPath(null);
		setNotesDirty(false);
		setError(null);
		void refreshLibrary();
	}, [refreshLibrary]);

	const handleSelectFile = async (node: FileNode) => {
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
		await openPath(node.path);
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
			void openPath(full);
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
				await openPath(full);
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
		setCenterMode(mode);
	};

	const showLibrary = Boolean(
		vaultPath && isLibraryHome(vaultPath, selectedPath),
	);
	/** Notes / Preview: only when a concrete paper is open (PDF/HTML), never on library. */
	const showNotesOnRight =
		!showLibrary &&
		Boolean(paperMeta) &&
		(centerMode === "pdf" || centerMode === "html");

	/**
	 * Notes still mounts/unmounts with paper selection. Re-assert intended collapse
	 * so a remounted middle column cannot partially un-collapse either rail.
	 * (showNotesOnRight is intentional; panel refs are stable.)
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run on Notes mount; assert current collapse intent
	useEffect(() => {
		const id = requestAnimationFrame(() => {
			const left = sidebarPanelRef.current;
			const right = rightSidebarPanelRef.current;
			if (sidebarCollapsed) {
				try {
					left?.collapse();
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
			}
		});
		return () => cancelAnimationFrame(id);
	}, [showNotesOnRight, sidebarCollapsed, rightSidebarOpen]);

	const activeFileLabel = showLibrary
		? t("sidebar:papersLibrary.title")
		: selectedPath
			? selectedPath.split(/[\\/]/).pop()
			: t("labels.untitled");

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
				<header className="flex h-8 shrink-0 items-center border-b select-none">
					{/*
					  Traffic lights: x=14, three ~14px buttons + gaps → ends ~68px.
					  Keep extra gap so the sidebar toggle never hugs the lights.
					*/}
					<div
						className="w-[92px] shrink-0 self-stretch"
						data-tauri-drag-region
					/>
					<TooltipProvider delayDuration={250}>
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
										? t("titlebar.showSidebarHint")
										: t("titlebar.hideSidebarHint")}
								</TooltipContent>
							</Tooltip>
						</div>
						{/* Draggable empty middle of the title bar */}
						<div
							className="min-w-0 flex-1 self-stretch"
							data-tauri-drag-region
						/>
						<div className="flex shrink-0 items-center gap-0.5 pr-2">
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
										? t("titlebar.hideRightSidebarHint")
										: t("titlebar.showRightSidebarHint")}
								</TooltipContent>
							</Tooltip>
						</div>
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
								else if (size.inPixels >= 80) setSidebarCollapsed(false);
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
								<div className="motif-scroll min-h-0 flex-1 px-1">
									<FileTree
										nodes={tree}
										selectedPath={selectedPath}
										vaultPath={vaultPath}
										createDraft={createDraft}
										onConfirmCreate={(name) => void handleConfirmCreate(name)}
										onCancelCreate={handleCancelCreate}
										onDeletePath={(path) => void handleDeletePath(path)}
										onSelectFile={(n) => void handleSelectFile(n)}
										onSelectLibrary={handleSelectLibrary}
										onDownloadPaperAssets={handleDownloadPaperAssets}
										onDownloadAllMissingAssets={handleDownloadAllMissingAssets}
										arxivPaperRelPaths={arxivPaperRelPaths}
									/>
								</div>
								{/* Paper info only when a specific paper is selected */}
								{paperMeta ? <PaperInfoPanel meta={paperMeta} /> : null}
							</aside>
						</ResizablePanel>

						{sidebarCollapsed ? null : <ResizableHandle />}

						<ResizablePanel
							id="source"
							defaultSize="40"
							minSize={200}
							className="min-h-0 min-w-0 overflow-hidden"
						>
							<div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
								{/* Single-row header: toggle left, title right — same 28px line box */}
								<div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
									<div className="flex h-7 shrink-0 items-center">
										{showLibrary ? null : (
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
										markdownDirty ? (
											<span
												className="size-1.5 shrink-0 rounded-full bg-muted-foreground/70"
												role="img"
												aria-label={t("editor.unsaved")}
												title={t("editor.unsaved")}
											/>
										) : null}
										{showLibrary ? (
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
										) : (
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
										)}
									</div>
								</div>
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
										<div className="motif-scroll flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-muted/30 p-6 text-center">
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
								) : showLibrary ? (
									<PapersLibrary
										papers={libraryPapers}
										loading={libraryLoading}
										onOpenPaper={handleOpenLibraryPaper}
										className="bg-muted/20"
									/>
								) : (
									<>
										{centerMode === "markdown" ? (
											<div
												ref={editorPaneRef}
												className="min-h-0 flex-1 overflow-hidden bg-muted/30"
											>
												<MarkdownEditor
													key={editorKey}
													className="motif-scroll h-full min-h-0"
													initialMarkdown={markdown}
													filePath={
														selectedPath && isMarkdownPath(selectedPath)
															? selectedPath
															: null
													}
													fontSize={editorFontSize}
													placeholder={t("editor.markdownPlaceholder")}
													onPersist={persistFile}
													onDirtyChange={setMarkdownDirty}
												/>
											</div>
										) : null}
										{centerMode === "pdf" ? (
											<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
												<PdfViewer
													source={pdfUrl}
													paperAbsPath={
														notesPath
															? notesPath.replace(/[\\/]NOTES\.md$/i, "")
															: null
													}
													paperRelPath={
														paperMeta?.path ??
														(notesPath && vaultPath
															? (() => {
																	const abs = notesPath
																		.replace(/[\\/]NOTES\.md$/i, "")
																		.replace(/\\/g, "/");
																	const root = vaultPath
																		.replace(/\\/g, "/")
																		.replace(/\/$/, "");
																	if (abs === root) return "";
																	if (abs.startsWith(`${root}/`)) {
																		return abs.slice(root.length + 1);
																	}
																	return abs;
																})()
															: null)
													}
													vaultPath={vaultPath}
													className="h-full w-full"
												/>
											</div>
										) : null}
										{centerMode === "html" ? (
											<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
												<HtmlViewer
													srcUrl={htmlSrcUrl}
													className="h-full w-full"
												/>
											</div>
										) : null}
									</>
								)}
							</div>
						</ResizablePanel>

						{showNotesOnRight ? <ResizableHandle /> : null}

						{showNotesOnRight ? (
							<ResizablePanel
								id="notes"
								defaultSize={rightSidebarOpen ? "30" : "40"}
								minSize={200}
								className="min-h-0 overflow-hidden"
							>
								<div
									ref={previewPaneRef}
									className="flex h-full min-h-0 flex-col overflow-hidden"
									style={{ fontSize: editorFontSize }}
								>
									<PaneHeader>
										<span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium text-sm">
											{t("labels.notes")}
											{notesDirty ? (
												<span
													className="size-1.5 shrink-0 rounded-full bg-muted-foreground/70"
													role="img"
													aria-label={t("editor.unsaved")}
													title={t("editor.unsaved")}
												/>
											) : null}
										</span>
									</PaneHeader>
									<div className="min-h-0 flex-1 overflow-hidden">
										<MarkdownEditor
											key={`notes-${notesKey}`}
											className="motif-scroll h-full min-h-0"
											initialMarkdown={paperNotes}
											filePath={notesPath}
											fontSize={editorFontSize}
											placeholder={t("editor.notesPlaceholder")}
											onPersist={persistFile}
											onDirtyChange={setNotesDirty}
										/>
									</div>
								</div>
							</ResizablePanel>
						) : null}

						{/*
						  Right sidebar: always mounted + collapsible (same as left).
						  Conditional mount used to remount the Group when toggling ⌘L,
						  which redistributed left panel size and caused visual overlap.
						*/}
						{rightSidebarOpen ? <ResizableHandle /> : null}
						<ResizablePanel
							id="right-sidebar"
							panelRef={rightSidebarPanelRef}
							defaultSize={0}
							minSize={260}
							maxSize={520}
							collapsible
							collapsedSize={0}
							groupResizeBehavior="preserve-pixel-size"
							className="min-h-0 overflow-hidden"
							onResize={(size) => {
								if (size.inPixels <= 1) setRightSidebarOpen(false);
								else if (size.inPixels >= 80) setRightSidebarOpen(true);
							}}
						>
							{rightSidebarOpen ? (
								rightSidebarTab === "agent" ? (
									<AgentPanel
										key={chatInputFocusKey.current}
										vaultPath={vaultPath}
										selectedPath={selectedPath}
										vaultMarkdownPaths={vaultMdFiles}
										className="min-h-0 h-full"
										title={t("labels.agent")}
										autoFocus
									/>
								) : (
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
								)
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

				{/* IDE-style background tasks (bottom-left floater) */}
				<BackgroundTasksPanel />
			</div>
		</WikiNavContext.Provider>
	);
}
