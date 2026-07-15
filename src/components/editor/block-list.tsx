"use client";

import { isOrderedList } from "@platejs/list";
import {
	useTodoListElement,
	useTodoListElementState,
} from "@platejs/list/react";
import type { TListElement } from "platejs";
import {
	type PlateElementProps,
	type RenderNodeWrapper,
	useReadOnly,
} from "platejs/react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

type ListProps = PlateElementProps & { lineBreakBadge?: React.ReactNode };

export const BlockList: RenderNodeWrapper = (props) => {
	if (!props.element.listStyleType) return;

	return (childProps: ListProps) => <List {...childProps} />;
};

function List(props: ListProps) {
	const { listStart, listStyleType } = props.element as TListElement;
	const isTodo = listStyleType === "todo";
	const Tag = isOrderedList(props.element) ? "ol" : "ul";

	return (
		<Tag
			className="relative m-0 p-0"
			style={{ listStyleType: isTodo ? "none" : listStyleType }}
			start={listStart}
		>
			{isTodo ? (
				<TodoLi {...props} />
			) : (
				<li>
					{props.children}
					{props.lineBreakBadge}
				</li>
			)}
		</Tag>
	);
}

function TodoLi(props: ListProps) {
	const state = useTodoListElementState({ element: props.element });
	const { checkboxProps } = useTodoListElement(state);
	const readOnly = useReadOnly();

	return (
		<li
			className={cn(
				"list-none",
				Boolean(props.element.checked) && "text-muted-foreground line-through",
			)}
		>
			<div contentEditable={false}>
				<Checkbox
					className={cn(
						"-left-6 absolute top-1",
						readOnly && "pointer-events-none",
					)}
					{...checkboxProps}
				/>
			</div>
			{props.children}
			{props.lineBreakBadge}
		</li>
	);
}
