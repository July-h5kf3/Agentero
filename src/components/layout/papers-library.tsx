/**
 * Vault library: table of all papers from catalog.sqlite (display only).
 * Click column headers to sort ascending / descending.
 */
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PaperMetadata } from "@/lib/paper-metadata";
import { cn } from "@/lib/utils";

export type PapersLibraryProps = {
	papers: PaperMetadata[];
	loading?: boolean;
	onOpenPaper: (paper: PaperMetadata) => void;
	className?: string;
};

type SortKey = "title" | "authors" | "year" | "type" | "id";
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

function identifierLabel(p: PaperMetadata): string {
	if (p.arxiv_id) return p.arxiv_id;
	if (p.doi) return p.doi;
	if (p.pmid) return `PMID:${p.pmid}`;
	return p.id || "—";
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

export function PapersLibrary({
	papers,
	loading,
	onOpenPaper,
	className,
}: PapersLibraryProps) {
	const { t, i18n } = useTranslation("sidebar");
	const [sortKey, setSortKey] = useState<SortKey>("title");
	const [sortDir, setSortDir] = useState<SortDir>("asc");

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

	const rows = useMemo(() => {
		const copy = [...papers];
		copy.sort((a, b) => comparePapers(a, b, sortKey, sortDir));
		return copy;
	}, [papers, sortKey, sortDir]);

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

	if (!rows.length) {
		return (
			<div
				className={cn(
					"flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-8 text-center",
					className,
				)}
			>
				<p className="font-medium text-sm">{t("papersLibrary.emptyTitle")}</p>
				<p className="max-w-sm text-muted-foreground text-xs">
					{t("papersLibrary.emptyHint")}
				</p>
			</div>
		);
	}

	return (
		<div
			className={cn("agentero-scroll-both min-h-0 min-w-0 flex-1", className)}
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
					</tr>
				</thead>
				<tbody>
					{rows.map((p) => (
						<tr
							key={p.path ?? p.id}
							className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/50"
							onClick={() => onOpenPaper(p)}
						>
							<td className="max-w-[420px] px-3 py-2.5">
								<div className="font-medium" title={p.title}>
									{p.title}
								</div>
								{p.publication ? (
									<div
										className="text-muted-foreground text-xs"
										title={p.publication}
									>
										{p.publication}
									</div>
								) : null}
							</td>
							<td className="max-w-[220px] px-3 py-2.5 text-muted-foreground text-xs">
								<span title={p.authors?.join(", ")}>
									{formatAuthors(p.authors)}
								</span>
							</td>
							<td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground text-xs">
								{p.year ?? "—"}
							</td>
							<td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground text-xs capitalize">
								{p.type}
							</td>
							<td className="max-w-[280px] px-3 py-2.5 font-mono text-muted-foreground text-xs">
								<span title={identifierLabel(p)}>{identifierLabel(p)}</span>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="sticky left-0 px-3 py-2 text-muted-foreground text-xs">
				{t("papersLibrary.count", {
					count: rows.length,
					formatted: new Intl.NumberFormat(i18n.language).format(rows.length),
				})}
			</p>
		</div>
	);
}
