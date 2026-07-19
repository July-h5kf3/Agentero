import { NotebookPen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { SelectionCard } from "@/components/viewer/pdf-ask/selection-card";

type AnnotationEditorProps = {
	/** Screen point near the highlight (from popoverScreenPoint) */
	screen: { x: number; y: number };
	/** Highlighted passage (read-only context for the note) */
	quote: string;
	/** Existing note text when editing; empty for a fresh annotation */
	initialComment?: string;
	/** Save the (possibly empty) note; empty means "no comment / plain highlight" */
	onSave: (text: string) => void;
	/** Cancel edit: close without saving and without deleting the highlight */
	onClose: () => void;
	/** Same hover-hide contract as ask / translate cards */
	onPointerEnter?: () => void;
	onPointerLeave?: () => void;
};

/**
 * Floating note editor — quote (context) + note field + cancel/save.
 * Cancel discards draft text only; it does not remove the highlight.
 */
export function AnnotationEditor({
	screen,
	quote,
	initialComment,
	onSave,
	onClose,
	onPointerEnter,
	onPointerLeave,
}: AnnotationEditorProps) {
	const { t } = useTranslation("viewer");
	const [text, setText] = useState(initialComment ?? "");
	const ref = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		ref.current?.focus();
	}, []);

	// Re-sync when switching to another annotation without unmounting.
	useEffect(() => {
		setText(initialComment ?? "");
	}, [initialComment]);

	return (
		<SelectionCard
			screen={screen}
			width={280}
			height={320}
			preferRight={false}
			title={t("annotations.editorLabel")}
			icon={NotebookPen}
			ariaLabel={t("annotations.editorLabel")}
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
			bodyClassName="gap-2 px-3 py-2.5"
			footer={
				<div className="flex items-center justify-end gap-1">
					<Button type="button" variant="ghost" size="sm" onClick={onClose}>
						{t("annotations.cancel")}
					</Button>
					<Button type="button" size="sm" onClick={() => onSave(text)}>
						{t("annotations.save")}
					</Button>
				</div>
			}
		>
			{quote.trim() ? (
				<blockquote className="agentero-scroll max-h-20 shrink-0 overflow-y-auto border-border/70 border-l-2 pl-2 text-muted-foreground text-xs leading-relaxed">
					{quote.trim()}
				</blockquote>
			) : null}
			<textarea
				ref={ref}
				className="min-h-16 w-full min-w-0 flex-1 resize-none rounded-md border border-border/80 bg-transparent p-2 text-sm text-foreground/80 outline-none placeholder:text-muted-foreground/80 focus:ring-1 focus:ring-ring"
				placeholder={t("annotations.placeholder")}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") {
						e.preventDefault();
						onClose();
						return;
					}
					// Enter = save; Shift+Enter = newline (same as ask composer).
					// Skip while IME is composing (e.g. Chinese input).
					if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
						e.preventDefault();
						onSave(text);
					}
				}}
			/>
		</SelectionCard>
	);
}
