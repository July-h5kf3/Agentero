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
import { useTheme } from "next-themes";
import { Plate, usePlateEditor } from "platejs/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { MarkdownKit } from "@/components/editor/plugins/markdown-kit";
import { FileTree, VaultSidebarHeader } from "@/components/file-tree/file-tree";
import { PaneHeader } from "@/components/layout/pane-header";
import {
	ResizableGroup,
	ResizableHandle,
	ResizablePanel,
} from "@/components/layout/resizable";
import {
	type SettingsSection,
	SettingsWindow,
} from "@/components/settings/settings-window";
import { BlockquoteElement } from "@/components/ui/blockquote-node";
import { Editor, EditorContainer } from "@/components/ui/editor";
import { H1Element, H2Element, H3Element } from "@/components/ui/heading-node";
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
} from "@/lib/vault";
import {
	type CenterViewMode,
	isHtmlPath,
	isPdfPath,
	preferredModeForPath,
} from "@/lib/viewer";

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
	...MarkdownKit,
];

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
	const sidebarPanelRef = usePanelRef();
	const editorPaneRef = useRef<HTMLTextAreaElement>(null);
	const previewPaneRef = useRef<HTMLDivElement>(null);
	const sidebarAsideRef = useRef<HTMLElement>(null);

	const debouncedMarkdown = useDebounce(markdown, 300);
	const debouncedPaperNotes = useDebounce(paperNotes, 200);
	const isDemo = vaultPath === null;
	const showNotesOnRight = centerMode === "pdf" || centerMode === "html";

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

	const toggleSidebar = useCallback(() => {
		const panel = sidebarPanelRef.current;
		if (!panel) return;
		if (panel.isCollapsed()) panel.expand();
		else panel.collapse();
	}, [sidebarPanelRef]);

	const expandSidebar = useCallback(() => {
		const panel = sidebarPanelRef.current;
		if (!panel) return;
		if (panel.isCollapsed()) panel.expand();
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
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}, []);

	const handleRefresh = useCallback(() => {
		if (vaultPath) void refreshTree(vaultPath);
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
		})();

		return () => {
			cancelled = true;
			for (const unsub of unsubs) unsub();
		};
	}, [handleOpenVault, handleRefresh, openSettings, toggleSidebar]);

	const editor = usePlateEditor({
		plugins: platePlugins,
		value: (ed) => ed.getApi(MarkdownPlugin).markdown.deserialize(markdown),
	});

	const notesEditor = usePlateEditor({
		plugins: platePlugins,
		value: (ed) =>
			ed.getApi(MarkdownPlugin).markdown.deserialize(paperNotes || " "),
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
		const value = editor
			.getApi(MarkdownPlugin)
			.markdown.deserialize(debouncedMarkdown);
		editor.tf.reset();
		editor.tf.setValue(value);
	}, [debouncedMarkdown, editor]);

	useEffect(() => {
		const value = notesEditor
			.getApi(MarkdownPlugin)
			.markdown.deserialize(debouncedPaperNotes || " ");
		notesEditor.tf.reset();
		notesEditor.tf.setValue(value);
	}, [debouncedPaperNotes, notesEditor]);

	const handleUseDemo = () => {
		saveVaultPath(null);
		setVaultPath(null);
		setSelectedPath(DEMO_NOTES);
		setMarkdown(getDemoTextContent(DEMO_NOTES) ?? defaultMarkdown);
		setError(null);
		setTree(getDemoTree());
		setCenterMode("markdown");
	};

	const handleSelectFile = async (node: FileNode) => {
		if (node.kind !== "file") return;
		setSelectedPath(node.path);
		setError(null);

		const mode = preferredModeForPath(node.path);
		setCenterMode(mode);

		// Opening PDF/HTML: center shows viewer; notes load via paperDir effect
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
	};

	const handleCenterModeChange = (mode: CenterViewMode) => {
		if (!modeAvailable[mode]) return;
		setCenterMode(mode);
	};

	const activeFileLabel = selectedPath
		? selectedPath.split(/[\\/]/).pop()
		: "Untitled";

	const editorFontSize = settings.editorFontSize;

	return (
		<div className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-background text-foreground">
			<ResizableGroup
				orientation="horizontal"
				className="h-full min-h-0 flex-1 overflow-hidden"
			>
				<ResizablePanel
					id="sidebar"
					panelRef={sidebarPanelRef}
					defaultSize={240}
					minSize={160}
					maxSize={420}
					collapsible
					collapsedSize={0}
					className="min-h-0 overflow-hidden"
					onResize={() => {
						const collapsed = sidebarPanelRef.current?.isCollapsed() ?? false;
						setSidebarCollapsed(collapsed);
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
					defaultSize="40"
					minSize={200}
					className="min-h-0 overflow-hidden"
				>
					<div
						ref={previewPaneRef}
						className="flex h-full min-h-0 flex-col overflow-hidden"
						style={{ fontSize: editorFontSize }}
					>
						<PaneHeader>
							<span className="font-medium text-sm">
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
										/>
									</EditorContainer>
								</Plate>
							)}
						</div>
					</div>
				</ResizablePanel>
			</ResizableGroup>

			<SettingsWindow
				open={settingsOpen}
				section={settingsSection}
				onSectionChange={setSettingsSection}
				onClose={closeSettings}
				settings={settings}
				onChange={updateSettings}
			/>
		</div>
	);
}
