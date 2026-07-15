/**
 * Vault library: table of all papers from catalog.sqlite (display only).
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { PaperMetadata } from "@/lib/paper-metadata";
import { cn } from "@/lib/utils";

export type PapersLibraryProps = {
	papers: PaperMetadata[];
	loading?: boolean;
	onOpenPaper: (paper: PaperMetadata) => void;
	className?: string;
};

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

export function PapersLibrary({
	papers,
	loading,
	onOpenPaper,
	className,
}: PapersLibraryProps) {
	const { t, i18n } = useTranslation("sidebar");

	const rows = useMemo(() => papers, [papers]);

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
		<div className={cn("motif-scroll min-h-0 flex-1 overflow-auto", className)}>
			<table className="w-full min-w-[640px] border-collapse text-left text-sm">
				<thead className="sticky top-0 z-[1] border-b bg-background/95 backdrop-blur-sm">
					<tr className="text-muted-foreground text-xs">
						<th className="px-3 py-2 font-medium">
							{t("papersLibrary.colTitle")}
						</th>
						<th className="w-[18%] px-3 py-2 font-medium">
							{t("papersLibrary.colAuthors")}
						</th>
						<th className="w-14 px-3 py-2 font-medium">
							{t("papersLibrary.colYear")}
						</th>
						<th className="w-20 px-3 py-2 font-medium">
							{t("papersLibrary.colType")}
						</th>
						<th className="w-[22%] px-3 py-2 font-medium">
							{t("papersLibrary.colId")}
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((p) => (
						<tr
							key={p.path ?? p.id}
							className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/50"
							onClick={() => onOpenPaper(p)}
						>
							<td className="max-w-0 px-3 py-2.5">
								<div className="truncate font-medium" title={p.title}>
									{p.title}
								</div>
								{p.publication ? (
									<div
										className="truncate text-muted-foreground text-xs"
										title={p.publication}
									>
										{p.publication}
									</div>
								) : null}
							</td>
							<td className="px-3 py-2.5 text-muted-foreground text-xs">
								<span className="line-clamp-2" title={p.authors?.join(", ")}>
									{formatAuthors(p.authors)}
								</span>
							</td>
							<td className="px-3 py-2.5 tabular-nums text-muted-foreground text-xs">
								{p.year ?? "—"}
							</td>
							<td className="px-3 py-2.5 text-muted-foreground text-xs capitalize">
								{p.type}
							</td>
							<td className="px-3 py-2.5 font-mono text-muted-foreground text-xs">
								<span className="line-clamp-2" title={identifierLabel(p)}>
									{identifierLabel(p)}
								</span>
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className="px-3 py-2 text-muted-foreground text-xs">
				{t("papersLibrary.count", {
					count: rows.length,
					formatted: new Intl.NumberFormat(i18n.language).format(rows.length),
				})}
			</p>
		</div>
	);
}
