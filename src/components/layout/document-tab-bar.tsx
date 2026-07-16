import {
	FileCode2,
	FileImage,
	FileText,
	FileType2,
	Library,
	Trash2,
	X,
} from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { DocTab } from "@/lib/tabs";
import { cn } from "@/lib/utils";

function iconForTab(tab: DocTab) {
	if (tab.kind === "library") return Library;
	if (tab.kind === "trash") return Trash2;
	if (tab.mode === "pdf") return FileType2;
	if (tab.mode === "html") return FileCode2;
	if (tab.mode === "image") return FileImage;
	return FileText;
}

type DocumentTabBarProps = {
	tabs: DocTab[];
	activeId: string | null;
	onSelect: (id: string) => void;
	onClose: (id: string) => void;
	onReorder: (fromId: string, toId: string) => void;
	className?: string;
};

/**
 * Browser-style document tab strip.
 * Sits in the title bar row (same line as zen / layout icons).
 */
export function DocumentTabBar({
	tabs,
	activeId,
	onSelect,
	onClose,
	onReorder,
	className,
}: DocumentTabBarProps) {
	const { t } = useTranslation(["app", "sidebar"]);
	const dragId = useRef<string | null>(null);

	if (!tabs.length) return null;

	return (
		<div className={cn("flex h-full min-w-0 flex-1 items-stretch", className)}>
			<div
				className="agentero-scroll flex h-full min-w-0 items-stretch gap-0.5 overflow-x-auto px-1"
				role="tablist"
				aria-label={t("app:tabs.strip")}
			>
				{tabs.map((tab) => {
					const Icon = iconForTab(tab);
					const active = tab.id === activeId;
					const dirty = tab.markdownDirty || tab.notesDirty;
					const label =
						tab.kind === "library"
							? t("sidebar:papersLibrary.title")
							: tab.kind === "trash"
								? t("sidebar:recycleBin.title")
								: tab.title;
					return (
						<div
							key={tab.id}
							role="tab"
							aria-selected={active}
							tabIndex={0}
							draggable
							title={label}
							onDragStart={() => {
								dragId.current = tab.id;
							}}
							onDragOver={(e) => {
								if (dragId.current && dragId.current !== tab.id)
									e.preventDefault();
							}}
							onDrop={(e) => {
								e.preventDefault();
								if (dragId.current && dragId.current !== tab.id) {
									onReorder(dragId.current, tab.id);
								}
								dragId.current = null;
							}}
							onDragEnd={() => {
								dragId.current = null;
							}}
							onClick={() => onSelect(tab.id)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onSelect(tab.id);
								}
							}}
							onAuxClick={(e) => {
								// Middle-click closes the tab.
								if (e.button === 1) {
									e.preventDefault();
									onClose(tab.id);
								}
							}}
							className={cn(
								"group my-0.5 flex min-w-0 max-w-[180px] shrink-0 cursor-default items-center gap-1 rounded-md px-1.5 text-[11px] outline-none",
								"focus-visible:ring-2 focus-visible:ring-ring/40",
								active
									? "bg-background text-foreground shadow-sm dark:bg-foreground/10"
									: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
							)}
						>
							<Icon
								className="size-3 shrink-0"
								strokeWidth={active ? 2.25 : 1.75}
							/>
							<span className="min-w-0 flex-1 truncate">{label}</span>
							{dirty ? (
								<span
									className="size-1.5 shrink-0 rounded-full bg-muted-foreground/70 group-hover:hidden"
									role="img"
									aria-label={t("app:editor.unsaved")}
								/>
							) : null}
							<button
								type="button"
								aria-label={t("app:tabs.close", { title: label })}
								className={cn(
									"grid size-3.5 shrink-0 place-items-center rounded hover:bg-muted-foreground/20",
									dirty
										? "hidden group-hover:grid"
										: "opacity-0 group-hover:opacity-100",
								)}
								onClick={(e) => {
									e.stopPropagation();
									onClose(tab.id);
								}}
							>
								<X className="size-2.5" />
							</button>
						</div>
					);
				})}
			</div>
			{/* Remaining title-bar space is draggable */}
			<div className="min-w-2 flex-1 self-stretch" data-tauri-drag-region />
		</div>
	);
}
