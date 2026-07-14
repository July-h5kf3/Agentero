/**
 * Chat message primitives — follows shadcn.io/ai Message family conventions.
 * @see https://www.shadcn.io/ai/message
 */
import type { ComponentProps, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type MessageRole = "user" | "assistant" | "system";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
	from: MessageRole;
};

export function Message({ className, from, ...props }: MessageProps) {
	return (
		<div
			data-slot="message"
			data-from={from}
			className={cn(
				"group flex w-full max-w-[95%] flex-col gap-1.5",
				from === "user" && "is-user ml-auto justify-end",
				from === "assistant" && "is-assistant",
				from === "system" && "is-system mx-auto max-w-full",
				className,
			)}
			{...props}
		/>
	);
}

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageContent({
	className,
	children,
	...props
}: MessageContentProps) {
	return (
		<div
			data-slot="message-content"
			className={cn(
				"w-fit min-w-0 max-w-full text-[13px] leading-relaxed wrap-break-word",
				"group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-3 group-[.is-user]:py-2 group-[.is-user]:text-foreground",
				"group-[.is-assistant]:rounded-lg group-[.is-assistant]:border group-[.is-assistant]:bg-card group-[.is-assistant]:px-3 group-[.is-assistant]:py-2 group-[.is-assistant]:text-foreground",
				"group-[.is-system]:w-full group-[.is-system]:text-center group-[.is-system]:text-muted-foreground group-[.is-system]:text-xs",
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}

export type MessageHeaderProps = ComponentProps<"div">;

export function MessageHeader({ className, ...props }: MessageHeaderProps) {
	return (
		<div
			data-slot="message-header"
			className={cn(
				"px-1 font-medium text-[11px] text-muted-foreground",
				"group-[.is-user]:text-right",
				className,
			)}
			{...props}
		/>
	);
}

export type MessageResponseProps = ComponentProps<"div"> & {
	/** When true, show a streaming caret after content */
	streaming?: boolean;
};

/** Plain / streaming text body (markdown renderer can replace children later). */
export function MessageResponse({
	className,
	streaming,
	children,
	...props
}: MessageResponseProps) {
	return (
		<div
			data-slot="message-response"
			className={cn("whitespace-pre-wrap", className)}
			{...props}
		>
			{children}
			{streaming ? (
				<span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-foreground/60 align-middle" />
			) : null}
		</div>
	);
}
