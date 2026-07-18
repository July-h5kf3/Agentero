import { FileText, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
	Command,
	CommandDialog,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import type { PaperMetadata } from "@/lib/paper-metadata";
import { type SearchHit, searchVault } from "@/lib/vault-search";

type CommandPaletteProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	vaultPath: string | null;
	/** In-memory catalog rows for instant title/author quick-open. */
	papers: PaperMetadata[];
	/** Open a paper by its vault-relative folder (e.g. papers/x). */
	onOpenPaper: (paperRel: string) => void;
	/** Open a vault-relative file (e.g. notes/idea.md). */
	onOpenVaultRel: (rel: string) => void;
};

const PAPER_LIMIT = 8;

/**
 * Global command palette (⌘K / ⌘P): instant paper quick-open (title/author,
 * in-memory) + debounced full-text "in contents" search over Vault Markdown.
 */
export function CommandPalette({
	open,
	onOpenChange,
	vaultPath,
	papers,
	onOpenPaper,
	onOpenVaultRel,
}: CommandPaletteProps) {
	const { t } = useTranslation("app");
	const [query, setQuery] = useState("");
	const [hits, setHits] = useState<SearchHit[]>([]);
	const [loading, setLoading] = useState(false);
	const genRef = useRef(0);

	// Clear the query each time the palette opens.
	useEffect(() => {
		if (open) setQuery("");
	}, [open]);

	// Instant, in-memory paper matches (title / authors / id). Empty query → recents.
	const paperMatches = useMemo(() => {
		const withPath = papers.filter((p) => p.path);
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		if (!terms.length) return withPath.slice(0, PAPER_LIMIT);
		return withPath
			.filter((p) => {
				const hay =
					`${p.title} ${p.authors?.join(" ") ?? ""} ${p.id}`.toLowerCase();
				return terms.every((term) => hay.includes(term));
			})
			.slice(0, PAPER_LIMIT);
	}, [papers, query]);

	// Debounced backend full-text search over Vault Markdown.
	useEffect(() => {
		if (!open || !vaultPath) {
			setHits([]);
			setLoading(false);
			return;
		}
		const q = query.trim();
		if (!q) {
			setHits([]);
			setLoading(false);
			return;
		}
		setLoading(true);
		const gen = ++genRef.current;
		const timer = setTimeout(() => {
			searchVault({ vaultPath, query: q, limit: 60 })
				.then((r) => {
					if (gen === genRef.current) setHits(r.hits);
				})
				.catch(() => {
					if (gen === genRef.current) setHits([]);
				})
				.finally(() => {
					if (gen === genRef.current) setLoading(false);
				});
		}, 200);
		return () => clearTimeout(timer);
	}, [query, open, vaultPath]);

	const choosePaper = (rel: string) => {
		onOpenPaper(rel);
		onOpenChange(false);
	};
	const chooseHit = (hit: SearchHit) => {
		if (hit.paperPath) onOpenPaper(hit.paperPath);
		else onOpenVaultRel(hit.path);
		onOpenChange(false);
	};

	const hasResults = paperMatches.length > 0 || hits.length > 0;

	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			className="max-w-xl"
			title={t("commandPalette.title")}
			description={t("commandPalette.placeholder")}
		>
			<Command shouldFilter={false} loop>
				<CommandInput
					value={query}
					onValueChange={setQuery}
					placeholder={t("commandPalette.placeholder")}
				/>
				<CommandList>
					{paperMatches.length ? (
						<CommandGroup
							heading={
								query ? t("commandPalette.papers") : t("commandPalette.recent")
							}
						>
							{paperMatches.map((p) => (
								<CommandItem
									key={p.path}
									value={`paper:${p.path}`}
									onSelect={() => choosePaper(p.path as string)}
								>
									<FileText className="text-muted-foreground" />
									<div className="flex min-w-0 flex-col">
										<span className="truncate">{p.title || p.id}</span>
										{p.authors?.length ? (
											<span className="truncate text-muted-foreground text-xs">
												{p.authors.join(", ")}
												{p.year ? ` · ${p.year}` : ""}
											</span>
										) : null}
									</div>
								</CommandItem>
							))}
						</CommandGroup>
					) : null}

					{hits.length ? (
						<CommandGroup heading={t("commandPalette.contents")}>
							{hits.map((hit) => (
								<CommandItem
									key={hit.path}
									value={`hit:${hit.path}`}
									onSelect={() => chooseHit(hit)}
								>
									<FileText className="text-muted-foreground" />
									<div className="flex min-w-0 flex-col">
										<span className="truncate">{hit.title}</span>
										<span className="truncate text-muted-foreground text-xs">
											{hit.snippet}
										</span>
									</div>
								</CommandItem>
							))}
						</CommandGroup>
					) : null}

					{loading ? (
						<div className="flex items-center gap-2 px-3 py-3 text-muted-foreground text-xs">
							<Loader2 className="size-3.5 animate-spin" />
							{t("commandPalette.searching")}
						</div>
					) : null}

					{!loading && !hasResults ? (
						<div className="px-3 py-6 text-center text-muted-foreground text-sm">
							{query
								? t("commandPalette.noResults")
								: t("commandPalette.empty")}
						</div>
					) : null}
				</CommandList>
			</Command>
		</CommandDialog>
	);
}
