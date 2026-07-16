"use client";

import {
	Check,
	ChevronRightIcon,
	FileIcon,
	FolderIcon,
	FolderOpenIcon,
} from "lucide-react";
import type {
	HTMLAttributes,
	KeyboardEvent,
	MouseEvent,
	ReactNode,
} from "react";
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { cn } from "@/lib/utils";

export type SelectMods = { meta: boolean; ctrl: boolean; shift: boolean };

interface FileTreeContextType {
	expandedPaths: Set<string>;
	togglePath: (path: string) => void;
	selectedPath?: string;
	onSelect?: (path: string) => void;
	onDoubleClickPath?: (path: string) => void;
	onContextMenuPath?: (path: string, event: MouseEvent) => void;
	/** Multi-selection set (row highlight + checkbox state). */
	selectedPaths?: Set<string>;
	/** True when a multi-selection is active (checkboxes stay visible). */
	selecting?: boolean;
	/** Row click carrying modifier keys (files + modifier-clicked folders). */
	onSelectRow?: (path: string, mods: SelectMods) => void;
	/** Checkbox toggle for a row (never opens/expands). */
	onToggleSelect?: (path: string) => void;
}

const noop = () => {};

const FileTreeContext = createContext<FileTreeContextType>({
	expandedPaths: new Set(),
	togglePath: noop,
});

export type FileTreeProps = Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> & {
	expanded?: Set<string>;
	defaultExpanded?: Set<string>;
	selectedPath?: string;
	onSelect?: (path: string) => void;
	/** Double-click a tree row (file or folder). */
	onDoubleClickPath?: (path: string) => void;
	/** Right-click a tree row (file or folder). */
	onContextMenuPath?: (path: string, event: MouseEvent) => void;
	onExpandedChange?: (expanded: Set<string>) => void;
	selectedPaths?: Set<string>;
	selecting?: boolean;
	onSelectRow?: (path: string, mods: SelectMods) => void;
	onToggleSelect?: (path: string) => void;
};

export const FileTree = ({
	expanded: controlledExpanded,
	defaultExpanded,
	selectedPath,
	onSelect,
	onDoubleClickPath,
	onContextMenuPath,
	selectedPaths,
	selecting,
	onSelectRow,
	onToggleSelect,
	onExpandedChange,
	className,
	children,
	...props
}: FileTreeProps) => {
	const [internalExpanded, setInternalExpanded] = useState<Set<string>>(
		() => defaultExpanded ?? new Set(),
	);
	const expandedPaths = controlledExpanded ?? internalExpanded;

	const togglePath = useCallback(
		(path: string) => {
			const base = controlledExpanded ?? internalExpanded;
			const newExpanded = new Set(base);
			if (newExpanded.has(path)) {
				newExpanded.delete(path);
			} else {
				newExpanded.add(path);
			}
			if (!controlledExpanded) {
				setInternalExpanded(newExpanded);
			}
			onExpandedChange?.(newExpanded);
		},
		[controlledExpanded, internalExpanded, onExpandedChange],
	);

	const contextValue = useMemo(
		() => ({
			expandedPaths,
			onSelect,
			onDoubleClickPath,
			onContextMenuPath,
			selectedPath,
			selectedPaths,
			selecting,
			onSelectRow,
			onToggleSelect,
			togglePath,
		}),
		[
			expandedPaths,
			onSelect,
			onDoubleClickPath,
			onContextMenuPath,
			selectedPath,
			selectedPaths,
			selecting,
			onSelectRow,
			onToggleSelect,
			togglePath,
		],
	);

	return (
		<FileTreeContext.Provider value={contextValue}>
			<div className={cn("text-sm", className)} role="tree" {...props}>
				{children}
			</div>
		</FileTreeContext.Provider>
	);
};

export type FileTreeIconProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeIcon = ({
	className,
	children,
	...props
}: FileTreeIconProps) => (
	<span className={cn("shrink-0", className)} {...props}>
		{children}
	</span>
);

export type FileTreeNameProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeName = ({
	className,
	children,
	...props
}: FileTreeNameProps) => (
	<span className={cn("truncate", className)} {...props}>
		{children}
	</span>
);

interface FileTreeFolderContextType {
	path: string;
	name: string;
	isExpanded: boolean;
}

const FileTreeFolderContext = createContext<FileTreeFolderContextType>({
	isExpanded: false,
	name: "",
	path: "",
});

export type FileTreeFolderProps = HTMLAttributes<HTMLDivElement> & {
	path: string;
	name: string;
};

/** Row selection checkbox — visible on hover or when a selection is active. */
function RowCheckbox({
	checked,
	show,
	onToggle,
}: {
	checked: boolean;
	show: boolean;
	onToggle: () => void;
}) {
	return (
		<span
			role="checkbox"
			aria-checked={checked}
			tabIndex={-1}
			onClick={(e) => {
				e.stopPropagation();
				onToggle();
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					e.stopPropagation();
					onToggle();
				}
			}}
			className={cn(
				"grid size-3.5 shrink-0 cursor-pointer place-items-center rounded-[4px] border transition-opacity",
				checked
					? "border-primary bg-primary text-primary-foreground opacity-100"
					: cn(
							"border-muted-foreground/40",
							show ? "opacity-100" : "opacity-0 group-hover:opacity-100",
						),
			)}
		>
			{checked ? <Check className="size-2.5" /> : null}
		</span>
	);
}

export const FileTreeFolder = ({
	path,
	name,
	className,
	children,
	...props
}: FileTreeFolderProps) => {
	const {
		expandedPaths,
		togglePath,
		selectedPath,
		selectedPaths,
		selecting,
		onSelectRow,
		onToggleSelect,
		onDoubleClickPath,
		onContextMenuPath,
	} = useContext(FileTreeContext);
	const isExpanded = expandedPaths.has(path);
	const checked = selectedPaths?.has(path) ?? false;
	const isSelected = selectedPath === path || checked;

	const folderContextValue = useMemo(
		() => ({ isExpanded, name, path }),
		[isExpanded, name, path],
	);

	return (
		<FileTreeFolderContext.Provider value={folderContextValue}>
			<div className={cn("", className)} {...props}>
				<button
					type="button"
					data-path={path}
					className={cn(
						"group flex w-full items-center gap-1 rounded px-2 py-1 text-left transition-colors hover:bg-muted/50",
						isSelected && "bg-muted",
					)}
					onClick={(e) => {
						if ((e.metaKey || e.ctrlKey || e.shiftKey) && onSelectRow) {
							onSelectRow(path, {
								meta: e.metaKey,
								ctrl: e.ctrlKey,
								shift: e.shiftKey,
							});
						} else {
							togglePath(path);
						}
					}}
					onDoubleClick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						onDoubleClickPath?.(path);
					}}
					onContextMenu={(e) => {
						onContextMenuPath?.(path, e);
					}}
					aria-expanded={isExpanded}
					role="treeitem"
				>
					{onToggleSelect ? (
						<RowCheckbox
							checked={checked}
							show={Boolean(selecting)}
							onToggle={() => onToggleSelect(path)}
						/>
					) : null}
					<ChevronRightIcon
						className={cn(
							"size-4 shrink-0 text-muted-foreground transition-transform",
							isExpanded && "rotate-90",
						)}
					/>
					<FileTreeIcon>
						{isExpanded ? (
							<FolderOpenIcon className="size-4 text-blue-500" />
						) : (
							<FolderIcon className="size-4 text-blue-500" />
						)}
					</FileTreeIcon>
					<FileTreeName>{name}</FileTreeName>
				</button>
				{isExpanded ? (
					<div className="ml-4 border-l pl-2">{children}</div>
				) : null}
			</div>
		</FileTreeFolderContext.Provider>
	);
};

interface FileTreeFileContextType {
	path: string;
	name: string;
}

const FileTreeFileContext = createContext<FileTreeFileContextType>({
	name: "",
	path: "",
});

export type FileTreeFileProps = HTMLAttributes<HTMLDivElement> & {
	path: string;
	name: string;
	icon?: ReactNode;
};

export const FileTreeFile = ({
	path,
	name,
	icon,
	className,
	children,
	...props
}: FileTreeFileProps) => {
	const {
		selectedPath,
		onSelect,
		onDoubleClickPath,
		onContextMenuPath,
		selectedPaths,
		selecting,
		onSelectRow,
		onToggleSelect,
	} = useContext(FileTreeContext);
	const checked = selectedPaths?.has(path) ?? false;
	const isSelected = selectedPath === path || checked;

	const handleClick = useCallback(
		(e: MouseEvent) => {
			if (onSelectRow) {
				onSelectRow(path, {
					meta: e.metaKey,
					ctrl: e.ctrlKey,
					shift: e.shiftKey,
				});
			} else {
				onSelect?.(path);
			}
		},
		[onSelect, onSelectRow, path],
	);

	const handleDoubleClick = useCallback(
		(e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			onDoubleClickPath?.(path);
		},
		[onDoubleClickPath, path],
	);

	const handleContextMenu = useCallback(
		(e: MouseEvent) => {
			onContextMenuPath?.(path, e);
		},
		[onContextMenuPath, path],
	);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLDivElement>) => {
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				onSelect?.(path);
			}
		},
		[onSelect, path],
	);

	const fileContextValue = useMemo(() => ({ name, path }), [name, path]);

	return (
		<FileTreeFileContext.Provider value={fileContextValue}>
			<div
				data-path={path}
				className={cn(
					"group flex cursor-pointer items-center gap-1 rounded px-2 py-1 transition-colors hover:bg-muted/50",
					isSelected && "bg-muted",
					className,
				)}
				onClick={handleClick}
				onDoubleClick={handleDoubleClick}
				onContextMenu={handleContextMenu}
				onKeyDown={handleKeyDown}
				role="treeitem"
				tabIndex={0}
				{...props}
			>
				{onToggleSelect ? (
					<RowCheckbox
						checked={checked}
						show={Boolean(selecting)}
						onToggle={() => onToggleSelect(path)}
					/>
				) : null}
				{children ?? (
					<>
						<span className="size-4 shrink-0" />
						<FileTreeIcon>
							{icon ?? <FileIcon className="size-4 text-muted-foreground" />}
						</FileTreeIcon>
						<FileTreeName>{name}</FileTreeName>
					</>
				)}
			</div>
		</FileTreeFileContext.Provider>
	);
};

export type FileTreeActionsProps = HTMLAttributes<HTMLDivElement>;

export const FileTreeActions = ({
	className,
	children,
	...props
}: FileTreeActionsProps) => (
	<div className={cn("ml-auto flex items-center gap-1", className)} {...props}>
		{children}
	</div>
);
