import { useTranslation } from "react-i18next";
import {
	PageTitle,
	SettingsGroup,
	SettingsRow,
} from "@/components/settings/settings-layout";
import { Switch } from "@/components/ui/switch";
import type { AppSettings } from "@/lib/settings";

export function PrivacyPane({
	settings,
	patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	const { t } = useTranslation("settings");
	return (
		<>
			<PageTitle title={t("privacy.title")} />
			<SettingsGroup>
				<SettingsRow label={t("privacy.analytics.label")} htmlFor="analytics">
					<Switch
						id="analytics"
						checked={settings.analyticsEnabled}
						onCheckedChange={(v) => patch({ analyticsEnabled: v })}
					/>
				</SettingsRow>
				<SettingsRow label={t("privacy.crash.label")} htmlFor="crash">
					<Switch
						id="crash"
						checked={settings.shareCrashReports}
						onCheckedChange={(v) => patch({ shareCrashReports: v })}
					/>
				</SettingsRow>
			</SettingsGroup>
		</>
	);
}
