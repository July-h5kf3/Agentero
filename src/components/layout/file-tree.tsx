import { useVirtualizer } from "@tanstack/react-virtual";
import {
	Download,
	FileCode2,
	FileImage,
	FileJson,
	FilePlus2,
	FileText,
	FileType2,
	FileUp,
	FolderInput,
	FolderPlus,
	Library,
	Loader2,
	ScrollText,
	Trash2,
	Upload,
	WandSparkles,
	X,
	Zap,
} from "lucide-react";
import {
	type DragEvent as ReactDragEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
	FileTree as AiFileTree,
	FileTreeActions,
	FileTreeFile,
	FileTreeFolderRow,
	FileTreeIcon,
	FileTreeName,
} from "@/components/ai-elements/file-tree";
import { PaneHeader } from "@/components/layout/pane-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	isPaperDirectory,
	isPapersRoot,
	type PaperMetadata,
	paperAssetDownloadReasons,
	paperNeedsAssetDownload,
	paperNeedsRead,
} from "@/lib/paper-metadata";
import { LIBRARY_VIRTUAL_PATH } from "@/lib/papers-api";
import {
	openInTerminal,
	revealInFileManager,
	revealInOsLabelKey,
} from "@/lib/reveal";
import { formatShortcut, SHORTCUTS } from "@/lib/shortcuts";
import { isTauri } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { FileNode } from "@/lib/vault";

/** Paper folders that need Download (no PDF / no source / no PAPER.md). */
function collectPapersNeedingAssets(nodes: FileNode[]): FileNode[] {
	const out: FileNode[] = [];
	const walk = (list: FileNode[]) => {
		for (const n of list) {
			if (n.kind === "directory" && isPaperDirectory(n.path, n.children)) {
				if (paperNeedsAssetDownload(n)) {
					out.push(n);
				}
			} else if (n.children?.length) {
				walk(n.children);
			}
		}
	};
	walk(nodes);
	return out;
}

const DOWNLOAD_REASON_KEYS = {
	noPdf: "fileTree.downloadReason.noPdf",
	noBody: "fileTree.downloadReason.noBody",
} as const;

export type TreeCreateKind = "file" | "folder";

export type TreeCreateDraft = {
	kind: TreeCreateKind;
	/** Absolute path of the parent directory (vault root or folder). */
	parentPath: string;
};

/** One flattened, windowable tree row in display order. */
type FlatRow =
	| { key: string; kind: "library" }
	| { key: string; kind: "create"; depth: number }
	| {
			key: string;
			kind: "node";
			depth: number;
			node: FileNode;
			paperLeaf: boolean;
	  };

function isVirtualTreePath(path: string): boolean {
	return path === LIBRARY_VIRTUAL_PATH;
}

function AgenteroLogo({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 64 64"
			fill="none"
			aria-hidden="true"
			className={className}
		>
			<path
				d="M10 46 L10 18 L32 40 L54 18 L54 46"
				stroke="currentColor"
				strokeWidth="5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<circle cx="10" cy="18" r="4" fill="currentColor" />
			<circle cx="32" cy="40" r="4" fill="currentColor" />
			<circle cx="54" cy="18" r="4" fill="currentColor" />
		</svg>
	);
}

function fileIcon(name: string) {
	if (/\.pdf$/i.test(name)) return FileType2;
	if (/\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(name)) return FileImage;
	if (/\.json$/i.test(name)) return FileJson;
	if (/\.(ts|tsx|js|jsx|rs|toml)$/i.test(name)) return FileCode2;
	return FileText;
}

function pathKey(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/**
 * Default open folders when a Vault is first opened:
 * expand `papers/` and its first-level children (org folders) so papers one
 * level down are visible. Deeper nesting, `notes/`, etc. stay collapsed.
 * Paper folders are never expanded (they render as leaves).
 */
function collectDefaultExpanded(nodes: FileNode[], into: Set<string>) {
	for (const n of nodes) {
		if (n.kind !== "directory" || !isPapersRoot(n.path)) continue;
		into.add(n.path);
		for (const child of n.children ?? []) {
			if (child.kind !== "directory") continue;
			// Paper units are leaves — expanding them is a no-op for the UI.
			if (isPaperDirectory(child.path, child.children)) continue;
			into.add(child.path);
		}
		return;
	}
}

/** Parent directory paths of `target` (absolute), nearest-first excluded. Root-ward order. */
function ancestorPaths(target: string, vaultRoot: string | null): string[] {
	const norm = target.replace(/\\/g, "/").replace(/\/+$/, "");
	const rootKey = vaultRoot ? pathKey(vaultRoot) : null;
	const out: string[] = [];
	let current = norm;
	while (true) {
		const idx = current.lastIndexOf("/");
		if (idx <= 0) break;
		current = current.slice(0, idx);
		if (rootKey && pathKey(current) === rootKey) break;
		if (current) out.push(current);
	}
	return out.reverse();
}

/** Inline name input — VS Code / Cursor style create. */
function TreeCreateInput({
	kind,
	onConfirm,
	onCancel,
}: {
	kind: TreeCreateKind;
	onConfirm: (name: string) => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation("sidebar");
	const defaultName = kind === "file" ? "Untitled.md" : "New Folder";
	const [value, setValue] = useState(defaultName);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const committedRef = useRef(false);

	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.focus();
		// Select basename without extension for files (IDE-like).
		if (kind === "file") {
			const dot = defaultName.lastIndexOf(".");
			if (dot > 0) el.setSelectionRange(0, dot);
			else el.select();
		} else {
			el.select();
		}
	}, [kind, defaultName]);

	const commit = useCallback(() => {
		if (committedRef.current) return;
		const name = value.trim();
		if (!name) {
			committedRef.current = true;
			onCancel();
			return;
		}
		if (name === "." || name === ".." || /[\\/]/.test(name)) {
			setError(t("fileTree.invalidName"));
			// Keep editing; re-focus next tick.
			requestAnimationFrame(() => inputRef.current?.focus());
			return;
		}
		committedRef.current = true;
		onConfirm(name);
	}, [value, onCancel, onConfirm, t]);

	const cancel = useCallback(() => {
		if (committedRef.current) return;
		committedRef.current = true;
		onCancel();
	}, [onCancel]);

	const Icon = kind === "file" ? FileText : FolderPlus;

	return (
		<div className="flex flex-col gap-0.5 py-0.5">
			<div
				className={cn(
					"flex items-center gap-1 rounded px-2 py-1",
					error ? "bg-destructive/10" : "bg-muted/60",
				)}
			>
				<span className="size-4 shrink-0" aria-hidden />
				<Icon className="size-4 shrink-0 text-muted-foreground" />
				<input
					ref={inputRef}
					type="text"
					value={value}
					aria-label={
						kind === "file" ? t("fileTree.newFile") : t("fileTree.newFolder")
					}
					aria-invalid={Boolean(error)}
					className={cn(
						"min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 py-0.5 text-sm outline-none",
						error && "border-destructive",
					)}
					onChange={(e) => {
						setValue(e.target.value);
						if (error) setError(null);
					}}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Enter") {
							e.preventDefault();
							commit();
						} else if (e.key === "Escape") {
							e.preventDefault();
							cancel();
						}
					}}
					onBlur={() => {
						// Defer so Enter/click handlers run first.
						requestAnimationFrame(() => {
							if (!committedRef.current) commit();
						});
					}}
				/>
			</div>
			{error ? (
				<p className="px-8 text-destructive text-[11px] leading-tight">
					{error}
				</p>
			) : null}
		</div>
	);
}

type FileTreeProps = {
	nodes: FileNode[];
	selectedPath: string | null;
	/** Vault root absolute path — used as create parent for root-level entries. */
	vaultPath: string | null;
	createDraft: TreeCreateDraft | null;
	onConfirmCreate: (name: string) => void;
	onCancelCreate: () => void;
	/** Called for normal files and for paper folders (collapsed leaves). */
	onSelectFile: (node: FileNode) => void;
	/** Virtual library node → papers table in center pane. */
	onSelectLibrary?: () => void;
	/** Download PDF (+ TeX if arXiv); no TeX → liteparse PAPER.md. */
	onDownloadPaperAssets?: (paperNode: FileNode) => Promise<void>;
	/**
	 * @deprecated No longer used for Download visibility (kept for App prop compat).
	 */
	arxivPaperRelPaths?: ReadonlySet<string>;
	/** Download missing assets for every incomplete paper (Library row). */
	onDownloadAllMissingAssets?: () => Promise<void>;
	/**
	 * Catalog paper rows keyed by vault-relative path (for `is_read` / read trigger).
	 * Paths normalized without leading/trailing slashes.
	 */
	paperMetaByRelPath?: ReadonlyMap<string, PaperMetadata>;
	/** Start paper-reader workflow for a paper folder with complete local assets. */
	onReadPaper?: (paperNode: FileNode) => Promise<void>;
	/** Delete a real tree path (file / folder / paper). Parent confirms + performs IO. */
	onDeletePath?: (path: string) => void | Promise<void>;
	/** Batch delete multiple real tree paths (one confirm). */
	onDeletePaths?: (paths: string[]) => void | Promise<void>;
	/** Batch move: parent opens a destination picker for these paths. */
	onMovePaths?: (paths: string[]) => void;
	/** Drag-and-drop move: relocate paths into an existing folder (no dialog). */
	onMoveTo?: (paths: string[], destParentRel: string) => void;
	className?: string;
};

type TreeContextMenu = {
	path: string;
	x: number;
	y: number;
};

export function FileTree({
	nodes,
	selectedPath,
	vaultPath,
	createDraft,
	onConfirmCreate,
	onCancelCreate,
	onSelectFile,
	onSelectLibrary,
	onDownloadPaperAssets,
	onDownloadAllMissingAssets,
	paperMetaByRelPath,
	onReadPaper,
	onDeletePath,
	onDeletePaths,
	onMovePaths,
	onMoveTo,
	className,
}: FileTreeProps) {
	const { t } = useTranslation("sidebar");
	const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
	const [downloadingAll, setDownloadingAll] = useState(false);
	const [readingPath, setReadingPath] = useState<string | null>(null);
	const [contextMenu, setContextMenu] = useState<TreeContextMenu | null>(null);
	const [revealError, setRevealError] = useState<string | null>(null);
	const contextMenuRef = useRef<HTMLDivElement>(null);
	const [expanded, setExpanded] = useState<Set<string>>(() => {
		const open = new Set<string>();
		collectDefaultExpanded(nodes, open);
		return open;
	});

	/**
	 * Apply default expansion once per Vault open (when tree first has nodes).
	 * Do not reset on every tree refresh — that would collapse user-expanded folders
	 * and wipe ancestors opened for scroll-into-view.
	 */
	const defaultAppliedForVaultRef = useRef<string | null>(null);
	useEffect(() => {
		if (!vaultPath) {
			defaultAppliedForVaultRef.current = null;
			setExpanded(new Set());
			return;
		}
		if (defaultAppliedForVaultRef.current === vaultPath) return;
		if (nodes.length === 0) return;
		const open = new Set<string>();
		collectDefaultExpanded(nodes, open);
		setExpanded(open);
		defaultAppliedForVaultRef.current = vaultPath;
	}, [vaultPath, nodes]);

	// Expand parent folder when starting inline create (IDE-like).
	useEffect(() => {
		if (!createDraft || !vaultPath) return;
		const parent = createDraft.parentPath;
		if (pathKey(parent) === pathKey(vaultPath)) return;
		setExpanded((prev) => {
			if (prev.has(parent)) return prev;
			const next = new Set(prev);
			next.add(parent);
			return next;
		});
	}, [createDraft, vaultPath]);

	const byPath = useMemo(() => {
		const map = new Map<string, FileNode>();
		const walk = (list: FileNode[]) => {
			for (const n of list) {
				map.set(n.path, n);
				if (n.children) walk(n.children);
			}
		};
		walk(nodes);
		return map;
	}, [nodes]);

	/** Case-insensitive path → node (for selection resolve / ancestor expand). */
	const byPathKey = useMemo(() => {
		const map = new Map<string, FileNode>();
		const walk = (list: FileNode[]) => {
			for (const n of list) {
				map.set(pathKey(n.path), n);
				if (n.children) walk(n.children);
			}
		};
		walk(nodes);
		return map;
	}, [nodes]);

	const relPathForNode = useCallback(
		(absPath: string): string => {
			if (!vaultPath) return absPath.replace(/\\/g, "/");
			const root = vaultPath.replace(/\\/g, "/").replace(/\/+$/, "");
			const norm = absPath.replace(/\\/g, "/");
			if (norm === root) return "";
			const prefix = `${root}/`;
			if (norm.startsWith(prefix)) {
				return norm.slice(prefix.length).replace(/^\/+|\/+$/g, "");
			}
			return norm.replace(/^\/+|\/+$/g, "");
		},
		[vaultPath],
	);

	/**
	 * Row to highlight / scroll to:
	 * - virtual Library as-is;
	 * - any path under a paper folder → that paper (papers are tree leaves);
	 * - otherwise the path itself if present, else nearest existing ancestor.
	 */
	const treeSelectedPath = useMemo(() => {
		if (!selectedPath) return undefined;
		if (isVirtualTreePath(selectedPath)) return selectedPath;

		// Prefer paper folder: children of papers are not listed in the tree.
		let cursor = selectedPath.replace(/\\/g, "/").replace(/\/+$/, "");
		while (cursor) {
			const node = byPathKey.get(pathKey(cursor));
			if (
				node &&
				node.kind === "directory" &&
				isPaperDirectory(node.path, node.children)
			) {
				return node.path;
			}
			const idx = cursor.lastIndexOf("/");
			if (idx <= 0) break;
			cursor = cursor.slice(0, idx);
		}

		const exact = byPathKey.get(pathKey(selectedPath));
		if (exact) return exact.path;

		// Deleted / not-yet-in-tree: nearest existing ancestor.
		cursor = selectedPath.replace(/\\/g, "/").replace(/\/+$/, "");
		while (true) {
			const idx = cursor.lastIndexOf("/");
			if (idx <= 0) break;
			cursor = cursor.slice(0, idx);
			const node = byPathKey.get(pathKey(cursor));
			if (node) return node.path;
		}
		return selectedPath;
	}, [selectedPath, byPathKey]);

	// ---- Multi-selection (Ctrl/Cmd/Shift click) -----------------------------
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [anchor, setAnchor] = useState<string | null>(null);

	// Reset the multi-selection whenever the tree changes (post delete/move).
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on nodes change
	useEffect(() => {
		setSelected(new Set());
		setAnchor(null);
	}, [nodes]);

	/** Visible, selectable rows in display order (paper folders are leaves). */
	const selectableOrder = useMemo(() => {
		const out: string[] = [];
		const walk = (list: FileNode[]) => {
			for (const n of list) {
				out.push(n.path);
				if (
					n.kind === "directory" &&
					!isPaperDirectory(n.path, n.children) &&
					expanded.has(n.path) &&
					n.children?.length
				) {
					walk(n.children);
				}
			}
		};
		walk(nodes);
		return out;
	}, [nodes, expanded]);

	/** Flattened rows in display order (respects expand state + inline drafts). */
	const flatRows = useMemo<FlatRow[]>(() => {
		const out: FlatRow[] = [{ key: "__library__", kind: "library" }];
		const draftAt = (parent: string) =>
			Boolean(
				createDraft && pathKey(createDraft.parentPath) === pathKey(parent),
			);
		if (vaultPath && draftAt(vaultPath)) {
			out.push({ key: "__create_root__", kind: "create", depth: 0 });
		}
		const walk = (list: FileNode[], depth: number) => {
			for (const n of list) {
				const paper =
					n.kind === "directory" && isPaperDirectory(n.path, n.children);
				out.push({ key: n.id, kind: "node", depth, node: n, paperLeaf: paper });
				if (n.kind === "directory" && draftAt(n.path)) {
					out.push({
						key: `create-${n.path}`,
						kind: "create",
						depth: depth + 1,
					});
				}
				if (
					n.kind === "directory" &&
					!paper &&
					expanded.has(n.path) &&
					n.children?.length
				) {
					walk(n.children, depth + 1);
				}
			}
		};
		walk(nodes, 0);
		return out;
	}, [nodes, expanded, createDraft, vaultPath]);

	const treeScrollRef = useRef<HTMLDivElement>(null);
	const rowVirtualizer = useVirtualizer({
		count: flatRows.length,
		getScrollElement: () => treeScrollRef.current,
		estimateSize: () => 28,
		overscan: 15,
	});

	/**
	 * When the active document changes, expand ancestor folders so the matching
	 * tree row is visible, then scroll it into view (IDE-style reveal).
	 */
	const pendingRevealPathRef = useRef<string | null>(null);
	useEffect(() => {
		if (!treeSelectedPath) return;
		pendingRevealPathRef.current = treeSelectedPath;

		if (isVirtualTreePath(treeSelectedPath)) return;

		const parents = ancestorPaths(treeSelectedPath, vaultPath);
		if (parents.length === 0) return;

		setExpanded((prev) => {
			let changed = false;
			const next = new Set(prev);
			for (const parent of parents) {
				const node = byPathKey.get(pathKey(parent));
				if (node?.kind !== "directory") continue;
				// Paper folders stay leaves — never expand them.
				if (isPaperDirectory(node.path, node.children)) continue;
				if (!next.has(node.path)) {
					next.add(node.path);
					changed = true;
				}
			}
			return changed ? next : prev;
		});
	}, [treeSelectedPath, vaultPath, byPathKey]);

	// treeSelectedPath: re-run when selection changes even if flatRows is unchanged
	// (path already visible / ancestors already expanded).
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
	useEffect(() => {
		const target = pendingRevealPathRef.current;
		if (!target) return;

		const targetKey = pathKey(target);
		const idx = flatRows.findIndex((row) => {
			if (row.kind === "library") return target === LIBRARY_VIRTUAL_PATH;
			if (row.kind === "node") return pathKey(row.node.path) === targetKey;
			return false;
		});
		if (idx < 0) return;

		pendingRevealPathRef.current = null;
		// Defer one frame so virtualizer sees updated row count after expand.
		requestAnimationFrame(() => {
			rowVirtualizer.scrollToIndex(idx, { align: "auto", behavior: "smooth" });
		});
	}, [flatRows, rowVirtualizer, treeSelectedPath]);

	const clearSelection = useCallback(() => {
		setSelected(new Set());
		setAnchor(null);
	}, []);

	const openRow = useCallback(
		(path: string) => {
			if (path === LIBRARY_VIRTUAL_PATH) {
				onSelectLibrary?.();
				return;
			}
			const node = byPath.get(path);
			if (!node) return;
			if (node.kind === "file" || isPaperDirectory(node.path, node.children)) {
				onSelectFile(node);
			}
		},
		[byPath, onSelectFile, onSelectLibrary],
	);

	const handleSelectRow = useCallback(
		(path: string, mods: { meta: boolean; ctrl: boolean; shift: boolean }) => {
			if (createDraft) return;
			if (isVirtualTreePath(path)) {
				clearSelection();
				openRow(path);
				return;
			}
			if (mods.shift && anchor) {
				const a = selectableOrder.indexOf(anchor);
				const b = selectableOrder.indexOf(path);
				if (a !== -1 && b !== -1) {
					const [lo, hi] = a <= b ? [a, b] : [b, a];
					setSelected(new Set(selectableOrder.slice(lo, hi + 1)));
					return;
				}
			}
			if (mods.meta || mods.ctrl) {
				setSelected((prev) => {
					const next = new Set(prev);
					// Fold the current open/anchored row into a fresh multi-selection
					// so the count matches the highlighted rows.
					if (
						next.size === 0 &&
						anchor &&
						anchor !== path &&
						selectableOrder.includes(anchor)
					) {
						next.add(anchor);
					}
					if (next.has(path)) next.delete(path);
					else next.add(path);
					return next;
				});
				setAnchor(path);
				return;
			}
			// Plain click: drop any multi-selection and open the row.
			setSelected(new Set());
			setAnchor(path);
			openRow(path);
		},
		[anchor, clearSelection, createDraft, openRow, selectableOrder],
	);

	const orderedSelected = useCallback(
		() => selectableOrder.filter((p) => selected.has(p)),
		[selectableOrder, selected],
	);

	const runBatchDelete = useCallback(() => {
		const paths = orderedSelected();
		if (paths.length === 0) return;
		if (onDeletePaths) void onDeletePaths(paths);
		else if (onDeletePath && paths[0]) void onDeletePath(paths[0]);
	}, [orderedSelected, onDeletePaths, onDeletePath]);

	const runBatchMove = useCallback(() => {
		const paths = orderedSelected();
		if (paths.length === 0 || !onMovePaths) return;
		onMovePaths(paths);
	}, [orderedSelected, onMovePaths]);

	/** Context-menu action target: the whole selection when the row is in it. */
	const menuTargets = useCallback(
		(path: string): string[] =>
			selected.has(path) && selected.size > 0 ? orderedSelected() : [path],
		[selected, orderedSelected],
	);

	// Delete / clear the multi-selection via the keyboard.
	useEffect(() => {
		if (selected.size === 0) return;
		const onKey = (e: KeyboardEvent) => {
			const el = e.target as HTMLElement | null;
			if (
				el &&
				(el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
			) {
				return;
			}
			if (e.key === "Escape") {
				clearSelection();
			} else if (
				e.key === "Delete" ||
				(e.key === "Backspace" && (e.metaKey || e.ctrlKey))
			) {
				e.preventDefault();
				runBatchDelete();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [selected.size, clearSelection, runBatchDelete]);

	// ---- Drag and drop to move into a papers/ folder -------------------------
	const [dragging, setDragging] = useState<string[] | null>(null);
	const [dropTarget, setDropTarget] = useState<string | null>(null);

	/** A row is a valid drop target only if it is an org folder under papers/. */
	const canDrop = useCallback(
		(targetPath: string, paths: string[]): boolean => {
			if (paths.length === 0 || isVirtualTreePath(targetPath)) return false;
			const node = byPath.get(targetPath);
			if (node?.kind !== "directory") return false;
			if (isPaperDirectory(node.path, node.children)) return false;
			const rel = relPathForNode(targetPath);
			if (rel !== "papers" && !rel.startsWith("papers/")) return false;
			const norm = targetPath.replace(/\\/g, "/").replace(/\/+$/, "");
			return !paths.some((d) => {
				const dn = d.replace(/\\/g, "/").replace(/\/+$/, "");
				return norm === dn || norm.startsWith(`${dn}/`);
			});
		},
		[byPath, relPathForNode],
	);

	const handleRowDragStart = useCallback(
		(path: string, e: ReactDragEvent) => {
			if (createDraft || isVirtualTreePath(path)) {
				e.preventDefault();
				return;
			}
			const paths =
				selected.has(path) && selected.size > 0 ? orderedSelected() : [path];
			setDragging(paths);
			e.dataTransfer.effectAllowed = "move";
			try {
				e.dataTransfer.setData("text/plain", paths.join("\n"));
			} catch {
				// some webviews restrict setData; state still drives the drop
			}
		},
		[createDraft, selected, orderedSelected],
	);

	const handleRowDragOver = useCallback(
		(path: string, e: ReactDragEvent) => {
			if (dragging && canDrop(path, dragging)) {
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				if (dropTarget !== path) setDropTarget(path);
			} else if (dropTarget) {
				setDropTarget(null);
			}
		},
		[dragging, dropTarget, canDrop],
	);

	const handleRowDrop = useCallback(
		(path: string, e: ReactDragEvent) => {
			e.preventDefault();
			const paths = dragging;
			setDragging(null);
			setDropTarget(null);
			if (!paths || !onMoveTo || !canDrop(path, paths)) return;
			const dest = relPathForNode(path) || "papers";
			onMoveTo(paths, dest);
		},
		[dragging, onMoveTo, canDrop, relPathForNode],
	);

	const handleRowDragEnd = useCallback(() => {
		setDragging(null);
		setDropTarget(null);
	}, []);

	const createRow =
		createDraft && vaultPath ? (
			<TreeCreateInput
				key={`create-${createDraft.kind}-${createDraft.parentPath}`}
				kind={createDraft.kind}
				onConfirm={onConfirmCreate}
				onCancel={onCancelCreate}
			/>
		) : null;

	const papersNeedingAssets = useMemo(
		() => collectPapersNeedingAssets(nodes),
		[nodes],
	);
	const showLibraryDownload =
		Boolean(onDownloadAllMissingAssets) && papersNeedingAssets.length > 0;
	const libraryBusy = downloadingAll || Boolean(downloadingPath);

	const handleDownload = useCallback(
		async (node: FileNode) => {
			if (!onDownloadPaperAssets || downloadingPath || downloadingAll) return;
			setDownloadingPath(node.path);
			try {
				await onDownloadPaperAssets(node);
			} finally {
				setDownloadingPath(null);
			}
		},
		[onDownloadPaperAssets, downloadingPath, downloadingAll],
	);

	const handleDownloadAll = useCallback(async () => {
		if (!onDownloadAllMissingAssets || downloadingAll || downloadingPath)
			return;
		setDownloadingAll(true);
		try {
			await onDownloadAllMissingAssets();
		} finally {
			setDownloadingAll(false);
		}
	}, [onDownloadAllMissingAssets, downloadingAll, downloadingPath]);

	const handleReadPaper = useCallback(
		async (node: FileNode) => {
			if (!onReadPaper || readingPath || downloadingPath || downloadingAll)
				return;
			setReadingPath(node.path);
			try {
				await onReadPaper(node);
			} finally {
				setReadingPath(null);
			}
		},
		[onReadPaper, readingPath, downloadingPath, downloadingAll],
	);

	const canRevealPath = useCallback((path: string) => {
		return Boolean(path) && !path.startsWith("agentero:");
	}, []);

	const handleReveal = useCallback(
		async (path: string) => {
			setContextMenu(null);
			if (!canRevealPath(path)) return;
			if (!isTauri()) {
				setRevealError(t("fileTree.revealDesktopOnly"));
				return;
			}
			setRevealError(null);
			try {
				await revealInFileManager(path);
			} catch {
				setRevealError(t("fileTree.revealFailed"));
			}
		},
		[canRevealPath, t],
	);

	const handleOpenInTerminal = useCallback(
		async (path: string) => {
			setContextMenu(null);
			if (!canRevealPath(path)) return;
			if (!isTauri()) {
				setRevealError(t("fileTree.openInTerminalDesktopOnly"));
				return;
			}
			setRevealError(null);
			try {
				await openInTerminal(path);
			} catch {
				setRevealError(t("fileTree.openInTerminalFailed"));
			}
		},
		[canRevealPath, t],
	);

	const handleContextMenuPath = useCallback(
		(path: string, event: ReactMouseEvent) => {
			if (createDraft) return;
			if (!canRevealPath(path)) return;
			event.preventDefault();
			event.stopPropagation();
			setRevealError(null);
			setContextMenu({ path, x: event.clientX, y: event.clientY });
		},
		[canRevealPath, createDraft],
	);

	useEffect(() => {
		if (!contextMenu) return;
		const close = () => setContextMenu(null);
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") close();
		};
		const onPointer = (e: PointerEvent) => {
			const el = contextMenuRef.current;
			if (el && e.target instanceof Node && el.contains(e.target)) return;
			close();
		};
		// Defer so the opening contextmenu event does not immediately close.
		const timer = window.setTimeout(() => {
			window.addEventListener("pointerdown", onPointer, true);
			window.addEventListener("keydown", onKey, true);
			window.addEventListener("scroll", close, true);
			window.addEventListener("resize", close);
		}, 0);
		return () => {
			window.clearTimeout(timer);
			window.removeEventListener("pointerdown", onPointer, true);
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("scroll", close, true);
			window.removeEventListener("resize", close);
		};
	}, [contextMenu]);

	const revealLabel = t(revealInOsLabelKey());
	const revealShortcut = useMemo(() => {
		const def = SHORTCUTS.find((s) => s.id === "revealInFinder");
		return def ? formatShortcut(def) : "⌥⌘R";
	}, []);
	const openInTerminalShortcut = useMemo(() => {
		const def = SHORTCUTS.find((s) => s.id === "openInTerminal");
		return def ? formatShortcut(def) : "⌥⌘T";
	}, []);
	const deleteShortcut = useMemo(() => {
		const def = SHORTCUTS.find((s) => s.id === "deleteTreeItem");
		return def ? formatShortcut(def) : "⌘⌫";
	}, []);

	const handleDeleteFromMenu = useCallback(() => {
		if (!contextMenu) return;
		const targets = menuTargets(contextMenu.path);
		setContextMenu(null);
		if (targets.length > 1 && onDeletePaths) void onDeletePaths(targets);
		else if (onDeletePath && targets[0]) void onDeletePath(targets[0]);
	}, [contextMenu, menuTargets, onDeletePaths, onDeletePath]);

	const handleMoveFromMenu = useCallback(() => {
		if (!contextMenu || !onMovePaths) return;
		const targets = menuTargets(contextMenu.path);
		setContextMenu(null);
		onMovePaths(targets);
	}, [contextMenu, menuTargets, onMovePaths]);

	const menuCount = contextMenu ? menuTargets(contextMenu.path).length : 1;
	const contextMenuPortal =
		contextMenu && typeof document !== "undefined"
			? createPortal(
					<div
						ref={contextMenuRef}
						role="menu"
						className="fixed z-50 min-w-44 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
						style={{
							left: Math.min(contextMenu.x, window.innerWidth - 200),
							top: Math.min(contextMenu.y, window.innerHeight - 120),
						}}
					>
						{menuCount === 1 ? (
							<button
								type="button"
								role="menuitem"
								className="flex w-full cursor-default items-center justify-between gap-4 rounded-md px-2 py-1.5 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
								onClick={() => {
									void handleReveal(contextMenu.path);
								}}
							>
								<span>{revealLabel}</span>
								<span className="text-muted-foreground text-xs tracking-wide">
									{revealShortcut}
								</span>
							</button>
						) : null}
						{menuCount === 1 ? (
							<button
								type="button"
								role="menuitem"
								className="flex w-full cursor-default items-center justify-between gap-4 rounded-md px-2 py-1.5 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
								onClick={() => {
									void handleOpenInTerminal(contextMenu.path);
								}}
							>
								<span>{t("fileTree.openInTerminal")}</span>
								<span className="text-muted-foreground text-xs tracking-wide">
									{openInTerminalShortcut}
								</span>
							</button>
						) : null}
						{onMovePaths ? (
							<button
								type="button"
								role="menuitem"
								className="flex w-full cursor-default items-center gap-4 rounded-md px-2 py-1.5 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
								onClick={handleMoveFromMenu}
							>
								<span>
									{menuCount > 1
										? t("fileTree.moveSelected", { count: menuCount })
										: t("fileTree.move")}
								</span>
							</button>
						) : null}
						{onDeletePath || onDeletePaths ? (
							<button
								type="button"
								role="menuitem"
								className="flex w-full cursor-default items-center justify-between gap-4 rounded-md px-2 py-1.5 text-left text-sm text-destructive outline-hidden select-none hover:bg-destructive/10 focus:bg-destructive/10"
								onClick={handleDeleteFromMenu}
							>
								<span>
									{menuCount > 1
										? t("fileTree.deleteSelected", { count: menuCount })
										: t("fileTree.delete")}
								</span>
								{menuCount === 1 ? (
									<span className="text-xs tracking-wide opacity-80">
										{deleteShortcut}
									</span>
								) : null}
							</button>
						) : null}
					</div>,
					document.body,
				)
			: null;

	const libraryRow = (
		<FileTreeFile path={LIBRARY_VIRTUAL_PATH} name={t("papersLibrary.title")}>
			<span className="size-4 shrink-0" />
			<FileTreeIcon>
				<Library className="size-4 text-muted-foreground" />
			</FileTreeIcon>
			<FileTreeName className="min-w-0 flex-1 truncate">
				{t("papersLibrary.title")}
			</FileTreeName>
			{showLibraryDownload ? (
				<FileTreeActions
					className="shrink-0"
					onClick={(e) => e.stopPropagation()}
					onKeyDown={(e) => e.stopPropagation()}
				>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								className="size-6"
								aria-label={t("fileTree.downloadAllMissing")}
								disabled={libraryBusy}
								onClick={(e) => {
									e.stopPropagation();
									void handleDownloadAll();
								}}
							>
								{downloadingAll ? (
									<Loader2 className="size-3.5 animate-spin" />
								) : (
									<Download className="size-3.5" />
								)}
							</Button>
						</TooltipTrigger>
						<TooltipContent side="right" className="max-w-xs">
							{t("fileTree.downloadAllMissing")}
						</TooltipContent>
					</Tooltip>
				</FileTreeActions>
			) : null}
		</FileTreeFile>
	);

	const renderPaperRow = (node: FileNode): ReactNode => {
		const downloadReasons = paperAssetDownloadReasons(node);
		const showDownload =
			Boolean(onDownloadPaperAssets) && downloadReasons.length > 0;
		const rel = relPathForNode(node.path);
		const meta = paperMetaByRelPath?.get(rel) ?? null;
		const showRead =
			Boolean(onReadPaper) && !showDownload && paperNeedsRead(node, meta);
		const isDownloading = downloadingPath === node.path || downloadingAll;
		const isReading = readingPath === node.path;
		const rowBusy =
			isDownloading ||
			isReading ||
			Boolean(downloadingPath) ||
			downloadingAll ||
			Boolean(readingPath);
		const reasonTip = downloadReasons.length
			? downloadReasons.map((r) => t(DOWNLOAD_REASON_KEYS[r])).join(" · ")
			: t("fileTree.downloadAssets");
		const showActions = showDownload || showRead;
		return (
			<FileTreeFile path={node.path} name={node.name}>
				<span className="size-4 shrink-0" />
				<FileTreeIcon>
					<ScrollText className="size-4 text-muted-foreground" />
				</FileTreeIcon>
				<FileTreeName className="min-w-0 flex-1 truncate">
					{node.name}
				</FileTreeName>
				{showActions ? (
					<FileTreeActions
						className="shrink-0"
						onClick={(e) => {
							e.stopPropagation();
						}}
						onKeyDown={(e) => e.stopPropagation()}
					>
						{showDownload ? (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										className="size-6"
										aria-label={reasonTip}
										disabled={rowBusy}
										onClick={(e) => {
											e.stopPropagation();
											void handleDownload(node);
										}}
									>
										{isDownloading ? (
											<Loader2 className="size-3.5 animate-spin" />
										) : (
											<Download className="size-3.5" />
										)}
									</Button>
								</TooltipTrigger>
								<TooltipContent side="right" className="max-w-xs">
									<p className="font-medium">{t("fileTree.downloadAssets")}</p>
									<ul className="mt-1 list-disc space-y-0.5 pl-3 text-xs opacity-90">
										{downloadReasons.map((r) => (
											<li key={r}>{t(DOWNLOAD_REASON_KEYS[r])}</li>
										))}
									</ul>
								</TooltipContent>
							</Tooltip>
						) : null}
						{showRead ? (
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										className="size-6"
										aria-label={t("fileTree.readPaper")}
										disabled={rowBusy}
										onClick={(e) => {
											e.stopPropagation();
											void handleReadPaper(node);
										}}
									>
										{isReading ? (
											<Loader2 className="size-3.5 animate-spin" />
										) : (
											<Zap className="size-3.5" />
										)}
									</Button>
								</TooltipTrigger>
								<TooltipContent side="right" className="max-w-xs">
									<p className="font-medium">{t("fileTree.readPaper")}</p>
								</TooltipContent>
							</Tooltip>
						) : null}
					</FileTreeActions>
				) : null}
			</FileTreeFile>
		);
	};

	const renderNodeRow = (node: FileNode, paperLeaf: boolean): ReactNode => {
		if (paperLeaf) return renderPaperRow(node);
		if (node.kind === "directory") {
			return <FileTreeFolderRow path={node.path} name={node.name} />;
		}
		const Icon = fileIcon(node.name);
		return (
			<FileTreeFile
				path={node.path}
				name={node.name}
				icon={<Icon className="size-4 text-muted-foreground" />}
			/>
		);
	};

	return (
		<TooltipProvider delayDuration={300}>
			<div
				className={cn(
					"flex min-h-0 flex-1 flex-col select-none text-sm",
					className,
				)}
			>
				{selected.size > 0 ? (
					<div className="mb-1 flex shrink-0 items-center gap-1 border-b bg-muted/95 px-3 py-1.5">
						<span className="text-muted-foreground text-xs">
							{t("fileTree.selectedCount", { count: selected.size })}
						</span>
						<div className="ml-auto flex items-center gap-0.5">
							{onMovePaths ? (
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											className="size-6"
											aria-label={t("fileTree.moveSelected", {
												count: selected.size,
											})}
											onClick={runBatchMove}
										>
											<FolderInput className="size-3.5" />
										</Button>
									</TooltipTrigger>
									<TooltipContent side="bottom">
										{t("fileTree.moveSelected", { count: selected.size })}
									</TooltipContent>
								</Tooltip>
							) : null}
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										className="size-6 text-destructive"
										aria-label={t("fileTree.deleteSelected", {
											count: selected.size,
										})}
										onClick={runBatchDelete}
									>
										<Trash2 className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent side="bottom">
									{t("fileTree.deleteSelected", { count: selected.size })}
								</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										className="size-6"
										aria-label={t("fileTree.clearSelection")}
										onClick={clearSelection}
									>
										<X className="size-3.5" />
									</Button>
								</TooltipTrigger>
								<TooltipContent side="bottom">
									{t("fileTree.clearSelection")}
								</TooltipContent>
							</Tooltip>
						</div>
					</div>
				) : null}
				<div
					ref={treeScrollRef}
					className="agentero-scroll min-h-0 flex-1 overflow-y-auto py-1"
				>
					{nodes.length === 0 && !createDraft ? (
						<>
							{/* Virtual library node always available (empty vault or no vault yet) */}
							<AiFileTree
								selectedPath={treeSelectedPath}
								selectedPaths={selected}
								expanded={expanded}
								onExpandedChange={setExpanded}
								onContextMenuPath={handleContextMenuPath}
								onSelectRow={handleSelectRow}
							>
								{libraryRow}
							</AiFileTree>
							{/* Only when a vault is open but has no files — not before open/create. */}
							{vaultPath ? (
								<p className="px-3 py-2 text-muted-foreground text-xs">
									{t("fileTree.empty")}
								</p>
							) : null}
						</>
					) : (
						<AiFileTree
							selectedPath={treeSelectedPath}
							selectedPaths={selected}
							expanded={expanded}
							onExpandedChange={setExpanded}
							onContextMenuPath={handleContextMenuPath}
							onSelectRow={handleSelectRow}
							dropTargetPath={dropTarget}
							onRowDragStart={handleRowDragStart}
							onRowDragOver={handleRowDragOver}
							onRowDrop={handleRowDrop}
							onRowDragEnd={handleRowDragEnd}
						>
							<div
								className="relative w-full"
								style={{ height: rowVirtualizer.getTotalSize() }}
							>
								{rowVirtualizer.getVirtualItems().map((vi) => {
									const row = flatRows[vi.index];
									if (!row) return null;
									const depth = row.kind === "library" ? 0 : row.depth;
									return (
										<div
											key={row.key}
											data-index={vi.index}
											ref={rowVirtualizer.measureElement}
											className="absolute top-0 left-0 w-full"
											style={{
												transform: `translateY(${vi.start}px)`,
												paddingLeft: depth * 12,
											}}
										>
											{row.kind === "library"
												? libraryRow
												: row.kind === "create"
													? createRow
													: renderNodeRow(row.node, row.paperLeaf)}
										</div>
									);
								})}
							</div>
						</AiFileTree>
					)}
					{revealError ? (
						<p className="px-3 py-1 text-destructive text-xs leading-snug">
							{revealError}
						</p>
					) : null}
				</div>
				{contextMenuPortal}
			</div>
		</TooltipProvider>
	);
}

function IconAction({
	label,
	onClick,
	disabled,
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label={label}
					disabled={disabled}
					onClick={onClick}
				>
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}

export function VaultSidebarHeader({
	title,
	onNewFile,
	onNewFolder,
	onOpenRecycleBin,
	/** Vault-relative papers parent, e.g. `papers` or `papers/nlp` */
	lookupParentDir,
	onLookupSubmit,
	/** Bibliography import (bottom-left of magic-wand popover). */
	onImportBibliography,
	/** Local PDF import (bottom-left of magic-wand popover). */
	onImportLocalPdf,
	importBusy,
	importPdfBusy,
	busy,
	isDemo,
	/**
	 * Increment from App (e.g. ⇧⌘I) to open the magic-wand popover.
	 * Only reacts to positive values after mount.
	 */
	lookupOpenSignal = 0,
}: {
	title: string;
	onNewFile: () => void;
	onNewFolder: () => void;
	onOpenRecycleBin?: () => void;
	lookupParentDir: string;
	onLookupSubmit: (text: string) => Promise<void>;
	onImportBibliography?: () => void | Promise<void>;
	onImportLocalPdf?: () => void | Promise<void>;
	importBusy?: boolean;
	importPdfBusy?: boolean;
	busy?: boolean;
	isDemo: boolean;
	lookupOpenSignal?: number;
}) {
	const { t } = useTranslation(["sidebar", "shortcuts"]);
	const [wandOpen, setWandOpen] = useState(false);
	const [lookupText, setLookupText] = useState("");
	const [lookupBusy, setLookupBusy] = useState(false);
	const [lookupError, setLookupError] = useState<string | null>(null);
	const actionsDisabled =
		busy ||
		isDemo ||
		lookupBusy ||
		Boolean(importBusy) ||
		Boolean(importPdfBusy);
	const magicWandShortcut = useMemo(() => {
		const def = SHORTCUTS.find((s) => s.id === "magicWand");
		return def ? formatShortcut(def) : "⇧⌘I";
	}, []);

	useEffect(() => {
		if (lookupOpenSignal <= 0 || isDemo || busy) return;
		setWandOpen(true);
		setLookupError(null);
	}, [lookupOpenSignal, isDemo, busy]);

	const runLookup = async () => {
		const text = lookupText.trim();
		if (!text || lookupBusy) return;
		setLookupBusy(true);
		setLookupError(null);
		try {
			await onLookupSubmit(text);
			setLookupText("");
			setWandOpen(false);
		} catch (e) {
			setLookupError(e instanceof Error ? e.message : String(e));
		} finally {
			setLookupBusy(false);
		}
	};

	return (
		<TooltipProvider delayDuration={300}>
			<div className="shrink-0">
				<PaneHeader
					className="bg-muted/20"
					trailing={
						<>
							<Popover
								open={wandOpen}
								onOpenChange={(open) => {
									setWandOpen(open);
									if (!open) setLookupError(null);
								}}
							>
								<Tooltip>
									<TooltipTrigger asChild>
										<PopoverTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												aria-label={t("lookup.magicWand")}
												disabled={actionsDisabled}
											>
												<WandSparkles className="size-3.5" />
											</Button>
										</PopoverTrigger>
									</TooltipTrigger>
									<TooltipContent side="bottom">
										{t("lookup.magicWand")}
										<span className="ml-2 text-muted-foreground">
											{magicWandShortcut}
										</span>
									</TooltipContent>
								</Tooltip>
								<PopoverContent
									align="end"
									side="bottom"
									className="w-72 gap-2 p-2.5"
								>
									<form
										className="flex flex-col gap-2"
										onSubmit={(e) => {
											e.preventDefault();
											void runLookup();
										}}
									>
										<p className="text-muted-foreground text-xs">
											{t("lookup.addTo", { path: lookupParentDir })}
										</p>
										<Input
											value={lookupText}
											onChange={(e) => setLookupText(e.target.value)}
											placeholder={t("lookup.placeholder")}
											disabled={lookupBusy || importBusy}
											className="h-8 text-xs"
										/>
										{lookupError ? (
											<p className="text-destructive text-xs leading-snug">
												{lookupError}
											</p>
										) : null}
										{/* Imports bottom-left (PDF · bibliography) · Add bottom-right */}
										<div className="flex items-center justify-between gap-2">
											<div className="flex items-center gap-1">
												{onImportLocalPdf ? (
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																type="button"
																variant="ghost"
																size="icon-xs"
																disabled={actionsDisabled}
																aria-label={t("papersLibrary.importPdf")}
																onClick={() => {
																	void onImportLocalPdf();
																}}
															>
																{importPdfBusy ? (
																	<Loader2 className="size-3.5 animate-spin" />
																) : (
																	<FileUp className="size-3.5" />
																)}
															</Button>
														</TooltipTrigger>
														<TooltipContent side="bottom">
															{t("papersLibrary.importPdf")}
														</TooltipContent>
													</Tooltip>
												) : null}
												{onImportBibliography ? (
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																type="button"
																variant="ghost"
																size="icon-xs"
																disabled={actionsDisabled}
																aria-label={t("papersLibrary.import")}
																onClick={() => {
																	void onImportBibliography();
																}}
															>
																{importBusy ? (
																	<Loader2 className="size-3.5 animate-spin" />
																) : (
																	<Upload className="size-3.5" />
																)}
															</Button>
														</TooltipTrigger>
														<TooltipContent side="bottom">
															{t("papersLibrary.import")}
														</TooltipContent>
													</Tooltip>
												) : null}
											</div>
											<Button
												type="submit"
												size="sm"
												className="h-7 px-2.5 text-xs"
												disabled={
													lookupBusy ||
													importBusy ||
													importPdfBusy ||
													!lookupText.trim()
												}
											>
												{lookupBusy ? t("lookup.adding") : t("lookup.add")}
											</Button>
										</div>
									</form>
								</PopoverContent>
							</Popover>
							<IconAction
								label={t("fileTree.newFile")}
								onClick={onNewFile}
								disabled={actionsDisabled}
							>
								<FilePlus2 className="size-3.5" />
							</IconAction>
							<IconAction
								label={t("fileTree.newFolder")}
								onClick={onNewFolder}
								disabled={actionsDisabled}
							>
								<FolderPlus className="size-3.5" />
							</IconAction>
							{onOpenRecycleBin ? (
								<IconAction
									label={t("recycleBin.open")}
									onClick={onOpenRecycleBin}
									disabled={busy || isDemo}
								>
									<Trash2 className="size-3.5" />
								</IconAction>
							) : null}
						</>
					}
				>
					<AgenteroLogo className="size-4 shrink-0 text-foreground" />
					<span className="truncate font-medium text-sm" title={title}>
						{title}
					</span>
				</PaneHeader>
			</div>
		</TooltipProvider>
	);
}
