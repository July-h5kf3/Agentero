import { Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { PaneHeader } from "@/components/layout/pane-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type Backlink, getBacklinks } from "@/lib/wiki";

type BacklinksPanelProps = {
	vaultPath: string | null;
	/** Absolute or demo path of the open file */
	selectedPath: string | null;
	onOpenPath: (vaultRelativePath: string) => void;
	className?: string;
	/** Full-height sidebar mode (default). Compact strip is legacy. */
	variant?: "sidebar" | "compact";
};

export function BacklinksPanel({
	vaultPath,
	selectedPath,
	onOpenPath,
	className,
	variant = "sidebar",
}: BacklinksPanelProps) {
	const { t } = useTranslation("sidebar");
	const [backlinks, setBacklinks] = useState<Backlink[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!selectedPath) {
			setBacklinks([]);
			setError(null);
			return;
		}
		let cancelled = false;
		setLoading(true);
		setError(null);
		void (async () => {
			try {
				const res = await getBacklinks(vaultPath, selectedPath);
				if (cancelled) return;
				setBacklinks(res.backlinks);
			} catch (e) {
				if (cancelled) return;
				setBacklinks([]);
				setError(e instanceof Error ? e.message : String(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [vaultPath, selectedPath]);

	const countLabel = loading ? "" : ` (${backlinks.length})`;

	const body = (
		<div
			className={cn(
				"motif-scroll min-h-0 flex-1 overflow-y-auto",
				variant === "sidebar" ? "px-2 py-2" : "px-2 pb-2",
			)}
		>
			{!selectedPath ? (
				<p className="flex h-full items-center justify-center text-muted-foreground text-xs">
					{t("backlinks.openNote")}
					Open a note to see backlinks
				</p>
			) : null}
			{selectedPath && error ? (
				<p className="flex h-full items-center justify-center text-destructive text-xs">
					{error}
				</p>
			) : null}
			{selectedPath && !error && !loading && backlinks.length === 0 ? (
				<p className="flex h-full items-center justify-center text-muted-foreground text-xs">
					{t("backlinks.none")}
					No backlinks
				</p>
			) : null}
			{selectedPath ? (
				<ul className="flex flex-col gap-0.5">
					{backlinks.map((b) => (
						<li key={`${b.source}:${b.line ?? 0}:${b.targetRaw}`}>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-auto w-full justify-start gap-1 px-2 py-1.5 font-normal text-left"
								onClick={() => onOpenPath(b.source)}
								title={b.source}
							>
								<span className="min-w-0 flex-1 truncate text-xs">
									<span className="font-medium text-foreground">
										{b.source.split("/").pop()}
									</span>
									{b.context ? (
										<span className="ml-1.5 text-muted-foreground">
											{b.context.length > 72
												? `${b.context.slice(0, 72)}…`
												: b.context}
										</span>
									) : null}
								</span>
							</Button>
						</li>
					))}
				</ul>
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
				<div className="flex h-8 shrink-0 items-center gap-1.5 px-3 text-muted-foreground">
					<Link2 className="size-3.5 shrink-0" aria-hidden />
					<span className="text-xs font-medium">
						{t("backlinks.title")}
						{countLabel}
					</span>
				</div>
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
					<span className="font-normal text-muted-foreground">
						{countLabel}
					</span>
				</span>
			</PaneHeader>
			{body}
		</div>
	);
}
