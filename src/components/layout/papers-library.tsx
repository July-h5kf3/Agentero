/**
 * Vault library: table of all papers from catalog.sqlite (display only).
 * Click column headers to sort ascending / descending.
 * Single-click a cell to copy that field (deferred so double-click can cancel);
 * double-click a row to open the paper without copying.
 * Reading heat: title text background as a left→right spine (doc start→end).
 * Optional tag filter chips above the table.
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw, X } from "lucide-react";
import {
	Fragment,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ReadingTitleHeat } from "@/components/layout/reading-heatmap";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuLabel,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { PaperMetadata } from "@/lib/paper-metadata";
import { filterPapersByScope } from "@/lib/papers-api";
import {
	heatmapCacheKey,
	loadReadingHeatmaps,
	type ReadingHeatmap,
} from "@/lib/reading-heatmap";
import {
	DEFAULT_LIBRARY_COLUMNS,
	type LibraryColumnKey,
	type LibraryColumnPref,
} from "@/lib/settings";
import {
	coercePaperTags,
	type PaperTag,
	tagChipStyle,
	tagSwatchStyle,
} from "@/lib/tag-colors";
import { cn } from "@/lib/utils";

export type PapersLibraryProps = {
	/** Full catalog list (or pre-scoped); further filtered by `scopePath`. */
	papers: PaperMetadata[];
	/** Vault root; required to load per-paper reading heatmaps. */
	vaultPath?: string | null;
	/** When the Library tab is focused — reload heatmaps (after PDF activity). */
	active?: boolean;
	loading?: boolean;
	query?: string;
	/**
	 * Vault-relative folder scope (e.g. `papers/nlp`).
	 * Null/empty = full library. Filters by catalog `path` prefix (recursive).
	 */
	scopePath?: string | null;
	/** Active tag filter (exact match, case-insensitive). */
	tagFilter?: string | null;
	onTagFilterChange?: (tag: string | null) => void;
	onOpenPaper: (paper: PaperMetadata) => void;
	/**
	 * Column order + visibility (persisted in settings). When omitted, all
	 * columns show in canonical order.
	 */
	columns?: LibraryColumnPref[];
	/** Persist a new column layout (reorder / show-hide / reset). */
	onColumnsChange?: (columns: LibraryColumnPref[]) => void;
	/** Rebuild the catalog from papers/ on disk (empty-state recovery). */
	onRescan?: () => void;
	rescanning?: boolean;
	className?: string;
};

/**
 * Delay before committing a cell-copy click.
 * Must outlast a typical double-click interval so the first half of a
 * double-click does not copy before `detail > 1` / `dblclick` can cancel it.
 */
const CELL_COPY_CLICK_DELAY_MS = 320;

type SortKey = LibraryColumnKey;
type SortDir = "asc" | "desc";

/** Per-column display metadata (i18n label + fixed layout weight). */
const COLUMN_META = {
	title: {
		labelKey: "papersLibrary.colTitle",
		widthWeight: 32,
		headerClassName: "min-w-[240px]",
	},
	authors: {
		labelKey: "papersLibrary.colAuthors",
		widthWeight: 18,
		headerClassName: "min-w-[140px]",
	},
	year: {
		labelKey: "papersLibrary.colYear",
		widthWeight: 8,
		headerClassName: "min-w-16",
	},
	tags: {
		labelKey: "papersLibrary.colTags",
		widthWeight: 18,
		headerClassName: "min-w-[120px]",
	},
	type: {
		labelKey: "papersLibrary.colType",
		widthWeight: 10,
		headerClassName: "min-w-24",
	},
	id: {
		labelKey: "papersLibrary.colId",
		widthWeight: 14,
		headerClassName: "min-w-[160px]",
	},
} as const satisfies Record<
	SortKey,
	{ labelKey: string; widthWeight: number; headerClassName: string }
>;

/** Move `fromKey` to sit just before `toKey` in the full column list. */
function reorderColumns(
	cols: LibraryColumnPref[],
	fromKey: SortKey,
	toKey: SortKey,
): LibraryColumnPref[] {
	if (fromKey === toKey) return cols;
	const arr = [...cols];
	const fromIdx = arr.findIndex((c) => c.key === fromKey);
	if (fromIdx < 0) return cols;
	const [moved] = arr.splice(fromIdx, 1);
	const toIdx = arr.findIndex((c) => c.key === toKey);
	if (toIdx < 0) return cols;
	arr.splice(toIdx, 0, moved);
	return arr;
}

/** Toggle a column's visibility (title is kept visible by the caller). */
function toggleColumnVisibility(
	cols: LibraryColumnPref[],
	key: SortKey,
): LibraryColumnPref[] {
	return cols.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c));
}

function formatAuthors(authors: string[] | undefined): string {
	if (!authors?.length) return "—";
	if (authors.length <= 2) return authors.join(", ");
	return `${authors[0]} et al.`;
}

/** Full author list for clipboard (not the abbreviated display form). */
function authorsCopyText(authors: string[] | undefined): string | null {
	if (!authors?.length) return null;
	return authors.join(", ");
}

function identifierLabel(p: PaperMetadata): string {
	if (p.arxiv_id) return p.arxiv_id;
	if (p.doi) return p.doi;
	if (p.pmid) return `PMID:${p.pmid}`;
	return p.id || "—";
}

function identifierCopyText(p: PaperMetadata): string | null {
	const label = identifierLabel(p);
	return label && label !== "—" ? label : null;
}

function paperHasTag(p: PaperMetadata, tag: string): boolean {
	const needle = tag.toLocaleLowerCase();
	return coercePaperTags(p.tags).some(
		(t) => t.name.toLocaleLowerCase() === needle,
	);
}

function paperTagNames(p: PaperMetadata): string[] {
	return coercePaperTags(p.tags).map((t) => t.name);
}

function sortValue(p: PaperMetadata, key: SortKey): string | number {
	switch (key) {
		case "title":
			return (p.title ?? "").toLocaleLowerCase();
		case "authors":
			return (p.authors?.[0] ?? "").toLocaleLowerCase();
		case "year":
			return p.year ?? Number.NEGATIVE_INFINITY;
		case "type":
			return (p.type ?? "").toLocaleLowerCase();
		case "id":
			return identifierLabel(p).toLocaleLowerCase();
		case "tags":
			return paperTagNames(p).join(", ").toLocaleLowerCase();
	}
}

function comparePapers(
	a: PaperMetadata,
	b: PaperMetadata,
	key: SortKey,
	dir: SortDir,
): number {
	const av = sortValue(a, key);
	const bv = sortValue(b, key);
	let cmp = 0;
	if (typeof av === "number" && typeof bv === "number") {
		cmp = av - bv;
	} else {
		cmp = String(av).localeCompare(String(bv), undefined, {
			numeric: true,
			sensitivity: "base",
		});
	}
	if (cmp === 0) {
		// Stable secondary: title then id
		cmp = (a.title ?? "").localeCompare(b.title ?? "", undefined, {
			sensitivity: "base",
		});
		if (cmp === 0) cmp = (a.id ?? "").localeCompare(b.id ?? "");
	}
	return dir === "asc" ? cmp : -cmp;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
	if (!active) {
		return <ArrowUpDown className="size-3 shrink-0 opacity-40" aria-hidden />;
	}
	return dir === "asc" ? (
		<ArrowUp className="size-3 shrink-0 text-foreground" aria-hidden />
	) : (
		<ArrowDown className="size-3 shrink-0 text-foreground" aria-hidden />
	);
}

function TagChip({
	tag,
	color,
	active,
	onClick,
}: {
	tag: string;
	color?: PaperTag["color"];
	active?: boolean;
	onClick?: () => void;
}) {
	const colored = !active ? tagChipStyle(color) : undefined;
	const body = (
		<>
			{color && !active ? (
				<span
					className="size-1.5 shrink-0 rounded-full ring-1 ring-black/10"
					style={tagSwatchStyle(color)}
					aria-hidden
				/>
			) : null}
			{tag}
		</>
	);
	if (!onClick) {
		return (
			<span
				className={cn(
					"inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] leading-none",
					active
						? "bg-foreground text-background"
						: colored
							? "font-medium"
							: "bg-muted text-muted-foreground",
				)}
				style={colored}
			>
				{body}
			</span>
		);
	}
	return (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
			className={cn(
				"inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] leading-none",
				"cursor-pointer transition-colors",
				active
					? "bg-foreground text-background hover:bg-foreground/90"
					: colored
						? "font-medium hover:opacity-90"
						: "bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground",
			)}
			style={colored}
		>
			{body}
		</button>
	);
}

export function PapersLibrary({
	papers,
	vaultPath = null,
	active = true,
	loading,
	query,
	scopePath = null,
	tagFilter = null,
	onTagFilterChange,
	onOpenPaper,
	columns = DEFAULT_LIBRARY_COLUMNS,
	onColumnsChange,
	onRescan,
	rescanning,
	className,
}: PapersLibraryProps) {
	const { t, i18n } = useTranslation("sidebar");
	const [sortKey, setSortKey] = useState<SortKey>("title");
	const [sortDir, setSortDir] = useState<SortDir>("asc");
	const [heatmaps, setHeatmaps] = useState<Map<string, ReadingHeatmap>>(
		() => new Map(),
	);
	/** Pending cell-copy timer — cleared when a double-click opens the paper. */
	const pendingCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const cancelPendingCopy = useCallback(() => {
		if (pendingCopyTimerRef.current != null) {
			clearTimeout(pendingCopyTimerRef.current);
			pendingCopyTimerRef.current = null;
		}
	}, []);

	useEffect(() => () => cancelPendingCopy(), [cancelPendingCopy]);

	const handleSort = useCallback(
		(key: SortKey) => {
			if (key === sortKey) {
				setSortDir((d) => (d === "asc" ? "desc" : "asc"));
				return;
			}
			setSortKey(key);
			// Year defaults to newest first; text columns ascending
			setSortDir(key === "year" ? "desc" : "asc");
		},
		[sortKey],
	);

	/** Single-click a cell → copy that field; skip empty placeholders. */
	const copyField = useCallback(
		async (text: string | null | undefined, label: string) => {
			const value = text?.trim();
			if (!value || value === "—") return;
			try {
				if (
					typeof navigator === "undefined" ||
					!navigator.clipboard?.writeText
				) {
					throw new Error("clipboard unavailable");
				}
				await navigator.clipboard.writeText(value);
				notifySuccess(t("papersLibrary.copied", { label }), {
					duration: 1500,
					id: "papers-library-copied",
				});
			} catch {
				notifyError(t("papersLibrary.copyFailed"));
			}
		},
		[t],
	);

	/**
	 * Cell click → schedule copy. Double-click fires a second click with
	 * `detail > 1` plus `dblclick` on the row; both cancel the pending copy
	 * so opening a paper does not also write the clipboard.
	 */
	const onCellCopy = useCallback(
		(e: ReactMouseEvent, text: string | null | undefined, label: string) => {
			// Second (or later) click of a multi-click: abort any scheduled copy.
			if (e.detail > 1) {
				cancelPendingCopy();
				return;
			}
			cancelPendingCopy();
			pendingCopyTimerRef.current = setTimeout(() => {
				pendingCopyTimerRef.current = null;
				void copyField(text, label);
			}, CELL_COPY_CLICK_DELAY_MS);
		},
		[cancelPendingCopy, copyField],
	);

	const openPaperFromRow = useCallback(
		(paper: PaperMetadata) => {
			cancelPendingCopy();
			onOpenPaper(paper);
		},
		[cancelPendingCopy, onOpenPaper],
	);

	// --- Column customization (order + visibility) ---
	const [dragKey, setDragKey] = useState<SortKey | null>(null);
	const [dragOverKey, setDragOverKey] = useState<SortKey | null>(null);

	/** Ordered, visible columns (title stays as a safety fallback). */
	const visibleColumns = useMemo(() => {
		const vis = columns.filter((c) => c.visible);
		return vis.length ? vis : columns.filter((c) => c.key === "title");
	}, [columns]);
	const visibleColumnWeight = useMemo(
		() =>
			visibleColumns.reduce(
				(total, col) => total + COLUMN_META[col.key].widthWeight,
				0,
			),
		[visibleColumns],
	);

	const toggleColumn = useCallback(
		(key: SortKey) => {
			if (!onColumnsChange || key === "title") return;
			onColumnsChange(toggleColumnVisibility(columns, key));
		},
		[columns, onColumnsChange],
	);

	const resetColumns = useCallback(() => {
		onColumnsChange?.(DEFAULT_LIBRARY_COLUMNS.map((c) => ({ ...c })));
	}, [onColumnsChange]);

	const handleColumnDrop = useCallback(
		(toKey: SortKey) => {
			const from = dragKey;
			setDragKey(null);
			setDragOverKey(null);
			if (!onColumnsChange || !from) return;
			onColumnsChange(reorderColumns(columns, from, toKey));
		},
		[columns, dragKey, onColumnsChange],
	);

	/** Render one table cell for a column key (order-independent). */
	const renderCell = useCallback(
		(
			key: SortKey,
			p: PaperMetadata,
			heat: ReadingHeatmap | undefined,
		): ReactNode => {
			switch (key) {
				case "title":
					return (
						<td className="min-w-0 max-w-0 overflow-hidden px-3 py-2.5">
							<button
								type="button"
								className={cn(
									"block w-full cursor-pointer rounded-sm text-left font-medium",
									"hover:bg-muted/60",
									"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
								)}
								title={
									p.title
										? t("papersLibrary.copyHint", {
												label: t("papersLibrary.colTitle"),
											})
										: undefined
								}
								aria-label={t("papersLibrary.copyHint", {
									label: t("papersLibrary.colTitle"),
								})}
								onClick={(e) =>
									onCellCopy(e, p.title, t("papersLibrary.colTitle"))
								}
							>
								<ReadingTitleHeat heatmap={heat} className="line-clamp-1">
									<span className="block truncate" title={p.title}>
										{p.title}
									</span>
								</ReadingTitleHeat>
							</button>
							{p.publication ? (
								<button
									type="button"
									className={cn(
										"mt-0.5 block w-full cursor-pointer rounded-sm text-left text-muted-foreground text-xs",
										"hover:bg-muted/60 hover:text-foreground",
										"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
									)}
									title={t("papersLibrary.copyHint", {
										label: t("papersLibrary.colPublication"),
									})}
									aria-label={t("papersLibrary.copyHint", {
										label: t("papersLibrary.colPublication"),
									})}
									onClick={(e) =>
										onCellCopy(
											e,
											p.publication,
											t("papersLibrary.colPublication"),
										)
									}
								>
									<span className="line-clamp-1" title={p.publication}>
										{p.publication}
									</span>
								</button>
							) : null}
						</td>
					);
				case "authors":
					return (
						<td className="min-w-0 max-w-0 overflow-hidden px-3 py-2.5 text-muted-foreground text-xs">
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										className={cn(
											"block w-full cursor-pointer rounded-sm text-left",
											"hover:bg-muted/60 hover:text-foreground",
											"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
										)}
										title={
											authorsCopyText(p.authors)
												? t("papersLibrary.copyHint", {
														label: t("papersLibrary.colAuthors"),
													})
												: undefined
										}
										aria-label={t("papersLibrary.copyHint", {
											label: t("papersLibrary.colAuthors"),
										})}
										onClick={(e) =>
											onCellCopy(
												e,
												authorsCopyText(p.authors),
												t("papersLibrary.colAuthors"),
											)
										}
									>
										<span>{formatAuthors(p.authors)}</span>
									</button>
								</TooltipTrigger>
								{p.authors && p.authors.length > 2 ? (
									<TooltipContent side="top" align="start" className="max-w-xs">
										{p.authors.join(", ")}
									</TooltipContent>
								) : null}
							</Tooltip>
						</td>
					);
				case "year":
					return (
						<td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground text-xs">
							<button
								type="button"
								className={cn(
									"cursor-pointer rounded-sm px-0.5",
									"hover:bg-muted/60 hover:text-foreground",
									"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
								)}
								title={
									p.year != null
										? t("papersLibrary.copyHint", {
												label: t("papersLibrary.colYear"),
											})
										: undefined
								}
								aria-label={t("papersLibrary.copyHint", {
									label: t("papersLibrary.colYear"),
								})}
								onClick={(e) =>
									onCellCopy(
										e,
										p.year != null ? String(p.year) : null,
										t("papersLibrary.colYear"),
									)
								}
							>
								{p.year ?? "—"}
							</button>
						</td>
					);
				case "tags":
					return (
						<td className="min-w-0 max-w-0 overflow-hidden px-3 py-2.5">
							{coercePaperTags(p.tags).length ? (
								<div className="flex flex-wrap gap-1">
									{coercePaperTags(p.tags).map((tag) => {
										const active =
											tagFilter != null &&
											tag.name.toLocaleLowerCase() ===
												tagFilter.toLocaleLowerCase();
										const colored = !active
											? tagChipStyle(tag.color)
											: undefined;
										return (
											<button
												key={tag.name}
												type="button"
												className={cn(
													"inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] leading-none",
													"cursor-pointer transition-colors",
													"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
													active
														? "bg-foreground text-background hover:bg-foreground/90"
														: colored
															? "font-medium hover:opacity-90"
															: "bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground",
												)}
												style={colored}
												title={t("papersLibrary.copyHint", {
													label: t("papersLibrary.colTags"),
												})}
												aria-label={t("papersLibrary.copyHint", {
													label: tag.name,
												})}
												onClick={(e) =>
													onCellCopy(e, tag.name, t("papersLibrary.colTags"))
												}
											>
												{tag.color && !active ? (
													<span
														className="size-1.5 shrink-0 rounded-full ring-1 ring-black/10"
														style={tagSwatchStyle(tag.color)}
														aria-hidden
													/>
												) : null}
												{tag.name}
											</button>
										);
									})}
								</div>
							) : (
								<span className="text-muted-foreground text-xs">—</span>
							)}
						</td>
					);
				case "type":
					return (
						<td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground text-xs capitalize">
							<button
								type="button"
								className={cn(
									"cursor-pointer rounded-sm px-0.5",
									"hover:bg-muted/60 hover:text-foreground",
									"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
								)}
								title={
									p.type
										? t("papersLibrary.copyHint", {
												label: t("papersLibrary.colType"),
											})
										: undefined
								}
								aria-label={t("papersLibrary.copyHint", {
									label: t("papersLibrary.colType"),
								})}
								onClick={(e) =>
									onCellCopy(e, p.type, t("papersLibrary.colType"))
								}
							>
								{p.type || "—"}
							</button>
						</td>
					);
				case "id":
					return (
						<td className="min-w-0 max-w-0 overflow-hidden px-3 py-2.5 font-mono text-muted-foreground text-xs">
							<button
								type="button"
								className={cn(
									"block w-full cursor-pointer rounded-sm text-left",
									"hover:bg-muted/60 hover:text-foreground",
									"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
								)}
								title={
									identifierCopyText(p)
										? t("papersLibrary.copyHint", {
												label: t("papersLibrary.colId"),
											})
										: undefined
								}
								aria-label={t("papersLibrary.copyHint", {
									label: t("papersLibrary.colId"),
								})}
								onClick={(e) =>
									onCellCopy(e, identifierCopyText(p), t("papersLibrary.colId"))
								}
							>
								<span className="line-clamp-1" title={identifierLabel(p)}>
									{identifierLabel(p)}
								</span>
							</button>
						</td>
					);
			}
		},
		[t, onCellCopy, tagFilter],
	);

	/** Folder scope first (cheap path-prefix filter on in-memory catalog). */
	const scopedPapers = useMemo(
		() => filterPapersByScope(papers, scopePath),
		[papers, scopePath],
	);

	/** Load reading heatmaps for the current folder scope (full library or org folder). */
	useEffect(() => {
		if (!active) return;
		if (!vaultPath || !scopedPapers.length) {
			setHeatmaps(new Map());
			return;
		}
		let cancelled = false;
		void loadReadingHeatmaps(vaultPath, scopedPapers, { concurrency: 6 }).then(
			(map) => {
				if (!cancelled) setHeatmaps(map);
			},
		);
		return () => {
			cancelled = true;
		};
	}, [vaultPath, scopedPapers, active]);

	const allTags = useMemo(() => {
		/** name → first-seen PaperTag (keeps color for filter chips). */
		const map = new Map<string, PaperTag>();
		for (const p of scopedPapers) {
			for (const tag of coercePaperTags(p.tags)) {
				const key = tag.name.toLocaleLowerCase();
				if (!map.has(key)) map.set(key, tag);
				else if (!map.get(key)?.color && tag.color) map.set(key, tag);
			}
		}
		return [...map.values()].sort((a, b) =>
			a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
		);
	}, [scopedPapers]);

	const normalizedQuery = (query ?? "").trim().toLocaleLowerCase();

	const rows = useMemo(() => {
		let filtered = scopedPapers;
		if (normalizedQuery) {
			filtered = filtered.filter((p) => {
				const title = (p.title ?? "").toLocaleLowerCase();
				const tags = paperTagNames(p).join(" ").toLocaleLowerCase();
				return (
					title.includes(normalizedQuery) || tags.includes(normalizedQuery)
				);
			});
		}
		if (tagFilter) {
			filtered = filtered.filter((p) => paperHasTag(p, tagFilter));
		}
		const copy = [...filtered];
		copy.sort((a, b) => comparePapers(a, b, sortKey, sortDir));
		return copy;
	}, [scopedPapers, sortKey, sortDir, normalizedQuery, tagFilter]);

	const scrollRef = useRef<HTMLDivElement>(null);
	const rowVirtualizer = useVirtualizer({
		count: rows.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => 52,
		overscan: 12,
	});
	const virtualRows = rowVirtualizer.getVirtualItems();
	const totalSize = rowVirtualizer.getTotalSize();
	const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
	const paddingBottom =
		virtualRows.length > 0
			? totalSize - virtualRows[virtualRows.length - 1].end
			: 0;

	if (loading) {
		return (
			<div
				className={cn(
					"flex min-h-0 flex-1 items-center justify-center text-muted-foreground text-sm",
					className,
				)}
			>
				{t("papersLibrary.loading")}
			</div>
		);
	}

	const searching = normalizedQuery.length > 0 || Boolean(tagFilter);

	if (!rows.length && !allTags.length) {
		return (
			<div
				className={cn(
					"flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center",
					className,
				)}
			>
				<p className="font-medium text-sm">
					{searching
						? t("papersLibrary.noMatch")
						: t("papersLibrary.emptyTitle")}
				</p>
				{searching ? null : (
					<p className="max-w-sm text-muted-foreground text-xs">
						{t("papersLibrary.emptyHint")}
					</p>
				)}
				{!searching && onRescan ? (
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="mt-1"
						disabled={rescanning}
						onClick={onRescan}
					>
						<RefreshCw
							className={cn("size-3.5", rescanning && "animate-spin")}
						/>
						{t("papersLibrary.rescan")}
					</Button>
				) : null}
			</div>
		);
	}

	return (
		<div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
			{allTags.length > 0 && onTagFilterChange ? (
				<div className="flex shrink-0 flex-wrap items-center gap-1 border-b px-3 py-2">
					<span className="mr-1 text-[10px] text-muted-foreground uppercase tracking-wide">
						{t("papersLibrary.filterTag")}
					</span>
					{allTags.map((tag) => {
						const active =
							tagFilter != null &&
							tag.name.toLocaleLowerCase() === tagFilter.toLocaleLowerCase();
						return (
							<TagChip
								key={tag.name}
								tag={tag.name}
								color={tag.color}
								active={active}
								onClick={() => onTagFilterChange(active ? null : tag.name)}
							/>
						);
					})}
					{tagFilter ? (
						<button
							type="button"
							className={cn(
								"inline-flex items-center gap-0.5 rounded px-1.5 py-0.5",
								"text-[10px] text-muted-foreground transition-colors",
								"hover:bg-muted hover:text-foreground",
								"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
							)}
							onClick={() => onTagFilterChange(null)}
							aria-label={t("papersLibrary.clearTagFilter")}
						>
							<X className="size-2.5" aria-hidden />
							{t("papersLibrary.clearTagFilter")}
						</button>
					) : null}
				</div>
			) : null}

			{!rows.length ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
					<p className="font-medium text-sm">{t("papersLibrary.noMatch")}</p>
				</div>
			) : (
				<div
					ref={scrollRef}
					className="agentero-scroll-both min-h-0 min-w-0 flex-1"
				>
					{/* Fixed weights keep the table stable while content and rows change. */}
					<table className="w-full min-w-[900px] table-fixed border-collapse text-left text-sm">
						<colgroup>
							{visibleColumns.map((col) => (
								<col
									key={col.key}
									style={{
										width: `${(COLUMN_META[col.key].widthWeight / visibleColumnWeight) * 100}%`,
									}}
								/>
							))}
						</colgroup>
						<ContextMenu>
							<ContextMenuTrigger asChild>
								<thead className="sticky top-0 z-[1] border-b bg-background/95 backdrop-blur-sm">
									<tr className="text-muted-foreground text-xs">
										{visibleColumns.map((col) => {
											const meta = COLUMN_META[col.key];
											const active = sortKey === col.key;
											const isDragOver =
												dragOverKey === col.key && dragKey !== col.key;
											return (
												<th
													key={col.key}
													className={cn(
														meta.headerClassName,
														"p-0 font-medium",
														dragKey === col.key && "opacity-50",
														isDragOver && "bg-muted",
													)}
													aria-sort={
														active
															? sortDir === "asc"
																? "ascending"
																: "descending"
															: "none"
													}
													draggable={Boolean(onColumnsChange)}
													onDragStart={(e) => {
														setDragKey(col.key);
														e.dataTransfer.effectAllowed = "move";
														e.dataTransfer.setData("text/plain", col.key);
													}}
													onDragOver={(e) => {
														if (!dragKey) return;
														e.preventDefault();
														e.dataTransfer.dropEffect = "move";
														if (dragOverKey !== col.key)
															setDragOverKey(col.key);
													}}
													onDrop={(e) => {
														e.preventDefault();
														handleColumnDrop(col.key);
													}}
													onDragEnd={() => {
														setDragKey(null);
														setDragOverKey(null);
													}}
												>
													<button
														type="button"
														className={cn(
															"flex w-full cursor-grab items-center gap-1 px-3 py-2 text-left active:cursor-grabbing",
															"hover:bg-muted/60 hover:text-foreground",
															"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
															active && "text-foreground",
														)}
														onClick={() => handleSort(col.key)}
														aria-label={t("papersLibrary.sortBy", {
															column: t(meta.labelKey),
														})}
													>
														<span className="truncate">{t(meta.labelKey)}</span>
														<SortIcon active={active} dir={sortDir} />
													</button>
												</th>
											);
										})}
									</tr>
								</thead>
							</ContextMenuTrigger>
							<ContextMenuContent className="w-44">
								<ContextMenuLabel>
									{t("papersLibrary.columnsMenuLabel")}
								</ContextMenuLabel>
								{columns.map((col) => (
									<ContextMenuCheckboxItem
										key={col.key}
										checked={col.visible}
										disabled={col.key === "title" || !onColumnsChange}
										onSelect={(e) => e.preventDefault()}
										onCheckedChange={() => toggleColumn(col.key)}
									>
										{t(COLUMN_META[col.key].labelKey)}
									</ContextMenuCheckboxItem>
								))}
								<ContextMenuSeparator />
								<ContextMenuItem
									disabled={!onColumnsChange}
									onSelect={() => resetColumns()}
								>
									{t("papersLibrary.resetColumns")}
								</ContextMenuItem>
							</ContextMenuContent>
						</ContextMenu>
						<tbody>
							{paddingTop > 0 ? (
								<tr aria-hidden>
									<td
										colSpan={visibleColumns.length}
										style={{ height: paddingTop }}
									/>
								</tr>
							) : null}
							{virtualRows.map((vr) => {
								const p = rows[vr.index];
								const heat = heatmaps.get(heatmapCacheKey(p));
								return (
									<tr
										key={p.path ?? p.id}
										data-index={vr.index}
										ref={rowVirtualizer.measureElement}
										className="border-b border-border/60 transition-colors hover:bg-muted/50"
										onDoubleClick={() => openPaperFromRow(p)}
									>
										{visibleColumns.map((col) => (
											<Fragment key={col.key}>
												{renderCell(col.key, p, heat)}
											</Fragment>
										))}
									</tr>
								);
							})}
							{paddingBottom > 0 ? (
								<tr aria-hidden>
									<td
										colSpan={visibleColumns.length}
										style={{ height: paddingBottom }}
									/>
								</tr>
							) : null}
						</tbody>
					</table>
					<p className="sticky left-0 px-3 py-2 text-muted-foreground text-xs">
						{t("papersLibrary.count", {
							count: rows.length,
							formatted: new Intl.NumberFormat(i18n.language).format(
								rows.length,
							),
						})}
					</p>
				</div>
			)}
		</div>
	);
}
