"use client";

import { common } from "lowlight";
import type { TCodeBlockElement, TCodeSyntaxLeaf } from "platejs";
import {
	PlateElement,
	type PlateElementProps,
	PlateLeaf,
	type PlateLeafProps,
	useEditorRef,
	useElement,
	useReadOnly,
} from "platejs/react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/core/utils";

// Languages actually registered with lowlight, kept in sync by sourcing the
// same `common` bundle the plugin uses (markdown-editor-kit.tsx).
const LANGUAGES = Object.keys(common).sort();

/** Sentinel value for the "no language / plain text" option. */
const PLAIN = "__plain__";

function CodeLanguageSelect() {
	const { t } = useTranslation("editor");
	const editor = useEditorRef();
	const readOnly = useReadOnly();
	const element = useElement<TCodeBlockElement>();
	const [open, setOpen] = React.useState(false);

	// Read-only / preview views don't expose the language picker; highlighting
	// still renders from the persisted `lang` attribute.
	if (readOnly) return null;

	const current = element.lang ?? "";
	const value = current ? current : PLAIN;
	const label = current ? current : t("codeBlock.plainText");

	const onSelect = (next: string) => {
		const lang = next === PLAIN ? undefined : next;
		editor.tf.setNodes<TCodeBlockElement>({ lang }, { at: element });
		setOpen(false);
	};

	return (
		<div contentEditable={false} className="absolute top-1.5 left-1.5 z-10">
			<Popover open={open} onOpenChange={setOpen} modal={false}>
				<PopoverTrigger asChild>
					<button
						type="button"
						aria-label={t("codeBlock.languageLabel")}
						className={cn(
							"flex h-6 items-center gap-1 rounded-md bg-background/80 px-1.5 font-mono text-xs text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100",
						)}
					>
						{label}
					</button>
				</PopoverTrigger>
				<PopoverContent
					align="start"
					className="w-48 p-0"
					onOpenAutoFocus={(e) => e.preventDefault()}
				>
					<Command value={value}>
						<CommandInput placeholder={t("codeBlock.search")} />
						<CommandList className="max-h-[40vh]">
							<CommandEmpty>{t("codeBlock.noMatch")}</CommandEmpty>
							<CommandGroup>
								<LanguageItem
									value={PLAIN}
									label={t("codeBlock.plainText")}
									selected={value === PLAIN}
									onSelect={onSelect}
								/>
								{LANGUAGES.map((lang) => (
									<LanguageItem
										key={lang}
										value={lang}
										label={lang}
										selected={value === lang}
										onSelect={onSelect}
									/>
								))}
							</CommandGroup>
						</CommandList>
					</Command>
				</PopoverContent>
			</Popover>
		</div>
	);
}

function LanguageItem({
	value,
	label,
	selected,
	onSelect,
}: {
	value: string;
	label: string;
	selected: boolean;
	onSelect: (value: string) => void;
}) {
	return (
		<CommandItem
			value={value}
			onSelect={() => onSelect(value)}
			data-checked={selected ? "true" : undefined}
		>
			<span className="font-mono">{label}</span>
		</CommandItem>
	);
}

export function CodeBlockElement(props: PlateElementProps<TCodeBlockElement>) {
	return (
		// Constrain width so long lines overflow inside <pre> (scroll), not the editor.
		// Use agentero-scroll-both: agentero-scroll sets overflow-x:hidden (unlayered CSS
		// beats Tailwind overflow-x-auto). The x-only modifier lets vertical wheel
		// input continue to the document scroller. whitespace-pre overrides editor
		// break-spaces.
		<PlateElement className="max-w-full min-w-0 py-1" {...props}>
			<div className="agentero-codeblock group relative max-w-full min-w-0 overflow-hidden rounded-md bg-muted/50">
				<CodeLanguageSelect />
				<pre className="agentero-scroll-both agentero-scroll-x-only max-w-full overflow-x-auto p-4 font-mono text-sm leading-[normal] whitespace-pre [tab-size:2]">
					<code className="block w-max min-w-full">{props.children}</code>
				</pre>
			</div>
		</PlateElement>
	);
}

export function CodeLineElement(props: PlateElementProps) {
	return <PlateElement className="block whitespace-pre" {...props} />;
}

export function CodeSyntaxLeaf(props: PlateLeafProps<TCodeSyntaxLeaf>) {
	const tokenClassName = props.leaf.className as string;

	return <PlateLeaf className={tokenClassName} {...props} />;
}
