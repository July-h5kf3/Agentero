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
import { type AppSettings, loadSettings, saveSettings } from "@/lib/settings";
import { resolveShortcutId } from "@/lib/shortcuts";
import { isTauri } from "@/lib/tauri";
import {
	type FileNode,
	getDemoTree,
	getSavedVaultPath,
	isTextOpenable,
	loadVaultTree,
	pickVaultDirectory,
	readVaultFile,
	saveVaultPath,
	vaultDisplayName,
} from "@/lib/vault";

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

export default function App() {
	const { setTheme } = useTheme();
	const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [settingsSection, setSettingsSection] =
		useState<SettingsSection>("general");
	const settingsOpenRef = useRef(settingsOpen);
	settingsOpenRef.current = settingsOpen;

	const [markdown, setMarkdown] = useState(
		() => localStorage.getItem(STORAGE_KEY) ?? defaultMarkdown,
	);
	const [vaultPath, setVaultPath] = useState<string | null>(() => {
		const s = loadSettings();
		if (!isTauri()) return null;
		if (!s.restoreLastVault) return null;
		return getSavedVaultPath();
	});
	const [tree, setTree] = useState<FileNode[]>(() => getDemoTree());
	const [selectedPath, setSelectedPath] = useState<string | null>(() =>
		localStorage.getItem(OPEN_FILE_KEY),
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const sidebarPanelRef = usePanelRef();
	const editorPaneRef = useRef<HTMLTextAreaElement>(null);
	const previewPaneRef = useRef<HTMLDivElement>(null);
	const sidebarAsideRef = useRef<HTMLElement>(null);

	const debouncedMarkdown = useDebounce(markdown, 300);
	const isDemo = vaultPath === null;

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
		plugins: [
			BoldPlugin,
			ItalicPlugin,
			UnderlinePlugin,
			H1Plugin.withComponent(H1Element),
			H2Plugin.withComponent(H2Element),
			H3Plugin.withComponent(H3Element),
			BlockquotePlugin.withComponent(BlockquoteElement),
			...MarkdownKit,
		],
		value: (ed) => ed.getApi(MarkdownPlugin).markdown.deserialize(markdown),
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

	const handleUseDemo = () => {
		saveVaultPath(null);
		setVaultPath(null);
		setSelectedPath(null);
		setError(null);
		setTree(getDemoTree());
	};

	const handleSelectFile = async (node: FileNode) => {
		if (node.kind !== "file") return;
		setSelectedPath(node.path);

		if (!isTextOpenable(node.path)) {
			setError(`Cannot preview this file type: ${node.name}`);
			return;
		}

		setBusy(true);
		setError(null);
		try {
			const content = await readVaultFile(node.path);
			setMarkdown(content);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	const activeFileLabel = selectedPath
		? selectedPath.split(/[\\/]/).pop()
		: "Untitled";

	const editorFontSize = settings.editorFontSize;

	return (
		<div className="flex h-screen flex-col bg-background text-foreground">
			<ResizableGroup orientation="horizontal" className="min-h-0 flex-1">
				<ResizablePanel
					id="sidebar"
					panelRef={sidebarPanelRef}
					defaultSize={240}
					minSize={160}
					maxSize={420}
					collapsible
					collapsedSize={0}
					className="min-h-0"
					onResize={() => {
						const collapsed = sidebarPanelRef.current?.isCollapsed() ?? false;
						setSidebarCollapsed(collapsed);
					}}
				>
					<aside
						ref={sidebarAsideRef}
						className="flex h-full min-h-0 flex-col bg-muted/20"
					>
						<VaultSidebarHeader
							title={vaultDisplayName(vaultPath)}
							onOpenVault={() => void handleOpenVault()}
							onRefresh={handleRefresh}
							onUseDemo={handleUseDemo}
							busy={busy}
							error={error}
							isDemo={isDemo}
						/>
						<div className="min-h-0 flex-1 overflow-y-auto px-1">
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
					className="min-h-0"
				>
					<div className="flex h-full min-h-0 flex-col">
						<div className="flex items-center justify-between border-b px-4 py-2 text-sm">
							<span className="font-medium">Markdown</span>
							<span className="max-w-[50%] truncate text-muted-foreground text-xs">
								{activeFileLabel}
							</span>
						</div>
						<textarea
							ref={editorPaneRef}
							className="min-h-0 flex-1 resize-none bg-muted/30 p-4 font-mono outline-none"
							style={{ fontSize: editorFontSize }}
							value={markdown}
							onChange={(event) => setMarkdown(event.target.value)}
							placeholder="Type Markdown here..."
							spellCheck={false}
						/>
					</div>
				</ResizablePanel>

				<ResizableHandle />

				<ResizablePanel
					id="preview"
					defaultSize="40"
					minSize={200}
					className="min-h-0"
				>
					<div
						ref={previewPaneRef}
						className="flex h-full min-h-0 flex-col"
						style={{ fontSize: editorFontSize }}
					>
						<div className="border-b px-4 py-2 font-medium text-sm">
							Preview
						</div>
						<Plate editor={editor}>
							<EditorContainer className="min-h-0 flex-1 overflow-y-auto">
								<Editor placeholder="Rendered Markdown will appear here..." />
							</EditorContainer>
						</Plate>
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
