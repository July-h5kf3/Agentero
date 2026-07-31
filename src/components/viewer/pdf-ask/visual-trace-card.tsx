import { ExternalLink, ScanSearch, Trash2Icon, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { cn } from "@/lib/core/utils";
import { traceMessages, tracePreview } from "@/lib/pdf/agent-trace/schema";
import type { PdfVisualSessionTrace } from "@/lib/pdf/agent-trace/types";

/** Compact pin-hover size (before pointer enters the card). */
const COMPACT = { width: 280, height: 260 } as const;
/** Expanded interactive size (pointer on the card). */
const EXPANDED = { width: 360, height: 440 } as const;

type VisualTraceCardProps = {
	trace: PdfVisualSessionTrace;
	screen: { x: number; y: number };
	streaming?: boolean;
	error?: string | null;
	/**
	 * Start expanded (e.g. just created via ⌘Enter). Pin hover stays compact
	 * until the pointer enters the card.
	 */
	initialExpanded?: boolean;
	onOpenSession: () => void;
	onSend: (question: string) => void;
	onDelete: () => void;
	onHide: () => void;
	onStop?: () => void;
	onPointerEnter?: () => void;
	onPointerLeave?: () => void;
};

/**
 * Hover card for one visual mark: compact preview → expand on card hover with
 * message list + continue input. "Open in Agent" sits in the header (top-right).
 */
export function VisualTraceCard({
	trace,
	screen,
	streaming = false,
	error = null,
	initialExpanded = false,
	onOpenSession,
	onSend,
	onDelete,
	onHide,
	onStop,
	onPointerEnter,
	onPointerLeave,
}: VisualTraceCardProps) {
	const { t } = useTranslation("viewer");
	const [expanded, setExpanded] = useState(initialExpanded);
	const messages = useMemo(() => traceMessages(trace), [trace]);
	const preview = tracePreview(trace, t("pdfExplain.visualAnnotation"), 280);
	const title = preview || t("pdfExplain.traceCardTitle");
	const scrollAnchorId = useMemo(() => {
		// Prefer last assistant, else last message — pin hover lands on the answer.
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg?.role === "assistant") return msg.id;
		}
		return messages[messages.length - 1]?.id ?? null;
	}, [messages]);
	const scrolledForTraceRef = useRef<string | null>(null);

	const imageSrc = useMemo(() => {
		const image = trace.image;
		if (!image?.data) return null;
		const mime = image.mimeType || "image/png";
		return `data:${mime};base64,${image.data}`;
	}, [trace.image]);

	// When pin first opens (or trace id changes), scroll the relevant message into view.
	useEffect(() => {
		if (scrolledForTraceRef.current === trace.id) return;
		if (!scrollAnchorId) return;
		const el = document.getElementById(`visual-trace-msg-${scrollAnchorId}`);
		if (!el) return;
		scrolledForTraceRef.current = trace.id;
		// rAF: wait for layout after compact mount
		requestAnimationFrame(() => {
			el.scrollIntoView({ block: "nearest", behavior: "smooth" });
		});
	}, [trace.id, scrollAnchorId]);

	useEffect(() => {
		if (initialExpanded) setExpanded(true);
	}, [initialExpanded]);

	const size = expanded ? EXPANDED : COMPACT;

	return (
		<SelectionCard
			screen={screen}
			width={size.width}
			height={size.height}
			lockHeight
			preferRight
			title={title}
			icon={ScanSearch}
			ariaLabel={t("pdfExplain.traceCardTitle")}
			onPointerEnter={() => {
				setExpanded(true);
				onPointerEnter?.();
			}}
			onPointerLeave={() => {
				// Stay expanded while streaming so the user can read the answer.
				if (!streaming) setExpanded(false);
				onPointerLeave?.();
			}}
			bodyClassName="min-h-0 overflow-hidden p-0"
			className={cn(
				"transition-[width,max-height,height] duration-200 ease-out",
			)}
			actions={[
				{
					label: t("pdfExplain.traceOpenSession"),
					onClick: onOpenSession,
					icon: <ExternalLink className="size-3.5" />,
				},
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
				<div className="flex flex-col gap-1">
					{!expanded ? (
						<p className="px-1 text-[10px] text-muted-foreground leading-tight">
							{t("pdfExplain.traceExpandHint")}
						</p>
					) : null}
					<PromptInput
						key={trace.id}
						className="w-full rounded-full border-border/80 bg-background shadow-none"
						inputGroupClassName="overflow-visible"
						onSubmit={({ text }) => {
							const q = text.trim();
							if (streaming || !q) return;
							setExpanded(true);
							onSend(q);
						}}
					>
						<PromptInputBody>
							<div className="flex w-full items-center gap-1 px-1.5 py-0.5">
								<PromptInputTextarea
									placeholder={t("pdfExplain.traceContinuePlaceholder")}
									disabled={streaming}
									rows={1}
									className="min-h-8 max-h-8 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm leading-5 shadow-none focus-visible:ring-0"
									onFocus={() => setExpanded(true)}
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
			}
		>
			<Conversation className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden">
				<ConversationContent
					className={cn("gap-2.5 px-3 py-2.5", !expanded && "gap-2")}
				>
					{imageSrc ? (
						<img
							src={imageSrc}
							alt={t("pdfExplain.annotationPreviewAlt", { page: trace.page })}
							className={cn(
								"w-full rounded-md border border-border/70 bg-muted/30 object-contain transition-[max-height] duration-200",
								expanded ? "max-h-28" : "max-h-16",
							)}
						/>
					) : null}
					<p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wider tabular-nums">
						{t("annotations.pageLabel", { page: trace.page })}
					</p>
					{messages.length === 0 ? (
						<p className="text-muted-foreground text-xs leading-relaxed">
							{t("pdfExplain.traceEmptyMessages")}
						</p>
					) : (
						messages.map((m) => {
							const from = m.role === "user" ? "user" : "assistant";
							const isEmptyAssistant =
								from === "assistant" && !m.content.trim() && streaming;
							const clamp =
								!expanded && from === "assistant"
									? "line-clamp-4"
									: !expanded && from === "user"
										? "line-clamp-2"
										: null;
							return (
								<Message
									key={m.id}
									id={`visual-trace-msg-${m.id}`}
									from={from}
									className="max-w-full"
								>
									<MessageContent
										className={cn(
											"text-sm",
											from === "user" && "px-3 py-2",
											from === "assistant" && "w-full max-w-full",
											clamp,
										)}
									>
										{isEmptyAssistant ? (
											<Shimmer className="text-sm" as="p">
												{t("pdfExplain.traceThinking")}
											</Shimmer>
										) : m.content.trim() ? (
											expanded ? (
												from === "assistant" ? (
													<MessageResponse
														isAnimating={
															streaming &&
															m.id === messages[messages.length - 1]?.id
														}
													>
														{m.content}
													</MessageResponse>
												) : (
													<span className="whitespace-pre-wrap break-words">
														{m.content}
													</span>
												)
											) : (
												<span className="whitespace-pre-wrap break-words">
													{m.content}
												</span>
											)
										) : null}
									</MessageContent>
								</Message>
							);
						})
					)}
					{error ? (
						<p className="text-destructive text-xs" role="alert">
							{error}
						</p>
					) : null}
					{trace.status === "failed" && trace.error && !error ? (
						<p className="text-destructive text-xs leading-relaxed">
							{trace.error}
						</p>
					) : null}
				</ConversationContent>
				{expanded ? (
					<ConversationScrollButton className="bottom-2 size-8 shadow-md" />
				) : null}
			</Conversation>
		</SelectionCard>
	);
}
