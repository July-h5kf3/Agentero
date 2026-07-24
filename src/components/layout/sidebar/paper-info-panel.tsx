import {
	BookOpen,
	Calendar,
	ChevronRight,
	ExternalLink,
	FileText,
	Info,
	Tag,
	Users,
} from "lucide-react";
import {
	type ComponentType,
	type KeyboardEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
	PaperTagChip,
	PaperTagRemoveButton,
} from "@/components/layout/workspace/library/paper-tag-chip";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import type { PaperMetadata } from "@/lib/paper-metadata";
import {
	coercePaperTags,
	normalizePaperTags,
	type PaperTag,
	TAG_COLOR_IDS,
	type TagColorId,
	tagSwatchStyle,
} from "@/lib/tag-colors";
import { cn } from "@/lib/utils";

type PaperInfoPanelProps = {
	meta: PaperMetadata | null;
	className?: string;
	/** Persist tags to catalog. Required for editing. */
	onTagsChange?: (tags: PaperTag[]) => Promise<void> | void;
};

function MetaRow({
	icon: Icon,
	label,
	children,
}: {
	icon: ComponentType<{ className?: string }>;
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex gap-2 px-3 py-1.5">
			<Icon
				className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
				aria-hidden
			/>
			<div className="min-w-0 flex-1">
				<div className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">
					{label}
				</div>
				<div className="mt-0.5 text-xs leading-snug text-foreground">
					{children}
				</div>
			</div>
		</div>
	);
}

function LinkChip({ href, label }: { href: string; label: string }) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className={cn(
				"inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5",
				"text-[11px] text-muted-foreground transition-colors",
				"hover:bg-muted hover:text-foreground",
			)}
		>
			{label}
			<ExternalLink className="size-2.5 opacity-70" aria-hidden />
		</a>
	);
}

function TagsEditor({
	tags,
	disabled,
	onChange,
}: {
	tags: PaperTag[] | unknown;
	disabled?: boolean;
	onChange: (tags: PaperTag[]) => void;
}) {
	const { t } = useTranslation("sidebar");
	const [draft, setDraft] = useState("");
	const [draftColor, setDraftColor] = useState<TagColorId | null>(null);
	const [colorOpen, setColorOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const list = coercePaperTags(tags);

	const commit = async (next: PaperTag[]) => {
		const normalized = normalizePaperTags(next);
		setBusy(true);
		try {
			await onChange(normalized);
		} finally {
			setBusy(false);
		}
	};

	const addTag = () => {
		const value = draft.trim();
		if (!value || busy || disabled) return;
		setDraft("");
		const next: PaperTag = draftColor
			? { name: value, color: draftColor }
			: { name: value };
		// Keep selected color for consecutive tags of the same theme.
		void commit([...list, next]);
	};

	const removeTag = (name: string) => {
		if (busy || disabled) return;
		void commit(
			list.filter(
				(x) => x.name.toLocaleLowerCase() !== name.toLocaleLowerCase(),
			),
		);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			e.preventDefault();
			addTag();
		} else if (e.key === "Backspace" && !draft && list.length > 0) {
			const last = list[list.length - 1];
			if (last) removeTag(last.name);
		}
	};

	const draftSwatch = tagSwatchStyle(draftColor);

	return (
		<div className="flex flex-col gap-1.5">
			{/* Input first so Zotero papers with many imported tags still show "Add tag…" without scrolling past chips. */}
			{disabled ? null : (
				<div className="relative">
					<Input
						ref={inputRef}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={onKeyDown}
						placeholder={t("paperInfo.addTag")}
						aria-label={t("paperInfo.addTag")}
						disabled={busy}
						className="h-6 border-dashed py-0 pr-7 pl-1.5 text-[11px]"
					/>
					<Popover open={colorOpen} onOpenChange={setColorOpen}>
						<PopoverTrigger asChild>
							<button
								type="button"
								data-tag-color-picker
								disabled={busy}
								className={cn(
									"absolute top-1/2 right-1 flex size-4 -translate-y-1/2 items-center justify-center",
									"overflow-hidden rounded-full bg-background ring-1 ring-border/70 transition-colors",
									"hover:ring-foreground/30",
									"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
									"disabled:pointer-events-none disabled:opacity-50",
								)}
								style={draftSwatch}
								aria-label={t("paperInfo.tagColor")}
								title={t("paperInfo.tagColor")}
							>
								{draftColor == null ? (
									<span
										className="pointer-events-none absolute top-1/2 left-[-20%] h-px w-[140%] -translate-y-1/2 rotate-45 bg-red-500"
										aria-hidden
									/>
								) : null}
								<span className="sr-only">{t("paperInfo.tagColor")}</span>
							</button>
						</PopoverTrigger>
						<PopoverContent
							data-tag-color-picker
							side="top"
							align="end"
							sideOffset={6}
							className="w-auto p-2"
							onOpenAutoFocus={(e) => e.preventDefault()}
						>
							<div className="flex items-center gap-1.5">
								<button
									type="button"
									data-tag-color-picker
									className={cn(
										"relative size-5 overflow-hidden rounded-full bg-background ring-1 ring-border transition-shadow",
										"hover:ring-foreground/40",
										"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
										draftColor == null && "ring-2 ring-foreground/50",
									)}
									aria-label={t("paperInfo.tagColorDefault")}
									title={t("paperInfo.tagColorDefault")}
									onClick={() => {
										setDraftColor(null);
										setColorOpen(false);
										inputRef.current?.focus();
									}}
								>
									<span
										className="pointer-events-none absolute top-1/2 left-[-20%] h-px w-[140%] -translate-y-1/2 rotate-45 bg-red-500"
										aria-hidden
									/>
								</button>
								{TAG_COLOR_IDS.map((id) => {
									const style = tagSwatchStyle(id);
									const selected = draftColor === id;
									return (
										<button
											key={id}
											type="button"
											data-tag-color-picker
											className={cn(
												"size-5 rounded-full ring-1 ring-black/10 transition-shadow",
												"hover:ring-foreground/40",
												"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
												selected && "ring-2 ring-foreground/50",
											)}
											style={style}
											aria-label={t("paperInfo.tagColorNamed", { color: id })}
											title={id}
											onClick={() => {
												setDraftColor(id);
												setColorOpen(false);
												inputRef.current?.focus();
											}}
										/>
									);
								})}
							</div>
						</PopoverContent>
					</Popover>
				</div>
			)}
			{list.length > 0 ? (
				<div className="flex flex-wrap gap-1">
					{list.map((tag) => (
						<PaperTagChip
							key={tag.name}
							tag={tag}
							size="sm"
							trailing={
								disabled ? null : (
									<PaperTagRemoveButton
										tagName={tag.name}
										label={t("paperInfo.removeTag", { tag: tag.name })}
										disabled={busy}
										onRemove={removeTag}
									/>
								)
							}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

const HEIGHT_STORAGE_KEY = "agentero.paperInfoHeight";
const MIN_CONTENT_HEIGHT = 120;
const MAX_CONTENT_HEIGHT = 560;
const DEFAULT_CONTENT_HEIGHT = 224;

function clampHeight(value: number) {
	return Math.min(MAX_CONTENT_HEIGHT, Math.max(MIN_CONTENT_HEIGHT, value));
}

function loadStoredHeight(): number {
	try {
		const raw = localStorage.getItem(HEIGHT_STORAGE_KEY);
		const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
		if (Number.isFinite(parsed)) return clampHeight(parsed);
	} catch {
		// localStorage unavailable; fall through to default.
	}
	return DEFAULT_CONTENT_HEIGHT;
}

export function PaperInfoPanel({
	meta,
	className,
	onTagsChange,
}: PaperInfoPanelProps) {
	const { t } = useTranslation("sidebar");
	const [open, setOpen] = useState(Boolean(meta));
	const [contentHeight, setContentHeight] = useState(loadStoredHeight);
	const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

	const persistHeight = (value: number) => {
		try {
			localStorage.setItem(HEIGHT_STORAGE_KEY, String(Math.round(value)));
		} catch {
			// Ignore persistence failures.
		}
	};

	const onHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		dragRef.current = { startY: e.clientY, startHeight: contentHeight };
		e.currentTarget.setPointerCapture(e.pointerId);
	};

	const onHandlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag) return;
		// Dragging up grows the panel.
		setContentHeight(clampHeight(drag.startHeight + (drag.startY - e.clientY)));
	};

	const onHandlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
		if (!dragRef.current) return;
		dragRef.current = null;
		e.currentTarget.releasePointerCapture(e.pointerId);
		setContentHeight((h) => {
			persistHeight(h);
			return h;
		});
	};

	const onHandleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const step = e.shiftKey ? 48 : 16;
		let next: number | null = null;
		if (e.key === "ArrowUp") next = clampHeight(contentHeight + step);
		else if (e.key === "ArrowDown") next = clampHeight(contentHeight - step);
		if (next == null) return;
		e.preventDefault();
		setContentHeight(next);
		persistHeight(next);
	};

	// Open when a paper is selected; collapse when none.
	useEffect(() => {
		if (!meta) {
			setOpen(false);
			return;
		}
		setOpen(true);
	}, [meta]);

	const resizable = open && Boolean(meta);

	return (
		<div className={cn("relative shrink-0 border-t bg-muted/10", className)}>
			{resizable ? (
				// biome-ignore lint/a11y/useSemanticElements: a focusable drag separator cannot be a native <hr>
				<div
					role="separator"
					aria-orientation="horizontal"
					aria-label={t("paperInfo.resize")}
					aria-valuenow={Math.round(contentHeight)}
					aria-valuemin={MIN_CONTENT_HEIGHT}
					aria-valuemax={MAX_CONTENT_HEIGHT}
					title={t("paperInfo.resize")}
					tabIndex={0}
					onPointerDown={onHandlePointerDown}
					onPointerMove={onHandlePointerMove}
					onPointerUp={onHandlePointerUp}
					onPointerCancel={onHandlePointerUp}
					onKeyDown={onHandleKeyDown}
					className={cn(
						// Sits on the panel's top border; wider invisible hit area.
						"absolute inset-x-0 -top-[3px] z-10 h-[7px] cursor-row-resize outline-none",
						"after:absolute after:inset-x-0 after:top-[3px] after:h-px after:content-['']",
						"hover:after:bg-foreground/25 focus-visible:after:bg-foreground/35",
					)}
				/>
			) : null}
			<Collapsible open={open} onOpenChange={setOpen}>
				<CollapsibleTrigger
					className={cn(
						"flex h-8 w-full items-center gap-1.5 px-2 text-left outline-none",
						"text-muted-foreground text-xs font-medium tracking-wide",
						"hover:bg-muted/40 hover:text-foreground",
						"focus-visible:ring-1 focus-visible:ring-ring",
					)}
				>
					<ChevronRight
						className={cn(
							"size-3.5 shrink-0 transition-transform",
							open && "rotate-90",
						)}
						aria-hidden
					/>
					<Info className="size-3.5 shrink-0" aria-hidden />
					<span className="truncate">{t("paperInfo.info")}</span>
					{meta ? (
						<span className="ml-auto max-w-[40%] truncate font-normal text-[10px] opacity-70">
							{meta.id}
						</span>
					) : null}
				</CollapsibleTrigger>
				<CollapsibleContent>
					{!meta ? (
						<p className="px-3 pb-3 text-muted-foreground text-xs leading-snug">
							{t("paperInfo.selectPrompt")}
						</p>
					) : (
						<div
							className="agentero-scroll overflow-y-auto border-t pb-2"
							style={{ maxHeight: contentHeight }}
						>
							<MetaRow icon={BookOpen} label={t("paperInfo.title")}>
								<span className="font-medium">{meta.title}</span>
							</MetaRow>
							{meta.authors?.length ? (
								<MetaRow icon={Users} label={t("paperInfo.authors")}>
									<span>{meta.authors.join(", ")}</span>
								</MetaRow>
							) : null}
							{meta.year ? (
								<MetaRow icon={Calendar} label={t("paperInfo.year")}>
									{meta.year}
								</MetaRow>
							) : null}
							<MetaRow icon={Tag} label={t("paperInfo.tags")}>
								<TagsEditor
									tags={meta.tags ?? []}
									// Editable whenever parent can persist; path is resolved in App
									// Prefer catalog path; else open paper folder.
									disabled={!onTagsChange}
									onChange={async (tags) => {
										if (onTagsChange) await onTagsChange(tags);
									}}
								/>
							</MetaRow>
							{meta.abstract ? (
								<MetaRow icon={FileText} label={t("paperInfo.abstract")}>
									<p className="text-muted-foreground">{meta.abstract}</p>
								</MetaRow>
							) : null}
							{(meta.pdf_url ||
								meta.html_url ||
								meta.source_url ||
								meta.arxiv_id) && (
								<div className="flex flex-wrap gap-1.5 px-3 pt-1">
									{meta.pdf_url || meta.arxiv_id ? (
										<LinkChip
											href={
												meta.pdf_url ?? `https://arxiv.org/pdf/${meta.arxiv_id}`
											}
											label={t("paperInfo.pdf")}
										/>
									) : null}
									{meta.html_url || meta.arxiv_id ? (
										<LinkChip
											href={
												meta.html_url ??
												`https://arxiv.org/html/${meta.arxiv_id}`
											}
											label={t("paperInfo.html")}
										/>
									) : null}
									{meta.source_url || meta.arxiv_id ? (
										<LinkChip
											href={
												meta.source_url ??
												`https://arxiv.org/abs/${meta.arxiv_id}`
											}
											label={t("paperInfo.abs")}
										/>
									) : null}
								</div>
							)}
						</div>
					)}
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}
