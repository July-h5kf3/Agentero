import { getVersion } from "@tauri-apps/api/app";
import { Download, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	PageTitle,
	SettingsGroup,
	SettingsRow,
} from "@/components/settings/settings-layout";
import { Button } from "@/components/ui/button";
import { notifyError } from "@/lib/core/notify";
import {
	checkForUpdate,
	getUpdateSnapshot,
	installAvailableUpdate,
	subscribeUpdate,
	type UpdateSnapshot,
} from "@/lib/update";

export function AboutPane() {
	const { t } = useTranslation("settings");
	const [version, setVersion] = useState<string>();
	const [update, setUpdate] = useState<UpdateSnapshot>(getUpdateSnapshot);

	useEffect(() => {
		void getVersion()
			.then(setVersion)
			.catch(() => undefined);
	}, []);
	useEffect(() => subscribeUpdate(setUpdate), []);

	const checking = update.phase === "checking";
	const installing =
		update.phase === "downloading" || update.phase === "installing";
	const onCheck = () => {
		void checkForUpdate();
	};
	const onInstall = () => {
		void installAvailableUpdate().then((next) => {
			if (next.phase === "error") {
				notifyError(t("about.update.installFailed"));
			}
		});
	};
	const description = (() => {
		switch (update.phase) {
			case "unsupported":
				return t("about.update.unsupported");
			case "checking":
				return t("about.update.checking");
			case "up-to-date":
				return t("about.update.upToDate");
			case "available":
				return t("about.update.available", {
					version: update.availableVersion,
				});
			case "downloading":
				return update.totalBytes && update.downloadedBytes !== undefined
					? t("about.update.downloadingProgress", {
							progress: Math.min(
								100,
								Math.round((update.downloadedBytes / update.totalBytes) * 100),
							),
						})
					: t("about.update.downloading");
			case "installing":
				return t("about.update.installing");
			case "error":
				return t(
					update.errorOperation === "install"
						? "about.update.installFailed"
						: "about.update.checkFailed",
				);
			default:
				return t("about.update.idle");
		}
	})();

	return (
		<>
			<PageTitle title={t("about.title")} />
			<SettingsGroup>
				<div className="space-y-1 px-3.5 py-4 text-center">
					<p className="font-semibold text-base tracking-tight">Agentero</p>
					{version && (
						<p className="text-muted-foreground text-sm">
							{t("about.version", { version })}
						</p>
					)}
					<p className="pt-2 text-muted-foreground text-xs leading-relaxed">
						{t("about.tagline")}
					</p>
				</div>
			</SettingsGroup>
			<SettingsGroup>
				<SettingsRow label={t("about.update.label")} description={description}>
					{update.phase === "available" ? (
						<Button size="sm" onClick={onInstall}>
							<Download data-icon="inline-start" />
							{t("about.update.downloadInstall")}
						</Button>
					) : update.phase === "unsupported" ? null : (
						<Button
							variant="outline"
							size="sm"
							disabled={checking || installing}
							onClick={onCheck}
						>
							{checking || installing ? (
								<LoaderCircle
									data-icon="inline-start"
									className="animate-spin"
								/>
							) : (
								<RefreshCw data-icon="inline-start" />
							)}
							{t("about.update.check")}
						</Button>
					)}
				</SettingsRow>
				{update.phase === "available" && update.notes?.trim() ? (
					<div className="border-t px-3.5 py-2.5 text-muted-foreground text-xs leading-relaxed whitespace-pre-wrap">
						{update.notes.trim()}
					</div>
				) : null}
			</SettingsGroup>
		</>
	);
}
