import { ScanSearch, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { SelectionCard } from "@/components/viewer/pdf-ask/selection-card";
import { useImeGuard } from "@/hooks/use-ime-guard";

type VisualAnnotationEditorProps = {
	/** Screen point near the selected region. */
	screen: { x: number; y: number };
	/** Enter: save note-only visual annotation (requires non-empty comment). */
	onSave: (comment: string) => void;
	/** ⌘/Ctrl+Enter: start an in-place visual Agent conversation. */
	onSendNow: (comment: string) => void;
	onClose: () => void;
	/** Hover surface for ephemeral layout-hover drafts (cancel auto-hide). */
	onPointerEnter?: () => void;
	onPointerLeave?: () => void;
};

/**
 * Floating editor after a PDF region crop: preview + comment.
 * Enter → save as annotation; ⌘/Ctrl+Enter → Agent prompt.
 * Actions are keyboard-driven; cancel is a header icon only.
 */
export function VisualAnnotationEditor({
	screen,
	onSave,
	onSendNow,
	onClose,
	onPointerEnter,
	onPointerLeave,
}: VisualAnnotationEditorProps) {
	const { t } = useTranslation("viewer");
	const [text, setText] = useState("");
	const ref = useRef<HTMLTextAreaElement>(null);
	const { isBlockedByIme, compositionProps } = useImeGuard();

	useEffect(() => {
		ref.current?.focus();
	}, []);

	const submitNote = () => {
		if (!text.trim()) return;
		onSave(text);
	};
	const submitAgent = () => onSendNow(text);

	return (
		<SelectionCard
			screen={screen}
			width={280}
			height={220}
			preferRight
			title={t("pdfExplain.annotationEditorLabel")}
			icon={ScanSearch}
			ariaLabel={t("pdfExplain.annotationEditorLabel")}
			bodyClassName="gap-2 px-3 py-2.5"
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
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
					// ⌘/Ctrl+Enter → Agent conversation; bare Enter → save note.
					if (e.metaKey || e.ctrlKey) {
						e.preventDefault();
						submitAgent();
						return;
					}
					e.preventDefault();
					submitNote();
				}}
			/>
		</SelectionCard>
	);
}
