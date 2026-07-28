import { memo } from "react";
import { AgentComposer } from "@/components/agent/agent-composer";
import {
	SidebarHistoryTrailing,
	ZenHistoryRail,
} from "@/components/agent/agent-history";
import { AgentPermissionDialog } from "@/components/agent/agent-permission-dialog";
import { AgentSwitcher } from "@/components/agent/agent-switcher";
import { ChatTranscript } from "@/components/agent/chat-transcript";
import type { AgentPanelProps } from "@/components/agent/types";
import { useAgentPanel } from "@/components/agent/use-agent-panel";
import { PaneHeader } from "@/components/shell/pane-header";
import { removeSelection } from "@/lib/agent/selection-store";
import { cn } from "@/lib/core/utils";

export type { AgentPanelProps } from "@/components/agent/types";

export const AgentPanel = memo(function AgentPanel({
	vaultPath,
	selectedPath = null,
	selectedPaperTitle = null,
	vaultMarkdownPaths = [],
	vaultDirectoryPaths = [],
	vaultPaperPaths = [],
	paperMetaByRelPath = null,
	paperTreeLabelMode = "title-author",
	className,
	headerActions,
	autoFocus = false,
	title = "Chat",
	variant = "sidebar",
	onOpenAgentSettings,
	onOpenSource,
}: AgentPanelProps) {
	const panel = useAgentPanel({
		vaultPath,
		selectedPath,
		selectedPaperTitle,
		vaultMarkdownPaths,
		vaultDirectoryPaths,
		vaultPaperPaths,
		paperMetaByRelPath,
		paperTreeLabelMode,
		variant,
	});

	const {
		isZen,
		t,
		lines,
		activeTabId,
		selected,
		activeTabIsRunning,
		submitting,
		switching,
		editingLineId,
		editingText,
		editTextareaRef,
		editCompositionProps,
		isEditBlockedByIme,
		setEditingText,
		cancelEditingMessage,
		resendEditedMessage,
		startEditingMessage,
		submitComposer,
		messageQueue,
		removeQueuedMessage,
		sessionHistory,
		historyOpen,
		setHistoryOpen,
		newConversation,
		openHistorySession,
		options,
		selectedAgentId,
		hasRunningSessions,
		selectAgent,
		composerText,
		onComposerTextChangeFromUser,
		setComposerMenuDismissed,
		setMentionActiveIndex,
		setSkillActiveIndex,
		handleComposerMenuKeyDown,
		handleComposerDragOver,
		handleComposerDrop,
		currentFilePath,
		currentFileLabel,
		mentionChipPaths,
		selectionChips,
		directoryPathSet,
		paperPathSet,
		labelForPath,
		removeContextPath,
		selectedSkills,
		setSelectedSkillIds,
		showMentionMenu,
		mentionBrowseRoot,
		mentionOptions,
		mentionActiveIndex,
		mentionCandidates,
		leaveMentionFolder,
		enterMentionFolder,
		attachMention,
		showSkillMenu,
		skillOptions,
		skillActiveIndex,
		attachSkill,
		showSlashMenu,
		slashOptions,
		slashActiveIndex,
		setSlashActiveIndex,
		attachSlashCommand,
		modelSelectorOpen,
		setModelSelectorOpen,
		models,
		groupedModels,
		modelId,
		selectedModelName,
		favoriteIds,
		warming,
		pickModel,
		toggleFavorite,
		effortOptionsInDisplayOrder,
		reasoningEffort,
		setReasoningEffort,
		formatEffort,
		activeUsage,
		fastAvailable,
		fastEnabled,
		setFastEnabled,
		cancelCurrentRun,
		permissionRequest,
		setPermissionRequest,
		switchingRef,
		submittingRef,
	} = panel;

	const sendSuggestion = (label: string, workflow?: string) => {
		void submitComposer(label, workflow);
	};

	return (
		<section
			className={cn(
				"flex h-full min-h-0 bg-background",
				isZen ? "flex-row bg-muted/15" : "flex-col",
				className,
			)}
			aria-label={title}
		>
			{isZen ? (
				<ZenHistoryRail
					sessionHistory={sessionHistory}
					activeTabId={activeTabId}
					submitting={submitting}
					onNewConversation={newConversation}
					onOpenSession={openHistorySession}
				/>
			) : null}

			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				{/* Same header chrome in both modes: Agent switcher + trailing actions (zen: no trailing). */}
				<PaneHeader
					trailing={
						isZen ? undefined : (
							<SidebarHistoryTrailing
								historyOpen={historyOpen}
								onHistoryOpenChange={setHistoryOpen}
								sessionHistory={sessionHistory}
								activeTabId={activeTabId}
								submitting={submitting}
								headerActions={headerActions}
								onNewConversation={newConversation}
								onOpenSession={openHistorySession}
							/>
						)
					}
				>
					<AgentSwitcher
						options={options}
						selected={selected}
						selectedAgentId={selectedAgentId}
						disabled={hasRunningSessions || switching || submitting}
						onSelect={(opt) => void selectAgent(opt)}
						onOpenAgentSettings={onOpenAgentSettings}
					/>
				</PaneHeader>

				{/*
				  Shared AI Elements transcript for sidebar + zen.
				  Zen only changes the scroll viewport width (full pane → scrollbar on the
				  far right) and centers the message column; message components are identical.
				*/}
				<div className="flex min-h-0 flex-1 flex-col">
					<ChatTranscript
						isZen={isZen}
						lines={lines}
						activeTabId={activeTabId}
						agentName={selected?.name ?? t("defaultName")}
						activeTabIsRunning={activeTabIsRunning}
						submitting={submitting}
						switching={switching}
						editingLineId={editingLineId}
						editingText={editingText}
						editTextareaRef={editTextareaRef}
						editCompositionProps={editCompositionProps}
						isEditBlockedByIme={isEditBlockedByIme}
						onEditingTextChange={setEditingText}
						onCancelEditing={cancelEditingMessage}
						onResendEdited={(lineId) => void resendEditedMessage(lineId)}
						onStartEditing={startEditingMessage}
						onSendSuggestion={sendSuggestion}
						onOpenSource={onOpenSource}
					/>

					<AgentComposer
						isZen={isZen}
						autoFocus={autoFocus}
						linesLength={lines.length}
						activeTabIsRunning={activeTabIsRunning}
						switching={switching}
						submitting={submitting}
						composerText={composerText}
						onComposerTextChange={(text) => {
							onComposerTextChangeFromUser(text);
							setComposerMenuDismissed(false);
							setMentionActiveIndex(0);
							setSkillActiveIndex(0);
							setSlashActiveIndex(0);
						}}
						onSubmit={async (text) => {
							if (switchingRef.current || submittingRef.current) {
								return;
							}
							await submitComposer(text);
						}}
						onComposerKeyDown={handleComposerMenuKeyDown}
						onComposerDragOver={handleComposerDragOver}
						onComposerDrop={handleComposerDrop}
						messageQueue={messageQueue}
						onRemoveQueuedMessage={removeQueuedMessage}
						currentFilePath={currentFilePath}
						currentFileLabel={currentFileLabel}
						mentionChipPaths={mentionChipPaths}
						selectionChips={selectionChips}
						onRemoveSelection={removeSelection}
						directoryPathSet={directoryPathSet}
						paperPathSet={paperPathSet}
						labelForPath={labelForPath}
						onRemoveContextPath={removeContextPath}
						selectedSkills={selectedSkills}
						onRemoveSkill={(skillId) =>
							setSelectedSkillIds((prev) => prev.filter((id) => id !== skillId))
						}
						showMentionMenu={showMentionMenu}
						mentionBrowseRoot={mentionBrowseRoot}
						mentionOptions={mentionOptions}
						mentionActiveIndex={mentionActiveIndex}
						mentionCandidates={mentionCandidates}
						onLeaveMentionFolder={leaveMentionFolder}
						onEnterMentionFolder={enterMentionFolder}
						onAttachMention={attachMention}
						onMentionActiveIndexChange={setMentionActiveIndex}
						showSkillMenu={showSkillMenu}
						skillOptions={skillOptions}
						skillActiveIndex={skillActiveIndex}
						onAttachSkill={attachSkill}
						onSkillActiveIndexChange={setSkillActiveIndex}
						showSlashMenu={showSlashMenu}
						slashOptions={slashOptions}
						slashActiveIndex={slashActiveIndex}
						onAttachSlashCommand={attachSlashCommand}
						onSlashActiveIndexChange={setSlashActiveIndex}
						modelSelectorOpen={modelSelectorOpen}
						onModelSelectorOpenChange={setModelSelectorOpen}
						models={models}
						groupedModels={groupedModels}
						modelId={modelId}
						selectedModelName={selectedModelName}
						favoriteIds={favoriteIds}
						warming={warming}
						onPickModel={pickModel}
						onToggleFavorite={toggleFavorite}
						effortOptionsInDisplayOrder={effortOptionsInDisplayOrder}
						reasoningEffort={reasoningEffort}
						onReasoningEffortChange={setReasoningEffort}
						formatEffort={formatEffort}
						activeUsage={activeUsage}
						fastAvailable={fastAvailable}
						fastEnabled={fastEnabled}
						onFastEnabledToggle={() => setFastEnabled((current) => !current)}
						onCancelRun={() => void cancelCurrentRun()}
						onSendSuggestion={sendSuggestion}
					/>
				</div>
			</div>

			<AgentPermissionDialog
				permissionRequest={permissionRequest}
				onDismiss={() => setPermissionRequest(null)}
			/>
		</section>
	);
});
