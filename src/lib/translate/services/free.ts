import { invokeTranslateText } from "@/lib/translate/api";
import type {
	FreeTranslateProviderId,
	TranslateService,
} from "@/lib/translate/types";

const MAX_CHARS = 5000;

function makeFreeMtService(
	id: FreeTranslateProviderId,
	nameKey: string,
): TranslateService {
	return {
		id,
		type: "sentence",
		nameKey,
		requireSecret: false,
		kind: "free-mt",
		async translate(task, opts) {
			const text = task.text.trim();
			if (!text) {
				throw new Error("Empty text");
			}
			if (text.length > MAX_CHARS) {
				throw new Error(
					`Text too long for free translation (max ${MAX_CHARS} characters)`,
				);
			}
			const result = await invokeTranslateText({
				text,
				sourceLang: task.sourceLang || "auto",
				targetLang: task.targetLang,
				provider: id,
				freeBaseUrl: opts.freeBaseUrl,
			});
			task.result = result;
		},
	};
}

export const BingTranslateService = makeFreeMtService("bing", "bing");
export const YoudaoTranslateService = makeFreeMtService("youdao", "youdao");
export const HuoshanWebTranslateService = makeFreeMtService(
	"huoshanweb",
	"huoshanweb",
);
export const TencentTransmartTranslateService = makeFreeMtService(
	"tencenttransmart",
	"tencenttransmart",
);
export const GoogleApiTranslateService = makeFreeMtService(
	"googleapi",
	"googleapi",
);
export const GoogleTranslateService = makeFreeMtService("google", "google");
export const LibreTranslateService = makeFreeMtService("libre", "libre");
