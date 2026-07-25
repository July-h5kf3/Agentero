import type { AgentSkill, AgentTemplate } from "@/lib/agent/api";

export type SlashCommandKind = "template" | "action";

export type SkillMentionStyle = "dollar" | "slash" | "injected-only";

export type SlashCommand = {
	id: string;
	/** 用于 `/` 匹配的短名，不带前导 `/`。 */
	name: string;
	/** 额外别名，如 `summary` 也命中 `summarize`。 */
	aliases?: string[];
	/** 菜单展示标题（slash command 固定英文）。 */
	title: string;
	/** 菜单展示描述（slash command 固定英文）。 */
	description: string;
	kind: SlashCommandKind;
	/** 是否要求当前有聚焦 paper/上下文。 */
	requiresContext?: boolean;
	/** template 命令：插入的模板，支持占位符。 */
	template?: string;
	/** action 命令：执行函数（在 React 层注入）。 */
	run?: (ctx: SlashActionContext) => void | Promise<void>;
	/** 关联 skill id；template 命令选中后自动加入 skill chip。 */
	skillId?: string;
};

export type SlashActionContext = {
	newConversation: () => void;
	clearConversation: () => void;
	cancelRun: () => void | Promise<void>;
	copyLastReply: () => Promise<void>;
};

function kebabCase(value: string): string {
	return value
		.replace(/([a-z])([A-Z])/g, "$1-$2")
		.replace(/[\s_]+/g, "-")
		.toLowerCase();
}

export function skillMentionStyleForTemplate(
	template: AgentTemplate | null | undefined,
): SkillMentionStyle {
	return template === "codex-acp" ? "dollar" : "slash";
}

export function skillToSlashCommand(
	skill: AgentSkill,
	{ skillMentionStyle }: { skillMentionStyle?: SkillMentionStyle } = {},
): SlashCommand {
	const name = kebabCase(skill.id);
	const mention =
		skillMentionStyle === "dollar" ? `$${skill.id}` : `/${skill.id}`;
	return {
		id: `skill:${skill.id}`,
		name,
		aliases: [kebabCase(skill.name)].filter((alias) => alias && alias !== name),
		title: skill.name,
		description: skill.description,
		kind: "template",
		template: `Please use the ${mention} skill to help with: `,
		skillId: skill.id,
	};
}

export function buildSlashCommands(
	skills: AgentSkill[],
	{ skillMentionStyle }: { skillMentionStyle?: SkillMentionStyle } = {},
): SlashCommand[] {
	const commands: SlashCommand[] = [
		{
			id: "workflow:summarize",
			name: "summarize",
			aliases: ["summary"],
			title: "Summarize paper",
			description: "Key contributions and methods",
			kind: "template",
			requiresContext: true,
			template:
				"Summarize the key contributions and methods of the current paper.",
		},
		{
			id: "workflow:qa",
			name: "qa",
			aliases: ["ask"],
			title: "Ask about paper",
			description: "Question-answer workflow",
			kind: "template",
			requiresContext: true,
			template: "Ask a question about the current paper: ",
		},
		{
			id: "workflow:claims",
			name: "claims",
			aliases: ["claim"],
			title: "List claims",
			description: "Main claims and evidence",
			kind: "template",
			requiresContext: true,
			template:
				"List the main claims and supporting evidence of the current paper.",
		},
		{
			id: "workflow:related",
			name: "related",
			aliases: ["related-work", "rw"],
			title: "Draft related work",
			description: "Compare with other papers",
			kind: "template",
			requiresContext: true,
			template:
				"Draft a related work paragraph comparing the current paper with: ",
		},
		{
			id: "workflow:paper-reader",
			name: "paper-reader",
			aliases: ["reader", "read"],
			title: "Paper reader",
			description: "Structured lecture notes",
			kind: "template",
			requiresContext: true,
			template:
				"Please read this paper carefully and write structured lecture notes.",
			skillId: "paper-reader",
		},
		{
			id: "chat:new",
			name: "new",
			aliases: ["new-chat"],
			title: "New chat",
			description: "Start a fresh conversation",
			kind: "action",
			run: (ctx) => ctx.newConversation(),
		},
		{
			id: "chat:clear",
			name: "clear",
			aliases: ["clear-chat"],
			title: "Clear chat",
			description: "Remove current messages",
			kind: "action",
			run: (ctx) => ctx.clearConversation(),
		},
		{
			id: "chat:stop",
			name: "stop",
			aliases: ["cancel"],
			title: "Stop",
			description: "Cancel running agent",
			kind: "action",
			run: (ctx) => void ctx.cancelRun(),
		},
		{
			id: "chat:copy",
			name: "copy",
			aliases: ["copy-last"],
			title: "Copy last reply",
			description: "Copy to clipboard",
			kind: "action",
			run: (ctx) => void ctx.copyLastReply(),
		},
	];

	for (const skill of skills) {
		commands.push(skillToSlashCommand(skill, { skillMentionStyle }));
	}

	return commands;
}

export function filterSlashCommands(
	commands: SlashCommand[],
	query: string,
	{
		hasContext,
		selectedSkillIds,
	}: { hasContext: boolean; selectedSkillIds: string[] },
): SlashCommand[] {
	const q = query.toLowerCase().trim();
	const selected = new Set(selectedSkillIds);

	return commands
		.filter((cmd) => {
			if (cmd.requiresContext && !hasContext) return false;
			if (cmd.skillId && selected.has(cmd.skillId)) return false;
			if (!q) return true;
			const names = [cmd.name, ...(cmd.aliases ?? [])].map((n) =>
				n.toLowerCase(),
			);
			return names.some((n) => n.startsWith(q) || n.includes(q));
		})
		.slice(0, 8);
}
