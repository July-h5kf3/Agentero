import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	PageTitle,
	SettingsGroup,
} from "@/components/settings/settings-layout";

export function AboutPane() {
	const { t } = useTranslation("settings");
	const [version, setVersion] = useState<string>();

	useEffect(() => {
		void getVersion()
			.then(setVersion)
			.catch(() => undefined);
	}, []);

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
		</>
	);
}
