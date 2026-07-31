import {
	ArrowUpIcon,
	ExternalLink,
	ScanSearch,
	SquareIcon,
	Trash2Icon,
	X,
} from "lucide-react";
import {
	type KeyboardEvent,
	memo,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { ChatVisualAnnotations } from "@/components/agent/chat-visual-annotations";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "@/components/ai-elements/message";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { SelectionCard } from "@/components/viewer/pdf-ask/selection-card";
import { useImeGuard } from "@/hooks/use-ime-guard";
import { useAgentSessionStore } from "@/lib/agent/agent-session-store";
import {
	agentTextFromParts,
	type ChatLine,
	type ChatVisualAnnotation,
} from "@/lib/agent/chat-state";
import { stripPromptEnvelopeForDisplay } from "@/lib/agent/prompt-display";
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
 * Lightweight local-state input — intentionally NOT PromptInput.
 * PromptInput pulls attachments/drag-drop/context providers; combined with
 * frequent PdfViewer re-renders that made typing feel laggy even when idle.
 *
 * memo + local text state: parent stream/list updates must not remount this.
 */
const VisualTraceFooter = memo(function VisualTraceFooter({
	streaming,
	placeholder,
	sendLabel,
	stopLabel,
	onSend,
	onHide,
	onStop,
	onFocusInput,
}: {
	streaming: boolean;
	placeholder: string;
	sendLabel: string;
	stopLabel: string;
	onSend: (question: string) => void;
	onHide: () => void;
	onStop?: () => void;
	onFocusInput: () => void;
}) {
	// Uncontrolled: AX set_value / OS automation write the DOM node directly.
	// A controlled `value={text}` would immediately overwrite that on re-render.
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const { isBlockedByIme, compositionProps } = useImeGuard();

	const submit = useCallback(() => {
		const el = textareaRef.current;
		const q = (el?.value ?? "").trim();
		if (streaming || !q) return;
		onFocusInput();
		onSend(q);
		if (el) el.value = "";
	}, [streaming, onFocusInput, onSend]);

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Escape") {
			e.preventDefault();
			onHide();
			return;
		}
		if (e.key === "Enter" && !e.shiftKey && !isBlockedByIme(e)) {
			e.preventDefault();
			submit();
		}
	};

	return (
		<div className="flex w-full items-center gap-1 rounded-full border border-border/80 bg-background px-1.5 py-0.5">
			<textarea
				ref={textareaRef}
				defaultValue=""
				placeholder={placeholder}
				disabled={streaming}
				rows={1}
				// Fixed box — no field-sizing-content layout thrash per keystroke.
				className="min-h-8 max-h-8 flex-1 resize-none border-0 bg-transparent px-2 py-1.5 text-sm leading-5 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
				onFocus={onFocusInput}
				onKeyDown={onKeyDown}
				{...compositionProps}
			/>
			{streaming ? (
				<Button
					type="button"
					size="icon-xs"
					variant="secondary"
					className="shrink-0 rounded-full"
					aria-label={stopLabel}
					onClick={() => onStop?.()}
				>
					<SquareIcon className="size-3.5" />
				</Button>
			) : (
				<Button
					type="button"
					size="icon-xs"
					className="shrink-0 rounded-full"
					aria-label={sendLabel}
					// Always clickable when idle: submit() validates DOM value (AX set_value).
					disabled={streaming}
					onClick={submit}
				>
					<ArrowUpIcon className="size-3.5" />
				</Button>
			)}
		</div>
	);
});

/**
 * Hover card for one visual mark: compact preview → expand on card hover with
 * message list + continue input. "Open in Agent" sits in the header (top-right).
 *
 * Scroll is manual only — no stick-to-bottom. Pin open keeps the user turn in
 * view; expanding preserves scrollTop so the answer is not jumped to.
 */
type ModalTraceMessage = {
	id: string;
	role: "user" | "assistant";
	content: string;
	/** Same crop chips as the Agent panel user turn (above the bubble). */
	visualAnnotations?: ChatVisualAnnotation[];
};

/** Crop chip for the first user turn when store lines omit visualAnnotations. */
function chipFromTrace(
	trace: PdfVisualSessionTrace,
): ChatVisualAnnotation | null {
	if (!trace.image?.data) return null;
	return {
		id: trace.id,
		page: trace.page,
		comment: trace.comment,
		paperPath: trace.paperPath,
		image: {
			data: trace.image.data,
			mimeType: trace.image.mimeType || "image/png",
		},
	};
}

/**
 * Map shared Agent session lines → pin-modal bubbles (same source as sidebar).
 * Keep `visualAnnotations` so crop chips match the right-rail transcript.
 */
function chatLinesToTraceMessages(lines: ChatLine[]): ModalTraceMessage[] {
	const out: ModalTraceMessage[] = [];
	for (const line of lines) {
		if (line.kind === "user") {
			const content = stripPromptEnvelopeForDisplay(line.text);
			const visuals = line.visualAnnotations ?? [];
			// Visual-only turns may have empty free text after envelope strip.
			if (!content && visuals.length === 0) continue;
			out.push({
				id: line.id,
				role: "user",
				content,
				...(visuals.length ? { visualAnnotations: visuals } : {}),
			});
			continue;
		}
		if (line.kind === "agent") {
			const content = agentTextFromParts(line.parts);
			out.push({
				id: line.id,
				role: "assistant",
				content,
			});
		}
	}
	return out;
}

/** Ensure the first user bubble has a crop chip (store path or mark fallback). */
function withTraceCropChip(
	messages: ModalTraceMessage[],
	trace: PdfVisualSessionTrace,
): ModalTraceMessage[] {
	const chip = chipFromTrace(trace);
	if (!chip) return messages;
	let attached = false;
	return messages.map((m) => {
		if (m.role !== "user" || attached) return m;
		attached = true;
		if (m.visualAnnotations?.length) return m;
		return { ...m, visualAnnotations: [chip] };
	});
}

export const VisualTraceCard = memo(function VisualTraceCard({
	trace,
	screen,
	streaming: streamingProp = false,
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
	// Same transcript as the right-rail Agent panel (single store).
	const boundSessionId = useAgentSessionStore(
		(s) =>
			s.sessions.find((item) => item.visualTraceId === trace.id)?.id ?? null,
	);
	const boundLines = useAgentSessionStore((s) => {
		const session = s.sessions.find((item) => item.visualTraceId === trace.id);
		return session?.lines ?? null;
	});
	const boundStatus = useAgentSessionStore(
		(s) =>
			s.sessions.find((item) => item.visualTraceId === trace.id)?.status ??
			null,
	);
	const storeSubmitting = useAgentSessionStore((s) => s.submitting);
	const activeTabId = useAgentSessionStore((s) => s.activeTabId);
	const streaming =
		streamingProp ||
		boundStatus === "running" ||
		(storeSubmitting &&
			boundSessionId !== null &&
			boundSessionId === activeTabId);
	const messages = useMemo(() => {
		const raw: ModalTraceMessage[] =
			boundLines && boundLines.length > 0
				? chatLinesToTraceMessages(boundLines)
				: traceMessages(trace).map((m) => ({
						id: m.id,
						role:
							m.role === "user" ? ("user" as const) : ("assistant" as const),
						content: m.content,
					}));
		// Pin crop chip on first user turn (matches Agent panel Open-in-Agent lines).
		return withTraceCropChip(raw, trace);
	}, [boundLines, trace]);
	const preview = tracePreview(trace, t("pdfExplain.visualAnnotation"), 280);
	const title = preview || t("pdfExplain.traceCardTitle");
	/** Keep the user's annotation turn in view; do not auto-jump to the answer. */
	const userAnchorId = useMemo(() => {
		const firstUser = messages.find((m) => m.role === "user");
		return firstUser?.id ?? messages[0]?.id ?? null;
	}, [messages]);
	const scrolledForTraceRef = useRef<string | null>(null);
	const scrollPortRef = useRef<HTMLDivElement | null>(null);
	const scrollTopBeforeExpandRef = useRef(0);
	const lastStreamingId =
		streaming && messages[messages.length - 1]?.role === "assistant"
			? messages[messages.length - 1]?.id
			: null;

	// Pin open: place the user message in view once (never stick to the bottom).
	useEffect(() => {
		if (scrolledForTraceRef.current === trace.id) return;
		if (!userAnchorId) return;
		const port = scrollPortRef.current;
		const el = document.getElementById(`visual-trace-msg-${userAnchorId}`);
		if (!port || !el) return;
		scrolledForTraceRef.current = trace.id;
		requestAnimationFrame(() => {
			const portTop = port.getBoundingClientRect().top;
			const elTop = el.getBoundingClientRect().top;
			port.scrollTop += elTop - portTop - 8;
		});
	}, [trace.id, userAnchorId]);

	useEffect(() => {
		if (initialExpanded) setExpanded(true);
	}, [initialExpanded]);

	const expandCard = useCallback(() => {
		setExpanded((prev) => {
			if (prev) return prev;
			const port = scrollPortRef.current;
			if (port) scrollTopBeforeExpandRef.current = port.scrollTop;
			requestAnimationFrame(() => {
				const next = scrollPortRef.current;
				if (next) next.scrollTop = scrollTopBeforeExpandRef.current;
			});
			return true;
		});
	}, []);

	const size = expanded ? EXPANDED : COMPACT;

	const actions = useMemo(
		() => [
			{
				label: t("pdfExplain.traceOpenSession"),
				onClick: onOpenSession,
				icon: (<ExternalLink className="size-3.5" />) as ReactNode,
			},
			{
				label: t("pdfExplain.traceDelete"),
				onClick: onDelete,
				icon: (<Trash2Icon className="size-3.5" />) as ReactNode,
				destructive: true,
			},
			{
				label: t("pdfExplain.traceHide"),
				onClick: onHide,
				icon: (<X className="size-3.5" />) as ReactNode,
			},
		],
		[t, onOpenSession, onDelete, onHide],
	);

	return (
		<SelectionCard
			screen={screen}
			width={size.width}
			height={size.height}
			// Place against the expanded footprint so compact → expand never
			// flips left/right under the pointer (right-edge thrash).
			placementWidth={EXPANDED.width}
			placementHeight={EXPANDED.height}
			lockHeight
			preferRight
			title={title}
			icon={ScanSearch}
			ariaLabel={t("pdfExplain.traceCardTitle")}
			onPointerEnter={() => {
				expandCard();
				onPointerEnter?.();
			}}
			onPointerLeave={() => {
				// Stay expanded while streaming so the user can read the answer.
				if (!streaming) setExpanded(false);
				onPointerLeave?.();
			}}
			bodyClassName="min-h-0 overflow-hidden p-0"
			// Light size transition for compact → expanded affordance. Footer is
			// memoized so the animation does not thrash the textarea.
			className="origin-top-left transition-[width,height,max-height] duration-150 ease-out"
			actions={actions}
			footer={
				<VisualTraceFooter
					streaming={streaming}
					placeholder={t("pdfExplain.traceContinuePlaceholder")}
					sendLabel={t("pdfExplain.traceSend")}
					stopLabel={t("pdfExplain.traceStop")}
					onSend={onSend}
					onHide={onHide}
					onStop={onStop}
					onFocusInput={expandCard}
				/>
			}
		>
			<div
				ref={scrollPortRef}
				className={cn(
					"agentero-scroll h-full min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
					"[scrollbar-gutter:stable]",
				)}
				role="log"
			>
				<div
					className={cn(
						"flex flex-col gap-2.5 px-3 py-2.5",
						!expanded && "gap-2",
					)}
				>
					{/* Crop preview lives on the PDF (dashed region + pin); omit modal image. */}
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
							const isLive = from === "assistant" && m.id === lastStreamingId;
							const isEmptyAssistant = isLive && !m.content.trim();
							const visuals = m.visualAnnotations ?? [];
							const clamp =
								!expanded && from === "assistant"
									? "line-clamp-4"
									: !expanded && from === "user"
										? "line-clamp-2"
										: null;
							const bodyText = m.content.trim();
							// Match Agent panel: chips above bubble; skip empty text bubble.
							if (from === "user" && !bodyText && visuals.length === 0) {
								return null;
							}
							return (
								<Message
									key={m.id}
									id={`visual-trace-msg-${m.id}`}
									from={from}
									className="max-w-full"
								>
									{from === "user" && visuals.length > 0 ? (
										<ChatVisualAnnotations
											annotations={visuals}
											className={cn(!expanded && "scale-95 origin-top-right")}
										/>
									) : null}
									{from === "user" && !bodyText ? null : (
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
											) : bodyText ? (
												// Live stream: plain text only. Streamdown after the
												// turn settles (math/mermaid parse is expensive).
												expanded && from === "assistant" && !isLive ? (
													<MessageResponse>{bodyText}</MessageResponse>
												) : (
													<span className="whitespace-pre-wrap break-words">
														{bodyText}
													</span>
												)
											) : null}
										</MessageContent>
									)}
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
				</div>
			</div>
		</SelectionCard>
	);
});
