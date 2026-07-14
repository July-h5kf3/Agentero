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
import { Plate, usePlateEditor } from "platejs/react";
import { useCallback, useEffect, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { MarkdownKit } from "@/components/editor/plugins/markdown-kit";
import { FileTree, VaultSidebarHeader } from "@/components/file-tree/file-tree";
import {
	ResizableGroup,
	ResizableHandle,
	ResizablePanel,
} from "@/components/layout/resizable";
import { BlockquoteElement } from "@/components/ui/blockquote-node";
import { Editor, EditorContainer } from "@/components/ui/editor";
import { H1Element, H2Element, H3Element } from "@/components/ui/heading-node";
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
	const [markdown, setMarkdown] = useState(
		() => localStorage.getItem(STORAGE_KEY) ?? defaultMarkdown,
	);
	const [vaultPath, setVaultPath] = useState<string | null>(() =>
		isTauri() ? getSavedVaultPath() : null,
	);
	const [tree, setTree] = useState<FileNode[]>(() => getDemoTree());
	const [selectedPath, setSelectedPath] = useState<string | null>(() =>
		localStorage.getItem(OPEN_FILE_KEY),
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const sidebarPanelRef = usePanelRef();

	const debouncedMarkdown = useDebounce(markdown, 300);
	const isDemo = vaultPath === null;

	const toggleSidebar = useCallback(() => {
		const panel = sidebarPanelRef.current;
		if (!panel) return;
		if (panel.isCollapsed()) panel.expand();
		else panel.collapse();
	}, [sidebarPanelRef]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
				event.preventDefault();
				toggleSidebar();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [toggleSidebar]);

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

	const handleOpenVault = async () => {
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
	};

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
					<aside className="flex h-full min-h-0 flex-col border-r bg-muted/20">
						<VaultSidebarHeader
							title={vaultDisplayName(vaultPath)}
							onOpenVault={() => void handleOpenVault()}
							onRefresh={() => {
								if (vaultPath) void refreshTree(vaultPath);
							}}
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
							className="min-h-0 flex-1 resize-none bg-muted/30 p-4 font-mono text-sm outline-none"
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
					<div className="flex h-full min-h-0 flex-col">
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
		</div>
	);
}
