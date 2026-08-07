import { MessageSquarePlus, NotebookPen, Trash2Icon, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { SelectionCard } from "@/components/viewer/pdf-ask/selection-card";
import { useImeGuard } from "@/hooks/use-ime-guard";

type VisualAnnotationEditorProps = {
	/** Screen point near the selected region. */
	screen: { x: number; y: number };
	/** Existing note when re-opening a draft; empty for a fresh crop. */
	initialComment?: string;
	/** Save as note-only visual annotation (same as normal 批注备注). */
	onSave: (comment: string) => void;
	/**
	 * Header action: add this crop + comment to the Agent sidebar composer
	 * (does not start a pin chat by itself).
	 */
	onAddToChat: (comment: string) => void;
	/** Discard the pending crop (same as cancel for a fresh region). */
	onDelete: () => void;
	onClose: () => void;
	/** Hover surface for ephemeral layout-hover drafts (cancel auto-hide). */
	onPointerEnter?: () => void;
	onPointerLeave?: () => void;
};

/**
 * Post-crop note editor — same chrome as the text highlight AnnotationEditor
 * (title「批注备注」、textarea、取消/保存). Header: 加入侧边栏 / 删除 / 关闭.
 */
export function VisualAnnotationEditor({
	screen,
	initialComment,
	onSave,
	onAddToChat,
	onDelete,
	onClose,
	onPointerEnter,
	onPointerLeave,
}: VisualAnnotationEditorProps) {
	const { t } = useTranslation("viewer");
	const [text, setText] = useState(initialComment ?? "");
	const ref = useRef<HTMLTextAreaElement>(null);
	const { isBlockedByIme, compositionProps } = useImeGuard();

	useEffect(() => {
		ref.current?.focus();
	}, []);

	useEffect(() => {
		setText(initialComment ?? "");
	}, [initialComment]);

	const save = useCallback(() => onSave(text), [onSave, text]);
	const addToChat = useCallback(() => onAddToChat(text), [onAddToChat, text]);

	const actions = useMemo(
		() => [
			{
				label: t("pdfExplain.addToSidebarChat"),
				onClick: addToChat,
				icon: <MessageSquarePlus className="size-3.5" />,
			},
			{
				label: t("annotations.delete"),
				onClick: onDelete,
				icon: <Trash2Icon className="size-3.5" />,
				destructive: true,
			},
			{
				label: t("annotations.close"),
				onClick: onClose,
				icon: <X className="size-3.5" />,
			},
		],
		[t, addToChat, onDelete, onClose],
	);

	return (
		<SelectionCard
			screen={screen}
			width={240}
			height={200}
			preferRight
			title={t("annotations.editorLabel")}
			icon={NotebookPen}
			ariaLabel={t("annotations.editorLabel")}
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
			bodyClassName="gap-2 px-3 py-2.5"
			actions={actions}
			footer={
				<div className="flex items-center justify-end gap-1">
					<Button type="button" variant="ghost" size="sm" onClick={onClose}>
						{t("annotations.cancel")}
					</Button>
					<Button type="button" size="sm" onClick={save}>
						{t("annotations.save")}
					</Button>
				</div>
			}
		>
			<textarea
				ref={ref}
				className="min-h-16 w-full min-w-0 flex-1 resize-none rounded-md border border-border/80 bg-transparent p-2 text-sm text-foreground/80 outline-none placeholder:text-muted-foreground/80 focus:ring-1 focus:ring-ring"
				placeholder={t("annotations.placeholder")}
				value={text}
				onChange={(e) => setText(e.target.value)}
				{...compositionProps}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						onClose();
						return;
					}
					// Enter = save; Shift+Enter = newline (same as AnnotationEditor).
					if (e.key === "Enter" && !e.shiftKey && !isBlockedByIme(e)) {
						e.preventDefault();
						save();
					}
				}}
			/>
		</SelectionCard>
	);
}
