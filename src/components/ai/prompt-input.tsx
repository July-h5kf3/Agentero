/**
 * Chat prompt input — follows shadcn.io/ai PromptInput family conventions (subset).
 * @see https://www.shadcn.io/ai/prompt-input
 */
import { Loader2, Send } from "lucide-react";
import type { ComponentProps, FormEvent, ReactNode } from "react";
import { forwardRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PromptInputProps = Omit<ComponentProps<"form">, "onSubmit"> & {
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
			className={cn("flex shrink-0 gap-1.5 border-t p-2", className)}
			onSubmit={handleSubmit}
			{...props}
		>
			{children}
		</form>
	);
}

export type PromptInputTextareaProps = ComponentProps<"input">;

export const PromptInputTextarea = forwardRef<
	HTMLInputElement,
	PromptInputTextareaProps
>(function PromptInputTextarea({ className, name = "message", ...props }, ref) {
	return (
		<input
			ref={ref}
			data-slot="prompt-input-textarea"
			name={name}
			className={cn(
				"min-w-0 flex-1 rounded-md border bg-background px-2.5 py-1.5 text-[13px] outline-none",
				"focus-visible:ring-1 focus-visible:ring-ring",
				"disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
});

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
			data-slot="prompt-input-submit"
			disabled={disabled || busy}
			aria-label={busy ? "Sending" : "Send"}
			className={className}
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

export type PromptInputBodyProps = {
	className?: string;
	children: ReactNode;
};

export function PromptInputBody({ className, children }: PromptInputBodyProps) {
	return (
		<div
			data-slot="prompt-input-body"
			className={cn("flex min-w-0 flex-1 items-center gap-1.5", className)}
		>
			{children}
		</div>
	);
}
