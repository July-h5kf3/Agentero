import { BookOpen, ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/core/utils";
import type { PaperMetadata } from "@/lib/paper/types";

export function MobileLibraryPage({
	papers,
	selected,
	onSelect,
}: {
	papers: PaperMetadata[];
	selected: PaperMetadata | null;
	onSelect: (paper: PaperMetadata) => void;
}) {
	const { t } = useTranslation("mobile");
	const [query, setQuery] = useState("");
	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) return papers;
		return papers.filter((paper) =>
			`${paper.title} ${paper.authors.join(" ")}`
				.toLowerCase()
				.includes(normalized),
		);
	}, [papers, query]);
	return (
		<section className="flex h-full min-h-0 flex-col">
			<div className="border-b px-4 py-3 md:px-6">
				<div className="relative">
					<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t("library.search")}
						className="pl-9"
					/>
				</div>
			</div>
			<div className="agentero-scroll flex-1">
				<ul className="divide-y">
					{filtered.map((paper) => (
						<li key={paper.path ?? paper.id}>
							<button
								type="button"
								onClick={() => onSelect(paper)}
								className={cn(
									"flex w-full items-center gap-3 px-4 py-4 text-left md:px-6",
									selected?.id === paper.id && "bg-muted/60",
								)}
							>
								<div className="grid size-10 shrink-0 place-items-center border bg-muted text-muted-foreground">
									<BookOpen className="size-4" />
								</div>
								<span className="min-w-0 flex-1">
									<span className="line-clamp-2 block font-medium text-sm">
										{paper.title}
									</span>
									<span className="mt-1 block truncate text-muted-foreground text-xs">
										{paper.authors.join(", ")}
										{paper.year ? ` · ${paper.year}` : ""}
									</span>
								</span>
								<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
							</button>
						</li>
					))}
				</ul>
				{filtered.length === 0 ? (
					<div className="grid h-full place-items-center text-muted-foreground text-sm">
						{t("library.empty")}
					</div>
				) : null}
			</div>
		</section>
	);
}
