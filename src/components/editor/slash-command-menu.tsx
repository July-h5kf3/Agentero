"use client";

import {
	Code2,
	ExternalLink,
	Heading1,
	Heading2,
	Heading3,
	Link2,
	List,
	ListOrdered,
	ListTodo,
	type LucideIcon,
	MessageSquareWarning,
	Quote,
} from "lucide-react";
import { useEditorRef } from "platejs/react";
import type {
	MutableRefObject,
	KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
	executeSlashCommand,
	filterSlashCommands,
	type SlashCommand,
	type SlashCommandId,
} from "@/components/editor/plugins/slash-command";

export type SlashCommandDraft = {
	query: string;
	path: number[];
	start: number;
	end: number;
	left: number;
	top: number;
	allowCallout: boolean;
};

export type SlashCommandController = {
	handleKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => boolean;
};

type SlashCommandMenuProps = {
	draft: SlashCommandDraft | null;
	onClose: () => void;
	controllerRef: MutableRefObject<SlashCommandController | null>;
};

const COMMAND_ICONS: Record<SlashCommandId, LucideIcon> = {
	heading1: Heading1,
	heading2: Heading2,
	heading3: Heading3,
	bulletedList: List,
	numberedList: ListOrdered,
	todoList: ListTodo,
	quote: Quote,
	codeBlock: Code2,
	internalLink: Link2,
	externalLink: ExternalLink,
	callout: MessageSquareWarning,
};

export function SlashCommandMenu({
	draft,
	onClose,
	controllerRef,
}: SlashCommandMenuProps) {
	const { t } = useTranslation("editor");
	const editor = useEditorRef();
	const [selectedIndex, setSelectedIndex] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);
	const commands = useMemo(
		() =>
			draft
				? filterSlashCommands(draft.query, (command) => t(command.labelKey), {
						allowCallout: draft.allowCallout,
					})
				: [],
		[draft, t],
	);

	useEffect(() => {
		if (!draft) return;
		setSelectedIndex(0);
	}, [draft]);

	useEffect(() => {
		if (!commands[selectedIndex]) return;
		listRef.current
			?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')
			?.scrollIntoView({ block: "nearest" });
	}, [commands, selectedIndex]);

	const selectCommand = useCallback(
		(command: SlashCommand) => {
			if (!draft) return false;
			const handled = executeSlashCommand(editor, command.id, {
				query: draft.query,
				path: draft.path,
				start: draft.start,
				end: draft.end,
			});
			if (!handled) return false;
			onClose();
			window.requestAnimationFrame(() => editor.tf.focus());
			return true;
		},
		[draft, editor, onClose],
	);

	const handleKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>) => {
			if (!draft) return false;
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
				return true;
			}
			if (event.key === "ArrowDown" && commands.length) {
				event.preventDefault();
				setSelectedIndex((index) => (index + 1) % commands.length);
				return true;
			}
			if (event.key === "ArrowUp" && commands.length) {
				event.preventDefault();
				setSelectedIndex(
					(index) => (index - 1 + commands.length) % commands.length,
				);
				return true;
			}
			if (event.key === "Enter" && commands[selectedIndex]) {
				if (selectCommand(commands[selectedIndex])) {
					event.preventDefault();
					return true;
				}
			}
			return false;
		},
		[commands, draft, onClose, selectCommand, selectedIndex],
	);

	useLayoutEffect(() => {
		controllerRef.current = { handleKeyDown };
		return () => {
			controllerRef.current = null;
		};
	}, [controllerRef, handleKeyDown]);

	if (!draft) return null;
	return (
		<div
			className="absolute z-50 w-64 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
			style={{ left: draft.left, top: draft.top }}
		>
			<div
				ref={listRef}
				className="max-h-64 overflow-y-auto p-1"
				role="listbox"
				aria-label={t("slashCommand.label")}
			>
				{commands.length ? (
					commands.map((command, index) => {
						const Icon = COMMAND_ICONS[command.id];
						return (
							<button
								key={command.id}
								type="button"
								role="option"
								aria-selected={index === selectedIndex}
								className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm outline-none ${
									index === selectedIndex
										? "bg-accent text-accent-foreground"
										: "hover:bg-accent/60"
								}`}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => selectCommand(command)}
							>
								<Icon
									className="size-4 shrink-0 text-muted-foreground"
									aria-hidden
								/>
								<span className="truncate">{t(command.labelKey)}</span>
							</button>
						);
					})
				) : (
					<p className="px-2 py-1.5 text-muted-foreground text-xs">
						{t("slashCommand.empty")}
					</p>
				)}
			</div>
		</div>
	);
}
