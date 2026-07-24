import {
	CheckIcon,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Star,
	X,
	Zap,
} from "lucide-react";
import type { KeyboardEvent, DragEvent as ReactDragEvent } from "react";
import { useTranslation } from "react-i18next";
import { ContextPathIcon } from "@/components/agent/context-path-icon";
import {
	Context,
	ContextContent,
	ContextContentHeader,
	ContextTrigger,
} from "@/components/ai-elements/context";
import {
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorEmpty,
	ModelSelectorGroup,
	ModelSelectorInput,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
	AgentEffortChoice,
	AgentModelChoice,
	AgentSkill,
} from "@/lib/agent";
import { SUGGESTION_KEYS, SUGGESTION_WORKFLOW } from "@/lib/agent-chat-state";
import { mentionPathHasChildren } from "@/lib/agent-mention";
import { cn } from "@/lib/utils";

export type GroupedModel = {
	id: string;
	heading: string;
	isFavorites: boolean;
	items: AgentModelChoice[];
};

export function AgentComposer({
	isZen,
	autoFocus,
	linesLength,
	activeTabIsRunning,
	switching,
	submitting,
	hasStreamingAgentMessage,
	composerControlsMuted,
	composerText,
	onComposerTextChange,
	onSubmit,
	onComposerKeyDown,
	onComposerDragOver,
	onComposerDrop,
	// Context chips
	currentFilePath,
	currentFileLabel,
	mentionChipPaths,
	directoryPathSet,
	paperPathSet,
	labelForPath,
	onRemoveContextPath,
	// Skills chips
	selectedSkills,
	onRemoveSkill,
	// Mention menu
	showMentionMenu,
	mentionBrowseRoot,
	mentionOptions,
	mentionActiveIndex,
	mentionCandidates,
	onLeaveMentionFolder,
	onEnterMentionFolder,
	onAttachMention,
	onMentionActiveIndexChange,
	// Skill menu
	showSkillMenu,
	skillOptions,
	skillActiveIndex,
	onAttachSkill,
	onSkillActiveIndexChange,
	// Model / effort / usage / fast
	modelSelectorOpen,
	onModelSelectorOpenChange,
	models,
	groupedModels,
	modelId,
	selectedModelName,
	favoriteIds,
	warming,
	onPickModel,
	onToggleFavorite,
	effortOptionsInDisplayOrder,
	reasoningEffort,
	onReasoningEffortChange,
	formatEffort,
	activeUsage,
	fastAvailable,
	fastEnabled,
	onFastEnabledToggle,
	// Submit / stop
	onCancelRun,
	// Follow-up suggestions
	onSendSuggestion,
}: {
	isZen: boolean;
	autoFocus: boolean;
	linesLength: number;
	activeTabIsRunning: boolean;
	switching: boolean;
	submitting: boolean;
	hasStreamingAgentMessage: boolean;
	composerControlsMuted: boolean;
	composerText: string;
	onComposerTextChange: (text: string) => void;
	onSubmit: (text: string) => Promise<void>;
	onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
	onComposerDragOver: (e: ReactDragEvent) => void;
	onComposerDrop: (e: ReactDragEvent) => void;
	currentFilePath: string | null;
	currentFileLabel: string;
	mentionChipPaths: string[];
	directoryPathSet: ReadonlySet<string>;
	paperPathSet: ReadonlySet<string>;
	labelForPath: (path: string) => string;
	onRemoveContextPath: (path: string) => void;
	selectedSkills: AgentSkill[];
	onRemoveSkill: (skillId: string) => void;
	showMentionMenu: boolean;
	mentionBrowseRoot: string | null;
	mentionOptions: string[];
	mentionActiveIndex: number;
	mentionCandidates: string[];
	onLeaveMentionFolder: () => void;
	onEnterMentionFolder: (path: string) => void;
	onAttachMention: (path: string) => void;
	onMentionActiveIndexChange: (index: number) => void;
	showSkillMenu: boolean;
	skillOptions: AgentSkill[];
	skillActiveIndex: number;
	onAttachSkill: (skill: AgentSkill) => void;
	onSkillActiveIndexChange: (index: number) => void;
	modelSelectorOpen: boolean;
	onModelSelectorOpenChange: (open: boolean) => void;
	models: AgentModelChoice[];
	groupedModels: GroupedModel[];
	modelId: string | null;
	selectedModelName: string | null;
	favoriteIds: string[];
	warming: boolean;
	onPickModel: (id: string) => void;
	onToggleFavorite: (id: string) => void;
	effortOptionsInDisplayOrder: AgentEffortChoice[];
	reasoningEffort: string | null;
	onReasoningEffortChange: (id: string) => void;
	formatEffort: (value: string) => string;
	activeUsage: { used: number; size: number } | null;
	fastAvailable: boolean;
	fastEnabled: boolean;
	onFastEnabledToggle: () => void;
	onCancelRun: () => void;
	onSendSuggestion: (label: string, workflow?: string) => void;
}) {
	const { t } = useTranslation("agent");

	return (
		<div
			className={cn(
				"shrink-0 space-y-2",
				isZen
					? "mx-auto w-full max-w-2xl border-0 bg-transparent px-4 pt-1 pb-6 sm:px-6 sm:pb-8"
					: "border-t bg-muted/10 p-3",
			)}
		>
			{linesLength > 0 && !activeTabIsRunning ? (
				<Suggestions className={cn(isZen && "justify-center")}>
					{SUGGESTION_KEYS.map((key) => {
						const label = t(`suggestions.${key}`);
						return (
							<Suggestion
								key={key}
								suggestion={label}
								onClick={(v) => onSendSuggestion(v, SUGGESTION_WORKFLOW[key])}
								disabled={activeTabIsRunning || switching}
							/>
						);
					})}
				</Suggestions>
			) : null}
			<PromptInput
				className={cn(
					"w-full rounded-xl border-border bg-background shadow-none",
					isZen && "rounded-2xl border shadow-sm",
				)}
				inputGroupClassName={cn(
					"overflow-visible",
					!hasStreamingAgentMessage &&
						"has-disabled:bg-transparent has-disabled:opacity-100 dark:has-disabled:bg-input/30",
				)}
				onSubmit={async ({ text }) => {
					await onSubmit(text);
				}}
			>
				<PromptInputBody>
					<div
						className={cn(
							"relative flex w-full flex-col px-3 pt-3",
							isZen ? "min-h-[120px]" : "min-h-[96px]",
						)}
						onDragOverCapture={onComposerDragOver}
						onDropCapture={onComposerDrop}
					>
						{currentFilePath || mentionChipPaths.length > 0 ? (
							<div className="mb-2 flex flex-wrap gap-1.5">
								{currentFilePath ? (
									<button
										type="button"
										className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border bg-muted/20 px-2 text-foreground text-xs transition-colors hover:bg-muted"
										disabled={activeTabIsRunning}
										onClick={() => onRemoveContextPath(currentFilePath)}
										title={t("composer.currentFileRemove")}
									>
										<ContextPathIcon
											path={currentFilePath}
											directoryPaths={directoryPathSet}
											paperPaths={paperPathSet}
										/>
										<span className="truncate" title={currentFilePath}>
											{currentFileLabel}
										</span>
										<X className="size-3 shrink-0 text-muted-foreground" />
									</button>
								) : null}
								{mentionChipPaths.map((path) => {
									const label = labelForPath(path);
									return (
										<button
											key={path}
											type="button"
											className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border bg-muted/20 px-2 text-foreground text-xs transition-colors hover:bg-muted"
											onClick={() => onRemoveContextPath(path)}
											title={t("composer.removeContext", { path })}
										>
											<ContextPathIcon
												path={path}
												directoryPaths={directoryPathSet}
												paperPaths={paperPathSet}
											/>
											<span className="max-w-[16rem] truncate" title={path}>
												{label}
											</span>
											<X className="size-3 shrink-0 text-muted-foreground" />
										</button>
									);
								})}
							</div>
						) : null}
						{selectedSkills.length > 0 ? (
							<div className="mb-2 flex flex-wrap gap-1.5">
								{selectedSkills.map((skill) => (
									<button
										key={skill.id}
										type="button"
										className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border bg-muted/20 px-2 text-foreground text-xs transition-colors hover:bg-muted"
										onClick={() => onRemoveSkill(skill.id)}
										title={t("composer.removeSkill", {
											skill: skill.name,
										})}
									>
										<span className="font-mono text-muted-foreground">$</span>
										<span className="truncate">{skill.name}</span>
										<X className="size-3 shrink-0 text-muted-foreground" />
									</button>
								))}
							</div>
						) : null}
						{showMentionMenu ? (
							<div
								id="agent-mention-menu"
								role="listbox"
								className="absolute right-3 bottom-full left-3 z-20 mb-2 overflow-hidden rounded-lg border bg-popover p-1 shadow-md"
							>
								{mentionBrowseRoot ? (
									<div className="mb-0.5 flex items-center gap-0.5 border-border/60 border-b px-0.5 pb-1">
										<button
											type="button"
											className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
											aria-label={t("composer.mentionBack")}
											title={t("composer.mentionBack")}
											onClick={onLeaveMentionFolder}
										>
											<ChevronLeft className="size-3.5" aria-hidden />
										</button>
										<span
											className="min-w-0 flex-1 truncate pr-1 text-muted-foreground text-xs"
											title={mentionBrowseRoot}
										>
											{labelForPath(mentionBrowseRoot)}
										</span>
									</div>
								) : null}
								{mentionOptions.length === 0 ? (
									<div className="px-2 py-2 text-muted-foreground text-xs">
										{t("composer.mentionEmptyFolder")}
									</div>
								) : (
									mentionOptions.map((path, index) => {
										const label = labelForPath(path);
										const showPathHint =
											!mentionBrowseRoot &&
											label !== path &&
											path.includes("/");
										const canEnter = mentionPathHasChildren(
											path,
											mentionCandidates,
											paperPathSet,
										);
										return (
											<div
												key={path}
												className={cn(
													"flex w-full items-center gap-0.5 rounded-md text-sm",
													mentionActiveIndex === index
														? "bg-muted"
														: "hover:bg-muted/70",
												)}
											>
												<button
													type="button"
													id={`agent-mention-option-${index}`}
													role="option"
													aria-selected={mentionActiveIndex === index}
													className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left focus-visible:outline-none"
													onMouseEnter={() => onMentionActiveIndexChange(index)}
													onClick={() => onAttachMention(path)}
												>
													<ContextPathIcon
														path={path}
														directoryPaths={directoryPathSet}
														paperPaths={paperPathSet}
													/>
													<span className="min-w-0 flex-1 truncate">
														<span className="block truncate" title={path}>
															{label}
														</span>
														{showPathHint ? (
															<span
																className="block truncate text-[11px] text-muted-foreground"
																title={path}
															>
																{path}
															</span>
														) : null}
													</span>
												</button>
												{canEnter ? (
													<button
														type="button"
														tabIndex={-1}
														className="mr-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
														aria-label={t("composer.mentionEnterFolder", {
															name: label,
														})}
														title={t("composer.mentionEnterFolder", {
															name: label,
														})}
														onMouseEnter={() =>
															onMentionActiveIndexChange(index)
														}
														onClick={(e) => {
															e.preventDefault();
															e.stopPropagation();
															onEnterMentionFolder(path);
														}}
													>
														<ChevronRight className="size-3.5" aria-hidden />
													</button>
												) : (
													<span className="mr-0.5 size-7 shrink-0" />
												)}
											</div>
										);
									})
								)}
							</div>
						) : null}
						{showSkillMenu ? (
							<div
								id="agent-skill-menu"
								role="listbox"
								className="absolute right-3 bottom-full left-3 z-20 mb-2 overflow-hidden rounded-lg border bg-popover p-1 shadow-md"
							>
								{skillOptions.map((skill, index) => (
									<button
										key={skill.id}
										id={`agent-skill-option-${index}`}
										type="button"
										role="option"
										aria-selected={skillActiveIndex === index}
										className={cn(
											"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none",
											skillActiveIndex === index
												? "bg-muted"
												: "hover:bg-muted/70",
										)}
										onMouseEnter={() => onSkillActiveIndexChange(index)}
										onClick={() => onAttachSkill(skill)}
									>
										<span className="font-mono text-muted-foreground">$</span>
										<span className="min-w-0 flex-1 truncate">
											{skill.name}
										</span>
										{skill.description ? (
											<span className="max-w-40 truncate text-muted-foreground text-xs">
												{skill.description}
											</span>
										) : null}
									</button>
								))}
							</div>
						) : null}
						<PromptInputTextarea
							autoFocus={autoFocus || undefined}
							className="min-h-[82px] px-0 py-1 text-[15px] leading-6 placeholder:text-muted-foreground/80"
							value={composerText}
							onChange={(event) => {
								onComposerTextChange(event.currentTarget.value);
							}}
							onKeyDown={onComposerKeyDown}
							aria-expanded={showMentionMenu || showSkillMenu}
							aria-autocomplete="list"
							aria-controls={
								showMentionMenu
									? "agent-mention-menu"
									: showSkillMenu
										? "agent-skill-menu"
										: undefined
							}
							aria-activedescendant={
								showMentionMenu
									? `agent-mention-option-${mentionActiveIndex}`
									: showSkillMenu
										? `agent-skill-option-${skillActiveIndex}`
										: undefined
							}
							role="combobox"
							disabled={switching}
							placeholder={
								activeTabIsRunning
									? t("composer.interruptHint")
									: t("composer.placeholder")
							}
						/>
					</div>
				</PromptInputBody>
				<PromptInputFooter className="flex-wrap items-end gap-x-2 gap-y-1.5 px-3 pb-2.5">
					<PromptInputTools className="min-w-0 flex-1 flex-wrap gap-1">
						<ModelSelector
							open={modelSelectorOpen}
							onOpenChange={onModelSelectorOpenChange}
						>
							<ModelSelectorTrigger asChild>
								<PromptInputButton
									type="button"
									className={cn(
										"h-7 max-w-[min(16rem,100%)] gap-1 px-1.5 text-xs font-medium",
										composerControlsMuted
											? "text-muted-foreground"
											: "text-foreground",
									)}
									disabled={
										activeTabIsRunning || warming || models.length === 0
									}
									tooltip={
										models.length > 0
											? t("models.selectTooltip")
											: t("models.reportedTooltip")
									}
								>
									<span className="truncate text-xs">
										{selectedModelName ??
											(warming ? t("models.loading") : t("models.button"))}
									</span>
									<ChevronDown className="size-3 shrink-0 opacity-70" />
								</PromptInputButton>
							</ModelSelectorTrigger>
							<ModelSelectorContent className="sm:max-w-md">
								<ModelSelectorInput
									placeholder={t("models.searchPlaceholder")}
								/>
								<ModelSelectorList className="max-h-64">
									{groupedModels.map((group) => (
										<ModelSelectorGroup key={group.id} heading={group.heading}>
											{group.items.map((model) => {
												const favorited = favoriteIds.includes(model.id);
												const selected = modelId === model.id;
												return (
													<ModelSelectorItem
														key={`${group.id}-${model.id}`}
														value={`${model.name} ${model.id}${
															group.isFavorites ? "\u200b" : ""
														}`}
														onSelect={() => onPickModel(model.id)}
														className={cn(
															selected &&
																"bg-accent font-medium text-accent-foreground data-selected:bg-accent",
														)}
													>
														<span className="flex-1 truncate">
															{model.name}
														</span>
														<button
															type="button"
															aria-label={
																favorited
																	? t("models.removeFromFavorites")
																	: t("models.addToFavorites")
															}
															title={
																favorited
																	? t("models.removeFromFavorites")
																	: t("models.addToFavorites")
															}
															className={cn(
																"rounded p-0.5 text-muted-foreground transition hover:text-foreground",
																favorited
																	? "opacity-100"
																	: "opacity-0 group-hover/command-item:opacity-100 group-data-selected/command-item:opacity-100",
															)}
															onClick={(e) => {
																e.stopPropagation();
																e.preventDefault();
																onToggleFavorite(model.id);
															}}
															onPointerDown={(e) => e.stopPropagation()}
															onMouseDown={(e) => e.stopPropagation()}
														>
															<Star
																className={cn(
																	"size-3.5",
																	favorited && "fill-current text-amber-500",
																)}
															/>
														</button>
													</ModelSelectorItem>
												);
											})}
										</ModelSelectorGroup>
									))}
									<ModelSelectorEmpty>
										{models.length === 0
											? t("models.emptyNone")
											: t("models.emptyNoMatch")}
									</ModelSelectorEmpty>
								</ModelSelectorList>
							</ModelSelectorContent>
						</ModelSelector>
						{effortOptionsInDisplayOrder.length > 0 ? (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<PromptInputButton
										type="button"
										className={cn(
											"h-7 max-w-[min(8rem,100%)] gap-1 px-1.5 text-xs font-medium",
											composerControlsMuted
												? "text-muted-foreground"
												: "text-foreground",
										)}
										disabled={activeTabIsRunning}
										tooltip={t("composer.effortTooltip")}
									>
										<span className="truncate">
											{t("composer.effort.label")}:{" "}
											{formatEffort(reasoningEffort ?? "medium")}
										</span>
										<ChevronDown className="size-3 shrink-0 opacity-70" />
									</PromptInputButton>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="start" className="min-w-28 p-1">
									{effortOptionsInDisplayOrder.map((effort) => (
										<DropdownMenuItem
											key={effort.id}
											className={cn(
												"justify-between rounded-md",
												reasoningEffort === effort.id && "bg-muted",
											)}
											onSelect={() => onReasoningEffortChange(effort.id)}
										>
											{formatEffort(effort.id)}
											{reasoningEffort === effort.id ? (
												<CheckIcon className="size-3.5 text-muted-foreground" />
											) : null}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
						{activeUsage && activeUsage.size > 0 ? (
							<Context
								usedTokens={activeUsage.used}
								maxTokens={activeUsage.size}
							>
								<ContextTrigger className="h-7 gap-1 px-1.5 text-xs" />
								<ContextContent>
									<ContextContentHeader />
								</ContextContent>
							</Context>
						) : null}
						{fastAvailable ? (
							<PromptInputButton
								type="button"
								className={cn(
									"size-7",
									composerControlsMuted
										? "text-muted-foreground"
										: "text-foreground",
									fastEnabled && "text-amber-500 hover:text-amber-500",
								)}
								aria-pressed={fastEnabled}
								disabled={activeTabIsRunning}
								onClick={onFastEnabledToggle}
								tooltip={t("composer.fastToggle")}
							>
								<Zap
									className={cn(
										"size-3.5",
										fastEnabled &&
											"fill-amber-400 text-amber-500 dark:fill-amber-300 dark:text-amber-300",
									)}
								/>
							</PromptInputButton>
						) : null}
					</PromptInputTools>
					<PromptInputSubmit
						className="ml-auto shrink-0"
						size="icon-xs"
						status={
							activeTabIsRunning
								? "streaming"
								: submitting
									? "submitted"
									: "ready"
						}
						onStop={activeTabIsRunning ? onCancelRun : undefined}
						disabled={
							!activeTabIsRunning &&
							(switching || submitting || !composerText.trim())
						}
					/>
				</PromptInputFooter>
			</PromptInput>
		</div>
	);
}
