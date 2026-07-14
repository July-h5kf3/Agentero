/**
 * Chat composer input (Motif helper).
 * Pairs with official Message / Bubble:
 * @see https://ui.shadcn.com/docs/components/base/message
 */
import { Loader2, Send } from "lucide-react";
import type {
	ComponentProps,
	FormEvent,
	KeyboardEventHandler,
	ReactNode,
} from "react";
import { forwardRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PromptInputProps = Omit<ComponentProps<"form">, "onSubmit"> & {
	/** Called with trimmed text when the form submits */
	onSubmitPrompt?: (value: string) => void | Promise<void>;
	onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
};

export function PromptInput({
	className,
	onSubmitPrompt,
	onSubmit,
	children,
	...props
}: PromptInputProps) {
	const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
		onSubmit?.(e);
		if (e.defaultPrevented) return;
		e.preventDefault();
		if (!onSubmitPrompt) return;
		const form = e.currentTarget;
		const data = new FormData(form);
		const value = String(data.get("message") ?? "").trim();
		if (!value) return;
		void onSubmitPrompt(value);
	};

	return (
		<form
			data-slot="prompt-input"
			className={cn("shrink-0 border-t bg-background p-3", className)}
			onSubmit={handleSubmit}
			{...props}
		>
			<div
				data-slot="prompt-input-shell"
				className={cn(
					"flex flex-col gap-2 rounded-xl border border-input bg-muted/30 shadow-sm",
					"focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30",
					"dark:bg-input/20",
				)}
			>
				{children}
			</div>
		</form>
	);
}

export type PromptInputBodyProps = {
	className?: string;
	children: ReactNode;
};

export function PromptInputBody({ className, children }: PromptInputBodyProps) {
	return (
		<div
			data-slot="prompt-input-body"
			className={cn("min-w-0 flex-1 px-3 pt-2.5", className)}
		>
			{children}
		</div>
	);
}

export type PromptInputTextareaProps = ComponentProps<"textarea"> & {
	/** Enter submits; Shift+Enter inserts newline (default true) */
	submitOnEnter?: boolean;
};

export const PromptInputTextarea = forwardRef<
	HTMLTextAreaElement,
	PromptInputTextareaProps
>(function PromptInputTextarea(
	{
		className,
		name = "message",
		submitOnEnter = true,
		onKeyDown,
		rows = 1,
		...props
	},
	ref,
) {
	const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
		(e) => {
			onKeyDown?.(e);
			if (e.defaultPrevented) return;
			if (!submitOnEnter) return;
			// Enter without Shift → submit
			if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
				e.preventDefault();
				e.currentTarget.form?.requestSubmit();
			}
		},
		[onKeyDown, submitOnEnter],
	);

	return (
		<textarea
			ref={ref}
			data-slot="prompt-input-textarea"
			name={name}
			rows={rows}
			onKeyDown={handleKeyDown}
			className={cn(
				"field-sizing-content max-h-40 min-h-[40px] w-full resize-none",
				"bg-transparent text-[13px] leading-relaxed outline-none",
				"placeholder:text-muted-foreground",
				"disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
});

export type PromptInputFooterProps = {
	className?: string;
	children: ReactNode;
};

export function PromptInputFooter({
	className,
	children,
}: PromptInputFooterProps) {
	return (
		<div
			data-slot="prompt-input-footer"
			className={cn(
				"flex items-center justify-between gap-2 px-2 pb-2",
				className,
			)}
		>
			{children}
		</div>
	);
}

export type PromptInputToolsProps = {
	className?: string;
	children?: ReactNode;
};

export function PromptInputTools({
	className,
	children,
}: PromptInputToolsProps) {
	return (
		<div
			data-slot="prompt-input-tools"
			className={cn(
				"flex min-w-0 flex-1 items-center gap-1 text-[11px] text-muted-foreground",
				className,
			)}
		>
			{children}
		</div>
	);
}

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
	status?: "ready" | "streaming" | "submitted";
};

export function PromptInputSubmit({
	className,
	status = "ready",
	disabled,
	children,
	...props
}: PromptInputSubmitProps) {
	const busy = status === "streaming" || status === "submitted";
	return (
		<Button
			type="submit"
			size="icon-xs"
			variant={busy ? "secondary" : "default"}
			data-slot="prompt-input-submit"
			disabled={disabled || busy}
			aria-label={busy ? "Sending" : "Send"}
			className={cn("shrink-0 rounded-full", className)}
			{...props}
		>
			{children ??
				(busy ? (
					<Loader2 className="size-3.5 animate-spin" />
				) : (
					<Send className="size-3.5" />
				))}
		</Button>
	);
}
