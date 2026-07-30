import { Camera, LogOut, WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { type BridgeClientStatus, bridgeDisconnect } from "@/lib/bridge/client";

export function MobileSettingsPage({
	status,
	onStatus,
	onPairAnother,
}: {
	status: BridgeClientStatus;
	onStatus: (status: BridgeClientStatus) => void;
	onPairAnother: () => void;
}) {
	const { t } = useTranslation("mobile");
	const disconnect = async () => {
		await bridgeDisconnect();
		onStatus({ connected: false, paired: false });
	};
	return (
		<section className="px-4 py-5 md:px-6">
			<dl className="divide-y border-y">
				<div className="flex items-center justify-between gap-4 py-3">
					<dt className="text-muted-foreground text-sm">
						{t("settings.computer")}
					</dt>
					<dd className="truncate text-sm">{status.hostName ?? "-"}</dd>
				</div>
				<div className="flex items-center justify-between gap-4 py-3">
					<dt className="text-muted-foreground text-sm">
						{t("settings.vault")}
					</dt>
					<dd className="truncate text-sm">{status.vaultName ?? "-"}</dd>
				</div>
			</dl>
			<div className="mt-6 space-y-3">
				<Button
					size="lg"
					className="h-12 w-full justify-start gap-3 px-4 text-base"
					onClick={onPairAnother}
				>
					<Camera className="size-5" />
					<span>{t("settings.addDesktop")}</span>
				</Button>
				<Button
					variant="destructive"
					size="lg"
					className="h-12 w-full justify-start gap-3 px-4 text-base"
					onClick={() => void disconnect()}
				>
					<LogOut className="size-5" />
					<span>{t("settings.disconnect")}</span>
				</Button>
			</div>
			{!status.connected ? (
				<p className="mt-4 flex items-center gap-2 text-muted-foreground text-sm">
					<WifiOff className="size-4" />
					{t("connect.offline")}
				</p>
			) : null}
		</section>
	);
}
