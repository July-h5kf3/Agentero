import { ArrowDownRight, ArrowUpLeft, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { PaneHeader } from "@/components/shell/pane-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/core/utils";
import { isMarkdownPath } from "@/lib/vault";
import { getBacklinks, getOutgoingLinks, type ResolvedLink } from "@/lib/wiki";

type BacklinksPanelProps = {
	vaultPath: string | null;
	/** Absolute or demo path of the open file. */
	selectedPath: string | null;
	onNavigate: (link: ResolvedLink) => void;
	className?: string;
	/** Bumped after `graph_rebuild` so relationship queries remain fresh. */
	wikiIndexRevision?: number;
};

function fragmentLabel(link: ResolvedLink): string | null {
	const fragment = link.occurrence.fragment;
	if (!fragment) return null;
	if (fragment.kind === "block") return `^${fragment.id}`;
	if (fragment.kind === "annotation") return `@${fragment.id}`;
	return fragment.path.join(" › ");
}

function RelationList({
	items,
	direction,
	onNavigate,
	statusLabel,
}: {
	items: ResolvedLink[];
	direction: "incoming" | "outgoing";
	onNavigate: (link: ResolvedLink) => void;
	statusLabel: (status: Exclude<ResolvedLink["status"], "resolved">) => string;
}) {
	return (
		<ul className="flex flex-col gap-0.5">
			{items.map((link) => {
				const source = link.occurrence.source;
				const target = link.targetPath;
				const canNavigate =
					direction === "incoming" ||
					(link.status === "resolved" && Boolean(target));
				const status = link.status === "resolved" ? null : link.status;
				return (
					<li key={`${source}:${link.occurrence.sourceRange.start}`}>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-auto w-full justify-start gap-1 px-2 py-1.5 font-normal text-left disabled:opacity-100"
							disabled={!canNavigate}
							onClick={() => {
								if (direction === "incoming") {
									onNavigate({
										...link,
										status: "resolved",
										targetPath: source,
										occurrence: { ...link.occurrence, fragment: undefined },
									});
									return;
								}
								onNavigate(link);
							}}
							title={
								direction === "incoming"
									? source
									: (target ?? link.occurrence.targetRaw)
							}
						>
							<span className="min-w-0 flex-1 truncate text-xs">
								<span className="font-medium text-foreground">
									{(direction === "incoming"
										? source
										: (target ?? link.occurrence.targetRaw)
									)
										.split("/")
										.pop()}
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
								{status ? (
									<span className="ml-1.5 text-destructive">
										{statusLabel(status)}
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
	wikiIndexRevision = 0,
}: BacklinksPanelProps) {
	const { t } = useTranslation("sidebar");
	const [incoming, setIncoming] = useState<ResolvedLink[]>([]);
	const [outgoing, setOutgoing] = useState<ResolvedLink[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(false);

	useEffect(() => {
		void wikiIndexRevision;
		if (!selectedPath || !isMarkdownPath(selectedPath)) {
			setIncoming([]);
			setOutgoing([]);
			setError(false);
			return;
		}
		let cancelled = false;
		setLoading(true);
		setError(false);
		void Promise.all([
			getBacklinks(vaultPath, selectedPath),
			getOutgoingLinks(vaultPath, selectedPath),
		])
			.then(([backlinks, links]) => {
				if (cancelled) return;
				setIncoming(backlinks.backlinks);
				setOutgoing(links.outgoing);
			})
			.catch(() => {
				if (cancelled) return;
				setIncoming([]);
				setOutgoing([]);
				setError(true);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [vaultPath, selectedPath, wikiIndexRevision]);

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
			<div className="agentero-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
				{!selectedPath || !isMarkdownPath(selectedPath) ? (
					<p className="flex h-full items-center justify-center text-muted-foreground text-xs">
						{t("backlinks.openNote")}
					</p>
				) : null}
				{selectedPath && isMarkdownPath(selectedPath) && error ? (
					<p className="flex h-full items-center justify-center text-destructive text-xs">
						{t("backlinks.loadFailed")}
					</p>
				) : null}
				{selectedPath && isMarkdownPath(selectedPath) && !error && !loading ? (
					<div className="space-y-3">
						<section>
							<p className="mb-1 flex items-center gap-1 px-2 text-muted-foreground text-xs">
								<ArrowUpLeft className="size-3" aria-hidden />
								{t("backlinks.incoming", { count: incoming.length })}
							</p>
							{incoming.length ? (
								<RelationList
									items={incoming}
									direction="incoming"
									onNavigate={onNavigate}
									statusLabel={(status) => t(`backlinks.status.${status}`)}
								/>
							) : (
								<p className="px-2 text-muted-foreground text-xs">
									{t("backlinks.noneIncoming")}
								</p>
							)}
						</section>
						<section>
							<p className="mb-1 flex items-center gap-1 px-2 text-muted-foreground text-xs">
								<ArrowDownRight className="size-3" aria-hidden />
								{t("backlinks.outgoing", { count: outgoing.length })}
							</p>
							{outgoing.length ? (
								<RelationList
									items={outgoing}
									direction="outgoing"
									onNavigate={onNavigate}
									statusLabel={(status) => t(`backlinks.status.${status}`)}
								/>
							) : (
								<p className="px-2 text-muted-foreground text-xs">
									{t("backlinks.noneOutgoing")}
								</p>
							)}
						</section>
					</div>
				) : null}
			</div>
		</div>
	);
}
