"use client";

import {
	Calendar,
	Check,
	CheckSquare,
	ChevronRight,
	Code2,
	List,
	ListTree,
	Plus,
	Trash2,
	Type,
	X,
} from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useId,
	useMemo,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/core/utils";
import {
	convertPropertyKind,
	countFrontmatterProperties,
	createEmptyProperty,
	type FrontmatterProperty,
	type FrontmatterPropertyKind,
	parseFrontmatterProperties,
	serializeFrontmatterProperties,
} from "@/lib/markdown/frontmatter";

/** YAML list items conventionally indent with two spaces. */
const YAML_INDENT = "  ";

export type FrontmatterPanelProps = {
	/** YAML interior only (no `---` fences). */
	value: string;
	readOnly?: boolean;
	onChange?: (interior: string) => void;
	className?: string;
};

type EditorMode = "form" | "source";

type PropertyRowState = FrontmatterProperty & { id: string };

function rowsFromProperties(
	properties: FrontmatterProperty[],
): PropertyRowState[] {
	return properties.map((property) => ({
		...property,
		id: crypto.randomUUID(),
	}));
}

function stripRowIds(rows: PropertyRowState[]): FrontmatterProperty[] {
	return rows.map(({ id: _id, ...property }) => property);
}

/**
 * Collapsible Properties strip above the Markdown body.
 * Form mode edits simple scalars / lists; Source mode is raw YAML.
 * Frontmatter stays outside the Plate AST and is re-attached on save.
 */
export function FrontmatterPanel({
	value,
	readOnly = false,
	onChange,
	className,
}: FrontmatterPanelProps) {
	const { t } = useTranslation("editor");
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<EditorMode>("form");
	const panelId = useId();
	const parsed = useMemo(() => parseFrontmatterProperties(value), [value]);
	const propertyCount = countFrontmatterProperties(value);
	const hasContent = value.trim().length > 0;
	const formAvailable = parsed.ok;
	const showSource = mode === "source" || !formAvailable;

	// Local form rows (keep empty-key drafts that are not yet serializable).
	const [rows, setRows] = useState<PropertyRowState[]>(() =>
		parsed.ok ? rowsFromProperties(parsed.properties) : [],
	);

	// When YAML becomes unparseable, fall back to source automatically.
	useEffect(() => {
		if (!parsed.ok) setMode("source");
	}, [parsed.ok]);

	// Sync form rows from the controlled value when it changes externally
	// (or after a clean serialize), but not while a blank key draft is open.
	useEffect(() => {
		if (!parsed.ok) return;
		setRows((prev) => {
			if (prev.some((row) => !row.key.trim())) return prev;
			const current = serializeFrontmatterProperties(stripRowIds(prev));
			if (current === value) return prev;
			return rowsFromProperties(parsed.properties);
		});
	}, [value, parsed]);

	const commitRows = (next: PropertyRowState[]) => {
		if (readOnly) return;
		setRows(next);
		// Drop rows without a key so disk/YAML stays valid; blank drafts stay local.
		onChange?.(
			serializeFrontmatterProperties(
				stripRowIds(next).filter((property) => property.key.trim()),
			),
		);
	};

	const updateProperty = (index: number, next: FrontmatterProperty) => {
		commitRows(
			rows.map((row, i) => (i === index ? { ...next, id: row.id } : row)),
		);
	};

	const removeProperty = (index: number) => {
		commitRows(rows.filter((_, i) => i !== index));
	};

	const addProperty = () => {
		// Default to text (scalar); user can switch to list via the type icon.
		commitRows([
			...rows,
			{ ...createEmptyProperty("", "scalar"), id: crypto.randomUUID() },
		]);
	};

	const handleYamlKeyDown = (
		event: ReactKeyboardEvent<HTMLTextAreaElement>,
	) => {
		if (readOnly || event.key !== "Tab") return;
		event.preventDefault();
		event.stopPropagation();
		const el = event.currentTarget;
		const start = el.selectionStart;
		const end = el.selectionEnd;
		if (event.shiftKey) {
			const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
			const strip = value.startsWith(YAML_INDENT, lineStart)
				? YAML_INDENT.length
				: value.startsWith("\t", lineStart)
					? 1
					: 0;
			if (strip === 0) return;
			const next = value.slice(0, lineStart) + value.slice(lineStart + strip);
			onChange?.(next);
			requestAnimationFrame(() => {
				el.selectionStart = Math.max(lineStart, start - strip);
				el.selectionEnd = Math.max(lineStart, end - strip);
			});
			return;
		}
		const next = `${value.slice(0, start)}${YAML_INDENT}${value.slice(end)}`;
		onChange?.(next);
		const cursor = start + YAML_INDENT.length;
		requestAnimationFrame(() => {
			el.selectionStart = cursor;
			el.selectionEnd = cursor;
		});
	};

	return (
		<Collapsible
			open={open}
			onOpenChange={setOpen}
			className={cn(
				"shrink-0 border-border/60 border-b bg-muted/20",
				className,
			)}
		>
			<div className="flex h-8 min-w-0 items-center">
				<CollapsibleTrigger
					className={cn(
						"flex h-8 min-w-0 flex-1 items-center gap-1.5 px-3 text-left outline-none",
						"text-muted-foreground text-xs font-medium tracking-wide",
						"hover:bg-muted/40 hover:text-foreground",
						"focus-visible:ring-1 focus-visible:ring-ring",
					)}
					aria-controls={panelId}
				>
					<ChevronRight
						className={cn(
							"size-3.5 shrink-0 transition-transform",
							open && "rotate-90",
						)}
						aria-hidden
					/>
					<ListTree className="size-3.5 shrink-0" aria-hidden />
					<span className="truncate">{t("frontmatter.title")}</span>
					{propertyCount > 0 ? (
						<span className="ml-1 shrink-0 tabular-nums text-[11px] text-muted-foreground/80">
							{propertyCount}
						</span>
					) : !hasContent ? (
						<span className="ml-1 shrink-0 text-[11px] text-muted-foreground/70">
							{t("frontmatter.emptyBadge")}
						</span>
					) : null}
				</CollapsibleTrigger>
				{open ? (
					<TooltipProvider delayDuration={300}>
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									className={cn(
										"mr-2 inline-flex size-7 shrink-0 items-center justify-center rounded-md outline-none",
										"text-muted-foreground hover:bg-muted hover:text-foreground",
										"focus-visible:ring-1 focus-visible:ring-ring",
										showSource && formAvailable && "bg-muted text-foreground",
									)}
									aria-pressed={showSource}
									aria-label={
										showSource
											? t("frontmatter.formMode")
											: t("frontmatter.sourceMode")
									}
									disabled={!formAvailable && showSource}
									onClick={(event) => {
										event.preventDefault();
										if (!formAvailable) return;
										setMode((current) => {
											if (current === "source") {
												// Reload structured rows from the latest YAML.
												if (parsed.ok) {
													setRows(rowsFromProperties(parsed.properties));
												}
												return "form";
											}
											return "source";
										});
									}}
								>
									<Code2 className="size-3.5" aria-hidden />
								</button>
							</TooltipTrigger>
							<TooltipContent side="bottom">
								{showSource
									? formAvailable
										? t("frontmatter.formMode")
										: t("frontmatter.sourceOnly")
									: t("frontmatter.sourceMode")}
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				) : null}
			</div>
			<CollapsibleContent id={panelId}>
				<div className="border-border/50 border-t px-3 pt-2 pb-3">
					{showSource ? (
						<>
							{!formAvailable && hasContent ? (
								<p className="mb-1.5 text-[11px] text-muted-foreground leading-snug">
									{t("frontmatter.parseFallback")}
								</p>
							) : null}
							<label className="sr-only" htmlFor={`${panelId}-yaml`}>
								{t("frontmatter.yamlLabel")}
							</label>
							<textarea
								id={`${panelId}-yaml`}
								value={value}
								readOnly={readOnly}
								spellCheck={false}
								placeholder={t("frontmatter.placeholder")}
								rows={Math.min(12, Math.max(4, value.split("\n").length + 1))}
								className={cn(
									"agentero-scroll w-full min-h-[5.5rem] resize-y rounded-md border border-input",
									"bg-background px-2.5 py-2 font-mono text-[12px] leading-relaxed text-foreground",
									"outline-none placeholder:text-muted-foreground/70",
									"focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
									readOnly && "cursor-default opacity-90",
								)}
								onChange={(event) => {
									if (readOnly) return;
									onChange?.(event.target.value);
								}}
								onKeyDown={handleYamlKeyDown}
							/>
						</>
					) : (
						<div className="flex flex-col gap-1.5">
							{rows.length === 0 ? (
								<p className="py-1 text-[11px] text-muted-foreground leading-snug">
									{t("frontmatter.emptyForm")}
								</p>
							) : null}
							{rows.map((property, index) => (
								<PropertyRow
									key={property.id}
									property={property}
									readOnly={readOnly}
									onChange={(next) => updateProperty(index, next)}
									onRemove={() => removeProperty(index)}
								/>
							))}
							{!readOnly ? (
								<button
									type="button"
									className={cn(
										"mt-0.5 inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] outline-none",
										"text-muted-foreground hover:bg-muted hover:text-foreground",
										"focus-visible:ring-1 focus-visible:ring-ring",
									)}
									onClick={addProperty}
								>
									<Plus className="size-3" aria-hidden />
									{t("frontmatter.addProperty")}
								</button>
							) : null}
						</div>
					)}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

const PROPERTY_TYPES: Array<{
	kind: FrontmatterPropertyKind;
	icon: typeof Type;
	labelKey:
		| "frontmatter.typeText"
		| "frontmatter.typeList"
		| "frontmatter.typeCheckbox"
		| "frontmatter.typeDate";
}> = [
	{ kind: "scalar", icon: Type, labelKey: "frontmatter.typeText" },
	{ kind: "list", icon: List, labelKey: "frontmatter.typeList" },
	{ kind: "checkbox", icon: CheckSquare, labelKey: "frontmatter.typeCheckbox" },
	{ kind: "date", icon: Calendar, labelKey: "frontmatter.typeDate" },
];

function propertyTypeIcon(kind: FrontmatterPropertyKind) {
	return PROPERTY_TYPES.find((item) => item.kind === kind)?.icon ?? Type;
}

function PropertyRow({
	property,
	readOnly,
	onChange,
	onRemove,
}: {
	property: FrontmatterProperty;
	readOnly: boolean;
	onChange: (next: FrontmatterProperty) => void;
	onRemove: () => void;
}) {
	const { t } = useTranslation("editor");
	const [draftItem, setDraftItem] = useState("");
	const TypeIcon = propertyTypeIcon(property.kind);

	const commitDraftItem = () => {
		const text = draftItem.trim();
		if (!text || readOnly) return;
		if (property.items.some((item) => item === text)) {
			setDraftItem("");
			return;
		}
		onChange({
			...property,
			kind: "list",
			items: [...property.items, text],
		});
		setDraftItem("");
	};

	return (
		<div className="group flex min-w-0 items-start gap-1">
			{readOnly ? (
				<span
					className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center text-muted-foreground"
					aria-hidden
				>
					<TypeIcon className="size-3.5" />
				</span>
			) : (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							className={cn(
								"mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md outline-none",
								"text-muted-foreground hover:bg-muted hover:text-foreground",
								"focus-visible:ring-1 focus-visible:ring-ring",
							)}
							aria-label={t("frontmatter.propertyType")}
							title={t("frontmatter.propertyType")}
						>
							<TypeIcon className="size-3.5" aria-hidden />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="min-w-[9.5rem]">
						{PROPERTY_TYPES.map((item) => {
							const Icon = item.icon;
							return (
								<DropdownMenuItem
									key={item.kind}
									onSelect={() =>
										onChange(convertPropertyKind(property, item.kind))
									}
								>
									<Icon className="size-3.5" aria-hidden />
									<span className="flex-1">{t(item.labelKey)}</span>
									{property.kind === item.kind ? (
										<Check className="size-3.5 opacity-80" aria-hidden />
									) : null}
								</DropdownMenuItem>
							);
						})}
					</DropdownMenuContent>
				</DropdownMenu>
			)}
			<input
				value={property.key}
				readOnly={readOnly}
				spellCheck={false}
				placeholder={t("frontmatter.keyPlaceholder")}
				aria-label={t("frontmatter.keyPlaceholder")}
				className={cn(
					"h-7 w-[6.5rem] shrink-0 rounded-md border border-transparent bg-transparent px-1.5",
					"font-mono text-[11px] text-muted-foreground outline-none",
					"hover:border-border focus-visible:border-ring focus-visible:bg-background",
					readOnly && "cursor-default",
				)}
				onChange={(event) => {
					onChange({
						...property,
						key: event.target.value,
					});
				}}
			/>
			<div className="min-w-0 flex-1">
				{property.kind === "list" ? (
					<div
						className={cn(
							"flex min-h-7 min-w-0 flex-wrap items-center gap-1 rounded-md border border-transparent px-1 py-0.5",
							"hover:border-border focus-within:border-ring focus-within:bg-background",
						)}
					>
						{property.items.map((item) => (
							<span
								key={item}
								className="inline-flex max-w-full items-center gap-0.5 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-foreground"
							>
								<span className="truncate" title={item}>
									{item}
								</span>
								{!readOnly ? (
									<button
										type="button"
										className="shrink-0 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
										aria-label={t("frontmatter.removeItem", { item })}
										onClick={() =>
											onChange({
												...property,
												items: property.items.filter((entry) => entry !== item),
											})
										}
									>
										<X className="size-3" aria-hidden />
									</button>
								) : null}
							</span>
						))}
						{!readOnly ? (
							<input
								value={draftItem}
								spellCheck={false}
								placeholder={t("frontmatter.itemPlaceholder")}
								aria-label={t("frontmatter.itemPlaceholder")}
								className="h-6 min-w-[7rem] flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/70"
								onChange={(event) => setDraftItem(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										commitDraftItem();
									}
									if (
										event.key === "Backspace" &&
										!draftItem &&
										property.items.length
									) {
										onChange({
											...property,
											items: property.items.slice(0, -1),
										});
									}
								}}
								onBlur={commitDraftItem}
							/>
						) : null}
					</div>
				) : property.kind === "checkbox" ? (
					<div className="flex h-7 items-center px-1">
						<Switch
							size="sm"
							checked={property.value === "true"}
							disabled={readOnly}
							aria-label={t("frontmatter.typeCheckbox")}
							onCheckedChange={(checked) =>
								onChange({
									...property,
									kind: "checkbox",
									value: checked ? "true" : "false",
									items: [],
								})
							}
						/>
					</div>
				) : property.kind === "date" ? (
					<input
						type="date"
						value={property.value}
						readOnly={readOnly}
						aria-label={t("frontmatter.typeDate")}
						className={cn(
							"h-7 w-full min-w-0 rounded-md border border-transparent bg-transparent px-1.5",
							"text-[11px] text-foreground outline-none",
							"hover:border-border focus-visible:border-ring focus-visible:bg-background",
							readOnly && "cursor-default",
							// Native date control is dark-mode awkward; keep compact.
							"[color-scheme:light] dark:[color-scheme:dark]",
						)}
						onChange={(event) =>
							onChange({
								...property,
								kind: "date",
								value: event.target.value,
								items: [],
							})
						}
					/>
				) : (
					<input
						value={property.value}
						readOnly={readOnly}
						spellCheck={false}
						placeholder={t("frontmatter.valuePlaceholder")}
						aria-label={t("frontmatter.valuePlaceholder")}
						className={cn(
							"h-7 w-full rounded-md border border-transparent bg-transparent px-1.5",
							"text-[11px] text-foreground outline-none",
							"hover:border-border focus-visible:border-ring focus-visible:bg-background",
							readOnly && "cursor-default",
						)}
						onChange={(event) =>
							onChange({ ...property, value: event.target.value })
						}
					/>
				)}
			</div>
			{!readOnly ? (
				<button
					type="button"
					className={cn(
						"mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md outline-none",
						"text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground",
						"group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring",
					)}
					aria-label={t("frontmatter.removeProperty")}
					onClick={onRemove}
				>
					<Trash2 className="size-3.5" aria-hidden />
				</button>
			) : null}
		</div>
	);
}
