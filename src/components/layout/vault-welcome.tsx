import { FolderOpen, FolderPlus, Server, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ZoteroIcon } from "@/components/icons/zotero-icon";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { vaultDisplayName } from "@/lib/vault";

export function VaultWelcome({
	recentVaults,
	busy,
	onOpenVault,
	onOpenRemoteVault,
	onCreateVault,
	onMigrateZotero,
	onOpenRecent,
	onRemoveRecent,
	className,
}: {
	recentVaults: string[];
	busy?: boolean;
	onOpenVault: () => void;
	/** Connect via SSH/SFTP (host, optional user, remote path). */
	onOpenRemoteVault: (args: {
		host: string;
		user?: string;
		remotePath: string;
	}) => void | Promise<void>;
	onCreateVault: () => void;
	onMigrateZotero: () => void;
	onOpenRecent: (path: string) => void;
	onRemoveRecent: (path: string) => void;
	className?: string;
}) {
	const { t } = useTranslation(["app", "sidebar"]);
	const [remoteOpen, setRemoteOpen] = useState(false);
	const [host, setHost] = useState("");
	const [user, setUser] = useState("");
	const [remotePath, setRemotePath] = useState("");
	const [connecting, setConnecting] = useState(false);

	const submitRemote = async () => {
		const h = host.trim();
		const p = remotePath.trim();
		if (!h || !p) return;
		setConnecting(true);
		try {
			await onOpenRemoteVault({
				host: h,
				user: user.trim() || undefined,
				remotePath: p,
			});
			setRemoteOpen(false);
		} finally {
			setConnecting(false);
		}
	};

	return (
		<div
			className={cn(
				"agentero-scroll flex min-h-0 flex-1 flex-col items-center justify-center bg-muted/20 p-8",
				className,
			)}
		>
			<div className="flex w-full max-w-lg flex-col gap-6">
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
						{t("app:vault.createVaultButton")}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={onOpenVault}
					>
						<FolderOpen className="size-3.5" />
						{t("app:vault.openVaultButton")}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={() => setRemoteOpen(true)}
					>
						<Server className="size-3.5" />
						{t("app:vault.openRemoteVaultButton")}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={busy}
						onClick={onMigrateZotero}
					>
						<ZoteroIcon className="size-3.5" />
						{t("sidebar:zoteroMigrate.button")}
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
					<p className="text-center text-muted-foreground text-sm">
						{t("vault.recentEmpty")}
					</p>
				)}
			</div>

			<Dialog open={remoteOpen} onOpenChange={setRemoteOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>{t("app:vault.remoteDialogTitle")}</DialogTitle>
					</DialogHeader>
					<div className="flex flex-col gap-3 py-1">
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="remote-host">
								{t("app:vault.remoteHostLabel")}
							</Label>
							<Input
								id="remote-host"
								value={host}
								onChange={(e) => setHost(e.target.value)}
								placeholder={t("app:vault.remoteHostPlaceholder")}
								autoComplete="off"
								disabled={connecting}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="remote-user">
								{t("app:vault.remoteUserLabel")}
							</Label>
							<Input
								id="remote-user"
								value={user}
								onChange={(e) => setUser(e.target.value)}
								placeholder={t("app:vault.remoteUserPlaceholder")}
								autoComplete="username"
								disabled={connecting}
							/>
						</div>
						<div className="flex flex-col gap-1.5">
							<Label htmlFor="remote-path">
								{t("app:vault.remotePathLabel")}
							</Label>
							<Input
								id="remote-path"
								value={remotePath}
								onChange={(e) => setRemotePath(e.target.value)}
								placeholder={t("app:vault.remotePathPlaceholder")}
								autoComplete="off"
								disabled={connecting}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							disabled={connecting}
							onClick={() => setRemoteOpen(false)}
						>
							{t("app:vault.remoteCancel")}
						</Button>
						<Button
							type="button"
							disabled={connecting || !host.trim() || !remotePath.trim()}
							onClick={() => void submitRemote()}
						>
							{connecting
								? t("app:vault.remoteConnecting")
								: t("app:vault.remoteConnect")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
