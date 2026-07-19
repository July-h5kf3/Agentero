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
import { SelectionCard } from "@/components/viewer/pdf-ask/selection-card";
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
	const title = threadTitle(thread, t("pdfAsk.newTitle"));

	return (
		<SelectionCard
			screen={screen}
			width={360}
			height={360}
			title={title}
			icon={MessageSquareIcon}
			ariaLabel={t("pdfAsk.dialogLabel")}
			onPointerEnter={onPointerEnter}
			onPointerLeave={onPointerLeave}
			// Conversation owns scroll; body must not grow past the viewport cap.
			bodyClassName="min-h-0 overflow-hidden p-0"
			actions={[
				{
					label: t("pdfAsk.delete"),
					onClick: onDelete,
					icon: <Trash2Icon className="size-3.5" />,
					destructive: true,
				},
				{
					label: t("pdfAsk.hide"),
					onClick: onHide,
					icon: <MinusIcon className="size-3.5" />,
				},
			]}
			footer={
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
			}
		>
			<Conversation className="min-h-0 min-w-0 flex-1 overflow-y-hidden">
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
												m.id === thread.messages[thread.messages.length - 1]?.id
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
		</SelectionCard>
	);
}
