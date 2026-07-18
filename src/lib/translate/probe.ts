/**
 * Parallel availability probe for free MT providers (excludes Agent).
 * Used by Settings → Translate when the default-service Select opens.
 */

import { isTauri } from "@/lib/tauri";
import { invokeTranslateText } from "@/lib/translate/api";
import type { FreeTranslateProviderId } from "@/lib/translate/types";
import { FREE_MT_PROVIDER_IDS } from "@/lib/translate/types";

/** Short probe sample: en → zh-CN, minimal payload. */
const PROBE_TEXT = "Hi";
const PROBE_SOURCE = "en";
const PROBE_TARGET = "zh-CN";

/** Host timeout for each probe request (ms). */
export const TRANSLATE_PROBE_TIMEOUT_MS = 5_000;

export type FreeMtProbeStatus = "idle" | "probing" | "ok" | "fail";

export type FreeMtProbeMap = Partial<
	Record<FreeTranslateProviderId, FreeMtProbeStatus>
>;

export type ProbeFreeMtOptions = {
	freeBaseUrl?: string;
	/** Per-request timeout; default {@link TRANSLATE_PROBE_TIMEOUT_MS}. */
	timeoutMs?: number;
	/** Called as each provider finishes (progressive UI). */
	onResult?: (id: FreeTranslateProviderId, ok: boolean) => void;
	/**
	 * Optional abort: when aborted, remaining probes still resolve as fail
	 * (Tauri invoke cannot cancel in-flight host work).
	 */
	signal?: AbortSignal;
};

/**
 * Whether a free provider can be probed without a guaranteed local failure.
 * Libre without endpoint is not probeable until the user sets freeBaseUrl.
 */
export function canProbeFreeMtProvider(
	id: FreeTranslateProviderId,
	freeBaseUrl?: string,
): boolean {
	if (id === "libre") {
		return Boolean(freeBaseUrl?.trim());
	}
	return true;
}

async function probeOne(
	id: FreeTranslateProviderId,
	opts: ProbeFreeMtOptions,
): Promise<boolean> {
	if (opts.signal?.aborted) return false;
	if (!canProbeFreeMtProvider(id, opts.freeBaseUrl)) return false;
	if (!isTauri()) return false;
	try {
		const text = await invokeTranslateText({
			text: PROBE_TEXT,
			sourceLang: PROBE_SOURCE,
			targetLang: PROBE_TARGET,
			provider: id,
			freeBaseUrl: opts.freeBaseUrl,
			timeoutMs: opts.timeoutMs ?? TRANSLATE_PROBE_TIMEOUT_MS,
		});
		return text.trim().length > 0;
	} catch {
		return false;
	}
}

/**
 * Probe all free MT engines in parallel (not Agent).
 * Results stream via `onResult`; returned map is the final snapshot.
 */
export async function probeFreeMtProviders(
	opts: ProbeFreeMtOptions = {},
): Promise<Record<FreeTranslateProviderId, boolean>> {
	const results = await Promise.all(
		FREE_MT_PROVIDER_IDS.map(async (id) => {
			const ok = await probeOne(id, opts);
			opts.onResult?.(id, ok);
			return [id, ok] as const;
		}),
	);
	const map = {} as Record<FreeTranslateProviderId, boolean>;
	for (const [id, ok] of results) {
		map[id] = ok;
	}
	return map;
}
