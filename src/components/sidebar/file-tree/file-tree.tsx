import { useVirtualizer } from "@tanstack/react-virtual";
import { FolderIcon, FolderInput, Trash2, X } from "lucide-react";
import {
	forwardRef,
	memo,
	type DragEvent as ReactDragEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { FileTree as AiFileTree } from "@/components/ai-elements/file-tree";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor } from "@/components/ui/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { contextPathIcon } from "@/lib/agent/context-path-icon";
import { copyTextToClipboard } from "@/lib/core/clipboard";
import { notifyError } from "@/lib/core/notify";
import { dirnameOf } from "@/lib/core/path";
import { isTauri } from "@/lib/core/tauri";
import { cn } from "@/lib/core/utils";
import {
	formatPaperTreeLabel,
	isPaperDirectory,
	type PaperMetadata,
	type PaperTreeLabelMode,
	type PaperTreeSortMode,
	paperAssetDownloadReasons,
	paperNeedsRead,
	sortFileTreeNodes,
} from "@/lib/paper";
import { LIBRARY_VIRTUAL_PATH, TRASH_VIRTUAL_PATH } from "@/lib/paper/api";
import { useUiScale } from "@/lib/settings";
import {
	dataTransferHasFiles,
	resolveDroppedPdfPaths,
	snapshotDataTransfer,
} from "@/lib/shell/external-file-drop";
import { type FileNode, resolveCreateParent } from "@/lib/vault";
import { openInTerminal, revealInFileManager } from "@/lib/vault/reveal";
import { toVaultRelative } from "@/lib/wiki";
import { MoveDestinationPicker } from "./move-destination-picker";
import { TreeContextMenuPortal } from "./tree-context-menu";
import {
	ancestorPaths,
	collectDefaultExpanded,
	collectPapersNeedingAssets,
	collectPapersRootOnlyExpanded,
	isVirtualTreePath,
	pathKey,
} from "./tree-helpers";
import { TreeCreateInput, TreeRenameInput } from "./tree-inputs";
import {
	LibraryRow,
	LoadingRows,
	NodeTreeRow,
	PaperTreeRow,
	TrashRow,
} from "./tree-rows";
import type {
	FlatRow,
	TreeContextMenu,
	TreeCreateDraft,
	TreeCreateKind,
	TreeRenameDraft,
} from "./types";

type FileTreeProps = {
	nodes: FileNode[];
	/** True while the root Vault tree is being loaded. */
	loading?: boolean;
	selectedPath: string | null;
	/** Vault root absolute path — used as create parent for root-level entries. */
	vaultPath: string | null;
	createDraft: TreeCreateDraft | null;
	onConfirmCreate: (name: string) => void;
	onCancelCreate: () => void;
	/** Inline rename draft; replaces the rename dialog for file/folder items. */
	renameDraft?: TreeRenameDraft | null;
	/** Start inline rename for the given tree path. */
	onStartRename?: (path: string) => void;
	/** Confirm inline rename; parent performs the link-aware vault move. */
	onConfirmRename?: (path: string, newName: string) => void | Promise<void>;
	/** Cancel inline rename and clear the draft. */
	onCancelRename?: () => void;
	/** Called for normal files and for paper folders (collapsed leaves). */
	onSelectFile: (node: FileNode) => void;
	/** Virtual library node → papers table in center pane. */
	onSelectLibrary?: () => void;
	/** Virtual trash node → recycle bin view in center pane. */
	onSelectTrash?: () => void;
	/** Empty recycle bin (confirm + purge). From trash node context menu. */
	onEmptyTrash?: () => void | Promise<void>;
	/** Export library bibliography (Library node context menu). */
	onExportLibrary?: () => void | Promise<void>;
	/** True while export (or other library IO) is in progress — disables menu item. */
	libraryExportBusy?: boolean;
	/**
	 * Start an inline create rename for a new file/folder under the given parent.
	 * Parent is derived from the right-clicked path (folder itself, or file's parent).
	 */
	onStartCreate?: (kind: TreeCreateKind, parentPath: string) => void;
	/** Download PDF (+ TeX if arXiv); no TeX → liteparse PAPER.md. */
	onDownloadPaperAssets?: (paperNode: FileNode) => Promise<void>;
	/** Download missing assets for every incomplete paper (Library row). */
	onDownloadAllMissingAssets?: () => Promise<void>;
	/**
	 * Catalog paper rows keyed by vault-relative path (for `is_read` / read trigger).
	 * Paths normalized without leading/trailing slashes.
	 */
	paperMetaByRelPath?: ReadonlyMap<string, PaperMetadata>;
	/**
	 * How paper folder rows are labeled (Settings → General).
	 * Display-only; disk folder names are unchanged.
	 */
	paperTreeLabelMode?: PaperTreeLabelMode;
	/**
	 * How siblings under each folder are ordered (Settings → General).
	 * Display-only; does not rename or move disk folders.
	 */
	paperTreeSortMode?: PaperTreeSortMode;
	/** Start paper-reader workflow for a paper folder with complete local assets. */
	onReadPaper?: (paperNode: FileNode) => Promise<void>;
	/** Paper row context menu: open the paper's NOTES.md in the reading split. */
	onOpenPaperNotes?: (paperDir: string) => void;
	/** Delete a real tree path (file / folder / paper). Parent confirms + performs IO. */
	onDeletePath?: (path: string) => void | Promise<void>;
	/** Batch delete multiple real tree paths (one confirm). */
	onDeletePaths?: (paths: string[]) => void | Promise<void>;
	/** Move paths into a papers/ folder chosen by the inline picker. */
	onMoveTo?: (paths: string[], destParentRel: string) => void;
	/** Move paths to the destination implied by a drag-and-drop target. */
	onDropMove?: (paths: string[], targetPath: string) => void;
	onCutPaths?: (paths: string[]) => void;
	onPasteInto?: (targetPath: string) => void;
	/** Absolute paths currently staged by Cut (for row dimming). */
	cutPaths?: string[];
	/**
	 * OS PDF drop onto a `papers/` org folder → open confirm dialog in parent.
	 * `parentDir` is vault-relative (e.g. `papers` or `papers/nlp`).
	 * `items` include absolute path + original filename for metadata defaults.
	 */
	onDropLocalPdfs?: (
		items: Array<{ path: string; sourceName: string }>,
		parentDir: string,
	) => void;
	/**
	 * Lazy tree: load children when a folder with `childrenPending` is expanded.
	 * Parent should call `listVaultDirChildren` and merge via `replaceTreeNodeChildren`.
	 */
	onLoadDirChildren?: (dirPath: string) => void | Promise<void>;
	className?: string;
};

/** Imperative tree controls (global shortcuts / command palette). */
export type FileTreeHandle = {
	/** Collapse the selected folder, or its parent if the row is a leaf / already closed. */
	collapseSelected: () => void;
	/** Only expand papers/ (list direct children; do not expand subfolders). */
	collapseToDefault: () => void;
	/** Cut the current multi-selection (or selected path if no multi-selection). */
	cutSelected: () => void;
	/** Paste cut items into the currently selected path. */
	pasteIntoSelected: () => void;
};

export const FileTree = memo(
	forwardRef<FileTreeHandle, FileTreeProps>(function FileTree(
		{
			nodes,
			loading = false,
			selectedPath,
			vaultPath,
			createDraft,
			onConfirmCreate,
			onCancelCreate,
			renameDraft,
			onStartRename,
			onConfirmRename,
			onCancelRename,
			onSelectFile,
			onSelectLibrary,
			onSelectTrash,
			onEmptyTrash,
			onExportLibrary,
			libraryExportBusy = false,
			onStartCreate,
			onDownloadPaperAssets,
			onDownloadAllMissingAssets,
			paperMetaByRelPath,
			paperTreeLabelMode = "title-author",
			paperTreeSortMode = "folder",
			onReadPaper,
			onOpenPaperNotes,
			onDeletePath,
			onDeletePaths,
			onMoveTo,
			onDropMove,
			onCutPaths,
			onPasteInto,
			cutPaths = [],
			onDropLocalPdfs,
			onLoadDirChildren,
			className,
		},
		ref,
	) {
		const { t } = useTranslation("sidebar");
		const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
		const [downloadingAll, setDownloadingAll] = useState(false);
		const [readingPath, setReadingPath] = useState<string | null>(null);
		const [contextMenu, setContextMenu] = useState<TreeContextMenu | null>(
			null,
		);
		const [revealError, setRevealError] = useState<string | null>(null);
		const contextMenuRef = useRef<HTMLDivElement>(null);
		/** Inline move picker state. */
		const [movePickerOpen, setMovePickerOpen] = useState(false);
		const [moveTargets, setMoveTargets] = useState<string[]>([]);
		const [moveSelectedFolder, setMoveSelectedFolder] = useState("papers");
		const [moveNewFolder, setMoveNewFolder] = useState("");
		const [moveBusy, setMoveBusy] = useState(false);
		const [moveAnchorPos, setMoveAnchorPos] = useState<{
			x: number;
			y: number;
		} | null>(null);
		const containerRef = useRef<HTMLDivElement>(null);
		/** Paths currently being listed (lazy expand). */
		const [loadingDirs, setLoadingDirs] = useState<Set<string>>(
			() => new Set(),
		);
		const loadingDirsRef = useRef<Set<string>>(new Set());
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

		/**
		 * When expanded folders still have `childrenPending`, ask parent to list them.
		 * Covers click-expand, default expand, and reveal-ancestors.
		 */
		useEffect(() => {
			if (!onLoadDirChildren) return;
			const pending: string[] = [];
			const walk = (list: FileNode[]) => {
				for (const n of list) {
					if (n.kind !== "directory") continue;
					if (
						n.childrenPending &&
						expanded.has(n.path) &&
						!loadingDirsRef.current.has(n.path)
					) {
						pending.push(n.path);
					}
					if (n.children?.length) walk(n.children);
				}
			};
			walk(nodes);
			if (pending.length === 0) return;

			for (const path of pending) {
				loadingDirsRef.current.add(path);
			}
			setLoadingDirs(new Set(loadingDirsRef.current));

			void (async () => {
				for (const path of pending) {
					try {
						await onLoadDirChildren(path);
					} catch {
						// Parent surfaces errors via toast; clear loading so user can retry.
					} finally {
						loadingDirsRef.current.delete(path);
						setLoadingDirs(new Set(loadingDirsRef.current));
					}
				}
			})();
		}, [nodes, expanded, onLoadDirChildren]);

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

		/**
		 * After an intentional collapse, skip one flatRows-driven re-reveal so
		 * a deep selection does not immediately re-expand collapsed ancestors.
		 * Cleared on the next `treeSelectedPath` change.
		 */
		const suppressAutoRevealRef = useRef(false);

		const collapseToDefault = useCallback(() => {
			suppressAutoRevealRef.current = true;
			const open = new Set<string>();
			// Only papers/ — list its children; do not expand org subfolders.
			collectPapersRootOnlyExpanded(nodes, open);
			setExpanded(open);
		}, [nodes]);

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

		const cutPathKeys = useMemo(
			() => new Set(cutPaths.map((p) => pathKey(p))),
			[cutPaths],
		);

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
			(absPath: string): string => toVaultRelative(vaultPath, absPath),
			[vaultPath],
		);

		/** Display order under each folder (Settings → paperTreeSortMode). */
		const displayNodes = useMemo(
			() =>
				sortFileTreeNodes(
					nodes,
					paperTreeSortMode,
					paperMetaByRelPath,
					relPathForNode,
					paperTreeLabelMode,
				),
			[
				nodes,
				paperTreeSortMode,
				paperMetaByRelPath,
				relPathForNode,
				paperTreeLabelMode,
			],
		);

		/**
		 * Row to highlight / scroll to:
		 * - virtual Library / Trash as-is;
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
			walk(displayNodes);
			return out;
		}, [displayNodes, expanded]);

		/** Flattened rows in display order (respects expand state + inline drafts). */
		const flatRows = useMemo<FlatRow[]>(() => {
			// Virtual Library + Recycle Bin sit at the top (Library, then trash).
			const out: FlatRow[] = [
				{ key: "__library__", kind: "library" },
				{ key: "__trash__", kind: "trash" },
			];
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
					out.push({
						key: n.id,
						kind: "node",
						depth,
						node: n,
						paperLeaf: paper,
					});
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
			walk(displayNodes, 0);
			return out;
		}, [displayNodes, expanded, createDraft, vaultPath]);

		const treeScrollRef = useRef<HTMLDivElement>(null);
		const uiScale = useUiScale();
		// Key by stable row id so insert/remove of the inline create draft does
		// not leave stale measured heights on recycled indexes (gap after create).
		const flatRowKeys = useMemo(() => flatRows.map((r) => r.key), [flatRows]);
		const rowVirtualizer = useVirtualizer({
			count: flatRows.length,
			getScrollElement: () => treeScrollRef.current,
			estimateSize: () => Math.round(28 * uiScale),
			getItemKey: (index) => flatRowKeys[index] ?? index,
			overscan: 15,
		});

		// Remeasure when the flattened set changes (create draft, expand, refresh).
		// biome-ignore lint/correctness/useExhaustiveDependencies: keys encode flatRows identity
		useEffect(() => {
			rowVirtualizer.measure();
		}, [flatRowKeys, uiScale, rowVirtualizer]);

		/**
		 * When the active document changes (or tree data refreshes after import),
		 * expand ancestor folders so the matching tree row is visible, then scroll
		 * it into view (IDE-style reveal — e.g. after magic-wand lookup import).
		 */
		const pendingRevealPathRef = useRef<string | null>(null);
		const expandAncestorsOf = useCallback(
			(target: string) => {
				if (isVirtualTreePath(target)) return;
				const parents = ancestorPaths(target, vaultPath);
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
			},
			[vaultPath, byPathKey],
		);

		/**
		 * Collapse the selected folder (VS Code list.collapse-ish):
		 * - expandable folder that is open → collapse it;
		 * - leaf / already-collapsed folder → collapse nearest open parent.
		 * Multi-select collapses each path independently.
		 */
		const collapseSelected = useCallback(() => {
			const candidates =
				selected.size > 0 ? [...selected] : selectedPath ? [selectedPath] : [];
			if (candidates.length === 0) return;

			suppressAutoRevealRef.current = true;
			setExpanded((prev) => {
				let changed = false;
				const next = new Set(prev);
				for (const raw of candidates) {
					if (isVirtualTreePath(raw)) continue;
					const node = byPathKey.get(pathKey(raw));
					const path =
						node?.path ?? raw.replace(/\\/g, "/").replace(/\/+$/, "");
					const isExpandableDir =
						node?.kind === "directory" &&
						!isPaperDirectory(node.path, node.children);

					let folderToClose: string | null = null;
					if (isExpandableDir && next.has(path)) {
						folderToClose = path;
					} else {
						// Nearest ancestor that is currently expanded (root-ward list → last).
						const parents = ancestorPaths(path, vaultPath);
						for (let i = parents.length - 1; i >= 0; i--) {
							const parent = parents[i];
							if (!parent || !next.has(parent)) continue;
							const parentNode = byPathKey.get(pathKey(parent));
							if (
								parentNode?.kind === "directory" &&
								isPaperDirectory(parentNode.path, parentNode.children)
							) {
								continue;
							}
							folderToClose = parentNode?.path ?? parent;
							break;
						}
					}
					if (folderToClose && next.has(folderToClose)) {
						next.delete(folderToClose);
						changed = true;
					}
				}
				return changed ? next : prev;
			});
		}, [selected, selectedPath, byPathKey, vaultPath]);

		useEffect(() => {
			if (!treeSelectedPath) return;
			// New selection always re-enables auto-reveal (e.g. open paper).
			suppressAutoRevealRef.current = false;
			pendingRevealPathRef.current = treeSelectedPath;
			expandAncestorsOf(treeSelectedPath);
		}, [treeSelectedPath, expandAncestorsOf]);

		// After tree refresh (import / rescan), re-queue reveal only when the
		// selected path is not yet a visible flat row (parents collapsed, or the
		// node just appeared after magic-wand import).
		useEffect(() => {
			if (suppressAutoRevealRef.current) {
				// Consume once: intentional collapse must not re-expand ancestors.
				suppressAutoRevealRef.current = false;
				return;
			}
			if (!treeSelectedPath || isVirtualTreePath(treeSelectedPath)) return;
			const targetKey = pathKey(treeSelectedPath);
			const visible = flatRows.some((row) => {
				if (row.kind === "library")
					return targetKey === pathKey(LIBRARY_VIRTUAL_PATH);
				if (row.kind === "trash")
					return targetKey === pathKey(TRASH_VIRTUAL_PATH);
				if (row.kind === "node") return pathKey(row.node.path) === targetKey;
				return false;
			});
			if (visible) return;
			pendingRevealPathRef.current = treeSelectedPath;
			expandAncestorsOf(treeSelectedPath);
		}, [treeSelectedPath, expandAncestorsOf, flatRows]);

		// treeSelectedPath: re-run when selection changes even if flatRows is unchanged
		// (path already visible / ancestors already expanded).
		// biome-ignore lint/correctness/useExhaustiveDependencies: intentional
		useEffect(() => {
			const target = pendingRevealPathRef.current;
			if (!target) return;

			const targetKey = pathKey(target);
			const idx = flatRows.findIndex((row) => {
				if (row.kind === "library")
					return targetKey === pathKey(LIBRARY_VIRTUAL_PATH);
				if (row.kind === "trash")
					return targetKey === pathKey(TRASH_VIRTUAL_PATH);
				if (row.kind === "node") return pathKey(row.node.path) === targetKey;
				return false;
			});
			if (idx < 0) return;

			pendingRevealPathRef.current = null;
			// Double rAF: first for expand→flatRows layout, second for virtualizer measure.
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					rowVirtualizer.scrollToIndex(idx, {
						align: "center",
						behavior: "smooth",
					});
				});
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
				if (path === TRASH_VIRTUAL_PATH) {
					onSelectTrash?.();
					return;
				}
				const node = byPath.get(path);
				if (!node) return;
				// Files, paper folders, and org folders (e.g. papers/nlp/pretrain) —
				// parent opens paper / scoped library via onSelectFile.
				onSelectFile(node);
			},
			[byPath, onSelectFile, onSelectLibrary, onSelectTrash],
		);

		const handleSelectRow = useCallback(
			(
				path: string,
				mods: { meta: boolean; ctrl: boolean; shift: boolean },
			) => {
				if (createDraft || renameDraft) return;
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
			[
				anchor,
				clearSelection,
				createDraft,
				renameDraft,
				openRow,
				selectableOrder,
			],
		);

		const orderedSelected = useCallback(
			() => selectableOrder.filter((p) => selected.has(p)),
			[selectableOrder, selected],
		);

		const cutSelected = useCallback(() => {
			const paths =
				selected.size > 0
					? orderedSelected()
					: selectedPath
						? [selectedPath]
						: [];
			if (paths.length > 0) {
				onCutPaths?.(paths);
			}
		}, [selected.size, selectedPath, orderedSelected, onCutPaths]);

		const pasteIntoSelected = useCallback(() => {
			const target = selectedPath;
			if (target) {
				onPasteInto?.(target);
			}
		}, [selectedPath, onPasteInto]);

		useImperativeHandle(
			ref,
			() => ({
				collapseSelected,
				collapseToDefault,
				cutSelected,
				pasteIntoSelected,
			}),
			[collapseSelected, collapseToDefault, cutSelected, pasteIntoSelected],
		);

		const runBatchDelete = useCallback(() => {
			const paths = orderedSelected();
			if (paths.length === 0) return;
			if (onDeletePaths) void onDeletePaths(paths);
			else if (onDeletePath && paths[0]) void onDeletePath(paths[0]);
		}, [orderedSelected, onDeletePaths, onDeletePath]);

		const openMovePicker = useCallback(
			(paths: string[], anchor?: { x: number; y: number }) => {
				if (paths.length === 0 || !onMoveTo) return;
				setMoveTargets(paths);
				setMoveSelectedFolder("papers");
				setMoveNewFolder("");
				if (anchor && containerRef.current) {
					const containerRect = containerRef.current.getBoundingClientRect();
					setMoveAnchorPos({
						x: anchor.x - containerRect.left,
						y: anchor.y - containerRect.top,
					});
				} else {
					setMoveAnchorPos(anchor ?? null);
				}
				setMovePickerOpen(true);
			},
			[onMoveTo],
		);

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

		// ---- Drag and drop: vault move + OS PDF import into a papers/ folder ----
		const [dragging, setDragging] = useState<string[] | null>(null);
		const [dropTarget, setDropTarget] = useState<string | null>(null);

		/** Org folder under papers/ (not a paper unit, not virtual). */
		const isPapersOrgFolder = useCallback(
			(targetPath: string): boolean => {
				if (isVirtualTreePath(targetPath)) return false;
				const node = byPath.get(targetPath);
				if (node?.kind !== "directory") return false;
				if (isPaperDirectory(node.path, node.children)) return false;
				const rel = relPathForNode(targetPath);
				return rel === "papers" || rel.startsWith("papers/");
			},
			[byPath, relPathForNode],
		);

		/** A row is a valid vault-move drop target if it is a real file/folder and not the dragged path or its descendant. */
		const canDrop = useCallback(
			(targetPath: string, paths: string[]): boolean => {
				if (paths.length === 0 || isVirtualTreePath(targetPath)) return false;
				const node = byPath.get(targetPath);
				if (!node) return false;
				const norm = targetPath.replace(/\\/g, "/").replace(/\/+$/, "");
				return !paths.some((d) => {
					const dn = d.replace(/\\/g, "/").replace(/\/+$/, "");
					return norm === dn || norm.startsWith(`${dn}/`);
				});
			},
			[byPath],
		);

		const handleRowDragStart = useCallback(
			(path: string, e: ReactDragEvent) => {
				if (createDraft || renameDraft || isVirtualTreePath(path)) {
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
			[createDraft, renameDraft, selected, orderedSelected],
		);

		const handleRowDragOver = useCallback(
			(path: string, e: ReactDragEvent) => {
				// Internal vault move takes priority while a tree drag is active.
				if (dragging && canDrop(path, dragging)) {
					e.preventDefault();
					e.dataTransfer.dropEffect = "move";
					// Highlight the target folder itself, or the file's parent folder
					// so the user sees where the item will land.
					const node = byPath.get(path);
					const highlightPath =
						node?.kind === "directory" ? path : (dirnameOf(path) ?? path);
					if (dropTarget !== highlightPath) {
						setDropTarget(highlightPath);
					}
					return;
				}
				// OS PDF → import parent (only when not mid vault-move).
				if (
					!dragging &&
					onDropLocalPdfs &&
					dataTransferHasFiles(e.dataTransfer) &&
					isPapersOrgFolder(path)
				) {
					e.preventDefault();
					e.stopPropagation();
					e.dataTransfer.dropEffect = "copy";
					if (dropTarget !== path) setDropTarget(path);
					return;
				}
				if (dropTarget) setDropTarget(null);
			},
			[
				dragging,
				dropTarget,
				canDrop,
				onDropLocalPdfs,
				isPapersOrgFolder,
				byPath,
			],
		);

		const handleRowDrop = useCallback(
			(path: string, e: ReactDragEvent) => {
				e.preventDefault();
				const vaultMovePaths = dragging;
				setDragging(null);
				setDropTarget(null);

				if (vaultMovePaths) {
					if (!onDropMove || !canDrop(path, vaultMovePaths)) return;
					onDropMove(vaultMovePaths, path);
					return;
				}

				// External PDF drop onto papers/ org folder → confirm dialog in App.
				// Snapshot DataTransfer **now** (WKWebView clears it after the handler).
				// Prefer nativeEvent — React synthetic DataTransfer can hide FileList.
				// Path-less Files are staged via Host `paper_stage_import_file`.
				if (
					onDropLocalPdfs &&
					dataTransferHasFiles(e.dataTransfer) &&
					isPapersOrgFolder(path)
				) {
					e.stopPropagation();
					const dest = relPathForNode(path) || "papers";
					const nativeDt =
						(e.nativeEvent as DragEvent | undefined)?.dataTransfer ??
						e.dataTransfer;
					const snap = snapshotDataTransfer(nativeDt);
					void (async () => {
						try {
							const pdfs = await resolveDroppedPdfPaths(snap);
							if (!pdfs.length) {
								notifyError(t("importLocalPdf.dropNoPath"));
								return;
							}
							onDropLocalPdfs(pdfs, dest);
						} catch (err) {
							notifyError(err instanceof Error ? err.message : String(err));
						}
					})();
				}
			},
			[
				dragging,
				onDropMove,
				onDropLocalPdfs,
				canDrop,
				relPathForNode,
				isPapersOrgFolder,
				t,
			],
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
				if (createDraft || renameDraft) return;
				// Real vault paths + virtual Library (export) / Recycle Bin (empty).
				if (
					!canRevealPath(path) &&
					path !== TRASH_VIRTUAL_PATH &&
					path !== LIBRARY_VIRTUAL_PATH
				) {
					return;
				}
				// Library menu only when export is wired.
				if (path === LIBRARY_VIRTUAL_PATH && !onExportLibrary) return;
				event.preventDefault();
				event.stopPropagation();
				setRevealError(null);
				setContextMenu({ path, x: event.clientX, y: event.clientY });
			},
			[canRevealPath, createDraft, renameDraft, onExportLibrary],
		);

		const handleEmptyTrashFromMenu = useCallback(() => {
			setContextMenu(null);
			void onEmptyTrash?.();
		}, [onEmptyTrash]);

		const handleExportLibraryFromMenu = useCallback(() => {
			setContextMenu(null);
			void onExportLibrary?.();
		}, [onExportLibrary]);

		const handleDeleteFromMenu = useCallback(() => {
			if (!contextMenu) return;
			const targets = menuTargets(contextMenu.path);
			setContextMenu(null);
			if (targets.length > 1 && onDeletePaths) void onDeletePaths(targets);
			else if (onDeletePath && targets[0]) void onDeletePath(targets[0]);
		}, [contextMenu, menuTargets, onDeletePaths, onDeletePath]);

		const handleMoveFromMenu = useCallback(() => {
			if (!contextMenu || !onMoveTo) return;
			const targets = menuTargets(contextMenu.path);
			const anchor = { x: contextMenu.x, y: contextMenu.y };
			setContextMenu(null);
			openMovePicker(targets, anchor);
		}, [contextMenu, menuTargets, onMoveTo, openMovePicker]);

		const handleCutFromMenu = useCallback(() => {
			if (!contextMenu || !onCutPaths) return;
			const targets = menuTargets(contextMenu.path);
			setContextMenu(null);
			onCutPaths(targets);
		}, [contextMenu, menuTargets, onCutPaths]);

		const handlePasteFromMenu = useCallback(() => {
			if (!contextMenu || !onPasteInto) return;
			const path = contextMenu.path;
			setContextMenu(null);
			onPasteInto(path);
		}, [contextMenu, onPasteInto]);

		const handleRenameFromMenu = useCallback(() => {
			if (!contextMenu || !onStartRename) return;
			const path = contextMenu.path;
			setContextMenu(null);
			onStartRename(path);
		}, [contextMenu, onStartRename]);

		const handleNewFileFromMenu = useCallback(() => {
			if (!contextMenu || !vaultPath || !onStartCreate) return;
			const parent = resolveCreateParent(vaultPath, contextMenu.path, nodes);
			setContextMenu(null);
			onStartCreate("file", parent);
		}, [contextMenu, vaultPath, nodes, onStartCreate]);

		const handleNewFolderFromMenu = useCallback(() => {
			if (!contextMenu || !vaultPath || !onStartCreate) return;
			const parent = resolveCreateParent(vaultPath, contextMenu.path, nodes);
			setContextMenu(null);
			onStartCreate("folder", parent);
		}, [contextMenu, vaultPath, nodes, onStartCreate]);

		const handleCopyPathFromMenu = useCallback(async () => {
			if (!contextMenu) return;
			setContextMenu(null);
			await copyTextToClipboard(contextMenu.path, {
				successMessage: t("fileTree.copiedPath"),
				errorMessage: t("fileTree.copyPathFailed"),
				successNotify: { duration: 2000 },
			});
		}, [contextMenu, t]);

		const menuCount = contextMenu ? menuTargets(contextMenu.path).length : 1;
		const menuNode = contextMenu ? byPath.get(contextMenu.path) : undefined;
		const isPaperMenu =
			menuNode?.kind === "directory" &&
			isPaperDirectory(menuNode.path, menuNode.children);
		const menuTargetIsVirtual =
			contextMenu?.path === LIBRARY_VIRTUAL_PATH ||
			contextMenu?.path === TRASH_VIRTUAL_PATH;
		const canPasteAtTarget =
			cutPaths.length > 0 &&
			!menuTargetIsVirtual &&
			Boolean(contextMenu?.path) &&
			!cutPathKeys.has(pathKey(contextMenu?.path ?? "")) &&
			!cutPaths.some((p) =>
				pathKey(contextMenu?.path ?? "").startsWith(`${pathKey(p)}/`),
			);
		const handleOpenNotesFromMenu = useCallback(() => {
			if (!contextMenu || !onOpenPaperNotes) return;
			const path = contextMenu.path;
			setContextMenu(null);
			onOpenPaperNotes(path);
		}, [contextMenu, onOpenPaperNotes]);
		const closeContextMenu = useCallback(() => {
			setContextMenu(null);
		}, []);
		const contextMenuPortal = contextMenu ? (
			<TreeContextMenuPortal
				menu={contextMenu}
				menuRef={contextMenuRef}
				menuCount={menuCount}
				menuNodeName={menuNode?.name}
				isPaperMenu={isPaperMenu}
				libraryExportBusy={libraryExportBusy}
				canPasteAtTarget={canPasteAtTarget}
				onClose={closeContextMenu}
				onExportLibrary={
					onExportLibrary ? handleExportLibraryFromMenu : undefined
				}
				onEmptyTrash={onEmptyTrash ? handleEmptyTrashFromMenu : undefined}
				onOpenNotes={onOpenPaperNotes ? handleOpenNotesFromMenu : undefined}
				onNewFile={onStartCreate ? handleNewFileFromMenu : undefined}
				onNewFolder={onStartCreate ? handleNewFolderFromMenu : undefined}
				onCopyPath={() => {
					void handleCopyPathFromMenu();
				}}
				onCut={
					onCutPaths && !menuTargetIsVirtual ? handleCutFromMenu : undefined
				}
				onPaste={handlePasteFromMenu}
				onReveal={() => {
					void handleReveal(contextMenu.path);
				}}
				onOpenInTerminal={() => {
					void handleOpenInTerminal(contextMenu.path);
				}}
				onMove={onMoveTo ? handleMoveFromMenu : undefined}
				onRename={onStartRename ? handleRenameFromMenu : undefined}
				onDelete={
					onDeletePath || onDeletePaths ? handleDeleteFromMenu : undefined
				}
			/>
		) : null;

		const libraryRow = (
			<LibraryRow
				showDownload={showLibraryDownload}
				busy={libraryBusy}
				downloadingAll={downloadingAll}
				onDownloadAll={() => void handleDownloadAll()}
			/>
		);
		const trashRow = <TrashRow />;

		const renderNodeRow = (node: FileNode, paperLeaf: boolean): ReactNode => {
			const isCut = cutPathKeys.has(pathKey(node.path));
			if (paperLeaf) {
				const rel = relPathForNode(node.path);
				const meta = paperMetaByRelPath?.get(rel) ?? null;
				const downloadReasons = paperAssetDownloadReasons(node, meta);
				const showDownload =
					Boolean(onDownloadPaperAssets) && downloadReasons.length > 0;
				const label = formatPaperTreeLabel(paperTreeLabelMode, meta, node.name);
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
				return (
					<PaperTreeRow
						node={node}
						isCut={isCut}
						label={label}
						downloadReasons={downloadReasons}
						isDownloading={isDownloading}
						isReading={isReading}
						rowBusy={rowBusy}
						onDownload={
							showDownload ? () => void handleDownload(node) : undefined
						}
						onRead={showRead ? () => void handleReadPaper(node) : undefined}
					/>
				);
			}
			const pendingLoad =
				Boolean(node.childrenPending) || loadingDirs.has(node.path);
			return (
				<NodeTreeRow
					node={node}
					isCut={isCut}
					pendingLoad={pendingLoad}
					expanded={expanded.has(node.path)}
				/>
			);
		};

		const renderRenameInput = (
			node: FileNode,
			paperLeaf: boolean,
		): ReactNode => {
			if (!renameDraft || paperLeaf) return null;
			let icon: ReactNode;
			if (node.kind === "directory") {
				icon = <FolderIcon className="size-4 text-blue-500" />;
			} else {
				const Icon = contextPathIcon(node.name);
				icon = <Icon className="size-4 text-muted-foreground" />;
			}
			return (
				<TreeRenameInput
					initialName={renameDraft.currentName}
					icon={icon}
					onConfirm={(newName) => {
						if (onConfirmRename) void onConfirmRename(node.path, newName);
					}}
					onCancel={() => onCancelRename?.()}
				/>
			);
		};

		return (
			<TooltipProvider delayDuration={300}>
				<div
					ref={containerRef}
					className={cn(
						"relative flex min-h-0 flex-1 flex-col select-none text-sm",
						className,
					)}
				>
					{selected.size > 0 ? (
						<div className="mb-1 flex shrink-0 items-center gap-1 border-b bg-muted/95 px-3 py-1.5">
							<span className="text-muted-foreground text-xs">
								{t("fileTree.selectedCount", { count: selected.size })}
							</span>
							<div className="ml-auto flex items-center gap-0.5">
								{onMoveTo ? (
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
												onClick={(e) => {
													const rect = (
														e.currentTarget as HTMLElement
													).getBoundingClientRect();
													openMovePicker(orderedSelected(), {
														x: rect.left,
														y: rect.top,
													});
												}}
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
					<Popover
						open={movePickerOpen}
						onOpenChange={(open) => {
							if (!open) setMovePickerOpen(false);
						}}
					>
						<PopoverAnchor asChild>
							<div
								className="absolute size-0"
								style={
									moveAnchorPos
										? {
												left: moveAnchorPos.x,
												top: moveAnchorPos.y,
											}
										: undefined
								}
							/>
						</PopoverAnchor>
						<MoveDestinationPicker
							vaultPath={vaultPath}
							nodes={nodes}
							sourcePaths={moveTargets}
							selectedFolder={moveSelectedFolder}
							newFolder={moveNewFolder}
							busy={moveBusy}
							onNewFolderChange={setMoveNewFolder}
							onConfirm={async (dest) => {
								if (!onMoveTo) return;
								setMoveBusy(true);
								try {
									await onMoveTo(moveTargets, dest);
								} finally {
									setMoveBusy(false);
									setMovePickerOpen(false);
									setMoveTargets([]);
									setMoveAnchorPos(null);
									setSelected(new Set());
									setAnchor(null);
								}
							}}
						/>
					</Popover>
					<div
						ref={treeScrollRef}
						className="agentero-scroll min-h-0 flex-1 overflow-y-auto py-1"
					>
						{nodes.length === 0 && !createDraft ? (
							<>
								{/* Virtual library + trash always available (empty vault or no vault yet) */}
								<AiFileTree
									selectedPath={treeSelectedPath}
									selectedPaths={selected}
									expanded={expanded}
									onExpandedChange={setExpanded}
									onContextMenuPath={handleContextMenuPath}
									onSelectRow={handleSelectRow}
								>
									{libraryRow}
									{trashRow}
								</AiFileTree>
								{vaultPath && loading ? (
									<LoadingRows />
								) : vaultPath ? (
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
										const depth =
											row.kind === "library" || row.kind === "trash"
												? 0
												: row.depth;
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
													: row.kind === "trash"
														? trashRow
														: row.kind === "create"
															? createRow
															: renameDraft?.path === row.node.path
																? renderRenameInput(row.node, row.paperLeaf)
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
	}),
);
