import { describe, expect, it } from "vitest";
import {
	buildDefaultAgentChoices,
	defaultAgentChoiceValue,
	NO_DEFAULT_AGENT_CHOICE,
} from "@/components/settings/panes/agent-catalog";
import type {
	AgentDescriptor,
	CatalogEntry,
	CatalogScanResponse,
} from "@/lib/agent";

function entry(overrides: Partial<CatalogEntry>): CatalogEntry {
	return {
		templateId: "opencode",
		name: "OpenCode",
		description: "",
		command: "opencode",
		args: ["acp"],
		installHint: "",
		binaryAvailable: true,
		acpCommandAvailable: true,
		acpStatus: "ready",
		registeredId: "catalog-opencode",
		isDefault: false,
		...overrides,
	};
}

function custom(overrides: Partial<AgentDescriptor>): AgentDescriptor {
	return {
		id: "custom-1",
		name: "Desktop",
		template: "custom",
		command: "desktop-acp",
		args: [],
		env: {},
		available: true,
		...overrides,
	};
}

function scan(overrides: Partial<CatalogScanResponse>): CatalogScanResponse {
	return {
		entries: [],
		customAgents: [],
		defaultId: null,
		enabled: true,
		proxyEnabled: false,
		proxyUrl: "",
		...overrides,
	};
}

describe("buildDefaultAgentChoices", () => {
	it("offers ready catalog agents and available custom agents", () => {
		const choices = buildDefaultAgentChoices(
			scan({
				defaultId: "custom-1",
				entries: [entry({ templateId: "hermes", name: "Hermes Agent" })],
				customAgents: [custom({})],
			}),
		);

		expect(choices.map((choice) => choice.value)).toEqual([
			"catalog:hermes",
			"custom:custom-1",
		]);
		expect(
			defaultAgentChoiceValue(scan({ defaultId: "custom-1" }), choices),
		).toBe("custom:custom-1");
	});

	it("filters install-only catalog rows out of the default selector", () => {
		const choices = buildDefaultAgentChoices(
			scan({
				entries: [
					entry({
						templateId: "openclaw",
						name: "OpenClaw",
						binaryAvailable: false,
						acpCommandAvailable: false,
						canInstall: true,
						acpStatus: "missing",
					}),
				],
			}),
		);

		expect(choices).toEqual([]);
		expect(defaultAgentChoiceValue(scan({}), choices)).toBe(
			NO_DEFAULT_AGENT_CHOICE,
		);
	});

	it("uses the catalog value when a ready catalog entry is default", () => {
		const state = scan({
			defaultId: "catalog-codex-acp",
			entries: [
				entry({
					templateId: "codex-acp",
					name: "Codex",
					registeredId: "catalog-codex-acp",
					isDefault: true,
				}),
			],
		});
		const choices = buildDefaultAgentChoices(state);

		expect(defaultAgentChoiceValue(state, choices)).toBe("catalog:codex-acp");
	});
});
