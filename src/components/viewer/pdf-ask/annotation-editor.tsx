import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AnnotationEditorProps = {
	/** Screen point near the highlight (from popoverScreenPoint) */
	screen: { x: number; y: number };
	/** The highlighted passage, shown read-only */
	quote: string;
	/** Existing note text when editing; empty for a fresh annotation */
	initialComment?: string;
	/** Save the (possibly empty) note; empty means "no comment / plain highlight" */
	onSave: (text: string) => void;
	/**
	 * Cancel: remove the highlight (undo the selection annotation).
	 * Wired to the Cancel button; Escape only closes without deleting.
	 */
	onCancel: () => void;
	/** Dismiss editor without deleting the highlight (e.g. Escape) */
	onClose: () => void;
};

const BOX_W = 260;

/** Floating note editor anchored next to a highlight. */
export function AnnotationEditor({
	screen,
	quote,
	initialComment,
	onSave,
	onCancel,
	onClose,
}: AnnotationEditorProps) {
	const { t } = useTranslation("viewer");
	const [text, setText] = useState(initialComment ?? "");
	const ref = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		ref.current?.focus();
	}, []);

	const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
	const vh = typeof window !== "undefined" ? window.innerHeight : 800;
	let left = screen.x;
	left = Math.min(Math.max(12, left), vw - BOX_W - 12);
	let top = screen.y;
	top = Math.min(Math.max(12, top), vh - 180);

	return (
		<div
			className={cn(
				"fixed z-50 flex w-[260px] flex-col gap-2 rounded-xl border border-border/80 bg-background p-3 shadow-2xl ring-1 ring-black/5 dark:ring-white/10",
			)}
			style={{ left, top }}
			role="dialog"
			aria-label={t("annotations.editorLabel")}
			onMouseDown={(e) => e.stopPropagation()}
		>
			<blockquote className="max-h-16 overflow-y-auto border-amber-400 border-l-2 pl-2 text-muted-foreground text-xs">
				{quote}
			</blockquote>
			<textarea
				ref={ref}
				className="min-h-16 w-full resize-none rounded-md border border-border/80 bg-transparent p-2 text-sm outline-none focus:ring-1 focus:ring-ring"
				placeholder={t("annotations.placeholder")}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
						e.preventDefault();
						onSave(text);
					}
					if (e.key === "Escape") {
						e.preventDefault();
						onClose();
					}
				}}
			/>
			<div className="flex items-center justify-end gap-1">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					{t("annotations.cancel")}
				</Button>
				<Button type="button" size="sm" onClick={() => onSave(text)}>
					{t("annotations.save")}
				</Button>
			</div>
		</div>
	);
}
