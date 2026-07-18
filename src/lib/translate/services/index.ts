import { AgentTranslateService } from "@/lib/translate/services/agent";
import {
	BingTranslateService,
	CnkiTranslateService,
	DeeplxTranslateService,
	FreeTranslateService,
	GoogleApiTranslateService,
	GoogleTranslateService,
	HaiciTranslateService,
	HuoshanWebTranslateService,
	LibreTranslateService,
	TencentTransmartTranslateService,
	YoudaoTranslateService,
} from "@/lib/translate/services/free";
import type {
	TranslateProviderId,
	TranslateService,
} from "@/lib/translate/types";
import { FREE_MT_PROVIDER_IDS } from "@/lib/translate/types";

/** Free web engines + BYOA Agent (no paid APIs). */
export const TRANSLATE_SERVICES: TranslateService[] = [
	GoogleApiTranslateService,
	GoogleTranslateService,
	BingTranslateService,
	YoudaoTranslateService,
	HaiciTranslateService,
	CnkiTranslateService,
	DeeplxTranslateService,
	HuoshanWebTranslateService,
	TencentTransmartTranslateService,
	LibreTranslateService,
	AgentTranslateService,
	// keep legacy id resolvable
	FreeTranslateService,
];

export function getTranslateService(id: string): TranslateService | undefined {
	return TRANSLATE_SERVICES.find((s) => s.id === id);
}

export function isTranslateProviderId(id: string): id is TranslateProviderId {
	if (id === "agent" || id === "free") return true;
	return (FREE_MT_PROVIDER_IDS as string[]).includes(id);
}

export function isFreeMtProvider(id: string): boolean {
	return id !== "agent" && isTranslateProviderId(id);
}

/** Providers shown in Settings (exclude deprecated `free` alias). */
export function listSelectableProviders(): TranslateService[] {
	return TRANSLATE_SERVICES.filter((s) => s.id !== "free");
}
