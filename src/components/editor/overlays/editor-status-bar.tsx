"use client";

import { Link2 } from "lucide-react";
import { NodeApi } from "platejs";
import { useEditorSelector } from "platejs/react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useWikiStore } from "@/hooks/use-app-stores";
import { cn } from "@/lib/core/utils";
import { countChars, countWords } from "@/lib/markdown/stats";
import { isMarkdownPath } from "@/lib/vault/fs";
import { getBacklinks } from "@/lib/wiki";

type EditorStatusBarProps = {
	filePath?: string | null;
	vaultPath?: string | null;
};

export function EditorStatusBar({ filePath, vaultPath }: EditorStatusBarProps) {
	const { t } = useTranslation("editor");
	const wikiIndexRevision = useWikiStore((s) => s.wikiIndexRevision);
	const [backlinkCount, setBacklinkCount] = useState(0);

	const { words, chars } = useEditorSelector(
		(editor) => {
			const text = editor.children
				.map((node) => NodeApi.string(node))
				.join("\n");
			return {
				words: countWords(text),
				chars: countChars(text),
			};
		},
		[],
		{ equalityFn: (a, b) => a.words === b.words && a.chars === b.chars },
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: wikiIndexRevision is a refresh signal
	useEffect(() => {
		if (!filePath || !isMarkdownPath(filePath)) {
			setBacklinkCount(0);
			return;
		}
		let cancelled = false;
		getBacklinks(vaultPath ?? null, filePath)
			.then((res) => {
				if (!cancelled) setBacklinkCount(res.backlinks.length);
			})
			.catch(() => {
				if (!cancelled) setBacklinkCount(0);
			});
		return () => {
			cancelled = true;
		};
	}, [filePath, vaultPath, wikiIndexRevision]);

	return (
		<div
			className={cn(
				"flex h-7 shrink-0 items-center justify-end gap-3",
				"border-t border-border/80 bg-background/95 px-3",
				"text-xs text-muted-foreground tabular-nums select-none",
			)}
			role="status"
			aria-label={t("statusBar.label")}
		>
			<span className="inline-flex items-center gap-1">
				<Link2 className="size-3" aria-hidden />
				{t("statusBar.backlinks", { count: backlinkCount })}
			</span>
			<span className="h-3 w-px bg-border" aria-hidden />
			<span>{t("statusBar.words", { count: words })}</span>
			<span className="h-3 w-px bg-border" aria-hidden />
			<span>{t("statusBar.characters", { count: chars })}</span>
		</div>
	);
}
