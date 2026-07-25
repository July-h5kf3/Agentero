import { describe, expect, it } from "vitest";
import {
	buildSlashCommands,
	filterSlashCommands,
	type SlashActionContext,
	skillToSlashCommand,
} from "@/lib/agent/slash-commands";

const noopCtx: SlashActionContext = {
	newConversation: () => undefined,
	clearConversation: () => undefined,
	cancelRun: () => undefined,
	copyLastReply: async () => undefined,
};

describe("agent-slash-commands", () => {
	it("builds built-in workflow and chat commands", () => {
		const commands = buildSlashCommands([]);
		const names = commands.map((c) => c.name);
		expect(names).toContain("summarize");
		expect(names).toContain("qa");
		expect(names).toContain("claims");
		expect(names).toContain("related");
		expect(names).toContain("paper-reader");
		expect(names).toContain("new");
		expect(names).toContain("clear");
		expect(names).toContain("stop");
		expect(names).toContain("copy");
	});

	it("derives slash commands from skills with slash-style mention", () => {
		const commands = buildSlashCommands(
			[
				{ id: "web-search", name: "Web Search", description: "Search the web" },
				{
					id: "paper_reader",
					name: "Paper Reader",
					description: "Read papers",
				},
			],
			{ skillMentionStyle: "slash" },
		);
		const webSearch = commands.find((c) => c.id === "skill:web-search");
		expect(webSearch).toBeDefined();
		expect(webSearch?.name).toBe("web-search");
		expect(webSearch?.skillId).toBe("web-search");
		expect(webSearch?.template).toContain("/web-search");
	});

	it("uses dollar-style mention for codex-style agents", () => {
		const commands = buildSlashCommands(
			[{ id: "web-search", name: "Web Search", description: "" }],
			{ skillMentionStyle: "dollar" },
		);
		const webSearch = commands.find((c) => c.id === "skill:web-search");
		expect(webSearch).toBeDefined();
		expect(webSearch?.template).toContain("$web-search");
	});

	it("kebab-cases skill ids and names", () => {
		const cmd = skillToSlashCommand({
			id: "MySkill",
			name: "My Skill",
			description: "",
		});
		expect(cmd.name).toBe("my-skill");
		expect(cmd.aliases).toEqual([]);
	});

	it("filters by query and respects context requirement", () => {
		const commands = buildSlashCommands([]);
		const result = filterSlashCommands(commands, "sum", {
			hasContext: true,
			selectedSkillIds: [],
		});
		expect(result.map((c) => c.name)).toContain("summarize");
		expect(result.length).toBeLessThanOrEqual(8);
	});

	it("hides context-required commands without context", () => {
		const commands = buildSlashCommands([]);
		const result = filterSlashCommands(commands, "", {
			hasContext: false,
			selectedSkillIds: [],
		});
		expect(result.some((c) => c.requiresContext)).toBe(false);
		expect(result.some((c) => c.name === "new")).toBe(true);
	});

	it("excludes already selected skill commands", () => {
		const commands = buildSlashCommands([
			{ id: "paper-reader", name: "Paper Reader", description: "" },
		]);
		const result = filterSlashCommands(commands, "", {
			hasContext: true,
			selectedSkillIds: ["paper-reader"],
		});
		expect(result.some((c) => c.skillId === "paper-reader")).toBe(false);
	});

	it("runs action commands with context", () => {
		let called = false;
		const commands = buildSlashCommands([]);
		const clear = commands.find((c) => c.name === "clear");
		expect(clear).toBeDefined();
		clear?.run?.({
			...noopCtx,
			clearConversation: () => {
				called = true;
			},
		});
		expect(called).toBe(true);
	});
});
