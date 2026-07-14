/**
 * Lightweight scroll shell for chat logs.
 * Prefer pairing with official Message + Bubble:
 * @see https://ui.shadcn.com/docs/components/base/message
 * @see https://ui.shadcn.com/docs/components/base/message-scroller
 */
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type ConversationProps = ComponentProps<"div">;

/** Auto-scrolling message list container (Motif substitute for MessageScroller). */
export function Conversation({
	className,
	children,
	...props
}: ConversationProps) {
	const viewportRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = viewportRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	});

	return (
		<div
			role="log"
			aria-live="polite"
			aria-relevant="additions"
			className={cn(
				"relative flex min-h-0 flex-1 flex-col overflow-hidden",
				className,
			)}
			{...props}
		>
			<div
				ref={viewportRef}
				className="motif-scroll size-full min-h-0 overflow-y-auto overscroll-contain"
			>
				{children}
			</div>
		</div>
	);
}

export type ConversationContentProps = ComponentProps<"div">;

export function ConversationContent({
	className,
	...props
}: ConversationContentProps) {
	return (
		<div
			className={cn(
				// Match official MessageScrollerContent spacing
				"flex min-h-full flex-col gap-6 p-4",
				className,
			)}
			{...props}
		/>
	);
}

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
	title?: string;
	description?: string;
	icon?: ReactNode;
};

export function ConversationEmptyState({
	className,
	title = "No messages yet",
	description = "Start a conversation to see messages here",
	icon,
	children,
	...props
}: ConversationEmptyStateProps) {
	return (
		<div
			className={cn(
				"flex size-full flex-col items-center justify-center gap-3 p-6 text-center",
				className,
			)}
			{...props}
		>
			{children ?? (
				<>
					{icon ? <div className="text-muted-foreground">{icon}</div> : null}
					<div className="space-y-1">
						<h3 className="font-medium text-sm">{title}</h3>
						{description ? (
							<p className="text-muted-foreground text-xs leading-relaxed">
								{description}
							</p>
						) : null}
					</div>
				</>
			)}
		</div>
	);
}
