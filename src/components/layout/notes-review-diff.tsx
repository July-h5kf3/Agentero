"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { type DiffLine, diffLines } from "@/lib/text-diff";
import { cn } from "@/lib/utils";

type NotesReviewDiffProps = {
	before: string;
	after: string;
	className?: string;
};

function lineClass(kind: DiffLine["kind"]): string {
	switch (kind) {
		case "add":
			return "bg-emerald-500/15 text-emerald-900 dark:text-emerald-100";
		case "remove":
			return "bg-red-500/15 text-red-900 dark:text-red-100";
		default:
			return "text-muted-foreground";
	}
}

function gutterPrefix(kind: DiffLine["kind"]): string {
	switch (kind) {
		case "add":
			return "+";
		case "remove":
			return "-";
		default:
			return " ";
	}
}

/**
 * Unified diff view for the agent notes Keep/Revert dialog.
 * Prefer a single scrollable diff over side-by-side panes (hard to scan).
 */
export function NotesReviewDiff({
	before,
	after,
	className,
}: NotesReviewDiffProps) {
	const { t } = useTranslation("agent");
	const lines = useMemo(() => diffLines(before, after), [before, after]);
	const emptyBoth = !before.trim() && !after.trim();

	if (emptyBoth) {
		return (
			<pre
				className={cn(
					"agentero-scroll max-h-[50vh] overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs text-muted-foreground",
					className,
				)}
			>
				{t("review.empty")}
			</pre>
		);
	}

	return (
		<section
			className={cn(
				"agentero-scroll max-h-[50vh] overflow-auto rounded-md border border-border bg-muted/30 font-mono text-xs leading-5",
				className,
			)}
			aria-label={t("review.diffAria")}
		>
			{lines.map((line, idx) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: stable line order from pure diff
					key={`${line.kind}-${line.oldLine ?? "x"}-${line.newLine ?? "x"}-${idx}`}
					className={cn(
						"flex whitespace-pre-wrap break-words border-border/40 border-b last:border-b-0",
						lineClass(line.kind),
					)}
				>
					<span
						className="w-10 shrink-0 select-none border-border/50 border-r px-1 text-right text-[10px] text-muted-foreground/80 tabular-nums"
						aria-hidden
					>
						{line.oldLine ?? ""}
					</span>
					<span
						className="w-10 shrink-0 select-none border-border/50 border-r px-1 text-right text-[10px] text-muted-foreground/80 tabular-nums"
						aria-hidden
					>
						{line.newLine ?? ""}
					</span>
					<span
						className="w-4 shrink-0 select-none px-0.5 text-center font-semibold opacity-70"
						aria-hidden
					>
						{gutterPrefix(line.kind)}
					</span>
					<span className="min-w-0 flex-1 px-1 py-0.5">
						{line.text.length === 0 ? "\u00a0" : line.text}
					</span>
				</div>
			))}
		</section>
	);
}
