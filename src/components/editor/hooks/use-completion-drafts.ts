"use client";

import { KEYS, RangeApi } from "platejs";
import type { PlateEditor } from "platejs/react";
import {
	type Dispatch,
	type KeyboardEvent,
	type RefObject,
	type SetStateAction,
	useCallback,
	useRef,
	useState,
} from "react";
import type {
	SlashCommandController,
	SlashCommandDraft,
} from "@/components/editor/overlays/slash-command-menu";
import type {
	WikiCompletionController,
	WikiCompletionDraft,
} from "@/components/editor/overlays/wiki-link-suggestion";
import { editorCompletionHasFocus } from "@/lib/markdown/completion-focus";
import { findSlashCommandTrigger } from "@/lib/markdown/slash-command";
import { findWikiCompletionTrigger } from "@/lib/wiki-completion";

type CursorProbe = {
	/** Text of the leaf holding the collapsed caret. */
	text: string;
	offset: number;
	anchorPath: number[];
	cursorRect: DOMRect;
};

/**
 * A trigger is only live when the caret is collapsed inside an editable text
 * leaf that the editor still owns, and outside the DOM regions named by
 * `excludeSelector` — otherwise code samples would turn into links/commands.
 */
function probeCursor(
	editor: PlateEditor,
	container: HTMLElement | null,
	excludeSelector: string,
): CursorProbe | null {
	if (
		!container ||
		!editorCompletionHasFocus(container, document.activeElement)
	) {
		return null;
	}
	const slateSelection = editor.selection;
	if (!slateSelection || !RangeApi.isCollapsed(slateSelection)) return null;

	const leaf = editor.api.node(slateSelection.anchor.path)?.[0];
	if (!leaf || typeof (leaf as { text?: unknown }).text !== "string") {
		return null;
	}

	const nativeSelection = window.getSelection();
	const anchor = nativeSelection?.anchorNode;
	if (!nativeSelection?.isCollapsed || !anchor) return null;

	const anchorElement =
		anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : null;
	if (
		!anchorElement ||
		!container.contains(anchorElement) ||
		anchorElement.closest(excludeSelector)
	) {
		return null;
	}
	if (!nativeSelection.rangeCount) return null;

	return {
		text: (leaf as { text: string }).text,
		offset: slateSelection.anchor.offset,
		anchorPath: [...slateSelection.anchor.path],
		cursorRect: nativeSelection.getRangeAt(0).getBoundingClientRect(),
	};
}

export type CompletionDrafts = {
	wikiCompletionDraft: WikiCompletionDraft | null;
	slashCommandDraft: SlashCommandDraft | null;
	setWikiCompletionDraft: Dispatch<SetStateAction<WikiCompletionDraft | null>>;
	setSlashCommandDraft: Dispatch<SetStateAction<SlashCommandDraft | null>>;
	/** Dismiss both menus (Escape, blur). */
	closeMenus: () => void;
	completionControllerRef: RefObject<WikiCompletionController | null>;
	slashCommandControllerRef: RefObject<SlashCommandController | null>;
	/** Re-probe for a live `[[` and re-anchor its menu. */
	updateWikiCompletionDraft: () => void;
	/** Re-probe for a live `/` and re-anchor its menu. */
	updateSlashCommandDraft: () => void;
	/** True when an open menu consumed the key; the editor must not see it. */
	handleMenuKeyDown: (event: KeyboardEvent<HTMLDivElement>) => boolean;
};

/**
 * The `[[wikilink]]` and `/slash` completion menus: where they anchor, and
 * which keys they own while open.
 *
 * Both menus are editor-side probes rather than full Plate plugins — the
 * suggestion components own their Host queries; this only finds the trigger.
 */
export function useCompletionDrafts({
	editor,
	editorContainerRef,
}: {
	editor: PlateEditor;
	editorContainerRef: RefObject<HTMLDivElement | null>;
}): CompletionDrafts {
	const [wikiCompletionDraft, setWikiCompletionDraft] =
		useState<WikiCompletionDraft | null>(null);
	const [slashCommandDraft, setSlashCommandDraft] =
		useState<SlashCommandDraft | null>(null);
	const wikiCompletionDraftRef = useRef(wikiCompletionDraft);
	wikiCompletionDraftRef.current = wikiCompletionDraft;
	const slashCommandDraftRef = useRef(slashCommandDraft);
	slashCommandDraftRef.current = slashCommandDraft;
	const completionControllerRef = useRef<WikiCompletionController | null>(null);
	const slashCommandControllerRef = useRef<SlashCommandController | null>(null);

	const updateWikiCompletionDraft = useCallback(() => {
		const probe = probeCursor(editor, editorContainerRef.current, "code, pre");
		const trigger =
			probe && findWikiCompletionTrigger(probe.text, probe.offset);
		if (!probe || !trigger) {
			setWikiCompletionDraft(null);
			return;
		}
		setWikiCompletionDraft({
			raw: trigger.raw,
			embed: trigger.embed,
			left: probe.cursorRect.left,
			top: probe.cursorRect.bottom + 4,
		});
	}, [editor, editorContainerRef]);

	const updateSlashCommandDraft = useCallback(() => {
		const probe = probeCursor(
			editor,
			editorContainerRef.current,
			"code, pre, [data-slate-void='true']",
		);
		const trigger = probe && findSlashCommandTrigger(probe.text, probe.offset);
		const block = trigger ? editor.api.block() : null;
		if (!probe || !trigger || !block) {
			setSlashCommandDraft(null);
			return;
		}
		const insideCallout = Boolean(
			editor.api.above({ match: { type: editor.getType(KEYS.callout) } }),
		);
		setSlashCommandDraft({
			query: trigger.query,
			path: probe.anchorPath,
			start: trigger.start,
			end: trigger.end,
			left: probe.cursorRect.left,
			top: probe.cursorRect.bottom + 4,
			allowCallout: block[1].length === 1 && !insideCallout,
		});
	}, [editor, editorContainerRef]);

	const handleMenuKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			if (completionControllerRef.current?.handleKeyDown(event)) return true;
			if (slashCommandControllerRef.current?.handleKeyDown(event)) return true;
			// If a menu is open but its controller is mid-remount, still swallow
			// vertical arrows so the caret cannot leave `[[` / `/`.
			if (
				(event.key === "ArrowUp" || event.key === "ArrowDown") &&
				(wikiCompletionDraftRef.current || slashCommandDraftRef.current)
			) {
				event.preventDefault();
				return true;
			}
			return false;
		},
		[],
	);

	const closeMenus = useCallback(() => {
		setWikiCompletionDraft(null);
		setSlashCommandDraft(null);
	}, []);

	return {
		wikiCompletionDraft,
		slashCommandDraft,
		setWikiCompletionDraft,
		setSlashCommandDraft,
		closeMenus,
		completionControllerRef,
		slashCommandControllerRef,
		updateWikiCompletionDraft,
		updateSlashCommandDraft,
		handleMenuKeyDown,
	};
}
