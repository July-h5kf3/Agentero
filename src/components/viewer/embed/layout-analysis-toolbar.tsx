import type {
	DocumentAnalysisProgress,
	DocumentLayout,
	LayoutTask,
} from "@embedpdf/plugin-layout-analysis";
import {
	useLayoutAnalysis,
	useLayoutAnalysisCapability,
} from "@embedpdf/plugin-layout-analysis/react";
import { Boxes, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { notifyError } from "@/lib/core/notify";
import { cn } from "@/lib/core/utils";
import {
	dedupeLayoutRegions,
	isSidebarLayoutKind,
	layoutAnalysisStore,
	runDocumentLayoutAnalysis,
	setLayoutAnalysisUi,
	summarizeLayoutResult,
} from "@/lib/pdf/layout";
import { openRightTab } from "@/lib/shell/ui-store";

type LayoutAnalysisToolbarProps = {
	documentId: string;
};

/**
 * Opt-in control: run EmbedPDF layout analysis (PP-DocLayoutV3 via ONNX) and
 * collect image / table / formula / chart bboxes. Must render under EmbedPDF.
 */
export function LayoutAnalysisToolbar({
	documentId,
}: LayoutAnalysisToolbarProps) {
	const { t } = useTranslation("viewer");
	const { provides: layoutCap } = useLayoutAnalysisCapability();
	const { scope, layoutOverlayVisible, provides } =
		useLayoutAnalysis(documentId);
	const ui = useStore(layoutAnalysisStore, (s) => s.ui);
	const result = useStore(
		layoutAnalysisStore,
		(s) => s.byDocument[documentId] ?? null,
	);
	const taskRef = useRef<LayoutTask<
		DocumentLayout,
		DocumentAnalysisProgress
	> | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		return () => {
			taskRef.current?.abort({
				type: "no-document",
				message: "unmount",
			});
			taskRef.current = null;
		};
	}, []);

	const handleAnalyze = useCallback(() => {
		const la = scope ?? layoutCap?.forDocument(documentId);
		if (!la) {
			notifyError(t("pdf.layout.unavailable"));
			return;
		}

		taskRef.current?.abort({
			type: "no-document",
			message: "superseded",
		});

		setBusy(true);
		setLayoutAnalysisUi(
			{ stage: "running", message: t("pdf.layout.preparingModel") },
			documentId,
		);

		void runDocumentLayoutAnalysis(la, documentId, {
			onProgress: (p) => {
				let message = t("pdf.layout.running");
				switch (p.stage) {
					case "downloading-model": {
						const pct =
							p.total > 0 ? Math.round((p.loaded / p.total) * 100) : 0;
						message = t("pdf.layout.loadingModel", { pct });
						break;
					}
					case "creating-session":
						message = t("pdf.layout.creatingSession");
						break;
					case "rendering":
						message = t("pdf.layout.rendering", {
							page: p.pageIndex + 1,
						});
						break;
					case "layout-detection":
						message = t("pdf.layout.detecting", {
							page: p.pageIndex + 1,
						});
						break;
					case "mapping-coordinates":
						message = t("pdf.layout.mapping", {
							page: p.pageIndex + 1,
						});
						break;
					case "table-structure":
						message = t("pdf.layout.tableStructure", {
							page: p.pageIndex + 1,
							index: p.tableIndex + 1,
							total: p.tableCount,
						});
						break;
					case "page-complete":
						message = t("pdf.layout.pageComplete", {
							completed: p.completed,
							total: p.total,
						});
						break;
					default:
						break;
				}
				setLayoutAnalysisUi({ stage: "running", message }, documentId);
			},
			onDone: (summary, total) => {
				taskRef.current = null;
				setBusy(false);
				provides?.setLayoutOverlayVisible(true);
				setLayoutAnalysisUi(
					{
						stage: "done",
						message: t("pdf.layout.done", { summary }),
						total,
					},
					documentId,
				);
				// Surface results in the right rail.
				openRightTab("figures");
			},
			onError: (message, aborted) => {
				taskRef.current = null;
				setBusy(false);
				if (aborted) return;
				notifyError(t("pdf.layout.failed"), { description: message });
			},
		})
			.then((task) => {
				taskRef.current = task;
			})
			.catch((e) => {
				taskRef.current = null;
				setBusy(false);
				const message = e instanceof Error ? e.message : String(e);
				notifyError(t("pdf.layout.failed"), { description: message });
			});
	}, [scope, layoutCap, documentId, provides, t]);

	const handleToggleOverlay = useCallback(() => {
		provides?.setLayoutOverlayVisible(!layoutOverlayVisible);
	}, [provides, layoutOverlayVisible]);

	const running = busy || ui.stage === "running";
	// Sidebar-facing count: image / table / algorithm after dedupe + default gate.
	const sidebarCount = result
		? dedupeLayoutRegions(
				result.regions.filter((r) => isSidebarLayoutKind(r.kind)),
				{ minScore: 0.3 },
			).length
		: 0;
	const hasResult = sidebarCount > 0;
	const tooltip =
		ui.stage === "running"
			? ui.message
			: ui.stage === "done"
				? t("pdf.layout.done", { summary: ui.message })
				: ui.stage === "error"
					? ui.message
					: hasResult && result
						? t("pdf.layout.rerunHint", {
								summary: summarizeLayoutResult(result),
							})
						: t("pdf.layout.analyze");

	return (
		<>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						type="button"
						size="icon-xs"
						variant={running ? "secondary" : "ghost"}
						aria-label={t("pdf.layout.analyze")}
						aria-busy={running}
						disabled={!layoutCap && !scope}
						onClick={handleAnalyze}
					>
						{running ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : (
							<Boxes className="size-3.5" />
						)}
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom" className="max-w-64">
					{tooltip}
				</TooltipContent>
			</Tooltip>
			{hasResult ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							size="icon-xs"
							variant={layoutOverlayVisible ? "secondary" : "ghost"}
							aria-label={t("pdf.layout.toggleOverlay")}
							aria-pressed={layoutOverlayVisible}
							onClick={handleToggleOverlay}
							className={cn(layoutOverlayVisible && "text-primary")}
						>
							<span className="min-w-3 px-0.5 text-[10px] font-medium tabular-nums">
								{sidebarCount}
							</span>
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom">
						{layoutOverlayVisible
							? t("pdf.layout.hideOverlay")
							: t("pdf.layout.showOverlay")}
					</TooltipContent>
				</Tooltip>
			) : null}
		</>
	);
}
