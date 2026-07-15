/**
 * Magic-wand identifier import via Host `lookup_import`.
 * Translator base URL comes from Settings (`translatorBaseUrl`).
 * @see docs/backend/identifier-lookup.md
 */
import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import { type AppSettings, DEFAULT_TRANSLATOR_BASE_URL } from "@/lib/settings";
import { isTauri } from "@/lib/tauri";

export type LookupAddResult = {
	paperDir: string;
	path: string;
	id: string;
	title: string;
	usedTranslator: boolean;
	translatorBaseUrl: string;
};

type ApiResult<T> = {
	ok: boolean;
	data?: T;
	error?: { code: string; message: string };
};

type HostLookupResult = {
	paperDir: string;
	path: string;
	id: string;
	title: string;
	usedTranslator: boolean;
	translatorBaseUrl: string;
};

function resolveTranslatorBaseUrl(
	settings: AppSettings,
	override?: string,
): string {
	const raw =
		override?.trim() ||
		settings.translatorBaseUrl?.trim() ||
		DEFAULT_TRANSLATOR_BASE_URL;
	return raw.replace(/\/+$/, "");
}

/**
 * Add a paper by identifier/URL into `vaultRoot/parentDir/<id>/`.
 * Host calls Translator at Settings `translatorBaseUrl`
 * (default https://translator.philfan.cn); falls back to arXiv API
 * when Runtime is down and input is an arXiv id.
 */
export async function addPaperByIdentifier(opts: {
	vaultRoot: string;
	/** Vault-relative, e.g. `papers` or `papers/nlp` */
	parentDir: string;
	text: string;
	settings: AppSettings;
	/** Override settings URL for this call */
	translatorBaseUrl?: string;
}): Promise<LookupAddResult> {
	if (!isTauri()) {
		throw new Error(i18n.t("sidebar:lookup.desktopOnly"));
	}

	const text = opts.text.trim();
	if (!text) {
		throw new Error(i18n.t("sidebar:lookup.invalidId"));
	}

	const translatorBaseUrl = resolveTranslatorBaseUrl(
		opts.settings,
		opts.translatorBaseUrl,
	);

	const result = await invoke<ApiResult<HostLookupResult>>("lookup_import", {
		args: {
			vaultPath: opts.vaultRoot,
			parentDir: opts.parentDir.replace(/\\/g, "/"),
			text,
			downloadFulltextToLocal: opts.settings.downloadFulltextToLocal,
			translatorBaseUrl,
		},
	});

	if (!result.ok || !result.data) {
		throw new Error(
			result.error?.message ?? i18n.t("sidebar:lookup.fetchFailed"),
		);
	}

	return {
		paperDir: result.data.paperDir,
		path: result.data.path,
		id: result.data.id,
		title: result.data.title,
		usedTranslator: result.data.usedTranslator,
		translatorBaseUrl: result.data.translatorBaseUrl,
	};
}
