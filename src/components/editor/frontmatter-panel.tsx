"use client";

import { ChevronRight, ListTree } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/core/utils";
import { countFrontmatterProperties } from "@/lib/markdown/frontmatter";

export type FrontmatterPanelProps = {
	/** YAML interior only (no `---` fences). */
	value: string;
	readOnly?: boolean;
	onChange?: (interior: string) => void;
	className?: string;
};

/**
 * Collapsible Properties strip above the Markdown body.
 * Frontmatter stays outside the Plate AST; this panel edits the YAML string
 * that is re-attached on save.
 */
export function FrontmatterPanel({
	value,
	readOnly = false,
	onChange,
	className,
}: FrontmatterPanelProps) {
	const { t } = useTranslation("editor");
	const [open, setOpen] = useState(false);
	const panelId = useId();
	const propertyCount = countFrontmatterProperties(value);
	const hasContent = value.trim().length > 0;

	return (
		<Collapsible
			open={open}
			onOpenChange={setOpen}
			className={cn(
				"shrink-0 border-border/60 border-b bg-muted/20",
				className,
			)}
		>
			<CollapsibleTrigger
				className={cn(
					"flex h-8 w-full min-w-0 items-center gap-1.5 px-3 text-left outline-none",
					"text-muted-foreground text-xs font-medium tracking-wide",
					"hover:bg-muted/40 hover:text-foreground",
					"focus-visible:ring-1 focus-visible:ring-ring",
				)}
				aria-controls={panelId}
			>
				<ChevronRight
					className={cn(
						"size-3.5 shrink-0 transition-transform",
						open && "rotate-90",
					)}
					aria-hidden
				/>
				<ListTree className="size-3.5 shrink-0" aria-hidden />
				<span className="truncate">{t("frontmatter.title")}</span>
				{propertyCount > 0 ? (
					<span className="ml-auto shrink-0 tabular-nums text-[11px] text-muted-foreground/80">
						{propertyCount}
					</span>
				) : !hasContent ? (
					<span className="ml-auto shrink-0 text-[11px] text-muted-foreground/70">
						{t("frontmatter.emptyBadge")}
					</span>
				) : null}
			</CollapsibleTrigger>
			<CollapsibleContent id={panelId}>
				<div className="border-border/50 border-t px-3 pt-2 pb-3">
					<label className="sr-only" htmlFor={`${panelId}-yaml`}>
						{t("frontmatter.yamlLabel")}
					</label>
					<textarea
						id={`${panelId}-yaml`}
						value={value}
						readOnly={readOnly}
						spellCheck={false}
						placeholder={t("frontmatter.placeholder")}
						rows={Math.min(12, Math.max(4, value.split("\n").length + 1))}
						className={cn(
							"agentero-scroll w-full min-h-[5.5rem] resize-y rounded-md border border-input",
							"bg-background px-2.5 py-2 font-mono text-[12px] leading-relaxed text-foreground",
							"outline-none placeholder:text-muted-foreground/70",
							"focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
							readOnly && "cursor-default opacity-90",
						)}
						onChange={(event) => {
							if (readOnly) return;
							onChange?.(event.target.value);
						}}
					/>
					<p className="mt-1.5 text-[11px] text-muted-foreground leading-snug">
						{t("frontmatter.hint")}
					</p>
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
