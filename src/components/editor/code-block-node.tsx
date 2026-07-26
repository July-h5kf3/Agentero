"use client";

import { common } from "lowlight";
import { CheckIcon, CopyIcon } from "lucide-react";
import { NodeApi, type TCodeBlockElement, type TCodeSyntaxLeaf } from "platejs";
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
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { copyTextToClipboard } from "@/lib/core/clipboard";
import { cn } from "@/lib/core/utils";

// Languages actually registered with lowlight, kept in sync by sourcing the
// same `common` bundle the plugin uses (markdown-editor-kit.tsx). `plaintext`
// is part of `common` and serves as the default "no highlighting" entry.
const LANGUAGES = Object.keys(common).sort();

/**
 * Languages that mean "no highlighting". Selecting one clears the persisted
 * `lang` (writes `undefined`) so the block serializes as a bare fenced block
 * rather than ```` ```plaintext ````, while still matching the "plain" intent.
 * lowlight treats both undefined and "plaintext" as a no-op (no decorations).
 */
const PLAIN_LANGS = new Set(["plaintext", "plain"]);

function CodeLanguageSelect() {
	const { t } = useTranslation("editor");
	const editor = useEditorRef();
	const readOnly = useReadOnly();
	const element = useElement<TCodeBlockElement>();
	const [open, setOpen] = React.useState(false);

	// Read-only / preview views don't expose the language picker; highlighting
	// still renders from the persisted `lang` attribute.
	if (readOnly) return null;

	// `lang: undefined` (no highlighting) is represented in the picker by the
	// `plaintext` option.
	const current = element.lang ?? "";
	const value = current ? current : "plaintext";
	const label = current ? current : t("codeBlock.plainText");

	const onSelect = (next: string) => {
		// Plain variants clear `lang` so the block serializes without a fence lang.
		const lang = PLAIN_LANGS.has(next) ? undefined : next;
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
							"flex h-6 items-center rounded-md bg-background/80 px-1.5 font-mono text-xs text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100",
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

function CopyCodeButton({ element }: { element: TCodeBlockElement }) {
	const { t } = useTranslation("editor");
	const [copied, setCopied] = React.useState(false);
	const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

	React.useEffect(
		() => () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		},
		[],
	);

	const onCopy = async () => {
		// NodeApi.string recurses every descendant text of the code_block, joining
		// code_line children with newlines — the raw code without markers/markup.
		const text = NodeApi.string(element);
		const ok = await copyTextToClipboard(text, {
			errorMessage: t("codeBlock.copyFailed"),
		});
		if (!ok) return;
		setCopied(true);
		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => setCopied(false), 1500);
	};

	return (
		<div contentEditable={false} className="absolute top-1.5 right-1.5 z-10">
			<TooltipProvider delayDuration={300}>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							type="button"
							aria-label={t("codeBlock.copy")}
							onClick={onCopy}
							className={cn(
								"flex size-6 items-center justify-center rounded-md bg-background/80 text-muted-foreground opacity-0 backdrop-blur transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none group-focus-within:opacity-100 group-hover:opacity-100",
							)}
						>
							{copied ? (
								<CheckIcon className="size-3.5 text-green-600 dark:text-green-500" />
							) : (
								<CopyIcon className="size-3.5" />
							)}
						</button>
					</TooltipTrigger>
					<TooltipContent>{t("codeBlock.copy")}</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		</div>
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
				<CopyCodeButton element={props.element} />
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
