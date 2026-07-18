import { FileIcon, FolderIcon, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PaneHeader } from "@/components/layout/pane-header";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { notifyError } from "@/lib/notify";
import {
	listTrash,
	purgeAllTrash,
	purgeTrashItem,
	restoreTrashItem,
	type TrashEntry,
} from "@/lib/papers-api";
import { cn } from "@/lib/utils";

/**
 * Recycle Bin center view (Zotero-style): lists items previously deleted into
 * `.agentero/.trash/` in the same full-pane area as the Library table, with
 * per-item Restore / Delete-permanently and Empty Recycle Bin.
 */
export function RecycleBinView({
	vaultPath,
	active,
	onChanged,
	className,
}: {
	vaultPath: string | null;
	/** True when this is the active tab (tabs stay mounted → reload on show). */
	active: boolean;
	/** Called after a restore so the parent can refresh tree / library / wiki. */
	onChanged: () => void | Promise<void>;
	className?: string;
}) {
	const { t, i18n } = useTranslation("sidebar");
	const [items, setItems] = useState<TrashEntry[]>([]);
	const [loading, setLoading] = useState(false);
	const [busyId, setBusyId] = useState<string | null>(null);

	const reload = useCallback(async () => {
		if (!vaultPath) {
			setItems([]);
			return;
		}
		setLoading(true);
		try {
			setItems(await listTrash(vaultPath));
		} catch (e) {
			notifyError(e instanceof Error ? e.message : t("recycleBin.loadFailed"));
		} finally {
			setLoading(false);
		}
	}, [vaultPath, t]);

	// Reload whenever the view becomes active (tabs stay mounted in the strip).
	useEffect(() => {
		if (active) void reload();
	}, [active, reload]);

	const formatWhen = useCallback(
		(iso: string) => {
			const d = new Date(iso);
			if (Number.isNaN(d.getTime())) return "";
			return new Intl.DateTimeFormat(i18n.language, {
				dateStyle: "medium",
				timeStyle: "short",
			}).format(d);
		},
		[i18n.language],
	);

	const handleRestore = useCallback(
		async (item: TrashEntry) => {
			if (!vaultPath || busyId) return;
			setBusyId(item.id);
			try {
				await restoreTrashItem(vaultPath, item.batchId, item.stored);
				setItems((prev) => prev.filter((x) => x.id !== item.id));
				await onChanged();
			} catch (e) {
				notifyError(e instanceof Error ? e.message : t("fileTree.undoFailed"));
			} finally {
				setBusyId(null);
			}
		},
		[vaultPath, busyId, onChanged, t],
	);

	const handlePurge = useCallback(
		async (item: TrashEntry) => {
			if (!vaultPath || busyId) return;
			if (
				!window.confirm(
					t("recycleBin.deleteForeverConfirm", { name: item.name }),
				)
			) {
				return;
			}
			setBusyId(item.id);
			try {
				await purgeTrashItem(vaultPath, item.batchId, item.stored);
				setItems((prev) => prev.filter((x) => x.id !== item.id));
			} catch (e) {
				notifyError(
					e instanceof Error ? e.message : t("recycleBin.purgeFailed"),
				);
			} finally {
				setBusyId(null);
			}
		},
		[vaultPath, busyId, t],
	);

	const handleEmpty = useCallback(async () => {
		if (!vaultPath || items.length === 0) return;
		if (
			!window.confirm(t("recycleBin.emptyConfirm", { count: items.length }))
		) {
			return;
		}
		setBusyId("__all__");
		try {
			await purgeAllTrash(vaultPath);
			setItems([]);
		} catch (e) {
			notifyError(e instanceof Error ? e.message : t("recycleBin.purgeFailed"));
		} finally {
			setBusyId(null);
		}
	}, [vaultPath, items.length, t]);

	return (
		<div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
			{/* Same h-10 bar as VaultSidebarHeader / other pane headers. */}
			<PaneHeader
				trailing={
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-7 gap-1 px-2 text-destructive text-xs leading-none"
						disabled={items.length === 0 || Boolean(busyId)}
						onClick={() => void handleEmpty()}
					>
						<Trash2 className="size-3.5 shrink-0" aria-hidden />
						<span className="leading-none">{t("recycleBin.emptyTrash")}</span>
					</Button>
				}
			>
				<span className="truncate font-medium text-sm">
					{t("recycleBin.title")}
				</span>
			</PaneHeader>

			{loading ? (
				<div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground text-sm">
					{t("recycleBin.loading")}
				</div>
			) : items.length === 0 ? (
				<div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center text-muted-foreground text-sm">
					{t("recycleBin.empty")}
				</div>
			) : (
				<div className="agentero-scroll min-h-0 min-w-0 flex-1">
					<TooltipProvider delayDuration={300}>
						<ul className="divide-y">
							{items.map((item) => {
								const Icon = item.isDir ? FolderIcon : FileIcon;
								return (
									<li
										key={item.id}
										className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40"
									>
										<Icon
											className={cn(
												"size-4 shrink-0",
												item.isDir ? "text-blue-500" : "text-muted-foreground",
											)}
										/>
										<div className="min-w-0 flex-1">
											<div className="truncate text-sm" title={item.rel}>
												{item.name}
											</div>
											<div className="truncate text-[11px] text-muted-foreground">
												{item.rel} · {formatWhen(item.deletedAt)}
											</div>
										</div>
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													type="button"
													variant="ghost"
													size="icon-xs"
													className="size-7"
													aria-label={t("recycleBin.restore")}
													disabled={Boolean(busyId)}
													onClick={() => void handleRestore(item)}
												>
													<RotateCcw className="size-3.5" />
												</Button>
											</TooltipTrigger>
											<TooltipContent side="bottom">
												{t("recycleBin.restore")}
											</TooltipContent>
										</Tooltip>
										<Tooltip>
											<TooltipTrigger asChild>
												<Button
													type="button"
													variant="ghost"
													size="icon-xs"
													className="size-7 text-destructive"
													aria-label={t("recycleBin.deleteForever")}
													disabled={Boolean(busyId)}
													onClick={() => void handlePurge(item)}
												>
													<Trash2 className="size-3.5" />
												</Button>
											</TooltipTrigger>
											<TooltipContent side="bottom">
												{t("recycleBin.deleteForever")}
											</TooltipContent>
										</Tooltip>
									</li>
								);
							})}
						</ul>
					</TooltipProvider>
				</div>
			)}
		</div>
	);
}
