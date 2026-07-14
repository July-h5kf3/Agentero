import {
	FileCode2,
	FileJson,
	FileText,
	FolderOpen,
	FolderOpenDot,
	FolderSearch,
	RefreshCw,
	Sparkles,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
	FileTree as AiFileTree,
	FileTreeFile,
	FileTreeFolder,
} from "@/components/ai-elements/file-tree";
import { PaneHeader } from "@/components/layout/pane-header";
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

function collectDefaultExpanded(nodes: FileNode[], into: Set<string>) {
	for (const n of nodes) {
		if (n.kind === "directory") {
			into.add(n.path);
			if (n.children?.length) collectDefaultExpanded(n.children, into);
		}
	}
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
	const defaultExpanded = useMemo(() => {
		const open = new Set<string>();
		collectDefaultExpanded(nodes, open);
		return open;
	}, [nodes]);

	const [expanded, setExpanded] = useState<Set<string>>(defaultExpanded);

	useEffect(() => {
		setExpanded(defaultExpanded);
	}, [defaultExpanded]);

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

	const renderNode = (node: FileNode): ReactNode => {
		if (node.kind === "directory") {
			return (
				<FileTreeFolder key={node.id} path={node.path} name={node.name}>
					{node.children?.map((child) => renderNode(child))}
				</FileTreeFolder>
			);
		}
		const Icon = fileIcon(node.name);
		return (
			<FileTreeFile
				key={node.id}
				path={node.path}
				name={node.name}
				icon={<Icon className="size-4 text-muted-foreground" />}
			/>
		);
	};

	return (
		<div className={cn("select-none py-1 text-sm", className)}>
			{nodes.length === 0 ? (
				<p className="px-3 py-2 text-muted-foreground text-xs">Empty folder</p>
			) : (
				<AiFileTree
					selectedPath={selectedPath ?? undefined}
					expanded={expanded}
					onExpandedChange={setExpanded}
					onSelect={(path) => {
						const node = byPath.get(path);
						if (node?.kind === "file") onSelectFile(node);
					}}
				>
					{nodes.map((node) => renderNode(node))}
				</AiFileTree>
			)}
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
			<div className="shrink-0">
				<PaneHeader
					className="bg-muted/20"
					trailing={
						<>
							<IconAction
								label="Open vault (⌘O)"
								onClick={onOpenVault}
								disabled={busy}
							>
								<FolderSearch className="size-3.5" />
							</IconAction>
							<IconAction
								label="Refresh (⌘R)"
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
						</>
					}
				>
					{isDemo ? (
						<FolderOpenDot className="size-3.5 shrink-0 text-muted-foreground" />
					) : (
						<FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
					)}
					<span className="truncate font-medium text-sm" title={title}>
						{title}
					</span>
				</PaneHeader>
				{error ? (
					<p className="border-b px-3 py-1 text-destructive text-xs leading-snug">
						{error}
					</p>
				) : null}
			</div>
		</TooltipProvider>
	);
}
