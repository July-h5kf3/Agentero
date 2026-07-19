/**
 * Vault library: table of all papers from catalog.sqlite (display only).
 * Click column headers to sort ascending / descending.
 * Single-click a cell to copy that field; double-click a row to open the paper.
 * Reading heatmap column: highlight / ask / translate intensity along the PDF.
 * Optional tag filter chips above the table.
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, RefreshCw, X } from "lucide-react";
import {
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ReadingHeatmapBar } from "@/components/layout/reading-heatmap";
import { Button } from "@/components/ui/button";
import { notifyError, notifySuccess } from "@/lib/notify";
import type { PaperMetadata } from "@/lib/paper-metadata";
import { filterPapersByScope } from "@/lib/papers-api";
import {
	heatmapCacheKey,
	loadReadingHeatmaps,
	type ReadingHeatmap,
} from "@/lib/reading-heatmap";
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
	/** Rebuild the catalog from papers/ on disk (empty-state recovery). */
	onRescan?: () => void;
	rescanning?: boolean;
	className?: string;
};

/** Data columns + fixed reading-heatmap column (not sortable). */
const TABLE_COL_COUNT = 7;

type SortKey = "title" | "authors" | "year" | "type" | "id" | "tags";
type SortDir = "asc" | "desc";

const SORT_COLUMNS = [
	{
		key: "title" as const,
		labelKey: "papersLibrary.colTitle" as const,
		className: "min-w-[240px]",
	},
	{
		key: "authors" as const,
		labelKey: "papersLibrary.colAuthors" as const,
		className: "min-w-[140px]",
	},
	{
		key: "year" as const,
		labelKey: "papersLibrary.colYear" as const,
		className: "min-w-16",
	},
	{
		key: "tags" as const,
		labelKey: "papersLibrary.colTags" as const,
		className: "min-w-[120px]",
	},
	{
		key: "type" as const,
		labelKey: "papersLibrary.colType" as const,
		className: "min-w-24",
	},
	{
		key: "id" as const,
		labelKey: "papersLibrary.colId" as const,
		className: "min-w-[160px]",
	},
];

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
	return (p.tags ?? []).some((t) => t.toLocaleLowerCase() === needle);
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
			return (p.tags ?? []).join(", ").toLocaleLowerCase();
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
	active,
	onClick,
}: {
	tag: string;
	active?: boolean;
	onClick?: () => void;
}) {
	if (!onClick) {
		return (
			<span
				className={cn(
					"inline-flex items-center rounded px-1.5 py-0.5 text-[10px] leading-none",
					active
						? "bg-foreground text-background"
						: "bg-muted text-muted-foreground",
				)}
			>
				{tag}
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
				"inline-flex items-center rounded px-1.5 py-0.5 text-[10px] leading-none",
				"cursor-pointer transition-colors",
				active
					? "bg-foreground text-background hover:bg-foreground/90"
					: "bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground",
			)}
		>
			{tag}
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

	const onCellCopy = useCallback(
		(e: ReactMouseEvent, text: string | null | undefined, label: string) => {
			// Skip the second click of a double-click (row still opens paper).
			if (e.detail > 1) return;
			void copyField(text, label);
		},
		[copyField],
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
		const map = new Map<string, string>();
		for (const p of scopedPapers) {
			for (const tag of p.tags ?? []) {
				const key = tag.toLocaleLowerCase();
				if (!map.has(key)) map.set(key, tag);
			}
		}
		return [...map.values()].sort((a, b) =>
			a.localeCompare(b, undefined, { sensitivity: "base" }),
		);
	}, [scopedPapers]);

	const normalizedQuery = (query ?? "").trim().toLocaleLowerCase();

	const rows = useMemo(() => {
		let filtered = scopedPapers;
		if (normalizedQuery) {
			filtered = filtered.filter((p) => {
				const title = (p.title ?? "").toLocaleLowerCase();
				const tags = (p.tags ?? []).join(" ").toLocaleLowerCase();
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
							tag.toLocaleLowerCase() === tagFilter.toLocaleLowerCase();
						return (
							<TagChip
								key={tag}
								tag={tag}
								active={active}
								onClick={() => onTagFilterChange(active ? null : tag)}
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
					{/* w-max + column min-widths: grow past pane for horizontal scroll */}
					<table className="w-max min-w-full border-collapse text-left text-sm">
						<thead className="sticky top-0 z-[1] border-b bg-background/95 backdrop-blur-sm">
							<tr className="text-muted-foreground text-xs">
								{SORT_COLUMNS.map((col) => {
									const active = sortKey === col.key;
									return (
										<th
											key={col.key}
											className={cn(col.className, "p-0 font-medium")}
											aria-sort={
												active
													? sortDir === "asc"
														? "ascending"
														: "descending"
													: "none"
											}
										>
											<button
												type="button"
												className={cn(
													"flex w-full items-center gap-1 px-3 py-2 text-left",
													"hover:bg-muted/60 hover:text-foreground",
													"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
													active && "text-foreground",
												)}
												onClick={() => handleSort(col.key)}
												aria-label={t("papersLibrary.sortBy", {
													column: t(col.labelKey),
												})}
											>
												<span className="truncate">{t(col.labelKey)}</span>
												<SortIcon active={active} dir={sortDir} />
											</button>
										</th>
									);
								})}
								<th
									className="min-w-[88px] px-3 py-2 font-medium"
									title={t("papersLibrary.colHeatmapHint")}
								>
									<span className="truncate">
										{t("papersLibrary.colHeatmap")}
									</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{paddingTop > 0 ? (
								<tr aria-hidden>
									<td
										colSpan={TABLE_COL_COUNT}
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
										onDoubleClick={() => onOpenPaper(p)}
									>
										<td className="max-w-[420px] px-3 py-2.5">
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
												<span className="line-clamp-2" title={p.title}>
													{p.title}
												</span>
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
										<td className="max-w-[220px] px-3 py-2.5 text-muted-foreground text-xs">
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
												<span title={p.authors?.join(", ")}>
													{formatAuthors(p.authors)}
												</span>
											</button>
										</td>
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
										<td className="max-w-[200px] px-3 py-2.5">
											{p.tags?.length ? (
												<div className="flex flex-wrap gap-1">
													{p.tags.map((tag) => {
														const active =
															tagFilter != null &&
															tag.toLocaleLowerCase() ===
																tagFilter.toLocaleLowerCase();
														return (
															<button
																key={tag}
																type="button"
																className={cn(
																	"inline-flex items-center rounded px-1.5 py-0.5 text-[10px] leading-none",
																	"cursor-pointer transition-colors",
																	"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
																	active
																		? "bg-foreground text-background hover:bg-foreground/90"
																		: "bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground",
																)}
																title={t("papersLibrary.copyHint", {
																	label: t("papersLibrary.colTags"),
																})}
																aria-label={t("papersLibrary.copyHint", {
																	label: tag,
																})}
																onClick={(e) =>
																	onCellCopy(e, tag, t("papersLibrary.colTags"))
																}
															>
																{tag}
															</button>
														);
													})}
												</div>
											) : (
												<span className="text-muted-foreground text-xs">—</span>
											)}
										</td>
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
										<td className="max-w-[280px] px-3 py-2.5 font-mono text-muted-foreground text-xs">
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
													onCellCopy(
														e,
														identifierCopyText(p),
														t("papersLibrary.colId"),
													)
												}
											>
												<span
													className="line-clamp-1"
													title={identifierLabel(p)}
												>
													{identifierLabel(p)}
												</span>
											</button>
										</td>
										<td className="whitespace-nowrap px-3 py-2.5 align-middle">
											<ReadingHeatmapBar heatmap={heat} />
										</td>
									</tr>
								);
							})}
							{paddingBottom > 0 ? (
								<tr aria-hidden>
									<td
										colSpan={TABLE_COL_COUNT}
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
