import { FolderOpen, FolderPlus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { vaultDisplayName } from "@/lib/vault";

export function VaultWelcome({
	recentVaults,
	busy,
	onOpenVault,
	onCreateVault,
	onOpenRecent,
	onRemoveRecent,
	className,
}: {
	recentVaults: string[];
	busy?: boolean;
	onOpenVault: () => void;
	onCreateVault: () => void;
	onOpenRecent: (path: string) => void;
	onRemoveRecent: (path: string) => void;
	className?: string;
}) {
	const { t } = useTranslation("app");

	return (
		<div
			className={cn(
				"motif-scroll flex min-h-0 flex-1 flex-col items-center justify-center bg-muted/20 p-8",
				className,
			)}
		>
			<div className="flex w-full max-w-md flex-col gap-6">
				<div className="mx-auto flex size-12 items-center justify-center rounded-xl border bg-background shadow-sm">
					<FolderOpen className="size-6 text-muted-foreground" />
				</div>

				<div className="flex flex-wrap items-center justify-center gap-2">
					<Button
						type="button"
						variant="default"
						size="sm"
						disabled={busy}
						onClick={onCreateVault}
					>
						<FolderPlus className="size-3.5" />
						{t("vault.createVaultButton")}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={onOpenVault}
					>
						<FolderOpen className="size-3.5" />
						{t("vault.openVaultButton")}
					</Button>
				</div>

				{recentVaults.length > 0 ? (
					<div className="overflow-hidden rounded-lg border bg-background shadow-sm">
						<div className="border-b px-3 py-2">
							<p className="font-medium text-muted-foreground text-xs">
								{t("vault.recentTitle")}
							</p>
						</div>
						<ul className="max-h-56 divide-y overflow-y-auto">
							{recentVaults.map((path) => {
								const name = vaultDisplayName(path);
								return (
									<li key={path} className="group flex items-stretch">
										<button
											type="button"
											disabled={busy}
											onClick={() => onOpenRecent(path)}
											className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 disabled:opacity-50"
										>
											<span className="w-full truncate font-medium text-sm">
												{name}
											</span>
											<span
												className="w-full truncate text-[11px] text-muted-foreground"
												title={path}
											>
												{path}
											</span>
										</button>
										<button
											type="button"
											disabled={busy}
											aria-label={t("vault.removeRecent", { name })}
											title={t("vault.removeRecent", { name })}
											onClick={(e) => {
												e.stopPropagation();
												onRemoveRecent(path);
											}}
											className="flex shrink-0 items-center px-2.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted/60 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-50"
										>
											<Trash2 className="size-3.5" />
										</button>
									</li>
								);
							})}
						</ul>
					</div>
				) : (
					<p className="text-center text-muted-foreground text-xs">
						{t("vault.recentEmpty")}
					</p>
				)}
			</div>
		</div>
	);
}
