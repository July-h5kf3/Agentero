import { describe, expect, it } from "vitest";
import {
	type AcpCommand,
	filterSlashCommands,
	mapAcpCommands,
} from "@/lib/agent/slash-commands";

describe("agent-slash-commands", () => {
	it("maps ACP commands and strips leading slashes", () => {
		const commands = mapAcpCommands([
			{
				name: "/search",
				description: "Search the web",
				input: { hint: "query" },
			},
			{ name: "  /read  ", description: "Read papers", input: null },
		]);
		expect(commands).toEqual<AcpCommand[]>([
			{
				id: "acp:search",
				name: "search",
				title: "search",
				description: "Search the web",
				inputHint: "query",
			},
			{
				id: "acp:read",
				name: "read",
				title: "read",
				description: "Read papers",
				inputHint: undefined,
			},
		]);
	});

	it("filters out empty ACP command names", () => {
		const commands = mapAcpCommands([
			{ name: "", description: "Empty", input: null },
			{ name: "/valid", description: "Valid", input: null },
		]);
		expect(commands).toHaveLength(1);
		expect(commands[0].name).toBe("valid");
	});

	it("filters commands by query across name, title and description", () => {
		const commands = mapAcpCommands([
			{ name: "summary", description: "Summarize the paper", input: null },
			{ name: "qa", description: "Ask a question", input: null },
		]);
		const result = filterSlashCommands(commands, "sum");
		expect(result.map((c) => c.name)).toContain("summary");
		expect(result.map((c) => c.name)).not.toContain("qa");
	});

	it("returns all commands when query is empty", () => {
		const commands = mapAcpCommands([
			{ name: "one", description: "First", input: null },
			{ name: "two", description: "Second", input: null },
		]);
		const result = filterSlashCommands(commands, "");
		expect(result).toHaveLength(2);
	});

	it("is case-insensitive", () => {
		const commands = mapAcpCommands([
			{ name: "Summary", description: "SUMMARY", input: null },
		]);
		const result = filterSlashCommands(commands, "SUM");
		expect(result).toHaveLength(1);
	});

	it("limits results to 8", () => {
		const commands = mapAcpCommands(
			Array.from({ length: 12 }, (_, i) => ({
				name: `cmd-${i}`,
				description: `Command ${i}`,
				input: null,
			})),
		);
		const result = filterSlashCommands(commands, "");
		expect(result).toHaveLength(8);
	});
});
