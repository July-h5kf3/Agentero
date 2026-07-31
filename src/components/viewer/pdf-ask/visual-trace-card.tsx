import { ExternalLink, ScanSearch, Trash2Icon, X } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { SelectionCard } from "@/components/viewer/pdf-ask/selection-card";
import { tracePreview } from "@/lib/pdf/agent-trace/schema";
import type { PdfVisualSessionTrace } from "@/lib/pdf/agent-trace/types";

type VisualTraceCardProps = {
	trace: PdfVisualSessionTrace;
	screen: { x: number; y: number };
	onOpenSession: () => void;
	onDelete: () => void;
	onHide: () => void;
	onPointerEnter?: () => void;
	onPointerLeave?: () => void;
};

/** Hover card for one visual mark: crop preview + comment + open/delete. */
export function VisualTraceCard({
	trace,
	screen,
	onOpenSession,
	onDelete,
	onHide,
	onPointerEnter,
	onPointerLeave,
}: VisualTraceCardProps) {
	const { t } = useTranslation("viewer");
	const preview = tracePreview(trace, t("pdfExplain.visualAnnotation"), 280);
	const imageSrc = useMemo(() => {
		const image = trace.image;
		if (!image?.data) return null;
		const mime = image.mimeType || "image/png";
		return `data:${mime};base64,${image.data}`;
	}, [trace.image]);

	return (
		<SelectionCard
			screen={screen}
			width={300}
			height={imageSrc ? 320 : 200}
			preferRight
			title={t("pdfExplain.traceCardTitle")}
			icon={ScanSearch}
			ariaLabel={t("pdfExplain.traceCardTitle")}
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
			bodyClassName="gap-2 px-3 py-2.5"
			actions={[
				{
					label: t("pdfExplain.traceDelete"),
					onClick: onDelete,
					icon: <Trash2Icon className="size-3.5" />,
					destructive: true,
				},
				{
					label: t("pdfExplain.traceHide"),
					onClick: onHide,
					icon: <X className="size-3.5" />,
				},
			]}
			footer={
				<div className="flex items-center justify-end gap-1">
					<Button type="button" size="sm" onClick={onOpenSession}>
						<ExternalLink className="mr-1.5 size-3.5" aria-hidden />
						{t("pdfExplain.traceOpenSession")}
					</Button>
				</div>
			}
		>
			<p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider tabular-nums">
				{t("annotations.pageLabel", { page: trace.page })}
			</p>
			{imageSrc ? (
				<img
					src={imageSrc}
					alt={t("pdfExplain.annotationPreviewAlt", { page: trace.page })}
					className="max-h-36 w-full rounded-md border border-border/70 bg-muted/30 object-contain"
				/>
			) : null}
			<p className="line-clamp-4 whitespace-pre-wrap break-words text-[13px] text-foreground leading-relaxed">
				{preview}
			</p>
			{trace.status === "failed" && trace.error ? (
				<p className="text-destructive text-xs leading-relaxed">
					{trace.error}
				</p>
			) : null}
		</SelectionCard>
	);
}
