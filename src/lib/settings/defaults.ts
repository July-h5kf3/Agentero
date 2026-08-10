import type {
	AppSettings,
	EditorFontFamily,
	PdfAskSettings,
} from "@/lib/settings/types";
import { DEFAULT_LIBRARY_COLUMNS } from "@/lib/settings/types";
import { DEFAULT_TRANSLATE_SETTINGS } from "@/lib/translate/defaults";
import { DEFAULT_UI_THEME } from "@/lib/ui/theme";

export const DEFAULT_PDF_ASK_SETTINGS: PdfAskSettings = {
	agentId: "",
	modelId: "",
};

/** Default Translator Runtime endpoint (overridable in Settings). */
export const DEFAULT_TRANSLATOR_BASE_URL = "https://translator.philfan.cn";
export const DEFAULT_NETWORK_PROXY_URL = "http://127.0.0.1:7890";

/**
 * Discrete UI scale presets exposed in Settings. Keyboard shortcuts and the
 * settings UI move between these values instead of using a continuous slider.
 */
export const UI_SCALE_PRESETS = [0.8, 0.9, 1, 1.25, 1.5] as const;

/** Markdown editor line-height slider bounds (unitless). */
export const EDITOR_LINE_HEIGHT_MIN = 1.4;
export const EDITOR_LINE_HEIGHT_MAX = 2.0;
export const EDITOR_LINE_HEIGHT_STEP = 0.1;
export const DEFAULT_EDITOR_LINE_HEIGHT = 1.6;

/**
 * CSS font stacks for editor body presets. `default` returns undefined so the
 * editor inherits the app theme stack (Geist / --font-sans).
 */
const EDITOR_FONT_FAMILY_CSS: Record<EditorFontFamily, string | undefined> = {
	default: undefined,
	system:
		'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", sans-serif',
	serif:
		'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", "Noto Serif CJK SC", "Noto Serif SC", serif',
	mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
};

/** Resolve a preset to a CSS `font-family` value, or undefined for app default. */
export function editorFontFamilyCss(
	family: EditorFontFamily,
): string | undefined {
	return EDITOR_FONT_FAMILY_CSS[family];
}

/** Clamp and snap line-height to the supported slider range (0.1 steps). */
export function clampEditorLineHeight(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_EDITOR_LINE_HEIGHT;
	const clamped = Math.min(
		EDITOR_LINE_HEIGHT_MAX,
		Math.max(EDITOR_LINE_HEIGHT_MIN, value),
	);
	return Math.round(clamped * 10) / 10;
}

export const DEFAULT_SETTINGS: AppSettings = {
	translatorBaseUrl: DEFAULT_TRANSLATOR_BASE_URL,
	networkProxyEnabled: false,
	networkProxyUrl: DEFAULT_NETWORK_PROXY_URL,
	paperTreeLabelMode: "title-author",
	paperTreeSortMode: "folder",
	autoUpdateInternalLinks: "ask",
	libraryColumns: DEFAULT_LIBRARY_COLUMNS.map((c) => ({ ...c })),
	connectorEnabled: false,
	connectorPort: 23119,
	zoteroSyncDir: "",
	batchImportConcurrency: 5,
	telemetryEnabled: true,
	exportWatermarkEnabled: false,
	theme: "system",
	uiTheme: DEFAULT_UI_THEME,
	locale: "system",
	editorFontSize: 14,
	editorFontFamily: "default",
	editorLineHeight: DEFAULT_EDITOR_LINE_HEIGHT,
	uiScale: 1,
	showEditorToolbar: true,
	agentPermissionMode: "restricted",
	autoPaperReader: false,
	aiResponseLanguage: "auto",
	agentPersonalPrompt: "",
	pdfAsk: { ...DEFAULT_PDF_ASK_SETTINGS },
	translate: { ...DEFAULT_TRANSLATE_SETTINGS },
};

/** Snap an arbitrary scale value to the closest supported preset. */
export function snapUiScale(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_SETTINGS.uiScale;
	let closest: number = UI_SCALE_PRESETS[0];
	let best = Infinity;
	for (const preset of UI_SCALE_PRESETS) {
		const d = Math.abs(preset - value);
		if (d < best) {
			best = d;
			closest = preset;
		}
	}
	return closest;
}
