"use client";

import { ListStyleType } from "@platejs/list";
import {
	useIndentTodoToolBarButton,
	useIndentTodoToolBarButtonState,
	useListToolbarButton,
	useListToolbarButtonState,
} from "@platejs/list/react";
import {
	Bold,
	Code,
	Heading1,
	Heading2,
	Heading3,
	Highlighter,
	Italic,
	List,
	ListOrdered,
	ListTodo,
	type LucideIcon,
	Quote,
	Strikethrough,
	Underline,
} from "lucide-react";
import { KEYS } from "platejs";
import { useEditorRef, useSelectionFragmentProp } from "platejs/react";
import { useTranslation } from "react-i18next";

import { FixedToolbar } from "./fixed-toolbar";
import { MarkToolbarButton } from "./mark-toolbar-button";
import { ToolbarButton, ToolbarGroup } from "./toolbar";

/** Toggle the current block between `type` and paragraph. */
function BlockTypeButton({
	blockType,
	type,
	icon: Icon,
	label,
}: {
	blockType: string | undefined;
	type: string;
	icon: LucideIcon;
	label: string;
}) {
	const editor = useEditorRef();
	return (
		<ToolbarButton
			pressed={blockType === type}
			tooltip={label}
			aria-label={label}
			onClick={() => editor.tf.toggleBlock(type)}
		>
			<Icon />
		</ToolbarButton>
	);
}

/** Bulleted / numbered list toggle (indent-based `@platejs/list`). */
function ListToolbarButton({
	nodeType,
	icon: Icon,
	label,
}: {
	nodeType: string;
	icon: LucideIcon;
	label: string;
}) {
	const state = useListToolbarButtonState({ nodeType });
	const { props } = useListToolbarButton(state);
	return (
		<ToolbarButton tooltip={label} aria-label={label} {...props}>
			<Icon />
		</ToolbarButton>
	);
}

/** To-do (checkbox) list toggle. */
function TodoListToolbarButton({
	icon: Icon,
	label,
}: {
	icon: LucideIcon;
	label: string;
}) {
	const state = useIndentTodoToolBarButtonState({ nodeType: KEYS.listTodo });
	const { props } = useIndentTodoToolBarButton(state);
	return (
		<ToolbarButton tooltip={label} aria-label={label} {...props}>
			<Icon />
		</ToolbarButton>
	);
}

/**
 * WYSIWYG formatting toolbar for the Markdown/notes editor. Must be rendered
 * inside a `<Plate>` provider (it reads editor state via Plate hooks).
 */
export function MarkdownEditorToolbar() {
	const { t } = useTranslation("editor");
	const blockType = useSelectionFragmentProp({
		defaultValue: KEYS.p,
		getProp: (node) => node.type,
	});

	return (
		<FixedToolbar className="justify-start rounded-none">
			<ToolbarGroup>
				<BlockTypeButton
					blockType={blockType}
					type={KEYS.h1}
					icon={Heading1}
					label={t("toolbar.h1")}
				/>
				<BlockTypeButton
					blockType={blockType}
					type={KEYS.h2}
					icon={Heading2}
					label={t("toolbar.h2")}
				/>
				<BlockTypeButton
					blockType={blockType}
					type={KEYS.h3}
					icon={Heading3}
					label={t("toolbar.h3")}
				/>
				<BlockTypeButton
					blockType={blockType}
					type={KEYS.blockquote}
					icon={Quote}
					label={t("toolbar.quote")}
				/>
			</ToolbarGroup>

			<ToolbarGroup>
				<MarkToolbarButton
					nodeType={KEYS.bold}
					tooltip={t("toolbar.bold")}
					aria-label={t("toolbar.bold")}
				>
					<Bold />
				</MarkToolbarButton>
				<MarkToolbarButton
					nodeType={KEYS.italic}
					tooltip={t("toolbar.italic")}
					aria-label={t("toolbar.italic")}
				>
					<Italic />
				</MarkToolbarButton>
				<MarkToolbarButton
					nodeType={KEYS.underline}
					tooltip={t("toolbar.underline")}
					aria-label={t("toolbar.underline")}
				>
					<Underline />
				</MarkToolbarButton>
				<MarkToolbarButton
					nodeType={KEYS.strikethrough}
					tooltip={t("toolbar.strikethrough")}
					aria-label={t("toolbar.strikethrough")}
				>
					<Strikethrough />
				</MarkToolbarButton>
				<MarkToolbarButton
					nodeType={KEYS.code}
					tooltip={t("toolbar.code")}
					aria-label={t("toolbar.code")}
				>
					<Code />
				</MarkToolbarButton>
				<MarkToolbarButton
					nodeType={KEYS.highlight}
					tooltip={t("toolbar.highlight")}
					aria-label={t("toolbar.highlight")}
				>
					<Highlighter />
				</MarkToolbarButton>
			</ToolbarGroup>

			<ToolbarGroup>
				<ListToolbarButton
					nodeType={ListStyleType.Disc}
					icon={List}
					label={t("toolbar.bulletedList")}
				/>
				<ListToolbarButton
					nodeType={ListStyleType.Decimal}
					icon={ListOrdered}
					label={t("toolbar.numberedList")}
				/>
				<TodoListToolbarButton icon={ListTodo} label={t("toolbar.todoList")} />
			</ToolbarGroup>
		</FixedToolbar>
	);
}
