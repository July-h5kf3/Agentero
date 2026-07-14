import {
	ChevronDown,
	ChevronRight,
	FileCode2,
	FileJson,
	FileText,
	Folder,
	FolderOpen,
	FolderOpenDot,
	FolderSearch,
	RefreshCw,
	Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FileNode } from "@/lib/vault";

function fileIcon(name: string) {
	if (/\.json$/i.test(name)) return FileJson;
	if (/\.(ts|tsx|js|jsx|rs|toml)$/i.test(name)) return FileCode2;
	return FileText;
}

type FileTreeProps = {
	nodes: FileNode[];
	selectedPath: string | null;
	onSelectFile: (node: FileNode) => void;
	className?: string;
};

export function FileTree({
	nodes,
	selectedPath,
	onSelectFile,
	className,
}: FileTreeProps) {
	const defaultOpen = useMemo(() => {
		const open = new Set<string>();
		for (const n of nodes) {
			if (n.kind === "directory") open.add(n.path);
		}
		return open;
	}, [nodes]);

	const [expanded, setExpanded] = useState<Set<string>>(defaultOpen);

	useEffect(() => {
		setExpanded(defaultOpen);
	}, [defaultOpen]);

	const toggle = (path: string) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	};

	return (
		<div className={cn("select-none py-1 text-sm", className)}>
			{nodes.length === 0 ? (
				<p className="px-3 py-2 text-muted-foreground text-xs">Empty folder</p>
			) : (
				nodes.map((node) => (
					<TreeNode
						key={node.id}
						node={node}
						depth={0}
						expanded={expanded}
						selectedPath={selectedPath}
						onToggle={toggle}
						onSelectFile={onSelectFile}
					/>
				))
			)}
		</div>
	);
}

type TreeNodeProps = {
	node: FileNode;
	depth: number;
	expanded: Set<string>;
	selectedPath: string | null;
	onToggle: (path: string) => void;
	onSelectFile: (node: FileNode) => void;
};

function TreeNode({
	node,
	depth,
	expanded,
	selectedPath,
	onToggle,
	onSelectFile,
}: TreeNodeProps) {
	const isDir = node.kind === "directory";
	const isOpen = isDir && expanded.has(node.path);
	const isSelected = selectedPath === node.path;
	const Icon = isDir ? (isOpen ? FolderOpen : Folder) : fileIcon(node.name);

	return (
		<div>
			<button
				type="button"
				className={cn(
					"flex w-full items-center gap-1 rounded-sm px-1 py-0.5 text-left outline-none",
					"hover:bg-accent/70 focus-visible:ring-1 focus-visible:ring-ring",
					isSelected && "bg-accent text-accent-foreground",
				)}
				style={{ paddingLeft: 8 + depth * 12 }}
				aria-expanded={isDir ? isOpen : undefined}
				onClick={() => {
					if (isDir) onToggle(node.path);
					else onSelectFile(node);
				}}
				title={node.path}
			>
				<span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
					{isDir ? (
						isOpen ? (
							<ChevronDown className="size-3.5" />
						) : (
							<ChevronRight className="size-3.5" />
						)
					) : (
						<span className="size-3.5" />
					)}
				</span>
				<Icon className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="truncate">{node.name}</span>
			</button>
			{isDir && isOpen && node.children?.length
				? node.children.map((child) => (
						<TreeNode
							key={child.id}
							node={child}
							depth={depth + 1}
							expanded={expanded}
							selectedPath={selectedPath}
							onToggle={onToggle}
							onSelectFile={onSelectFile}
						/>
					))
				: null}
			{isDir && isOpen && (!node.children || node.children.length === 0) ? (
				<div
					className="px-2 py-0.5 text-muted-foreground text-xs"
					style={{ paddingLeft: 28 + depth * 12 }}
				>
					Empty
				</div>
			) : null}
		</div>
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
	children: React.ReactNode;
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
	onOpenVault,
	onRefresh,
	onUseDemo,
	busy,
	error,
	isDemo,
}: {
	title: string;
	onOpenVault: () => void;
	onRefresh: () => void;
	onUseDemo: () => void;
	busy?: boolean;
	error?: string | null;
	isDemo: boolean;
}) {
	return (
		<TooltipProvider delayDuration={300}>
			<div className="flex flex-col gap-0.5 border-b px-1.5 py-1.5">
				<div className="flex min-w-0 items-center gap-0.5">
					<span className="flex min-w-0 flex-1 items-center gap-1.5 px-1">
						{isDemo ? (
							<FolderOpenDot className="size-3.5 shrink-0 text-muted-foreground" />
						) : (
							<FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
						)}
						<span className="truncate font-medium text-sm" title={title}>
							{title}
						</span>
					</span>
					<div className="flex shrink-0 items-center">
						<IconAction
							label="Open vault"
							onClick={onOpenVault}
							disabled={busy}
						>
							<FolderSearch className="size-3.5" />
						</IconAction>
						<IconAction
							label="Refresh"
							onClick={onRefresh}
							disabled={busy || isDemo}
						>
							<RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
						</IconAction>
						{!isDemo ? (
							<IconAction
								label="Use demo vault"
								onClick={onUseDemo}
								disabled={busy}
							>
								<Sparkles className="size-3.5" />
							</IconAction>
						) : null}
					</div>
				</div>
				{error ? (
					<p className="px-1 text-destructive text-xs leading-snug">{error}</p>
				) : null}
			</div>
		</TooltipProvider>
	);
}
