import { useTheme } from "next-themes";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
	PageTitle,
	SettingsGroup,
	SettingsRow,
} from "@/components/settings/settings-layout";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type {
	AppSettings,
	LocalePreference,
	ThemePreference,
} from "@/lib/settings";
import { UI_SCALE_PRESETS } from "@/lib/settings";
import { applyUiTheme, DEFAULT_UI_THEME, UI_THEMES } from "@/lib/ui/theme";

export function AppearancePane({
	settings,
	patch,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
}) {
	const { t } = useTranslation("settings");
	const { setTheme } = useTheme();
	const fontId = useId();
	const uiScaleId = useId();

	const setThemePref = (theme: ThemePreference) => {
		patch({ theme });
		setTheme(theme);
	};

	return (
		<>
			<PageTitle title={t("appearance.title")} />
			<SettingsGroup>
				<SettingsRow label={t("appearance.themeLabel")}>
					<Select
						value={settings.theme}
						onValueChange={(v) => setThemePref(v as ThemePreference)}
					>
						<SelectTrigger size="sm" className="min-w-[120px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="system">
								{t("appearance.theme.system")}
							</SelectItem>
							<SelectItem value="light">
								{t("appearance.theme.light")}
							</SelectItem>
							<SelectItem value="dark">{t("appearance.theme.dark")}</SelectItem>
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow label={t("appearance.uiThemeLabel")}>
					<Select
						value={settings.uiTheme}
						onValueChange={(v) => {
							patch({ uiTheme: v });
							applyUiTheme(v);
						}}
					>
						<SelectTrigger size="sm" className="min-w-[160px] max-w-[220px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={DEFAULT_UI_THEME}>
								{t("appearance.uiTheme.default")}
							</SelectItem>
							{UI_THEMES.map((theme) => (
								<SelectItem key={theme.name} value={theme.name}>
									{theme.title}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow label={t("appearance.languageLabel")}>
					<Select
						value={settings.locale}
						onValueChange={(v) => patch({ locale: v as LocalePreference })}
					>
						<SelectTrigger size="sm" className="min-w-[120px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="system">
								{t("appearance.language.system")}
							</SelectItem>
							<SelectItem value="en">{t("appearance.language.en")}</SelectItem>
							<SelectItem value="zh-CN">
								{t("appearance.language.zhCN")}
							</SelectItem>
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow label={t("appearance.uiScale.label")} htmlFor={uiScaleId}>
					<Select
						value={String(settings.uiScale)}
						onValueChange={(v) => patch({ uiScale: Number(v) })}
					>
						<SelectTrigger id={uiScaleId} size="sm" className="min-w-[120px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{UI_SCALE_PRESETS.map((scale) => (
								<SelectItem key={scale} value={String(scale)}>
									{t("appearance.uiScale.value", {
										percent: Math.round(scale * 100),
									})}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
			</SettingsGroup>

			<p className="mb-1.5 mt-4 font-medium text-muted-foreground text-xs uppercase tracking-wide">
				{t("appearance.markdownEditor.section")}
			</p>
			<SettingsGroup>
				<SettingsRow label={t("appearance.fontSize.label")} htmlFor={fontId}>
					<div className="flex items-center gap-2">
						<input
							id={fontId}
							type="range"
							min={12}
							max={20}
							step={1}
							value={settings.editorFontSize}
							onChange={(e) =>
								patch({ editorFontSize: Number(e.target.value) })
							}
							className="w-28 accent-primary"
						/>
						<span className="w-12 text-right text-muted-foreground text-xs tabular-nums">
							{t("appearance.fontSize.value", {
								size: settings.editorFontSize,
							})}
						</span>
					</div>
				</SettingsRow>
				<SettingsRow
					label={t("appearance.editorToolbar.label")}
					htmlFor="editor-toolbar"
				>
					<Switch
						id="editor-toolbar"
						checked={settings.showEditorToolbar}
						onCheckedChange={(v) => patch({ showEditorToolbar: v })}
					/>
				</SettingsRow>
			</SettingsGroup>
		</>
	);
}
