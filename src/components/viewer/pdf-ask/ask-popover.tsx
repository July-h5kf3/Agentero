import { MessageSquareIcon, MinusIcon, Trash2Icon } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "@/components/ai-elements/message";
import {
	PromptInput,
	PromptInputBody,
	PromptInputSubmit,
	PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { threadTitle } from "@/lib/pdf-ask/schema";
import type { PdfAskThread } from "@/lib/pdf-ask/types";
import { cn } from "@/lib/utils";

type AskPopoverProps = {
	thread: PdfAskThread;
	screen: { x: number; y: number };
	streaming: boolean;
	error: string | null;
	/** Prefill single-line prompt (e.g. page number on double-click) */
	initialPrompt?: string;
	onSend: (question: string) => void;
	/** Collapse dialog; keep margin pin */
	onHide: () => void;
	/** Remove thread + pin permanently */
	onDelete: () => void;
	onStop?: () => void;
	/** Cancel delayed hover-hide while pointer is over dialog */
	onPointerEnter?: () => void;
	/** Schedule delayed hide when leaving dialog */
	onPointerLeave?: () => void;
};

export function AskPopover({
	thread,
	screen,
	streaming,
	error,
	initialPrompt,
	onSend,
	onHide,
	onDelete,
	onStop,
	onPointerEnter,
	onPointerLeave,
}: AskPopoverProps) {
	const { t } = useTranslation("viewer");

	// Prefer opening just to the right of the pin; flip left if near viewport edge
	const cardW = 360;
	const cardH = 360;
	const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
	const vh = typeof window !== "undefined" ? window.innerHeight : 800;
	let left = screen.x + 6;
	if (left + cardW > vw - 12) {
		left = Math.max(12, screen.x - cardW - 14);
	}
	left = Math.min(Math.max(12, left), vw - cardW - 12);
	const top = Math.min(Math.max(12, screen.y - 24), vh - cardH - 12);

	const title = threadTitle(thread, t("pdfAsk.newTitle"));

	return (
		<div
			className={cn(
				"fixed z-50 flex max-h-[min(420px,calc(100vh-24px))] w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden",
				"rounded-2xl border border-border/80 bg-background text-foreground shadow-2xl ring-1 ring-black/5 dark:ring-white/10",
			)}
			style={{ left, top }}
			role="dialog"
			aria-label={t("pdfAsk.dialogLabel")}
			onMouseDown={(e) => e.stopPropagation()}
			onMouseEnter={onPointerEnter}
			onMouseLeave={onPointerLeave}
		>
			<div className="flex shrink-0 items-center gap-2 border-border/60 border-b px-3 py-2">
				<MessageSquareIcon className="size-3.5 shrink-0 text-muted-foreground" />
				<span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm">
					{title}
				</span>
				<TooltipProvider delayDuration={200}>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								aria-label={t("pdfAsk.delete")}
								onClick={onDelete}
							>
								<Trash2Icon className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">{t("pdfAsk.delete")}</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								aria-label={t("pdfAsk.hide")}
								onClick={onHide}
							>
								<MinusIcon className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom">{t("pdfAsk.hide")}</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</div>

			<div className="flex min-h-0 flex-1 flex-col">
				<Conversation className="min-h-0 flex-1">
					<ConversationContent className="gap-3 px-3 py-2.5">
						{thread.messages.map((m) => {
							if (m.role === "system") {
								return (
									<p
										key={m.id}
										className="text-center text-muted-foreground text-xs"
									>
										{m.content}
									</p>
								);
							}
							const from = m.role === "user" ? "user" : "assistant";
							const isEmptyAssistant =
								from === "assistant" && !m.content.trim() && streaming;
							return (
								<Message key={m.id} from={from} className="max-w-full">
									<MessageContent
										className={cn(
											"text-sm",
											from === "user" && "px-3 py-2",
											from === "assistant" && "w-full max-w-full",
										)}
									>
										{isEmptyAssistant ? (
											<Shimmer className="text-sm" as="p">
												{t("pdfAsk.thinking")}
											</Shimmer>
										) : m.content.trim() ? (
											<MessageResponse
												isAnimating={
													streaming &&
													from === "assistant" &&
													m.id ===
														thread.messages[thread.messages.length - 1]?.id
												}
											>
												{m.content}
											</MessageResponse>
										) : null}
									</MessageContent>
								</Message>
							);
						})}
						{error ? (
							<p className="text-destructive text-xs" role="alert">
								{error}
							</p>
						) : null}
					</ConversationContent>
					<ConversationScrollButton className="bottom-2 size-8 shadow-md" />
				</Conversation>
			</div>

			<div className="shrink-0 border-border/60 border-t p-2">
				<PromptInput
					key={`${thread.id}-${initialPrompt ?? ""}`}
					className="w-full rounded-full border-border/80 bg-background shadow-none"
					inputGroupClassName="overflow-visible"
					onSubmit={({ text }) => {
						const q = text.trim();
						if (streaming || !q) return;
						onSend(q);
					}}
				>
					<PromptInputBody>
						<div className="flex w-full items-center gap-1 px-1.5 py-0.5">
							<PromptInputTextarea
								placeholder={t("pdfAsk.placeholder")}
								defaultValue={initialPrompt}
								disabled={streaming}
								rows={1}
								className="min-h-8 max-h-8 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm leading-5 shadow-none focus-visible:ring-0"
								onKeyDown={(e) => {
									if (e.key === "Escape") {
										e.preventDefault();
										onHide();
									}
								}}
							/>
							<PromptInputSubmit
								className="shrink-0 rounded-full"
								size="icon-xs"
								status={streaming ? "streaming" : "ready"}
								onStop={streaming ? onStop : undefined}
							/>
						</div>
					</PromptInputBody>
				</PromptInput>
			</div>
		</div>
	);
}
