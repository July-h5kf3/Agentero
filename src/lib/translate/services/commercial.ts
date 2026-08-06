import { invokeTranslateText } from "@/lib/translate/api";
import type {
	CommercialTranslateProviderId,
	TranslateService,
} from "@/lib/translate/types";

/**
 * Commercial BYOK engines are called by the Host so secrets never cross an
 * app-owned relay. Provider-specific validation still lives server-side.
 */
export function makeCommercialMtService(
	id: CommercialTranslateProviderId,
): TranslateService {
	return {
		id,
		type: "sentence",
		nameKey: id,
		requireSecret: true,
		kind: "commercial-mt",
		async translate(task, opts) {
			const cfg = opts.providerConfig;
			const result = await invokeTranslateText({
				text: task.text.trim(),
				sourceLang: task.sourceLang || "auto",
				targetLang: task.targetLang,
				provider: id,
				apiKey: cfg?.apiKey,
				baseUrl: cfg?.baseUrl,
				region: cfg?.region,
				model: cfg?.model,
			});
			task.result = result;
		},
	};
}
