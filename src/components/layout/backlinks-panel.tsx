import { ArrowUpLeft, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { PaneHeader } from "@/components/layout/pane-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getBacklinks, type ResolvedLink } from "@/lib/wiki";

type BacklinksPanelProps = {
	vaultPath: string | null;
	/** Absolute or demo path of the open file */
	selectedPath: string | null;
	onNavigate: (link: ResolvedLink) => void;
	className?: string;
	/** Full-height sidebar mode (default). Compact strip is legacy. */
	variant?: "sidebar" | "compact";
	/** Bumped after `graph_rebuild` so the relationship queries remain fresh. */
	wikiIndexRevision?: number;
};

function fragmentLabel(link: ResolvedLink): string | null {
	const fragment = link.occurrence.fragment;
	if (!fragment) return null;
	return fragment.kind === "block"
		? `^${fragment.id}`
		: fragment.path.join(" › ");
}

function RelationList({
	items,
	onNavigate,
}: {
	items: ResolvedLink[];
	onNavigate: (link: ResolvedLink) => void;
}) {
	return (
		<ul className="flex flex-col gap-0.5">
			{items.map((link) => {
				const source = link.occurrence.source;
				return (
					<li key={`${source}:${link.occurrence.sourceRange.start}`}>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-auto w-full justify-start gap-1 px-2 py-1.5 font-normal text-left disabled:opacity-100"
							onClick={() =>
								onNavigate({
									...link,
									status: "resolved",
									targetPath: source,
									occurrence: { ...link.occurrence, fragment: undefined },
								})
							}
							title={source}
						>
							<span className="min-w-0 flex-1 truncate text-xs">
								<span className="font-medium text-foreground">
									{source.split("/").pop()}
								</span>
								{fragmentLabel(link) ? (
									<span className="ml-1 text-muted-foreground">
										{fragmentLabel(link)}
									</span>
								) : null}
								{link.occurrence.context ? (
									<span className="ml-1.5 text-muted-foreground">
										{link.occurrence.context.length > 72
											? `${link.occurrence.context.slice(0, 72)}…`
											: link.occurrence.context}
									</span>
								) : null}
							</span>
						</Button>
					</li>
				);
			})}
		</ul>
	);
}

export function BacklinksPanel({
	vaultPath,
	selectedPath,
	onNavigate,
	className,
	variant = "sidebar",
	wikiIndexRevision = 0,
}: BacklinksPanelProps) {
	const { t } = useTranslation("sidebar");
	const [incoming, setIncoming] = useState<ResolvedLink[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		void wikiIndexRevision;
		if (!selectedPath) {
			setIncoming([]);
			setError(null);
			return;
		}
		let cancelled = false;
		setLoading(true);
		setError(null);
		void getBacklinks(vaultPath, selectedPath)
			.then((backlinks) => {
				if (cancelled) return;
				setIncoming(backlinks.backlinks);
			})
			.catch((cause: unknown) => {
				if (cancelled) return;
				setIncoming([]);
				setError(cause instanceof Error ? cause.message : String(cause));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [vaultPath, selectedPath, wikiIndexRevision]);

	const body = (
		<div
			className={cn(
				"agentero-scroll min-h-0 flex-1 overflow-y-auto",
				variant === "sidebar" ? "px-2 py-2" : "px-2 pb-2",
			)}
		>
			{!selectedPath ? (
				<p className="flex h-full items-center justify-center text-muted-foreground text-xs">
					{t("backlinks.openNote")}
				</p>
			) : null}
			{selectedPath && error ? (
				<p className="flex h-full items-center justify-center text-destructive text-xs">
					{error}
				</p>
			) : null}
			{selectedPath && !error && !loading ? (
				<div className="space-y-3">
					<section>
						<p className="mb-1 flex items-center gap-1 px-2 text-muted-foreground text-xs">
							<ArrowUpLeft className="size-3" aria-hidden />
							{t("backlinks.title")}
						</p>
						{incoming.length ? (
							<RelationList items={incoming} onNavigate={onNavigate} />
						) : (
							<p className="px-2 text-muted-foreground text-xs">
								{t("backlinks.none")}
							</p>
						)}
					</section>
				</div>
			) : null}
		</div>
	);

	if (variant === "compact") {
		if (!selectedPath) return null;
		return (
			<div
				className={cn(
					"flex max-h-40 shrink-0 flex-col border-t bg-muted/15",
					className,
				)}
			>
				{body}
			</div>
		);
	}

	return (
		<div
			className={cn(
				"flex h-full min-h-0 flex-col overflow-hidden bg-background",
				className,
			)}
		>
			<PaneHeader>
				<Link2
					className="size-3.5 shrink-0 text-muted-foreground"
					aria-hidden
				/>
				<span className="min-w-0 flex-1 truncate font-medium text-sm">
					{t("backlinks.title")}
				</span>
			</PaneHeader>
			{body}
		</div>
	);
}
