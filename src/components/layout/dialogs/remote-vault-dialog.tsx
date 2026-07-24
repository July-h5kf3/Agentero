import { useState } from "react";
import { useTranslation } from "react-i18next";
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

export type OpenRemoteVaultArgs = {
	host: string;
	user?: string;
	remotePath: string;
};

/**
 * SSH/SFTP connect dialog — shared by welcome page and vault switcher.
 */
export function RemoteVaultDialog({
	open,
	onOpenChange,
	onConnect,
	busy,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConnect: (args: OpenRemoteVaultArgs) => void | Promise<void>;
	busy?: boolean;
}) {
	const { t } = useTranslation("app");
	const [host, setHost] = useState("");
	const [user, setUser] = useState("");
	const [remotePath, setRemotePath] = useState("");
	const [connecting, setConnecting] = useState(false);

	const submit = async () => {
		const h = host.trim();
		const p = remotePath.trim();
		if (!h || !p || connecting || busy) return;
		setConnecting(true);
		try {
			await onConnect({
				host: h,
				user: user.trim() || undefined,
				remotePath: p,
			});
			onOpenChange(false);
		} finally {
			setConnecting(false);
		}
	};

	const disabled = connecting || Boolean(busy);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{t("vault.remoteDialogTitle")}</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3 py-1">
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="remote-host-shared">
							{t("vault.remoteHostLabel")}
						</Label>
						<Input
							id="remote-host-shared"
							value={host}
							onChange={(e) => setHost(e.target.value)}
							placeholder={t("vault.remoteHostPlaceholder")}
							autoComplete="off"
							disabled={disabled}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="remote-user-shared">
							{t("vault.remoteUserLabel")}
						</Label>
						<Input
							id="remote-user-shared"
							value={user}
							onChange={(e) => setUser(e.target.value)}
							placeholder={t("vault.remoteUserPlaceholder")}
							autoComplete="username"
							disabled={disabled}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor="remote-path-shared">
							{t("vault.remotePathLabel")}
						</Label>
						<Input
							id="remote-path-shared"
							value={remotePath}
							onChange={(e) => setRemotePath(e.target.value)}
							placeholder={t("vault.remotePathPlaceholder")}
							autoComplete="off"
							disabled={disabled}
						/>
					</div>
				</div>
				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						disabled={disabled}
						onClick={() => onOpenChange(false)}
					>
						{t("vault.remoteCancel")}
					</Button>
					<Button
						type="button"
						disabled={disabled || !host.trim() || !remotePath.trim()}
						onClick={() => void submit()}
					>
						{connecting || busy
							? t("vault.remoteConnecting")
							: t("vault.remoteConnect")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
