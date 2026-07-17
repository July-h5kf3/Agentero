import { memo } from "react";

import { MarkdownEditor } from "@/components/editor/markdown-editor";
import type { DocTab } from "@/lib/tabs";

type NotesEditorTabProps = {
	tab: DocTab;
	/** Whether this tab is the active one (drives visibility). */
	active: boolean;
	fontSize: number;
	showToolbar: boolean;
	placeholder: string;
	onPersist: (path: string, md: string) => void;
	onAssetsChanged: () => void;
	onDirty: (id: string, dirty: boolean) => void;
};

/**
 * One always-mounted `NOTES.md` editor for a paper tab. Memoized so switching
 * tabs only re-renders the two tabs whose `active` flag actually changed,
 * instead of reconciling every mounted notes editor on each switch.
 */
export const NotesEditorTab = memo(function NotesEditorTab({
	tab,
	active,
	fontSize,
	showToolbar,
	placeholder,
	onPersist,
	onAssetsChanged,
	onDirty,
}: NotesEditorTabProps) {
	return (
		<div hidden={!active} className="absolute inset-0">
			<MarkdownEditor
				key={`notes-${tab.id}-${tab.notesKey}`}
				className="agentero-scroll h-full min-h-0"
				initialMarkdown={tab.notesSeed}
				filePath={tab.notesPath}
				fontSize={fontSize}
				showToolbar={showToolbar}
				placeholder={placeholder}
				onPersist={onPersist}
				onAssetsChanged={onAssetsChanged}
				onDirtyChange={(d) => onDirty(tab.id, d)}
			/>
		</div>
	);
});
