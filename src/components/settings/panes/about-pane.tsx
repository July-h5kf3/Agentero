import { getVersion } from "@tauri-apps/api/app";
import {
	Download,
	LoaderCircle,
	RefreshCw,
	Terminal,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	PageTitle,
	SettingsGroup,
	SettingsRow,
} from "@/components/settings/settings-layout";
import { Button } from "@/components/ui/button";
import {
	type CliInstallStatus,
	fetchCliInstallStatus,
	installCliCommand,
	uninstallCliCommand,
} from "@/lib/cli/api";
import { notifyError, notifySuccess } from "@/lib/core/notify";
import { isTauri } from "@/lib/core/tauri";
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
	const [cli, setCli] = useState<CliInstallStatus | null>(null);
	const [cliBusy, setCliBusy] = useState(false);
	const [cliLoading, setCliLoading] = useState(false);

	const refreshCli = useCallback(async () => {
		if (!isTauri()) return;
		setCliLoading(true);
		try {
			const status = await fetchCliInstallStatus();
			setCli(status);
		} catch {
			notifyError(t("about.cli.statusFailed"));
		} finally {
			setCliLoading(false);
		}
	}, [t]);

	useEffect(() => {
		void getVersion()
			.then(setVersion)
			.catch(() => undefined);
	}, []);
	useEffect(() => subscribeUpdate(setUpdate), []);
	useEffect(() => {
		void refreshCli();
	}, [refreshCli]);

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
	const onInstallCli = () => {
		setCliBusy(true);
		void installCliCommand()
			.then((res) => {
				setCli(res.status);
				notifySuccess(t("about.cli.installSuccess"));
			})
			.catch(() => notifyError(t("about.cli.installFailed")))
			.finally(() => setCliBusy(false));
	};
	const onUninstallCli = () => {
		setCliBusy(true);
		void uninstallCliCommand()
			.then((res) => {
				setCli(res.status);
				notifySuccess(t("about.cli.uninstallSuccess"));
			})
			.catch(() => notifyError(t("about.cli.uninstallFailed")))
			.finally(() => setCliBusy(false));
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

	const cliDescription = (() => {
		if (!cli) {
			return cliLoading ? "…" : t("about.cli.statusFailed");
		}
		// Prefer structured i18n over English Host `message` strings.
		const parts: string[] = [];
		if (cli.bundledVersion) {
			parts.push(t("about.cli.version", { version: cli.bundledVersion }));
		} else if (!cli.bundledPath) {
			parts.push(t("about.cli.notBundled"));
		} else {
			parts.push(t("about.cli.versionUnknown"));
		}
		if (cli.installed && cli.installPath) {
			parts.push(t("about.cli.installed", { path: cli.installPath }));
			if (!cli.shimCurrent) {
				parts.push(t("about.cli.stale"));
			}
		} else {
			parts.push(t("about.cli.notInstalled"));
		}
		if (cli.installed && !cli.preferredBinOnPath) {
			parts.push(t("about.cli.pathHint", { dir: cli.preferredBinDir }));
		} else if (!cli.installed && cli.bundledPath) {
			parts.push(t("about.cli.installHint", { dir: cli.preferredBinDir }));
		}
		return parts.join(" · ");
	})();

	const canInstallCli = Boolean(cli?.bundledPath) && !cliBusy;

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
			{isTauri() ? (
				<SettingsGroup>
					<SettingsRow
						label={t("about.cli.label")}
						description={cliDescription}
					>
						<div className="flex flex-wrap items-center justify-end gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={cliLoading || cliBusy}
								onClick={() => void refreshCli()}
								aria-label={t("about.cli.refresh")}
							>
								{cliLoading ? (
									<LoaderCircle
										data-icon="inline-start"
										className="animate-spin"
									/>
								) : (
									<RefreshCw data-icon="inline-start" />
								)}
								{t("about.cli.refresh")}
							</Button>
							{cli?.installed ? (
								<>
									<Button
										size="sm"
										disabled={!canInstallCli}
										onClick={onInstallCli}
									>
										<Terminal data-icon="inline-start" />
										{t("about.cli.reinstall")}
									</Button>
									<Button
										variant="outline"
										size="sm"
										disabled={cliBusy}
										onClick={onUninstallCli}
									>
										<Trash2 data-icon="inline-start" />
										{t("about.cli.uninstall")}
									</Button>
								</>
							) : (
								<Button
									size="sm"
									disabled={!canInstallCli}
									onClick={onInstallCli}
								>
									<Terminal data-icon="inline-start" />
									{t("about.cli.install")}
								</Button>
							)}
						</div>
					</SettingsRow>
				</SettingsGroup>
			) : null}
		</>
	);
}
