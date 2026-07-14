import { Link2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type Backlink, getBacklinks } from "@/lib/wiki";

type BacklinksPanelProps = {
	vaultPath: string | null;
	/** Absolute or demo path of the open file */
	selectedPath: string | null;
	onOpenPath: (vaultRelativePath: string) => void;
	className?: string;
};

export function BacklinksPanel({
	vaultPath,
	selectedPath,
	onOpenPath,
	className,
}: BacklinksPanelProps) {
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
					Backlinks
					{loading ? "" : ` (${backlinks.length})`}
				</span>
			</div>
			<div className="motif-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
				{error ? (
					<p className="px-1 text-destructive text-xs">{error}</p>
				) : null}
				{!error && !loading && backlinks.length === 0 ? (
					<p className="px-1 text-muted-foreground text-xs">No backlinks</p>
				) : null}
				<ul className="flex flex-col gap-0.5">
					{backlinks.map((b) => (
						<li key={`${b.source}:${b.line ?? 0}:${b.targetRaw}`}>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-auto w-full justify-start gap-1 px-2 py-1 font-normal text-left"
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
			</div>
		</div>
	);
}
