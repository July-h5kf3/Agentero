import {
	CheckIcon,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ImageIcon,
	ScanSearch,
	Star,
	TextSelect,
	X,
	Zap,
} from "lucide-react";
import type { KeyboardEvent, DragEvent as ReactDragEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ContextPathIcon } from "@/components/agent/context-path-icon";
import type { QueuedPrompt } from "@/components/agent/types";
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
	usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import {
	Queue,
	QueueItem,
	QueueItemAction,
	QueueItemActions,
	QueueItemContent,
	QueueItemIndicator,
	QueueList,
	QueueSection,
	QueueSectionContent,
	QueueSectionLabel,
	QueueSectionTrigger,
} from "@/components/ai-elements/queue";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@/components/ui/popover";
import type {
	AgentEffortChoice,
	AgentModelChoice,
	AgentSkill,
	PromptImage,
} from "@/lib/agent";
import { SUGGESTION_KEYS, SUGGESTION_WORKFLOW } from "@/lib/agent/chat-state";
import { mentionPathHasChildren } from "@/lib/agent/mention";
import {
	COMPOSER_IMAGE_ACCEPT,
	COMPOSER_IMAGE_MAX_BYTES,
	COMPOSER_IMAGE_MAX_FILES,
	fileUiPartsToPromptImages,
	pickComposerImageFiles,
} from "@/lib/agent/prompt-image";
import type { SelectionContext } from "@/lib/agent/selection-store";
import type { AcpCommand } from "@/lib/agent/slash-commands";
import type { PdfVisualDraft } from "@/lib/agent/visual-context-store";
import { dataTransferLooksLikeImages } from "@/lib/core/file-accept";
import { notifyError } from "@/lib/core/notify";
import { basenameOf } from "@/lib/core/path";
import { cn } from "@/lib/core/utils";

export type GroupedModel = {
	id: string;
	heading: string;
	isFavorites: boolean;
	items: AgentModelChoice[];
};

/** Pending image attachment chips (inside PromptInput attachment context). */
function ComposerImageAttachments() {
	const { t } = useTranslation("agent");
	const attachments = usePromptInputAttachments();
	if (attachments.files.length === 0) return null;
	return (
		<div className="mb-2 flex flex-wrap gap-1.5">
			{attachments.files.map((file) => {
				const label = file.filename?.trim() || t("composer.attachedImage");
				const thumb = file.url || null;
				return (
					<button
						key={file.id}
						type="button"
						className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border bg-muted/20 px-1.5 pr-2 text-foreground text-xs transition-colors hover:bg-muted"
						onClick={() => attachments.remove(file.id)}
						title={t("composer.removeAttachedImage")}
					>
						{thumb ? (
							<img
								src={thumb}
								alt=""
								className="size-5 shrink-0 rounded object-cover"
							/>
						) : (
							<ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
						)}
						<span className="max-w-[10rem] truncate" title={label}>
							{label}
						</span>
						<X className="size-3 shrink-0 text-muted-foreground" />
					</button>
				);
			})}
		</div>
	);
}

function ComposerAttachImageButton({ disabled }: { disabled?: boolean }) {
	const { t } = useTranslation("agent");
	const attachments = usePromptInputAttachments();
	const [picking, setPicking] = useState(false);

	const onAttachClick = async () => {
		if (disabled || picking) return;
		const remaining = Math.max(
			0,
			COMPOSER_IMAGE_MAX_FILES - attachments.files.length,
		);
		if (remaining <= 0) {
			notifyError(t("composer.imageMaxFilesError"));
			return;
		}
		setPicking(true);
		try {
			// Desktop: native dialog with hard extension filters (PDF greyed out /
			// not listed). Non-Tauri: fall back to HTML file input + accept.
			const picked = await pickComposerImageFiles({
				remainingSlots: remaining,
				title: t("composer.attachImage"),
				filterName: t("composer.imageFilter"),
			});
			if (picked === null) {
				attachments.openFileDialog();
				return;
			}
			if (picked.length === 0) return;
			const oversized = picked.filter(
				(file) => file.size > COMPOSER_IMAGE_MAX_BYTES,
			);
			const sized = picked.filter(
				(file) => file.size <= COMPOSER_IMAGE_MAX_BYTES,
			);
			if (oversized.length && sized.length === 0) {
				notifyError(t("composer.imageMaxSizeError"));
				return;
			}
			if (oversized.length) {
				notifyError(t("composer.imageMaxSizeError"));
			}
			if (sized.length) {
				attachments.add(sized);
			}
		} catch (error) {
			notifyError(
				error instanceof Error ? error.message : t("composer.imagePickFailed"),
			);
		} finally {
			setPicking(false);
		}
	};

	return (
		<PromptInputButton
			type="button"
			className="size-7 text-foreground"
			disabled={disabled || picking}
			onClick={() => void onAttachClick()}
			tooltip={t("composer.attachImage")}
			aria-label={t("composer.attachImage")}
		>
			<ImageIcon className="size-3.5" />
		</PromptInputButton>
	);
}

function ComposerSubmitControl({
	canSubmitBase,
	switching,
	submitting,
	activeTabIsRunning,
	onCancelRun,
}: {
	canSubmitBase: boolean;
	switching: boolean;
	submitting: boolean;
	activeTabIsRunning: boolean;
	onCancelRun: () => void;
}) {
	const attachments = usePromptInputAttachments();
	const canSubmit = canSubmitBase || attachments.files.length > 0;
	// Streaming + empty composer → stop; with text/images/drafts → queue follow-up.
	const stop = activeTabIsRunning && !canSubmit;
	return (
		<PromptInputSubmit
			className="ml-auto shrink-0"
			size="icon-xs"
			status={
				stop
					? "streaming"
					: submitting && !activeTabIsRunning
						? "submitted"
						: "ready"
			}
			onStop={stop ? onCancelRun : undefined}
			disabled={
				switching ||
				(submitting && !activeTabIsRunning) ||
				(!stop && !canSubmit)
			}
		/>
	);
}

export function AgentComposer({
	isZen,
	autoFocus,
	linesLength,
	activeTabIsRunning,
	switching,
	submitting,
	composerText,
	onComposerTextChange,
	onSubmit,
	onComposerKeyDown,
	onComposerDragOver,
	onComposerDrop,
	onDismissComposerMenu,
	// Context chips
	currentFilePath,
	currentFileLabel,
	mentionChipPaths,
	selectionChips,
	onRemoveSelection,
	visualDrafts,
	onRemoveVisualDraft,
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
	// Slash menu
	showSlashMenu,
	slashOptions,
	slashActiveIndex,
	onAttachSlashCommand,
	onSlashActiveIndexChange,
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
	// Submit / stop / waitlist
	onCancelRun,
	messageQueue,
	onRemoveQueuedMessage,
	// Follow-up suggestions
	onSendSuggestion,
}: {
	isZen: boolean;
	autoFocus: boolean;
	linesLength: number;
	activeTabIsRunning: boolean;
	switching: boolean;
	submitting: boolean;
	composerText: string;
	onComposerTextChange: (text: string) => void;
	onSubmit: (text: string, images?: PromptImage[]) => Promise<void>;
	onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
	onComposerDragOver: (e: ReactDragEvent) => void;
	onComposerDrop: (e: ReactDragEvent) => void;
	onDismissComposerMenu: () => void;
	messageQueue: QueuedPrompt[];
	onRemoveQueuedMessage: (id: string) => void;
	currentFilePath: string | null;
	currentFileLabel: string;
	mentionChipPaths: string[];
	selectionChips: SelectionContext[];
	onRemoveSelection: (id: string) => void;
	visualDrafts: PdfVisualDraft[];
	onRemoveVisualDraft: (id: string) => void;
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
	showSlashMenu: boolean;
	slashOptions: AcpCommand[];
	slashActiveIndex: number;
	onAttachSlashCommand: (command: AcpCommand) => void;
	onSlashActiveIndexChange: (index: number) => void;
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
	const hasComposerText = Boolean(composerText.trim());
	const hasVisualDrafts = visualDrafts.length > 0;
	// Attachments live inside PromptInput; base gate ignores them (see ComposerSubmitControl).
	const canSubmitBase = hasComposerText || hasVisualDrafts;
	const composerMenuOpen = showMentionMenu || showSkillMenu || showSlashMenu;
	// Nested enter/leave counter so moving over chips/textarea does not flicker the drop ring.
	const fileDragDepthRef = useRef(0);
	const [isFileDragOver, setIsFileDragOver] = useState(false);

	const resetFileDragHighlight = useCallback(() => {
		fileDragDepthRef.current = 0;
		setIsFileDragOver(false);
	}, []);

	const onFileDragEnter = useCallback((event: ReactDragEvent) => {
		// Only highlight when we can tell the payload is image-like.
		if (!dataTransferLooksLikeImages(event.dataTransfer)) return;
		event.preventDefault();
		fileDragDepthRef.current += 1;
		setIsFileDragOver(true);
	}, []);

	const onFileDragLeave = useCallback((event: ReactDragEvent) => {
		if (!dataTransferLooksLikeImages(event.dataTransfer)) return;
		fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
		if (fileDragDepthRef.current === 0) {
			setIsFileDragOver(false);
		}
	}, []);

	const onFileDragOver = useCallback((event: ReactDragEvent) => {
		if (!dataTransferLooksLikeImages(event.dataTransfer)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
	}, []);

	const onFileDropHighlightEnd = useCallback(() => {
		// Drop fires before PromptInput's native listener consumes files; only clear UI.
		resetFileDragHighlight();
	}, [resetFileDragHighlight]);

	// Clear stuck highlight if the drag ends outside the composer (leave app, Esc, etc.).
	useEffect(() => {
		if (!isFileDragOver) return;
		const clear = () => resetFileDragHighlight();
		window.addEventListener("dragend", clear);
		window.addEventListener("drop", clear);
		return () => {
			window.removeEventListener("dragend", clear);
			window.removeEventListener("drop", clear);
		};
	}, [isFileDragOver, resetFileDragHighlight]);

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
			{messageQueue.length > 0 ? (
				<Queue className={cn(isZen && "shadow-sm")}>
					<QueueSection defaultOpen>
						<QueueSectionTrigger>
							<QueueSectionLabel
								count={messageQueue.length}
								label={t("composer.queueLabel")}
							/>
						</QueueSectionTrigger>
						<QueueSectionContent>
							<QueueList>
								{messageQueue.map((item) => {
									const imageCount = item.images?.length ?? 0;
									const queueLabel =
										item.text.trim() ||
										(item.visualDrafts.length
											? t("composer.visualAnnotationsTitle", {
													count: item.visualDrafts.length,
												})
											: imageCount > 0
												? t("composer.attachedImagesTitle", {
														count: imageCount,
													})
												: t("composer.visualAnnotation"));
									return (
										<QueueItem key={item.id}>
											<div className="flex w-full items-center gap-2">
												<QueueItemIndicator />
												<QueueItemContent title={queueLabel}>
													{queueLabel}
												</QueueItemContent>
												<QueueItemActions>
													<QueueItemAction
														aria-label={t("composer.queueRemove")}
														title={t("composer.queueRemove")}
														onClick={() => onRemoveQueuedMessage(item.id)}
													>
														<X className="size-3.5" />
													</QueueItemAction>
												</QueueItemActions>
											</div>
										</QueueItem>
									);
								})}
							</QueueList>
						</QueueSectionContent>
					</QueueSection>
				</Queue>
			) : null}
			<div className="relative">
				<PromptInput
					className={cn(
						"w-full rounded-xl border-border bg-background shadow-none transition-[background-color,box-shadow,border-color] duration-150",
						isZen && "rounded-2xl border shadow-sm",
						isFileDragOver &&
							"border-primary/55 bg-primary/5 shadow-[inset_0_0_0_1px] shadow-primary/25 ring-2 ring-primary/35",
					)}
					inputGroupClassName={cn(
						"overflow-visible",
						// Keep the same surface while any child is disabled or a run is
						// in progress — never dim / recolor the composer for "processing".
						"has-disabled:bg-transparent has-disabled:opacity-100 dark:has-disabled:bg-input/30",
						isFileDragOver && "bg-transparent dark:bg-transparent",
					)}
					accept={COMPOSER_IMAGE_ACCEPT}
					multiple
					maxFiles={COMPOSER_IMAGE_MAX_FILES}
					maxFileSize={COMPOSER_IMAGE_MAX_BYTES}
					onError={(err) => {
						if (err.code === "accept") {
							notifyError(t("composer.imageAcceptError"));
							return;
						}
						notifyError(err.message);
					}}
					onDragEnter={onFileDragEnter}
					onDragLeave={onFileDragLeave}
					onDragOver={onFileDragOver}
					onDrop={onFileDropHighlightEnd}
					onSubmit={async ({ text, files }) => {
						const images = fileUiPartsToPromptImages(files);
						await onSubmit(text, images.length ? images : undefined);
					}}
				>
					<PromptInputBody>
						<Popover
							open={composerMenuOpen}
							modal={false}
							onOpenChange={(open) => {
								if (!open) onDismissComposerMenu();
							}}
						>
							<PopoverAnchor asChild>
								<div
									className={cn(
										"relative flex w-full flex-col px-3 pt-3",
										isZen ? "min-h-[120px]" : "min-h-[96px]",
									)}
									onDragOverCapture={onComposerDragOver}
									onDropCapture={onComposerDrop}
								>
									<ComposerImageAttachments />
									{currentFilePath ||
									mentionChipPaths.length > 0 ||
									selectionChips.length > 0 ||
									visualDrafts.length > 0 ? (
										<div className="mb-2 flex flex-wrap gap-1.5">
											{currentFilePath ? (
												<button
													type="button"
													className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border bg-muted/20 px-2 text-foreground text-xs transition-colors hover:bg-muted"
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
														<span
															className="max-w-[16rem] truncate"
															title={path}
														>
															{label}
														</span>
														<X className="size-3 shrink-0 text-muted-foreground" />
													</button>
												);
											})}
											{selectionChips.map((sel) => {
												const name =
													basenameOf(sel.sourcePath) || t("composer.selection");
												const label = sel.page
													? `${name} · p.${sel.page}`
													: name;
												return (
													<button
														key={sel.id}
														type="button"
														className={cn(
															"inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border px-2 text-foreground text-xs transition-colors hover:bg-muted",
															sel.pinned
																? "bg-muted/20"
																: "border-dashed bg-transparent",
														)}
														onClick={() => onRemoveSelection(sel.id)}
														title={t("composer.removeSelection")}
													>
														<TextSelect className="size-3.5 shrink-0 text-muted-foreground" />
														<span
															className="max-w-[16rem] truncate"
															title={sel.text}
														>
															{label}
														</span>
														<X className="size-3 shrink-0 text-muted-foreground" />
													</button>
												);
											})}
											{visualDrafts.map((draft) => {
												const pageLabel = t("composer.visualAnnotationPage", {
													page: draft.page,
												});
												const label =
													draft.comment.trim() ||
													`${t("composer.visualAnnotation")} · ${pageLabel}`;
												const thumb =
													draft.image.data.length > 0
														? `data:${draft.image.mimeType || "image/png"};base64,${draft.image.data}`
														: null;
												return (
													<button
														key={draft.id}
														type="button"
														className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border bg-muted/20 px-1.5 pr-2 text-foreground text-xs transition-colors hover:bg-muted"
														onClick={() => onRemoveVisualDraft(draft.id)}
														title={t("composer.removeVisualDraft")}
													>
														{thumb ? (
															<img
																src={thumb}
																alt=""
																className="size-5 shrink-0 rounded object-cover"
															/>
														) : (
															<ScanSearch className="size-3.5 shrink-0 text-muted-foreground" />
														)}
														<span
															className="max-w-[14rem] truncate"
															title={draft.comment || pageLabel}
														>
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
													<span className="font-mono text-muted-foreground">
														$
													</span>
													<span className="truncate">{skill.name}</span>
													<X className="size-3 shrink-0 text-muted-foreground" />
												</button>
											))}
										</div>
									) : null}
									{showMentionMenu ? (
										<PopoverContent
											id="agent-mention-menu"
											role="listbox"
											side="top"
											align="start"
											sideOffset={8}
											onOpenAutoFocus={(event) => event.preventDefault()}
											className="max-h-(--radix-popover-content-available-height) w-[min(28rem,calc(100vw-1rem))] gap-0 overflow-y-auto p-1"
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
																onMouseEnter={() =>
																	onMentionActiveIndexChange(index)
																}
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
																	<ChevronRight
																		className="size-3.5"
																		aria-hidden
																	/>
																</button>
															) : (
																<span className="mr-0.5 size-7 shrink-0" />
															)}
														</div>
													);
												})
											)}
										</PopoverContent>
									) : null}
									{showSkillMenu ? (
										<PopoverContent
											id="agent-skill-menu"
											role="listbox"
											side="top"
											align="start"
											sideOffset={8}
											onOpenAutoFocus={(event) => event.preventDefault()}
											className="max-h-(--radix-popover-content-available-height) w-[min(28rem,calc(100vw-1rem))] gap-0 overflow-y-auto p-1"
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
													<span className="font-mono text-muted-foreground">
														$
													</span>
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
										</PopoverContent>
									) : null}
									{showSlashMenu ? (
										<PopoverContent
											id="agent-slash-menu"
											role="listbox"
											side="top"
											align="start"
											sideOffset={8}
											onOpenAutoFocus={(event) => event.preventDefault()}
											className="max-h-(--radix-popover-content-available-height) w-[min(28rem,calc(100vw-1rem))] gap-0 overflow-y-auto p-1"
										>
											{slashOptions.map((command, index) => (
												<button
													key={command.id}
													id={`agent-slash-option-${index}`}
													type="button"
													role="option"
													aria-selected={slashActiveIndex === index}
													className={cn(
														"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none",
														slashActiveIndex === index
															? "bg-muted"
															: "hover:bg-muted/70",
													)}
													onMouseEnter={() => onSlashActiveIndexChange(index)}
													onClick={() => onAttachSlashCommand(command)}
												>
													<span className="flex min-w-0 flex-1 items-center truncate">
														<span className="shrink-0 font-mono text-muted-foreground">
															/
														</span>
														<span className="shrink-0 whitespace-nowrap">
															{command.title}
														</span>
													</span>
													{command.description ? (
														<span className="min-w-0 max-w-40 flex-1 truncate text-muted-foreground text-xs">
															{command.description}
														</span>
													) : null}
												</button>
											))}
										</PopoverContent>
									) : null}
									<PromptInputTextarea
										autoFocus={autoFocus || undefined}
										className="min-h-[82px] px-0 py-1 text-[15px] leading-6 placeholder:text-muted-foreground/80"
										value={composerText}
										onChange={(event) => {
											onComposerTextChange(event.currentTarget.value);
										}}
										onKeyDown={onComposerKeyDown}
										aria-expanded={
											showMentionMenu || showSkillMenu || showSlashMenu
										}
										aria-autocomplete="list"
										aria-controls={
											showMentionMenu
												? "agent-mention-menu"
												: showSkillMenu
													? "agent-skill-menu"
													: showSlashMenu
														? "agent-slash-menu"
														: undefined
										}
										aria-activedescendant={
											showMentionMenu
												? `agent-mention-option-${mentionActiveIndex}`
												: showSkillMenu
													? `agent-skill-option-${skillActiveIndex}`
													: showSlashMenu
														? `agent-slash-option-${slashActiveIndex}`
														: undefined
										}
										role="combobox"
										disabled={switching}
										placeholder={
											activeTabIsRunning
												? t("composer.queueHint")
												: t("composer.placeholder")
										}
									/>
								</div>
							</PopoverAnchor>
						</Popover>
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
										className="h-7 max-w-[min(16rem,100%)] gap-1 px-1.5 text-xs font-medium text-foreground"
										disabled={warming || models.length === 0}
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
											<ModelSelectorGroup
												key={group.id}
												heading={group.heading}
											>
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
											className="h-7 max-w-[min(8rem,100%)] gap-1 px-1.5 text-xs font-medium text-foreground"
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
										"size-7 text-foreground",
										fastEnabled && "text-amber-500 hover:text-amber-500",
									)}
									aria-pressed={fastEnabled}
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
							<ComposerAttachImageButton disabled={switching} />
						</PromptInputTools>
						<ComposerSubmitControl
							canSubmitBase={canSubmitBase}
							switching={switching}
							submitting={submitting}
							activeTabIsRunning={activeTabIsRunning}
							onCancelRun={onCancelRun}
						/>
					</PromptInputFooter>
				</PromptInput>
				{isFileDragOver ? (
					<div
						className={cn(
							"pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl",
							isZen && "rounded-2xl",
							"border-2 border-primary/50 border-dashed bg-primary/10 backdrop-blur-[1px]",
						)}
						aria-hidden
					>
						<div className="flex items-center gap-2 rounded-full border border-primary/25 bg-background/90 px-3 py-1.5 text-primary text-xs font-medium shadow-sm">
							<ImageIcon className="size-3.5 shrink-0" />
							<span>{t("composer.dropImageHint")}</span>
						</div>
					</div>
				) : null}
			</div>
		</div>
	);
}
