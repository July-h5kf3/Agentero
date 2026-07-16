import {
	BookOpen,
	Calendar,
	ChevronRight,
	ExternalLink,
	FileText,
	Info,
	Tag,
	Users,
} from "lucide-react";
import { type ComponentType, type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { PaperMetadata } from "@/lib/paper-metadata";
import { cn } from "@/lib/utils";

type PaperInfoPanelProps = {
	meta: PaperMetadata | null;
	className?: string;
	/** Expand when a paper is selected (default true). */
	autoOpen?: boolean;
};

function MetaRow({
	icon: Icon,
	label,
	children,
}: {
	icon: ComponentType<{ className?: string }>;
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex gap-2 px-3 py-1.5">
			<Icon
				className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
				aria-hidden
			/>
			<div className="min-w-0 flex-1">
				<div className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">
					{label}
				</div>
				<div className="mt-0.5 text-xs leading-snug text-foreground">
					{children}
				</div>
			</div>
		</div>
	);
}

function LinkChip({ href, label }: { href: string; label: string }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className={cn(
				"inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5",
				"text-[11px] text-muted-foreground transition-colors",
				"hover:bg-muted hover:text-foreground",
			)}
		>
			{label}
			<ExternalLink className="size-2.5 opacity-70" aria-hidden />
		</a>
	);
}

export function PaperInfoPanel({
	meta,
	className,
	autoOpen = true,
}: PaperInfoPanelProps) {
	const { t } = useTranslation("sidebar");
	const [open, setOpen] = useState(Boolean(meta) && autoOpen);

	// Open when a paper is selected; collapse when none.
	useEffect(() => {
		if (!meta) {
			setOpen(false);
			return;
		}
		if (autoOpen) setOpen(true);
	}, [meta, autoOpen]);

	return (
		<div className={cn("shrink-0 border-t bg-muted/10", className)}>
			<Collapsible open={open} onOpenChange={setOpen}>
				<CollapsibleTrigger
					className={cn(
						"flex h-8 w-full items-center gap-1.5 px-2 text-left outline-none",
						"text-muted-foreground text-xs font-medium tracking-wide",
						"hover:bg-muted/40 hover:text-foreground",
						"focus-visible:ring-1 focus-visible:ring-ring",
					)}
				>
					<ChevronRight
						className={cn(
							"size-3.5 shrink-0 transition-transform",
							open && "rotate-90",
						)}
						aria-hidden
					/>
					<Info className="size-3.5 shrink-0" aria-hidden />
					<span className="truncate">{t("paperInfo.info")}</span>
					{meta ? (
						<span className="ml-auto max-w-[40%] truncate font-normal text-[10px] opacity-70">
							{meta.id}
						</span>
					) : null}
				</CollapsibleTrigger>
				<CollapsibleContent>
					{!meta ? (
						<p className="px-3 pb-3 text-muted-foreground text-xs leading-snug">
							{t("paperInfo.selectPrompt")}
						</p>
					) : (
						<div className="agentero-scroll max-h-48 overflow-y-auto border-t pb-2">
							<MetaRow icon={BookOpen} label={t("paperInfo.title")}>
								<span className="font-medium">{meta.title}</span>
							</MetaRow>
							{meta.authors?.length ? (
								<MetaRow icon={Users} label={t("paperInfo.authors")}>
									<span className="line-clamp-3">
										{meta.authors.join(", ")}
									</span>
								</MetaRow>
							) : null}
							{meta.year ? (
								<MetaRow icon={Calendar} label={t("paperInfo.year")}>
									{meta.year}
								</MetaRow>
							) : null}
							{meta.tags?.length ? (
								<MetaRow icon={Tag} label={t("paperInfo.tags")}>
									<div className="flex flex-wrap gap-1">
										{meta.tags.map((t) => (
											<span
												key={t}
												className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
											>
												#{t}
											</span>
										))}
									</div>
								</MetaRow>
							) : null}
							{meta.abstract ? (
								<MetaRow icon={FileText} label={t("paperInfo.abstract")}>
									<p className="line-clamp-4 text-muted-foreground">
										{meta.abstract}
									</p>
								</MetaRow>
							) : null}
							{(meta.pdf_url ||
								meta.html_url ||
								meta.source_url ||
								meta.arxiv_id) && (
								<div className="flex flex-wrap gap-1.5 px-3 pt-1">
									{meta.pdf_url || meta.arxiv_id ? (
										<LinkChip
											href={
												meta.pdf_url ?? `https://arxiv.org/pdf/${meta.arxiv_id}`
											}
											label={t("paperInfo.pdf")}
										/>
									) : null}
									{meta.html_url || meta.arxiv_id ? (
										<LinkChip
											href={
												meta.html_url ??
												`https://arxiv.org/html/${meta.arxiv_id}`
											}
											label={t("paperInfo.html")}
										/>
									) : null}
									{meta.source_url || meta.arxiv_id ? (
										<LinkChip
											href={
												meta.source_url ??
												`https://arxiv.org/abs/${meta.arxiv_id}`
											}
											label={t("paperInfo.abs")}
										/>
									) : null}
								</div>
							)}
						</div>
					)}
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}
