import {
	BlockquotePlugin,
	BoldPlugin,
	H1Plugin,
	H2Plugin,
	H3Plugin,
	ItalicPlugin,
	UnderlinePlugin,
} from "@platejs/basic-nodes/react";
import { MarkdownPlugin } from "@platejs/markdown";
import { Bot, Link2, PanelLeft, PanelRight } from "lucide-react";
import { useTheme } from "next-themes";
import { Plate, usePlateEditor } from "platejs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { BlockquoteElement } from "@/components/editor/blockquote-node";
import { Editor, EditorContainer } from "@/components/editor/editor";
import {
	H1Element,
	H2Element,
	H3Element,
} from "@/components/editor/heading-node";
import { LinkPlugin } from "@/components/editor/plugins/link-plugin";
import { MarkdownKit } from "@/components/editor/plugins/markdown-kit";
import { ErrorBoundary } from "@/components/error-boundary";
import { AgentPanel } from "@/components/layout/agent-panel";
import { BacklinksPanel } from "@/components/layout/backlinks-panel";
import { FileTree, VaultSidebarHeader } from "@/components/layout/file-tree";
import { PaneHeader } from "@/components/layout/pane-header";
import {
	ResizableGroup,
	ResizableHandle,
	ResizablePanel,
} from "@/components/layout/resizable";
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
import {
	loadPaperMetadata,
	notesPathForPaper,
	type PaperMetadata,
	paperDirFromPath,
	paperRemoteAssetsFromMetadata,
} from "@/lib/paper-metadata";
import { type AppSettings, loadSettings, saveSettings } from "@/lib/settings";
import { resolveShortcutId } from "@/lib/shortcuts";
import { isTauri } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import {
	type FileNode,
	getDemoTextContent,
	getDemoTree,
	getSavedVaultPath,
	isMarkdownPath,
	isTextOpenable,
	loadVaultTree,
	pickVaultDirectory,
	readVaultFile,
	saveVaultPath,
	vaultDisplayName,
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
	rewriteWikilinksForPreview,
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

function useDebounce<T>(value: T, delay: number): T {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);

	return debounced;
}

const platePlugins = [
	BoldPlugin,
	ItalicPlugin,
	UnderlinePlugin,
	H1Plugin.withComponent(H1Element),
	H2Plugin.withComponent(H2Element),
	H3Plugin.withComponent(H3Element),
	BlockquotePlugin.withComponent(BlockquoteElement),
	LinkPlugin,
	...MarkdownKit,
];

/** Flatten tree to vault-relative Markdown paths for wikilink resolve. */
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
	const { setTheme } = useTheme();
	const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [settingsSection, setSettingsSection] =
		useState<SettingsSection>("general");
	const settingsOpenRef = useRef(settingsOpen);
	settingsOpenRef.current = settingsOpen;

	const DEMO_NOTES = "demo-vault/papers/1706.03762/NOTES.md";
	const [markdown, setMarkdown] = useState(
		() =>
			localStorage.getItem(STORAGE_KEY) ??
			getDemoTextContent(DEMO_NOTES) ??
			defaultMarkdown,
	);
	const [vaultPath, setVaultPath] = useState<string | null>(() => {
		const s = loadSettings();
		if (!isTauri()) return null;
		if (!s.restoreLastVault) return null;
		return getSavedVaultPath();
	});
	const [tree, setTree] = useState<FileNode[]>(() => getDemoTree());
	const [selectedPath, setSelectedPath] = useState<string | null>(() => {
		const saved = localStorage.getItem(OPEN_FILE_KEY);
		// Demo: land on mock paper so metadata PDF/HTML toggles are usable immediately
		if (!saved) return DEMO_NOTES;
		return saved;
	});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [centerMode, setCenterMode] = useState<CenterViewMode>("markdown");
	const [paperMeta, setPaperMeta] = useState<PaperMetadata | null>(null);
	/** Remote streaming URLs only — never local vault file / blob download */
	const [pdfUrl, setPdfUrl] = useState<string | null>(null);
	const [htmlSrcUrl, setHtmlSrcUrl] = useState<string | null>(null);
	/** NOTES.md for the current paper — shown on the right when viewing PDF/HTML */
	const [paperNotes, setPaperNotes] = useState("");
	/**
	 * Right sidebar (⌘L): Agent (default) or Backlinks.
	 * Collapsed by default; top-bar icons open a tab.
	 */
	const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
	const [rightSidebarTab, setRightSidebarTab] = useState<"agent" | "backlinks">(
		"agent",
	);
	const sidebarPanelRef = usePanelRef();
	const editorPaneRef = useRef<HTMLTextAreaElement>(null);
	const previewPaneRef = useRef<HTMLDivElement>(null);
	const sidebarAsideRef = useRef<HTMLElement>(null);
	const chatInputFocusKey = useRef(0);

	const debouncedMarkdown = useDebounce(markdown, 300);
	const debouncedPaperNotes = useDebounce(paperNotes, 200);
	const isDemo = vaultPath === null;
	const showNotesOnRight = centerMode === "pdf" || centerMode === "html";
	const vaultMdFiles = useMemo(
		() => collectMarkdownRelPaths(tree, vaultPath),
		[tree, vaultPath],
	);

	const modeAvailable: Record<CenterViewMode, boolean> = {
		markdown: true,
		pdf: Boolean(pdfUrl),
		html: Boolean(htmlSrcUrl),
	};

	// Load remote PDF/HTML URLs from metadata (no local file download)
	useEffect(() => {
		let cancelled = false;

		void (async () => {
			const paperDir = paperDirFromPath(selectedPath);

			// Selecting a bare .pdf/.html path without paper metadata: no remote preview
			if (!paperDir) {
				if (cancelled) return;
				setPaperMeta(null);
				setPaperNotes("");
				setPdfUrl(null);
				setHtmlSrcUrl(null);
				return;
			}

			const meta = await loadPaperMetadata(paperDir);
			if (cancelled) return;
			setPaperMeta(meta);

			const { pdfUrl: remotePdf, htmlUrl: remoteHtml } =
				paperRemoteAssetsFromMetadata(meta);
			setPdfUrl(remotePdf);
			setHtmlSrcUrl(remoteHtml);

			// Notes stay local (Markdown only)
			const notesPath = notesPathForPaper(paperDir);
			try {
				const notes = await readVaultFile(notesPath);
				if (cancelled) return;
				setPaperNotes(notes);
			} catch {
				if (cancelled) return;
				setPaperNotes("# Notes\n\nNo NOTES.md found for this paper.\n");
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [selectedPath]);

	useEffect(() => {
		setTheme(settings.theme);
	}, [settings.theme, setTheme]);

	const updateSettings = useCallback((next: AppSettings) => {
		setSettings(next);
		saveSettings(next);
	}, []);

	const SIDEBAR_DEFAULT_PX = 240;

	const toggleSidebar = useCallback(() => {
		const panel = sidebarPanelRef.current;
		if (!panel) return;
		// Use React state as source of truth — library isCollapsed() is unreliable at 0px.
		if (sidebarCollapsed) {
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
			setSidebarCollapsed(false);
		} else {
			try {
				panel.collapse();
			} catch {
				// ignore
			}
			setSidebarCollapsed(true);
		}
	}, [sidebarCollapsed, sidebarPanelRef]);

	const toggleRightSidebar = useCallback(() => {
		setRightSidebarOpen((open) => {
			const next = !open;
			if (next && rightSidebarTab === "agent") {
				chatInputFocusKey.current += 1;
			}
			return next;
		});
	}, [rightSidebarTab]);

	/** Open right sidebar on a tab (or switch tab if already open). */
	const openRightTab = useCallback((tab: "agent" | "backlinks") => {
		setRightSidebarTab(tab);
		setRightSidebarOpen(true);
		if (tab === "agent") {
			chatInputFocusKey.current += 1;
		}
	}, []);

	/** ⌘L — toggle right sidebar (defaults to agent). */
	const toggleChat = useCallback(() => {
		setRightSidebarOpen((open) => {
			const next = !open;
			if (next && rightSidebarTab === "agent") {
				chatInputFocusKey.current += 1;
			}
			return next;
		});
	}, [rightSidebarTab]);

	const expandSidebar = useCallback(() => {
		const panel = sidebarPanelRef.current;
		if (!panel) return;
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
		setSidebarCollapsed(false);
		requestAnimationFrame(() => {
			sidebarAsideRef.current?.querySelector<HTMLElement>("button")?.focus();
		});
	}, [sidebarPanelRef]);

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

	const handleOpenVault = useCallback(async () => {
		setError(null);
		try {
			if (!isTauri()) {
				setError("Open vault requires the Tauri desktop app (pnpm tauri dev).");
				return;
			}
			setBusy(true);
			const path = await pickVaultDirectory();
			if (!path) return;
			saveVaultPath(path);
			setVaultPath(path);
			setSelectedPath(null);
			try {
				await rebuildWikiIndex(path);
			} catch {
				// Index rebuild is best-effort; get_backlinks will rebuild on demand.
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, []);

	const handleRefresh = useCallback(() => {
		if (!vaultPath) return;
		void (async () => {
			await refreshTree(vaultPath);
			try {
				await rebuildWikiIndex(vaultPath);
			} catch {
				// ignore
			}
		})();
	}, [vaultPath, refreshTree]);

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
			event.preventDefault();

			switch (id) {
				case "settings":
					if (settingsOpenRef.current) closeSettings();
					else openSettings();
					break;
				case "closeSheet":
					closeSettings();
					break;
				case "openVault":
					void handleOpenVault();
					break;
				case "refreshTree":
					handleRefresh();
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
					editorPaneRef.current?.focus();
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
		handleOpenVault,
		handleRefresh,
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

	const editor = usePlateEditor({
		plugins: platePlugins,
		value: (ed) =>
			ed
				.getApi(MarkdownPlugin)
				.markdown.deserialize(
					rewriteWikilinksForPreview(markdown, vaultMdFiles) || " ",
				),
	});

	const notesEditor = usePlateEditor({
		plugins: platePlugins,
		value: (ed) =>
			ed
				.getApi(MarkdownPlugin)
				.markdown.deserialize(
					rewriteWikilinksForPreview(paperNotes || " ", vaultMdFiles) || " ",
				),
	});

	useEffect(() => {
		if (!vaultPath) {
			setTree(getDemoTree());
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

	useEffect(() => {
		try {
			const previewMd = rewriteWikilinksForPreview(
				debouncedMarkdown || " ",
				vaultMdFiles,
			);
			const value = editor
				.getApi(MarkdownPlugin)
				.markdown.deserialize(previewMd || " ");
			editor.tf.reset();
			editor.tf.setValue(value);
		} catch (e) {
			console.error("Failed to deserialize markdown for preview:", e);
		}
	}, [debouncedMarkdown, editor, vaultMdFiles]);

	useEffect(() => {
		try {
			const previewMd = rewriteWikilinksForPreview(
				debouncedPaperNotes || " ",
				vaultMdFiles,
			);
			const value = notesEditor
				.getApi(MarkdownPlugin)
				.markdown.deserialize(previewMd || " ");
			notesEditor.tf.reset();
			notesEditor.tf.setValue(value);
		} catch (e) {
			console.error("Failed to deserialize NOTES.md for preview:", e);
		}
	}, [debouncedPaperNotes, notesEditor, vaultMdFiles]);

	const handleUseDemo = () => {
		saveVaultPath(null);
		setVaultPath(null);
		setSelectedPath(DEMO_NOTES);
		setMarkdown(getDemoTextContent(DEMO_NOTES) ?? defaultMarkdown);
		setError(null);
		setTree(getDemoTree());
		setCenterMode("markdown");
	};

	const openPath = useCallback(async (absoluteOrDemoPath: string) => {
		const name = absoluteOrDemoPath.split(/[\\/]/).pop() ?? absoluteOrDemoPath;
		const node: FileNode = {
			id: absoluteOrDemoPath,
			name,
			path: absoluteOrDemoPath,
			kind: "file",
		};
		setSelectedPath(node.path);
		setError(null);

		const mode = preferredModeForPath(node.path);
		setCenterMode(mode);

		if (isPdfPath(node.path) || isHtmlPath(node.path)) {
			return;
		}

		if (!isTextOpenable(node.path)) {
			setError(`Cannot preview this file type: ${node.name}`);
			return;
		}

		setBusy(true);
		try {
			const content = await readVaultFile(node.path);
			setMarkdown(content);
			if (!isMarkdownPath(node.path) && !isHtmlPath(node.path)) {
				setCenterMode("markdown");
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, []);

	const handleSelectFile = async (node: FileNode) => {
		if (node.kind !== "file") return;
		await openPath(node.path);
	};

	/** Open a vault-relative path from backlinks (e.g. `notes/idea.md`). */
	const handleOpenVaultRel = useCallback(
		(rel: string) => {
			const clean = normalizeVaultRel(rel);
			const full = vaultPath
				? `${vaultPath.replace(/[\\/]+$/, "")}/${clean}`
				: `demo-vault/${clean}`;
			void openPath(full);
		},
		[vaultPath, openPath],
	);

	const handleWikiNavigate = useCallback(
		async (nav: WikiNavTarget) => {
			if (nav.exists && nav.path) {
				handleOpenVaultRel(nav.path);
				return;
			}
			const createRel = missingNotePath(nav.targetRaw);
			const ok = window.confirm(
				`「${nav.targetRaw}」 does not exist.\n\nCreate ${createRel}?`,
			);
			if (!ok) return;

			const content = newNoteMarkdown(nav.targetRaw);
			const full = vaultPath
				? `${vaultPath.replace(/[\\/]+$/, "")}/${createRel}`
				: `demo-vault/${createRel}`;

			try {
				await writeVaultFile(full, content);
				if (vaultPath) {
					try {
						await rebuildWikiIndex(vaultPath);
					} catch {
						// ignore
					}
					await refreshTree(vaultPath);
				} else {
					// Demo: inject into tree so resolve finds it next time
					setTree((prev) => {
						const next = structuredClone(prev);
						const ensureChild = (
							nodes: FileNode[],
							name: string,
							path: string,
							kind: "file" | "directory",
						): FileNode => {
							let node = nodes.find((n) => n.name === name);
							if (!node) {
								node = {
									id: path,
									name,
									path,
									kind,
									children: kind === "directory" ? [] : undefined,
								};
								nodes.push(node);
								nodes.sort((a, b) => {
									if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
									return a.name.localeCompare(b.name);
								});
							}
							return node;
						};
						const parts = createRel.split("/");
						let cursor = next;
						let acc = "demo-vault";
						for (let i = 0; i < parts.length; i++) {
							const part = parts[i];
							acc = `${acc}/${part}`;
							const isLast = i === parts.length - 1;
							const node = ensureChild(
								cursor,
								part,
								acc,
								isLast ? "file" : "directory",
							);
							if (!isLast) {
								if (!node.children) node.children = [];
								cursor = node.children;
							}
						}
						return next;
					});
				}
				await openPath(full);
			} catch (e) {
				setError(e instanceof Error ? e.message : String(e));
			}
		},
		[vaultPath, handleOpenVaultRel, openPath, refreshTree],
	);

	const wikiNavValue = useMemo(
		() => ({
			onWikiNavigate: (nav: WikiNavTarget) => void handleWikiNavigate(nav),
		}),
		[handleWikiNavigate],
	);

	const handleCenterModeChange = (mode: CenterViewMode) => {
		if (!modeAvailable[mode]) return;
		setCenterMode(mode);
	};

	const activeFileLabel = selectedPath
		? selectedPath.split(/[\\/]/).pop()
		: "Untitled";

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
												? "Show left sidebar"
												: "Hide left sidebar"
										}
										aria-pressed={!sidebarCollapsed}
										onClick={toggleSidebar}
									>
										<PanelLeft className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent side="bottom">
									{sidebarCollapsed
										? "Show sidebar (⌥⌘S)"
										: "Hide sidebar (⌥⌘S)"}
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
												aria-label="Agent panel"
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
										<TooltipContent side="bottom">Agent</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												aria-label="Backlinks panel"
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
										<TooltipContent side="bottom">Backlinks</TooltipContent>
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
												? "Hide right sidebar"
												: "Show right sidebar"
										}
										aria-pressed={rightSidebarOpen}
										onClick={toggleRightSidebar}
									>
										<PanelRight className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent side="bottom">
									{rightSidebarOpen
										? "Hide right sidebar (⌘L)"
										: "Show right sidebar (⌘L)"}
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
										onOpenVault={() => void handleOpenVault()}
										onRefresh={handleRefresh}
										onUseDemo={handleUseDemo}
										busy={busy}
										error={error}
										isDemo={isDemo}
									/>
								</div>
								<div className="motif-scroll min-h-0 flex-1 px-1">
									<FileTree
										nodes={tree}
										selectedPath={selectedPath}
										onSelectFile={(n) => void handleSelectFile(n)}
									/>
								</div>
							</aside>
						</ResizablePanel>

						{sidebarCollapsed ? null : <ResizableHandle />}

						<ResizablePanel
							id="source"
							defaultSize="40"
							minSize={200}
							className="min-h-0 overflow-hidden"
						>
							<div className="flex h-full min-h-0 flex-col overflow-hidden">
								{/* Single-row header: toggle left, title right — same 28px line box */}
								<div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
									<div className="flex h-7 shrink-0 items-center">
										<ViewModeToggle
											value={centerMode}
											onChange={handleCenterModeChange}
											available={modeAvailable}
										/>
									</div>
									<div className="flex h-7 min-w-0 flex-1 items-center justify-end">
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
									</div>
								</div>
								{centerMode === "markdown" ? (
									<textarea
										ref={editorPaneRef}
										className="motif-scroll min-h-0 flex-1 resize-none bg-muted/30 p-4 font-mono outline-none"
										style={{ fontSize: editorFontSize }}
										value={markdown}
										onChange={(event) => setMarkdown(event.target.value)}
										placeholder="Type Markdown here..."
										spellCheck={false}
									/>
								) : null}
								{centerMode === "pdf" ? (
									<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
										<PdfViewer source={pdfUrl} className="h-full w-full" />
									</div>
								) : null}
								{centerMode === "html" ? (
									<div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
										<HtmlViewer srcUrl={htmlSrcUrl} className="h-full w-full" />
									</div>
								) : null}
							</div>
						</ResizablePanel>

						<ResizableHandle />

						<ResizablePanel
							id="preview"
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
									<span className="min-w-0 flex-1 font-medium text-sm">
										{showNotesOnRight ? "Notes" : "Preview"}
									</span>
								</PaneHeader>
								<div className="min-h-0 flex-1 overflow-hidden">
									{showNotesOnRight ? (
										<Plate editor={notesEditor}>
											<EditorContainer className="motif-scroll h-full min-h-0">
												<Editor
													variant="none"
													className="min-h-full px-6 py-4"
													placeholder="Paper NOTES.md will appear here..."
													readOnly
												/>
											</EditorContainer>
										</Plate>
									) : (
										<Plate editor={editor}>
											<EditorContainer className="motif-scroll h-full min-h-0">
												<Editor
													variant="none"
													className="min-h-full px-6 py-4"
													placeholder="Rendered Markdown will appear here..."
													readOnly
												/>
											</EditorContainer>
										</Plate>
									)}
								</div>
							</div>
						</ResizablePanel>

						{/* Right sidebar: Agent (default) or Backlinks */}
						{rightSidebarOpen ? <ResizableHandle /> : null}
						{rightSidebarOpen ? (
							<ResizablePanel
								id="right-sidebar"
								defaultSize="28"
								minSize={260}
								maxSize={520}
								className="min-h-0 overflow-hidden"
							>
								{rightSidebarTab === "agent" ? (
									<AgentPanel
										key={chatInputFocusKey.current}
										vaultPath={vaultPath}
										className="min-h-0 h-full"
										title="Agent"
										autoFocus
									/>
								) : (
									<BacklinksPanel
										vaultPath={vaultPath}
										selectedPath={selectedPath}
										onOpenPath={handleOpenVaultRel}
										variant="sidebar"
										className="min-h-0 h-full"
									/>
								)}
							</ResizablePanel>
						) : null}
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
			</div>
		</WikiNavContext.Provider>
	);
}
