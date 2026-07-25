import { useTheme } from "next-themes";
import { memo, useEffect, useId, useState } from "react";
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

export type AppearancePaneProps = {
	theme: ThemePreference;
	uiTheme: string;
	locale: LocalePreference;
	uiScale: number;
	editorFontSize: number;
	showEditorToolbar: boolean;
	patch: (p: Partial<AppSettings>) => void;
};

function AppearancePaneInner({
	theme,
	uiTheme,
	locale,
	uiScale,
	editorFontSize,
	showEditorToolbar,
	patch,
}: AppearancePaneProps) {
	const { t } = useTranslation("settings");
	const { setTheme } = useTheme();
	const fontId = useId();
	const uiScaleId = useId();

	const [fontSize, setFontSize] = useState(editorFontSize);
	useEffect(() => {
		setFontSize(editorFontSize);
	}, [editorFontSize]);

	useEffect(() => {
		if (fontSize === editorFontSize) return;
		const id = setTimeout(() => {
			patch({ editorFontSize: fontSize });
		}, 150);
		return () => clearTimeout(id);
	}, [fontSize, editorFontSize, patch]);

	const setThemePref = (next: ThemePreference) => {
		patch({ theme: next });
		setTheme(next);
	};

	return (
		<>
			<PageTitle title={t("appearance.title")} />
			<SettingsGroup>
				<SettingsRow label={t("appearance.themeLabel")}>
					<Select
						value={theme}
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
						value={uiTheme}
						onValueChange={(v) => {
							patch({ uiTheme: v });
							void applyUiTheme(v);
						}}
					>
						<SelectTrigger size="sm" className="min-w-[160px] max-w-[220px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={DEFAULT_UI_THEME}>
								{t("appearance.uiTheme.default")}
							</SelectItem>
							{UI_THEMES.map((item) => (
								<SelectItem key={item.name} value={item.name}>
									{item.title}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow label={t("appearance.languageLabel")}>
					<Select
						value={locale}
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
						value={String(uiScale)}
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
							value={fontSize}
							onChange={(e) => setFontSize(Number(e.target.value))}
							className="w-28 accent-primary"
						/>
						<span className="w-12 text-right text-muted-foreground text-xs tabular-nums">
							{t("appearance.fontSize.value", { size: fontSize })}
						</span>
					</div>
				</SettingsRow>
				<SettingsRow
					label={t("appearance.editorToolbar.label")}
					htmlFor="editor-toolbar"
				>
					<Switch
						id="editor-toolbar"
						checked={showEditorToolbar}
						onCheckedChange={(v) => patch({ showEditorToolbar: v })}
					/>
				</SettingsRow>
			</SettingsGroup>
		</>
	);
}

export const AppearancePane = memo(AppearancePaneInner);
