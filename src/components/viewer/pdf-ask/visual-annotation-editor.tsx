import { ScanSearch, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

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
	/** Enter: add to Agent composer drafts (default). */
	onSave: (comment: string) => void;
	/** ⌘/Ctrl+Enter: start an in-place visual conversation immediately. */
	onSendNow: (comment: string) => void;
	onClose: () => void;
};

/**
 * Floating editor after a PDF region crop: preview + comment.
 * Enter → composer draft; ⌘/Ctrl+Enter → immediate pin chat.
 * Actions are keyboard-driven; cancel is a header icon only.
 */
export function VisualAnnotationEditor({
	screen,
	page,
	image,
	onSave,
	onSendNow,
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

	const submitDraft = () => onSave(text);
	const submitNow = () => onSendNow(text);

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
			actions={[
				{
					label: t("pdfExplain.annotationCancel"),
					onClick: onClose,
					icon: <X className="size-3.5" />,
				},
			]}
			footer={
				<p className="px-1 text-center text-[10px] text-muted-foreground leading-tight">
					{t("pdfExplain.annotationShortcuts")}
				</p>
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
						className="max-h-28 w-full rounded-md border border-border/70 bg-muted/30 object-contain"
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
					if (e.key !== "Enter" || e.shiftKey || isBlockedByIme(e)) return;
					// ⌘/Ctrl+Enter → immediate conversation; bare Enter → composer draft.
					if (e.metaKey || e.ctrlKey) {
						e.preventDefault();
						submitNow();
						return;
					}
					e.preventDefault();
					submitDraft();
				}}
			/>
		</SelectionCard>
	);
}
