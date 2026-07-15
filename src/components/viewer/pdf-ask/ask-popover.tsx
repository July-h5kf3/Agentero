import { Loader2, MessageSquare, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import type { PdfAskThread } from "@/lib/pdf-ask/types";
import { cn } from "@/lib/utils";

type AskPopoverProps = {
	thread: PdfAskThread;
	screen: { x: number; y: number };
	streaming: boolean;
	error: string | null;
	onSend: (question: string) => void;
	onClose: () => void;
	onEnd: () => void;
};

export function AskPopover({
	thread,
	screen,
	streaming,
	error,
	onSend,
	onClose,
	onEnd,
}: AskPopoverProps) {
	const { t } = useTranslation("viewer");
	const [draft, setDraft] = useState("");
	const listRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	// Focus when switching threads
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-focus on thread change
	useEffect(() => {
		inputRef.current?.focus();
	}, [thread.id]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll when messages grow
	useEffect(() => {
		const el = listRef.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
	}, [thread.messages, streaming]);

	const submit = () => {
		const q = draft.trim();
		if (!q || streaming) return;
		setDraft("");
		onSend(q);
	};

	// Keep card inside viewport
	const left = Math.min(
		Math.max(12, screen.x + 8),
		typeof window !== "undefined" ? window.innerWidth - 340 : screen.x,
	);
	const top = Math.min(
		Math.max(12, screen.y),
		typeof window !== "undefined" ? window.innerHeight - 320 : screen.y,
	);

	return (
		<div
			className={cn(
				"fixed z-50 flex w-[min(320px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg",
			)}
			style={{ left, top }}
			role="dialog"
			aria-label={t("pdfAsk.dialogLabel")}
			onMouseDown={(e) => e.stopPropagation()}
		>
			<div className="flex items-center gap-1.5 border-border border-b px-2.5 py-1.5">
				<MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
					{thread.anchor.quote
						? t("pdfAsk.quoteLine", {
								page: thread.anchor.page,
								quote:
									thread.anchor.quote.length > 48
										? `${thread.anchor.quote.slice(0, 45)}…`
										: thread.anchor.quote,
							})
						: t("pdfAsk.pageOnly", { page: thread.anchor.page })}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label={t("pdfAsk.end")}
					title={t("pdfAsk.end")}
					onClick={onEnd}
				>
					<span className="text-[10px] font-medium">✓</span>
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label={t("pdfAsk.close")}
					onClick={onClose}
				>
					<X className="size-3.5" />
				</Button>
			</div>

			<div
				ref={listRef}
				className="motif-scroll max-h-48 min-h-[4rem] space-y-2 overflow-y-auto px-2.5 py-2"
			>
				{thread.messages.length === 0 && !streaming ? (
					<p className="text-muted-foreground text-xs">
						{t("pdfAsk.emptyHint")}
					</p>
				) : null}
				{thread.messages.map((m) => (
					<div
						key={m.id}
						className={cn(
							"rounded-lg px-2 py-1.5 text-xs leading-relaxed",
							m.role === "user"
								? "ml-4 bg-primary/10 text-foreground"
								: m.role === "assistant"
									? "mr-2 bg-muted text-foreground"
									: "text-muted-foreground",
						)}
					>
						{m.content}
					</div>
				))}
				{streaming ? (
					<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
						<Loader2 className="size-3 animate-spin" />
						{t("pdfAsk.thinking")}
					</div>
				) : null}
				{error ? (
					<p className="text-destructive text-xs" role="alert">
						{error}
					</p>
				) : null}
			</div>

			<div className="flex items-end gap-1 border-border border-t p-2">
				<textarea
					ref={inputRef}
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					rows={2}
					placeholder={t("pdfAsk.placeholder")}
					disabled={streaming}
					className="motif-scroll max-h-24 min-h-[2.5rem] flex-1 resize-none rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							submit();
						}
						if (e.key === "Escape") {
							e.preventDefault();
							onClose();
						}
					}}
				/>
				<Button
					type="button"
					size="icon-sm"
					disabled={streaming || !draft.trim()}
					aria-label={t("pdfAsk.send")}
					onClick={submit}
				>
					<Send className="size-3.5" />
				</Button>
			</div>
		</div>
	);
}
