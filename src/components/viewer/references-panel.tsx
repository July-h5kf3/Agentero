import {
	ArrowUpRight,
	BookCheck,
	BookMarked,
	Import,
	Loader2,
	RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { PaneHeader } from "@/components/shell/pane-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { notifyError } from "@/lib/core/notify";
import { openExternalUrl } from "@/lib/core/open-external";
import { cn } from "@/lib/core/utils";
import { lookupSubmit } from "@/lib/paper/import-actions";
import {
	type Citation,
	type CiteSidecar,
	citationImportIdentifier,
	matchCitationByMarker,
	paperRefsList,
	paperRefsParse,
} from "@/lib/paper/refs";
import { citationHoverStore } from "@/lib/pdf/citation-hover-store";
import { joinVaultPath } from "@/lib/vault/path";
import { openPaper } from "@/lib/workspace/actions";

type ReferencesPanelProps = {
	vaultPath: string | null;
	/** Vault-relative paper folder of the active document; null = not a paper. */
	paperPath: string | null;
	/** Active workspace tab id (=== PDF docId) for hover sync. */
	activeTabId?: string | null;
	className?: string;
};

/** Best external link for a citation: url → DOI resolver → arXiv abs page. */
function externalUrl(citation: Citation): string | null {
	const { url, doi, arxivId } = citation.metadata;
	if (url?.trim()) return url.trim();
	if (doi?.trim()) return `https://doi.org/${doi.trim()}`;
	if (arxivId?.trim()) return `https://arxiv.org/abs/${arxivId.trim()}`;
	return null;
}

function citationMatchesFilter(citation: Citation, needle: string): boolean {
	const m = citation.metadata;
	const haystack = [
		citation.display,
		citation.rawKey,
		citation.raw,
		m.title,
		m.venue,
		m.doi,
		m.arxivId,
		m.year != null ? String(m.year) : undefined,
		...(m.authors ?? []),
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase();
	return haystack.includes(needle);
}

/**
 * Right-sidebar reference list for the active paper: compact citation cards
 * from the `agentero-cite.json` sidecar (parse on demand, filter, open
 * matched library papers, import unmatched ones via the magic-wand pipeline).
 */
export function ReferencesPanel({
	vaultPath,
	paperPath,
	activeTabId = null,
	className,
}: ReferencesPanelProps) {
	const { t } = useTranslation("viewer");
	const [sidecar, setSidecar] = useState<CiteSidecar | null>(null);
	const [loading, setLoading] = useState(false);
	const [parsing, setParsing] = useState(false);
	const [filter, setFilter] = useState("");
	const [importingId, setImportingId] = useState<string | null>(null);
	const paperPathRef = useRef(paperPath);
	paperPathRef.current = paperPath;
	const listRef = useRef<HTMLDivElement>(null);

	// PDF in-text citation hover → highlight + reveal the matching card.
	const hoverMarker = useStore(citationHoverStore, (s) =>
		activeTabId && s.tabId === activeTabId ? s.marker : null,
	);
	const hoveredId = useMemo(
		() =>
			hoverMarker && sidecar
				? matchCitationByMarker(sidecar.citations, hoverMarker)
				: null,
		[hoverMarker, sidecar],
	);
	useEffect(() => {
		if (!hoveredId) return;
		listRef.current
			?.querySelector(`[data-citation-id="${CSS.escape(hoveredId)}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [hoveredId]);

	useEffect(() => {
		setSidecar(null);
		setFilter("");
		if (!vaultPath || !paperPath) return;
		let cancelled = false;
		setLoading(true);
		paperRefsList(vaultPath, paperPath)
			.then((s) => {
				if (!cancelled) setSidecar(s);
			})
			.catch(() => {
				if (!cancelled) setSidecar(null);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [vaultPath, paperPath]);

	const runParse = useCallback(
		async (force: boolean) => {
			if (!vaultPath || !paperPath) return;
			setParsing(true);
			try {
				const parsed = await paperRefsParse(vaultPath, paperPath, force);
				if (paperPathRef.current === paperPath) setSidecar(parsed);
			} catch (error) {
				notifyError(t("references.parseFailed"), {
					description: error instanceof Error ? error.message : String(error),
				});
			} finally {
				setParsing(false);
			}
		},
		[vaultPath, paperPath, t],
	);

	const importCitation = useCallback(
		async (citation: Citation) => {
			const identifier = citationImportIdentifier(citation);
			if (!identifier || !vaultPath || !paperPath) return;
			setImportingId(citation.id);
			const origin = paperPath;
			try {
				await lookupSubmit([identifier]);
				// Refresh localMatch for the origin paper (import may navigate away).
				const parsed = await paperRefsParse(vaultPath, origin, true);
				if (paperPathRef.current === origin) setSidecar(parsed);
			} catch (error) {
				notifyError(t("references.importFailed"), {
					description: error instanceof Error ? error.message : String(error),
				});
			} finally {
				setImportingId(null);
			}
		},
		[vaultPath, paperPath, t],
	);

	const openMatched = useCallback(
		(citation: Citation) => {
			if (!vaultPath || !citation.localMatch) return;
			openPaper(joinVaultPath(vaultPath, citation.localMatch.paperPath));
		},
		[vaultPath],
	);

	const citations = sidecar?.citations ?? [];
	const needle = filter.trim().toLowerCase();
	const visible = needle
		? citations.filter((c) => citationMatchesFilter(c, needle))
		: citations;

	return (
		<section
			className={cn(
				"flex h-full min-h-0 flex-col overflow-hidden bg-background",
				className,
			)}
			aria-label={t("references.panelAria")}
		>
			<PaneHeader
				trailing={
					paperPath && sidecar ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="size-6 text-muted-foreground hover:text-foreground"
							aria-label={t("references.reparse")}
							disabled={parsing}
							onClick={() => void runParse(true)}
						>
							<RefreshCw
								className={cn("size-3.5", parsing && "animate-spin")}
							/>
						</Button>
					) : null
				}
			>
				<BookMarked className="size-4 text-muted-foreground" aria-hidden />
				<span className="font-medium text-sm">{t("references.title")}</span>
			</PaneHeader>

			{!paperPath ? (
				<EmptyState text={t("references.noPaper")} />
			) : loading ? (
				<div className="flex min-h-0 flex-1 items-center justify-center">
					<Loader2
						className="size-4 animate-spin text-muted-foreground"
						aria-hidden
					/>
				</div>
			) : !sidecar || citations.length === 0 ? (
				<EmptyState
					text={sidecar ? t("references.emptyParsed") : t("references.empty")}
				>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={parsing}
						onClick={() => void runParse(Boolean(sidecar))}
					>
						{parsing ? (
							<Loader2 className="size-3.5 animate-spin" aria-hidden />
						) : null}
						{t("references.parse")}
					</Button>
				</EmptyState>
			) : (
				<>
					<div className="border-b px-2 py-1.5">
						<Input
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
							placeholder={t("references.filterPlaceholder")}
							className="h-7 text-xs"
							spellCheck={false}
						/>
					</div>
					<div
						ref={listRef}
						className="agentero-scroll min-h-0 flex-1 overflow-y-auto p-2"
					>
						{visible.length === 0 ? (
							<p className="px-2 py-6 text-center text-muted-foreground text-xs">
								{t("references.noFilterMatch")}
							</p>
						) : (
							<ul className="space-y-1">
								{visible.map((citation) => (
									<li key={citation.id}>
										<CitationCard
											citation={citation}
											ordinal={citations.indexOf(citation) + 1}
											importing={importingId === citation.id}
											hovered={citation.id === hoveredId}
											onOpenMatched={openMatched}
											onImport={importCitation}
										/>
									</li>
								))}
							</ul>
						)}
					</div>
				</>
			)}
		</section>
	);
}

function EmptyState({
	text,
	children,
}: {
	text: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
			<div className="flex size-12 items-center justify-center rounded-2xl bg-muted/70 text-muted-foreground">
				<BookMarked className="size-5" aria-hidden />
			</div>
			<p className="max-w-[15rem] text-muted-foreground text-xs leading-relaxed">
				{text}
			</p>
			{children}
		</div>
	);
}

function CitationCard({
	citation,
	ordinal,
	importing,
	hovered,
	onOpenMatched,
	onImport,
}: {
	citation: Citation;
	/** 1-based position in the full (unfiltered) sidecar list. */
	ordinal: number;
	importing: boolean;
	/** In-text citation under the pointer in the PDF matches this card. */
	hovered: boolean;
	onOpenMatched: (citation: Citation) => void;
	onImport: (citation: Citation) => void;
}) {
	const { t } = useTranslation("viewer");
	const m = citation.metadata;
	const matched = Boolean(citation.localMatch);
	const link = externalUrl(citation);
	const importable = !matched && citationImportIdentifier(citation) != null;

	const metaParts = [
		m.authors?.length
			? m.authors.length > 1
				? `${m.authors[0]} et al.`
				: m.authors[0]
			: null,
		m.year != null ? String(m.year) : null,
		m.venue || null,
	].filter(Boolean) as string[];

	const activate = () => {
		if (matched) {
			onOpenMatched(citation);
		} else if (link) {
			openExternalUrl(link);
		}
	};

	return (
		<div
			data-citation-id={citation.id}
			className={cn(
				"group relative rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border/60 hover:bg-muted/40",
				hovered && "border-border/60 bg-muted/50",
			)}
		>
			{/* biome-ignore lint/a11y/useSemanticElements: role=button wrapper for card activation */}
			<div
				role="button"
				tabIndex={0}
				className="block w-full cursor-pointer rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
				onClick={activate}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						activate();
					}
				}}
			>
				<div className="flex items-center gap-1.5">
					<span className="shrink-0 font-medium text-[10px] text-muted-foreground tabular-nums">
						{citation.display ?? `[${ordinal}]`}
					</span>
					{matched ? (
						<BookCheck
							className="size-3 shrink-0 text-emerald-600 dark:text-emerald-500"
							aria-label={t("references.inLibrary")}
						/>
					) : null}
					{m.doi ? (
						<span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] text-muted-foreground uppercase tracking-wide">
							DOI
						</span>
					) : null}
					{m.arxivId ? (
						<span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] text-muted-foreground tracking-wide">
							arXiv
						</span>
					) : null}
				</div>
				<p
					className={cn(
						"mt-1 line-clamp-2 text-[13px] leading-snug",
						m.title ? "text-foreground" : "text-muted-foreground",
					)}
				>
					{m.title ?? citation.raw ?? citation.rawKey ?? citation.id}
				</p>
				{metaParts.length > 0 ? (
					<p className="mt-0.5 truncate text-[11px] text-muted-foreground">
						{metaParts.join(" · ")}
					</p>
				) : null}
			</div>
			<div className="absolute top-2 right-2 flex items-center gap-0.5 rounded-lg bg-background/80 p-0.5 opacity-0 shadow-sm ring-1 ring-border/60 backdrop-blur-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
				<TooltipProvider delayDuration={250}>
					{importable ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									className="size-6 text-muted-foreground hover:text-foreground"
									aria-label={t("references.import")}
									disabled={importing}
									onClick={() => onImport(citation)}
								>
									{importing ? (
										<Loader2 className="size-3.5 animate-spin" />
									) : (
										<Import className="size-3.5" />
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								{t("references.import")}
							</TooltipContent>
						</Tooltip>
					) : null}
					{link ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									className="size-6 text-muted-foreground hover:text-foreground"
									aria-label={t("references.openLink")}
									onClick={() => openExternalUrl(link)}
								>
									<ArrowUpRight className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								{t("references.openLink")}
							</TooltipContent>
						</Tooltip>
					) : null}
				</TooltipProvider>
			</div>
		</div>
	);
}
