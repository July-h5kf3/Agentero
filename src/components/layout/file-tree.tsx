import {
	FileCode2,
	FileJson,
	FilePlus2,
	FileText,
	FolderPlus,
	Library,
	ScrollText,
	WandSparkles,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
	FileTree as AiFileTree,
	FileTreeFile,
	FileTreeFolder,
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
import { isPaperDirectory, paperDirFromPath } from "@/lib/paper-metadata";
import { LIBRARY_VIRTUAL_PATH } from "@/lib/papers-api";
import { cn } from "@/lib/utils";
import type { FileNode } from "@/lib/vault";

export type TreeCreateKind = "file" | "folder";

export type TreeCreateDraft = {
	kind: TreeCreateKind;
	/** Absolute path of the parent directory (vault root or folder). */
	parentPath: string;
};

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

function pathKey(path: string): string {
	return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Expand folders by default, but never expand individual paper folders. */
function collectDefaultExpanded(nodes: FileNode[], into: Set<string>) {
	for (const n of nodes) {
		if (n.kind !== "directory") continue;
		if (isPaperDirectory(n.path, n.children)) continue;
		into.add(n.path);
		if (n.children?.length) collectDefaultExpanded(n.children, into);
	}
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
	className?: string;
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

	/** Highlight paper folder when any file under it is open; keep virtual library selected. */
	const treeSelectedPath = useMemo(() => {
		if (!selectedPath) return undefined;
		if (selectedPath === LIBRARY_VIRTUAL_PATH) return LIBRARY_VIRTUAL_PATH;
		const paperDir = paperDirFromPath(selectedPath);
		if (paperDir) return paperDir;
		return selectedPath;
	}, [selectedPath]);

	const draftHere = useCallback(
		(parentAbs: string) =>
			Boolean(
				createDraft && pathKey(createDraft.parentPath) === pathKey(parentAbs),
			),
		[createDraft],
	);

	const createRow =
		createDraft && vaultPath ? (
			<TreeCreateInput
				key={`create-${createDraft.kind}-${createDraft.parentPath}`}
				kind={createDraft.kind}
				onConfirm={onConfirmCreate}
				onCancel={onCancelCreate}
			/>
		) : null;

	const renderNode = (node: FileNode): ReactNode => {
		// Paper folder (any depth under papers/) → leaf; org folders expand
		if (
			node.kind === "directory" &&
			isPaperDirectory(node.path, node.children)
		) {
			const creatingInside = draftHere(node.path);
			return (
				<div key={node.id}>
					<FileTreeFile
						path={node.path}
						name={node.name}
						icon={<ScrollText className="size-4 text-muted-foreground" />}
					/>
					{creatingInside ? (
						<div className="ml-4 border-l pl-2">{createRow}</div>
					) : null}
				</div>
			);
		}

		if (node.kind === "directory") {
			return (
				<FileTreeFolder key={node.id} path={node.path} name={node.name}>
					{draftHere(node.path) ? createRow : null}
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

	const rootCreate =
		createDraft && vaultPath && draftHere(vaultPath) ? createRow : null;

	return (
		<div className={cn("select-none py-1 text-sm", className)}>
			{nodes.length === 0 && !createDraft ? (
				<>
					{/* Virtual library node still useful on empty vault */}
					<AiFileTree
						selectedPath={treeSelectedPath}
						expanded={expanded}
						onExpandedChange={setExpanded}
						onSelect={(path) => {
							if (createDraft) return;
							if (path === LIBRARY_VIRTUAL_PATH) {
								onSelectLibrary?.();
							}
						}}
					>
						<FileTreeFile
							path={LIBRARY_VIRTUAL_PATH}
							name={t("papersLibrary.title")}
							icon={<Library className="size-4 text-muted-foreground" />}
						/>
					</AiFileTree>
					<p className="px-3 py-2 text-muted-foreground text-xs">
						{t("fileTree.empty")}
					</p>
				</>
			) : (
				<AiFileTree
					selectedPath={treeSelectedPath}
					expanded={expanded}
					onExpandedChange={setExpanded}
					onSelect={(path) => {
						// Don't navigate away while naming a new entry.
						if (createDraft) return;
						if (path === LIBRARY_VIRTUAL_PATH) {
							onSelectLibrary?.();
							return;
						}
						const node = byPath.get(path);
						if (!node) return;
						if (
							node.kind === "file" ||
							isPaperDirectory(node.path, node.children)
						) {
							onSelectFile(node);
						}
					}}
				>
					{/* Virtual root: papers library table (not a real folder) */}
					<FileTreeFile
						path={LIBRARY_VIRTUAL_PATH}
						name={t("papersLibrary.title")}
						icon={<Library className="size-4 text-muted-foreground" />}
					/>
					{rootCreate}
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
	onNewFile,
	onNewFolder,
	/** Vault-relative papers parent, e.g. `papers` or `papers/nlp` */
	lookupParentDir,
	onLookupSubmit,
	busy,
	error,
	isDemo,
}: {
	title: string;
	onNewFile: () => void;
	onNewFolder: () => void;
	lookupParentDir: string;
	onLookupSubmit: (text: string) => Promise<void>;
	busy?: boolean;
	error?: string | null;
	isDemo: boolean;
}) {
	const { t } = useTranslation("sidebar");
	const [wandOpen, setWandOpen] = useState(false);
	const [lookupText, setLookupText] = useState("");
	const [lookupBusy, setLookupBusy] = useState(false);
	const [lookupError, setLookupError] = useState<string | null>(null);

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

	const actionsDisabled = busy || isDemo || lookupBusy;

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
											disabled={lookupBusy}
											className="h-8 text-xs"
										/>
										{lookupError ? (
											<p className="text-destructive text-xs leading-snug">
												{lookupError}
											</p>
										) : null}
										<div className="flex justify-end">
											<Button
												type="submit"
												size="sm"
												className="h-7 px-2.5 text-xs"
												disabled={lookupBusy || !lookupText.trim()}
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
