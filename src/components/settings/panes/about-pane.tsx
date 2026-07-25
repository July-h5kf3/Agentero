import { useTranslation } from "react-i18next";
import {
	PageTitle,
	SettingsGroup,
} from "@/components/settings/settings-layout";

export function AboutPane() {
	const { t } = useTranslation("settings");
	return (
		<>
			<PageTitle title={t("about.title")} />
			<SettingsGroup>
				<div className="space-y-1 px-3.5 py-4 text-center">
					<p className="font-semibold text-base tracking-tight">Agentero</p>
					<p className="text-muted-foreground text-sm">
						{t("about.version", { version: "0.1.0" })}
					</p>
					<p className="pt-2 text-muted-foreground text-xs leading-relaxed">
						{t("about.tagline")}
					</p>
				</div>
			</SettingsGroup>
		</>
	);
}
