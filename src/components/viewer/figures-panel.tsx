import {
	Code2,
	ImageIcon,
	Loader2,
	RefreshCw,
	Sigma,
	Table2,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { PaneHeader } from "@/components/shell/pane-header";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PromptImage } from "@/lib/agent";
import { cn } from "@/lib/core/utils";
import {
	dedupeLayoutRegions,
	isAlgorithmLayoutKind,
	isFigureLayoutKind,
	isFormulaLayoutKind,
	isSidebarLayoutKind,
	isTableLayoutKind,
	LAYOUT_KIND_BADGE_CLASS,
	layoutAnalysisStore,
	layoutKindBorder,
	layoutKindFill,
	layoutKindHex,
	type PdfLayoutKind,
	type PdfLayoutRegion,
} from "@/lib/pdf/layout";

export type FiguresPanelProps = {
	/** EmbedPDF documentId / PDF tab id used as layout store key. */
	documentId: string | null;
	/** Whether a PDF viewer handle is currently registered for this doc. */
	viewerReady: boolean;
	/** Layout analysis in progress (from toolbar / handle). */
	analyzing?: boolean;
	onAnalyze: () => void;
	onJump: (region: PdfLayoutRegion) => void;
	/** Crop a region for sidebar thumbnails (null when viewer unavailable). */
	onRenderThumb?: (region: PdfLayoutRegion) => Promise<PromptImage | null>;
	className?: string;
};

/** Default confidence gate for the figures rail (model score 0–1). */
const DEFAULT_MIN_SCORE = 0.3;

type SidebarKind = "image" | "chart" | "table" | "algorithm" | "formula";

function asSidebarKind(kind: PdfLayoutKind): SidebarKind | null {
	if (kind === "image" || kind === "chart") return kind;
	if (isTableLayoutKind(kind)) return "table";
	if (isAlgorithmLayoutKind(kind)) return "algorithm";
	if (isFormulaLayoutKind(kind)) return "formula";
	return null;
}

function kindLabelKey(
	kind: SidebarKind,
):
	| "figures.kindImage"
	| "figures.kindChart"
	| "figures.kindTable"
	| "figures.kindAlgorithm"
	| "figures.kindFormula" {
	switch (kind) {
		case "image":
			return "figures.kindImage";
		case "chart":
			return "figures.kindChart";
		case "table":
			return "figures.kindTable";
		case "algorithm":
			return "figures.kindAlgorithm";
		case "formula":
			return "figures.kindFormula";
	}
}

function KindIcon({ kind, hex }: { kind: SidebarKind; hex: string }) {
	const cls = "size-6 opacity-60";
	if (kind === "table")
		return <Table2 className={cls} style={{ color: hex }} aria-hidden />;
	if (kind === "algorithm")
		return <Code2 className={cls} style={{ color: hex }} aria-hidden />;
	if (kind === "formula")
		return <Sigma className={cls} style={{ color: hex }} aria-hidden />;
	// image + chart share the figure section icon.
	return <ImageIcon className={cls} style={{ color: hex }} aria-hidden />;
}

function FigureCard({
	region,
	index,
	selected,
	thumb,
	onJump,
}: {
	region: PdfLayoutRegion;
	index: number;
	selected: boolean;
	thumb: PromptImage | null | undefined;
	onJump: (region: PdfLayoutRegion) => void;
}) {
	const { t } = useTranslation("viewer");
	const page = region.pageIndex + 1;
	const kind = asSidebarKind(region.kind);
	if (!kind) return null;

	const fallbackTitle =
		kind === "table"
			? t("figures.tableItem", { n: index })
			: kind === "algorithm"
				? t("figures.algorithmItem", { n: index })
				: kind === "formula"
					? t("figures.formulaItem", { n: index })
					: kind === "chart"
						? t("figures.chartItem", { n: index })
						: t("figures.figureItem", { n: index });
	// Prefer PDF caption text: figure/table titles, or formula number "(1)".
	const caption = region.title?.trim() || "";
	const title = caption || fallbackTitle;
	const kindText = t(kindLabelKey(kind));
	const hex = layoutKindHex(kind);
	const fill = layoutKindFill(kind);
	const border = layoutKindBorder(kind);
	const confPct = Math.round(Math.min(1, Math.max(0, region.score)) * 100);

	return (
		<button
			type="button"
			data-layout-region={region.id}
			className={cn(
				"group flex w-full flex-col overflow-hidden rounded-md border text-left transition-colors",
				"hover:bg-muted/30",
				selected ? "ring-2" : "border-border/80 bg-background",
			)}
			style={
				selected
					? {
							borderColor: hex,
							boxShadow: `0 0 0 2px ${hex}55`,
							backgroundColor: fill,
						}
					: { borderColor: border }
			}
			onClick={() => onJump(region)}
		>
			<div
				className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden"
				style={{ backgroundColor: fill }}
			>
				<span
					className="absolute inset-y-0 left-0 w-1"
					style={{ backgroundColor: hex }}
					aria-hidden
				/>
				{thumb ? (
					<img
						src={`data:${thumb.mimeType};base64,${thumb.data}`}
						alt=""
						className="max-h-full max-w-full object-contain"
						draggable={false}
					/>
				) : (
					<div className="flex flex-col items-center gap-1 text-muted-foreground">
						<KindIcon kind={kind} hex={hex} />
						<span className="text-[10px]">{t("figures.thumbPending")}</span>
					</div>
				)}
			</div>
			<div className="flex items-center justify-between gap-2 px-2 py-1.5">
				<div className="min-w-0">
					<p
						className={cn(
							"font-medium text-xs",
							caption ? "line-clamp-2" : "truncate",
						)}
						title={title}
					>
						{title}
					</p>
					<p className="truncate text-[10px] text-muted-foreground">
						<span
							className={cn(
								"mr-1 inline-flex items-center rounded px-1 py-px text-[10px] font-medium ring-1 ring-inset",
								LAYOUT_KIND_BADGE_CLASS[kind],
							)}
						>
							{kindText}
						</span>
						{t("figures.page", { page })}
						{" · "}
						<TooltipProvider delayDuration={200}>
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="cursor-help tabular-nums underline decoration-dotted underline-offset-2">
										{t("figures.confidence", { pct: confPct })}
									</span>
								</TooltipTrigger>
								<TooltipContent side="top" className="max-w-52 text-xs">
									{t("figures.confidenceHint")}
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					</p>
				</div>
			</div>
		</button>
	);
}

function Section({
	title,
	count,
	accent,
	children,
}: {
	title: string;
	count: number;
	accent: string;
	children: ReactNode;
}) {
	if (count === 0) return null;
	return (
		<section className="space-y-2">
			<div className="flex items-center justify-between px-0.5">
				<h3 className="flex items-center gap-1.5 font-medium text-xs uppercase tracking-wide text-muted-foreground">
					<span
						className="inline-block size-2 rounded-full"
						style={{ backgroundColor: accent }}
						aria-hidden
					/>
					{title}
				</h3>
				<span className="text-[10px] text-muted-foreground tabular-nums">
					{count}
				</span>
			</div>
			<div className="grid grid-cols-1 gap-2">{children}</div>
		</section>
	);
}

/**
 * Right-rail gallery: figures / tables / algorithms / numbered formulas.
 * Formulas section is always last. Unnumbered formulas are already dropped
 * at merge time. Filters by confidence, drops tiny boxes, NMS-dedupes.
 */
export function FiguresPanel({
	documentId,
	viewerReady,
	analyzing = false,
	onAnalyze,
	onJump,
	onRenderThumb,
	className,
}: FiguresPanelProps) {
	const { t } = useTranslation("viewer");
	const result = useStore(layoutAnalysisStore, (s) =>
		documentId ? (s.byDocument[documentId] ?? null) : null,
	);
	const focusedId = useStore(layoutAnalysisStore, (s) =>
		documentId && s.focused?.documentId === documentId
			? s.focused.regionId
			: null,
	);
	const ui = useStore(layoutAnalysisStore, (s) => s.ui);
	const [thumbs, setThumbs] = useState<Record<string, PromptImage | null>>({});
	/** Confidence threshold 0–100 for the UI slider (maps to score 0–1). */
	const [minScorePct, setMinScorePct] = useState(
		Math.round(DEFAULT_MIN_SCORE * 100),
	);

	const minScore = minScorePct / 100;

	const gallery = useMemo(() => {
		const sidebarOnly = (result?.regions ?? []).filter((r) =>
			isSidebarLayoutKind(r.kind),
		);
		return dedupeLayoutRegions(sidebarOnly, { minScore });
	}, [result, minScore]);

	const figures = useMemo(
		() => gallery.filter((r) => isFigureLayoutKind(r.kind)),
		[gallery],
	);
	const tables = useMemo(
		() => gallery.filter((r) => isTableLayoutKind(r.kind)),
		[gallery],
	);
	const algorithms = useMemo(
		() => gallery.filter((r) => isAlgorithmLayoutKind(r.kind)),
		[gallery],
	);
	const formulas = useMemo(
		() => gallery.filter((r) => isFormulaLayoutKind(r.kind)),
		[gallery],
	);

	const rawSidebarCount = useMemo(
		() =>
			(result?.regions ?? []).filter((r) => isSidebarLayoutKind(r.kind)).length,
		[result],
	);

	// Lazy thumbnails — sequential-ish batches to avoid PDFium thrash.
	useEffect(() => {
		if (!documentId || !onRenderThumb || gallery.length === 0) {
			setThumbs({});
			return;
		}
		let cancelled = false;
		const ids = new Set(gallery.map((r) => r.id));
		setThumbs((prev) => {
			const next: Record<string, PromptImage | null> = {};
			for (const id of Object.keys(prev)) {
				if (ids.has(id)) next[id] = prev[id];
			}
			return next;
		});

		void (async () => {
			const concurrency = 2;
			let cursor = 0;
			const workers = Array.from(
				{ length: Math.min(concurrency, gallery.length) },
				async () => {
					while (!cancelled) {
						const index = cursor;
						cursor += 1;
						if (index >= gallery.length) return;
						const region = gallery[index];
						if (!region) return;
						try {
							const image = await onRenderThumb(region);
							if (cancelled) return;
							setThumbs((prev) =>
								prev[region.id] === image
									? prev
									: { ...prev, [region.id]: image },
							);
						} catch {
							if (cancelled) return;
							setThumbs((prev) =>
								prev[region.id] === null
									? prev
									: { ...prev, [region.id]: null },
							);
						}
					}
				},
			);
			await Promise.all(workers);
		})();

		return () => {
			cancelled = true;
		};
	}, [documentId, gallery, onRenderThumb]);

	useEffect(() => {
		if (!focusedId) return;
		document
			.querySelector(`[data-layout-region="${CSS.escape(focusedId)}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [focusedId]);

	const handleJump = useCallback(
		(region: PdfLayoutRegion) => {
			onJump(region);
		},
		[onJump],
	);

	const running =
		analyzing ||
		(ui.stage === "running" &&
			(!documentId ||
				layoutAnalysisStore.getState().activeDocumentId === documentId));

	const empty = gallery.length === 0;
	const hasRaw = rawSidebarCount > 0;

	return (
		<section
			className={cn(
				"flex h-full min-h-0 flex-col overflow-hidden bg-background",
				className,
			)}
			aria-label={t("figures.panelAria")}
		>
			<PaneHeader
				trailing={
					documentId && viewerReady ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="size-6 text-muted-foreground hover:text-foreground"
							aria-label={
								result ? t("figures.reanalyze") : t("figures.analyze")
							}
							disabled={running}
							onClick={onAnalyze}
						>
							{running ? (
								<Loader2 className="size-3.5 animate-spin" aria-hidden />
							) : (
								<RefreshCw className="size-3.5" aria-hidden />
							)}
						</Button>
					) : null
				}
			>
				<ImageIcon className="size-4 text-muted-foreground" aria-hidden />
				<span className="font-medium text-sm">{t("figures.title")}</span>
				{!empty ? (
					<span className="text-muted-foreground text-xs tabular-nums">
						{gallery.length}
					</span>
				) : null}
			</PaneHeader>

			{!documentId ? (
				<p className="px-3 py-8 text-center text-muted-foreground text-xs">
					{t("figures.noPaper")}
				</p>
			) : running && !hasRaw ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4">
					<Loader2
						className="size-4 animate-spin text-muted-foreground"
						aria-hidden
					/>
					<p className="text-center text-muted-foreground text-xs">
						{ui.stage === "running" ? ui.message : t("figures.analyzing")}
					</p>
				</div>
			) : !hasRaw ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4">
					<p className="text-center text-muted-foreground text-xs">
						{viewerReady ? t("figures.empty") : t("figures.viewerUnavailable")}
					</p>
					{viewerReady ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={running}
							onClick={onAnalyze}
						>
							{running ? (
								<Loader2 className="size-3.5 animate-spin" aria-hidden />
							) : null}
							{t("figures.analyze")}
						</Button>
					) : null}
				</div>
			) : (
				<div className="flex min-h-0 flex-1 flex-col">
					{/* Confidence filter: score is model certainty (0–100%). */}
					<div className="shrink-0 space-y-1.5 border-b px-2 py-2">
						<div className="flex items-center justify-between gap-2">
							<TooltipProvider delayDuration={200}>
								<Tooltip>
									<TooltipTrigger asChild>
										<label
											htmlFor="figures-min-score"
											className="cursor-help text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2"
										>
											{t("figures.minConfidence", { pct: minScorePct })}
										</label>
									</TooltipTrigger>
									<TooltipContent side="bottom" className="max-w-56 text-xs">
										{t("figures.confidenceHint")}
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
							<span className="text-[10px] text-muted-foreground tabular-nums">
								{t("figures.shownOf", {
									shown: gallery.length,
									total: rawSidebarCount,
								})}
							</span>
						</div>
						<input
							id="figures-min-score"
							type="range"
							min={30}
							max={90}
							step={5}
							value={minScorePct}
							onChange={(e) =>
								setMinScorePct(Number.parseInt(e.target.value, 10) || 30)
							}
							className="h-1.5 w-full cursor-pointer accent-primary"
							aria-label={t("figures.minConfidenceAria")}
						/>
						<div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
							<span className="inline-flex items-center gap-1">
								<span
									className="size-2 rounded-full"
									style={{ backgroundColor: layoutKindHex("image") }}
								/>
								{t("figures.kindImage")}
							</span>
							<span className="inline-flex items-center gap-1">
								<span
									className="size-2 rounded-full"
									style={{ backgroundColor: layoutKindHex("chart") }}
								/>
								{t("figures.kindChart")}
							</span>
							<span className="inline-flex items-center gap-1">
								<span
									className="size-2 rounded-full"
									style={{ backgroundColor: layoutKindHex("table") }}
								/>
								{t("figures.kindTable")}
							</span>
							<span className="inline-flex items-center gap-1">
								<span
									className="size-2 rounded-full"
									style={{ backgroundColor: layoutKindHex("algorithm") }}
								/>
								{t("figures.kindAlgorithm")}
							</span>
							<span className="inline-flex items-center gap-1">
								<span
									className="size-2 rounded-full"
									style={{ backgroundColor: layoutKindHex("formula") }}
								/>
								{t("figures.kindFormula")}
							</span>
						</div>
					</div>

					{empty ? (
						<p className="px-3 py-8 text-center text-muted-foreground text-xs">
							{t("figures.emptyFiltered")}
						</p>
					) : (
						<div className="agentero-scroll min-h-0 flex-1 space-y-4 overflow-y-auto p-2">
							<Section
								title={t("figures.sectionFigures")}
								count={figures.length}
								accent={layoutKindHex("image")}
							>
								{figures.map((region, i) => (
									<FigureCard
										key={region.id}
										region={region}
										index={i + 1}
										selected={focusedId === region.id}
										thumb={thumbs[region.id]}
										onJump={handleJump}
									/>
								))}
							</Section>
							<Section
								title={t("figures.sectionTables")}
								count={tables.length}
								accent={layoutKindHex("table")}
							>
								{tables.map((region, i) => (
									<FigureCard
										key={region.id}
										region={region}
										index={i + 1}
										selected={focusedId === region.id}
										thumb={thumbs[region.id]}
										onJump={handleJump}
									/>
								))}
							</Section>
							<Section
								title={t("figures.sectionAlgorithms")}
								count={algorithms.length}
								accent={layoutKindHex("algorithm")}
							>
								{algorithms.map((region, i) => (
									<FigureCard
										key={region.id}
										region={region}
										index={i + 1}
										selected={focusedId === region.id}
										thumb={thumbs[region.id]}
										onJump={handleJump}
									/>
								))}
							</Section>
							{/* Formulas always last: numbered only (merge drops unnumbered). */}
							<Section
								title={t("figures.sectionFormulas")}
								count={formulas.length}
								accent={layoutKindHex("formula")}
							>
								{formulas.map((region, i) => (
									<FigureCard
										key={region.id}
										region={region}
										index={i + 1}
										selected={focusedId === region.id}
										thumb={thumbs[region.id]}
										onJump={handleJump}
									/>
								))}
							</Section>
						</div>
					)}
				</div>
			)}
		</section>
	);
}
