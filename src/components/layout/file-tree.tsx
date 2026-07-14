import {
	FileCode2,
	FileJson,
	FileText,
	FolderSearch,
	RefreshCw,
	ScrollText,
	Sparkles,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import {
	isPaperDirectory,
	isPapersRoot,
	paperDirFromPath,
} from "@/lib/paper-metadata";
import { cn } from "@/lib/utils";
import type { FileNode } from "@/lib/vault";

function MotifLogo({ className }: { className?: string }) {
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
	if (/\.json$/i.test(name)) return FileJson;
	if (/\.(ts|tsx|js|jsx|rs|toml)$/i.test(name)) return FileCode2;
	return FileText;
}

/** Expand folders by default, but never expand individual paper folders. */
function collectDefaultExpanded(nodes: FileNode[], into: Set<string>) {
	for (const n of nodes) {
		if (n.kind !== "directory") continue;
		if (isPaperDirectory(n.path)) continue;
		into.add(n.path);
		if (n.children?.length) collectDefaultExpanded(n.children, into);
	}
}

type FileTreeProps = {
	nodes: FileNode[];
	selectedPath: string | null;
	/** Called for normal files and for paper folders (collapsed leaves). */
	onSelectFile: (node: FileNode) => void;
	className?: string;
};

export function FileTree({
	nodes,
	selectedPath,
	onSelectFile,
	className,
}: FileTreeProps) {
	const { t } = useTranslation("sidebar");
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

	/** Highlight paper folder when any file under it is open. */
	const treeSelectedPath = useMemo(() => {
		if (!selectedPath) return undefined;
		const paperDir = paperDirFromPath(selectedPath);
		if (paperDir) return paperDir;
		return selectedPath;
	}, [selectedPath]);

	const renderNode = (node: FileNode, parentPath: string | null): ReactNode => {
		// papers/<id> → leaf paper entry (do not expand internals)
		const parentIsPapers = parentPath != null && isPapersRoot(parentPath);
		if (node.kind === "directory" && parentIsPapers) {
			return (
				<FileTreeFile
					key={node.id}
					path={node.path}
					name={node.name}
					icon={<ScrollText className="size-4 text-muted-foreground" />}
				/>
			);
		}

		if (node.kind === "directory") {
			return (
				<FileTreeFolder key={node.id} path={node.path} name={node.name}>
					{node.children?.map((child) => renderNode(child, node.path))}
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
				<p className="px-3 py-2 text-muted-foreground text-xs">
					{t("fileTree.empty")}
				</p>
			) : (
				<AiFileTree
					selectedPath={treeSelectedPath}
					expanded={expanded}
					onExpandedChange={setExpanded}
					onSelect={(path) => {
						const node = byPath.get(path);
						if (!node) return;
						if (node.kind === "file" || isPaperDirectory(node.path)) {
							onSelectFile(node);
						}
					}}
				>
					{nodes.map((node) => renderNode(node, null))}
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
	const { t } = useTranslation("sidebar");
	return (
		<TooltipProvider delayDuration={300}>
			<div className="shrink-0">
				<PaneHeader
					className="bg-muted/20"
					trailing={
						<>
							<IconAction
								label={t("fileTree.openVault")}
								onClick={onOpenVault}
								disabled={busy}
							>
								<FolderSearch className="size-3.5" />
							</IconAction>
							<IconAction
								label={t("fileTree.refresh")}
								onClick={onRefresh}
								disabled={busy || isDemo}
							>
								<RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
							</IconAction>
							{!isDemo ? (
								<IconAction
									label={t("fileTree.useDemo")}
									onClick={onUseDemo}
									disabled={busy}
								>
									<Sparkles className="size-3.5" />
								</IconAction>
							) : null}
						</>
					}
				>
					<MotifLogo className="size-4 shrink-0 text-foreground" />
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
