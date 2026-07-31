import { ScanSearch } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { SelectionCard } from "@/components/viewer/pdf-ask/selection-card";
import { useImeGuard } from "@/hooks/use-ime-guard";
import type { PromptImage } from "@/lib/agent";

type VisualAnnotationEditorProps = {
	/** Screen point near the selected region. */
	screen: { x: number; y: number };
	/** 1-based PDF page number. */
	page: number;
	/** Crop thumbnail / attachment image. */
	image: PromptImage;
	onSave: (comment: string) => void;
	onClose: () => void;
};

/**
 * Floating editor after a PDF region crop: preview + comment → Agent draft.
 * Does not send; saving only adds context to the Agent composer.
 */
export function VisualAnnotationEditor({
	screen,
	page,
	image,
	onSave,
	onClose,
}: VisualAnnotationEditorProps) {
	const { t } = useTranslation("viewer");
	const [text, setText] = useState("");
	const ref = useRef<HTMLTextAreaElement>(null);
	const { isBlockedByIme, compositionProps } = useImeGuard();

	const thumbnailSrc = useMemo(() => {
		if (!image.data) return null;
		const mime = image.mimeType || "image/png";
		return `data:${mime};base64,${image.data}`;
	}, [image.data, image.mimeType]);

	useEffect(() => {
		ref.current?.focus();
	}, []);

	return (
		<SelectionCard
			screen={screen}
			width={280}
			height={320}
			preferRight
			title={t("pdfExplain.annotationEditorLabel")}
			icon={ScanSearch}
			ariaLabel={t("pdfExplain.annotationEditorLabel")}
			bodyClassName="gap-2 px-3 py-2.5"
			footer={
				<div className="flex items-center justify-end gap-1">
					<Button type="button" variant="ghost" size="sm" onClick={onClose}>
						{t("pdfExplain.annotationCancel")}
					</Button>
					<Button type="button" size="sm" onClick={() => onSave(text)}>
						{t("pdfExplain.annotationSave")}
					</Button>
				</div>
			}
		>
			<div className="space-y-1.5">
				<p className="text-[11px] text-muted-foreground">
					{t("pdfExplain.annotationPage", { page })}
				</p>
				{thumbnailSrc ? (
					<img
						src={thumbnailSrc}
						alt={t("pdfExplain.annotationPreviewAlt", { page })}
						className="max-h-28 w-full rounded-md border border-border/70 object-contain bg-muted/30"
					/>
				) : null}
			</div>
			<textarea
				ref={ref}
				className="min-h-16 w-full min-w-0 flex-1 resize-none rounded-md border border-border/80 bg-transparent p-2 text-sm text-foreground/80 outline-none placeholder:text-muted-foreground/80 focus:ring-1 focus:ring-ring"
				placeholder={t("pdfExplain.annotationPlaceholder")}
				value={text}
				onChange={(e) => setText(e.target.value)}
				{...compositionProps}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						onClose();
						return;
					}
					if (e.key === "Enter" && !e.shiftKey && !isBlockedByIme(e)) {
						e.preventDefault();
						onSave(text);
					}
				}}
			/>
		</SelectionCard>
	);
}
