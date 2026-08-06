import { describe, expect, it } from "vitest";

import {
	buildTranslatePrompt,
	canProbeFreeMtProvider,
	FREE_MT_PROVIDER_IDS,
	getTranslateService,
	isFreeMtProvider,
	isTranslateProviderId,
	langsFromSettings,
	listSelectableProviders,
	resolveTargetLangCode,
	resolveTargetLangName,
	resolveTranslateAgent,
	targetLangDisplayName,
} from "@/lib/translate";
import { DEFAULT_TRANSLATE_SETTINGS } from "@/lib/translate/defaults";

describe("translate lang", () => {
	it("resolves ui target from interface language", () => {
		expect(resolveTargetLangCode("ui", "zh-CN")).toBe("zh-CN");
		expect(resolveTargetLangCode("ui", "en")).toBe("en");
		expect(resolveTargetLangCode("en", "zh-CN")).toBe("en");
		expect(resolveTargetLangName("ui", "zh-CN")).toBe("Chinese");
		expect(resolveTargetLangName("en", "zh-CN")).toBe("English");
	});

	it("maps codes and names via targetLangDisplayName", () => {
		expect(targetLangDisplayName("zh-CN")).toBe("Chinese");
		expect(targetLangDisplayName("zh")).toBe("Chinese");
		expect(targetLangDisplayName("en")).toBe("English");
		expect(targetLangDisplayName("Chinese")).toBe("Chinese");
		expect(targetLangDisplayName("English")).toBe("English");
	});

	it("builds langs from settings", () => {
		const l = langsFromSettings(
			{ ...DEFAULT_TRANSLATE_SETTINGS, targetLang: "ui" },
			"zh-CN",
		);
		expect(l.sourceLang).toBe("auto");
		expect(l.targetLang).toBe("zh-CN");
		expect(l.targetLangName).toBe("Chinese");
	});
});

describe("translate services registry", () => {
	it("registers free web engines + agent (no paid APIs)", () => {
		for (const id of FREE_MT_PROVIDER_IDS) {
			expect(getTranslateService(id)?.kind).toBe("free-mt");
			expect(getTranslateService(id)?.requireSecret).toBe(false);
		}
		expect(getTranslateService("agent")?.kind).toBe("agent");
		expect(getTranslateService("agent")?.requireExternalConfig).toBe(true);
		expect(getTranslateService("deepl")).toBeUndefined();
		expect(isTranslateProviderId("bing")).toBe(true);
		expect(isFreeMtProvider("youdao")).toBe(true);
		expect(isFreeMtProvider("deeplx")).toBe(true);
		expect(isFreeMtProvider("agent")).toBe(false);
	});

	it("settings list excludes deprecated free alias", () => {
		const ids = listSelectableProviders().map((s) => s.id);
		expect(ids).toContain("googleapi");
		expect(ids).toContain("tencenttransmart");
		expect(ids).toContain("huoshanweb");
		expect(ids).toContain("deeplx");
		expect(ids).toContain("bing");
		expect(ids).toContain("youdao");
		expect(ids).toContain("agent");
	});

	it("defaults to tencent transmart", () => {
		expect(DEFAULT_TRANSLATE_SETTINGS.provider).toBe("tencenttransmart");
		expect(DEFAULT_TRANSLATE_SETTINGS.agentId).toBe("");
		expect(DEFAULT_TRANSLATE_SETTINGS.modelId).toBe("");
	});

	it("can probe free engines; libre needs endpoint", () => {
		expect(canProbeFreeMtProvider("bing")).toBe(true);
		expect(canProbeFreeMtProvider("googleapi")).toBe(true);
		expect(canProbeFreeMtProvider("deeplx")).toBe(true);
		expect(canProbeFreeMtProvider("libre")).toBe(false);
		expect(canProbeFreeMtProvider("libre", "")).toBe(false);
		expect(canProbeFreeMtProvider("libre", "https://lt.example")).toBe(true);
	});
});

describe("resolveTranslateAgent", () => {
	it("follows default agent when agentId empty", () => {
		const r = resolveTranslateAgent(
			{ agentId: "", modelId: "" },
			{
				defaultId: "codex-1",
				agents: [
					{
						id: "codex-1",
						name: "Codex",
						template: "codex-acp",
						command: "codex",
						args: [],
						env: {},
						available: true,
					},
				],
			},
		);
		expect(r.agentId).toBe("codex-1");
	});

	it("uses pinned agentId when available", () => {
		const r = resolveTranslateAgent(
			{ agentId: "claude-1", modelId: "m1" },
			{
				defaultId: "codex-1",
				agents: [
					{
						id: "codex-1",
						name: "Codex",
						template: "codex-acp",
						command: "codex",
						args: [],
						env: {},
						available: true,
					},
					{
						id: "claude-1",
						name: "Claude",
						template: "claude-acp",
						command: "claude",
						args: [],
						env: {},
						available: true,
					},
				],
			},
		);
		expect(r.agentId).toBe("claude-1");
		expect(r.modelId).toBe("m1");
	});
});

describe("translate prompts", () => {
	it("builds a generic agent prompt", () => {
		const p = buildTranslatePrompt({
			text: "Hello world",
			targetLangName: "Chinese",
		});
		expect(p).toContain("Chinese");
		expect(p).toContain("Hello world");
		expect(p).toContain("only the translation");
	});

	it("pdf selection surface includes page context", () => {
		const p = buildTranslatePrompt({
			text: "attention",
			targetLangName: "Chinese",
			page: 3,
			surface: "pdf-selection",
		});
		expect(p).toContain("page 3");
		expect(p).toContain("attention");
	});
});
