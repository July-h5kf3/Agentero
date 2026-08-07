import {
	CheckCircle2,
	Copy,
	EyeOff,
	RefreshCw,
	TriangleAlert,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { PageTitle } from "@/components/settings/settings-layout";
import type { SettingsHostContext } from "@/components/settings/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { broadcastOpenAgentWithPrompt } from "@/lib/agent/composer-seed";
import { copyTextToClipboard } from "@/lib/core/clipboard";
import { notifyError, notifySuccess } from "@/lib/core/notify";
import {
	type AliasRepairCandidate,
	type DoctorIssue,
	type DoctorReport,
	doctorApplyAliases,
	doctorApplyWikilinks,
	doctorCheck,
	doctorIgnoreAliases,
	doctorPlanWikilinks,
	type WikiCheckIssue,
	type WikilinkRepairResidual,
	type WikilinkRepairSuggestion,
} from "@/lib/doctor/api";
import { buildDoctorWikilinkAgentPrompt } from "@/lib/doctor/wikilink-prompt";
import { closeSettingsWindow } from "@/lib/shell/settings-window";

type CandidateDraft = AliasRepairCandidate & { selected: boolean };
type WikilinkDraft = WikilinkRepairSuggestion & { selected: boolean };

/** Section title with status on the right; issue list below when present. */
function DoctorSection({
	title,
	description,
	ok,
	issueCount,
	action,
	/** Cap list height and scroll (wikilinks / aliases with many rows). */
	scrollable = false,
	/** Short muted rule under the section (omit on the last block). */
	showDivider = true,
	children,
}: {
	title: string;
	description?: string;
	ok: boolean;
	issueCount: number;
	action?: ReactNode;
	scrollable?: boolean;
	showDivider?: boolean;
	children?: ReactNode;
}) {
	const { t } = useTranslation("settings");
	const hasList = Boolean(children);

	return (
		<div className={showDivider ? "mb-2 pb-6" : "mb-5"}>
			<div className="mb-1 flex items-center gap-3 px-0.5">
				<p className="min-w-0 flex-1 font-medium text-[13px]">{title}</p>
				<span className="flex shrink-0 items-center gap-1.5 text-[13px]">
					{ok ? (
						<CheckCircle2 className="size-4 text-emerald-600" />
					) : (
						<TriangleAlert className="size-4 text-amber-600" />
					)}
					{t("doctor.issueCount", { count: issueCount })}
				</span>
				{action}
			</div>
			{description ? (
				<p className="mb-2 px-0.5 text-muted-foreground text-xs leading-relaxed">
					{description}
				</p>
			) : null}
			{hasList ? (
				<div
					className={
						scrollable
							? "max-h-60 overflow-y-auto overflow-x-hidden rounded-xl border bg-card"
							: "overflow-hidden rounded-xl border bg-card"
					}
				>
					{children}
				</div>
			) : null}
			{showDivider ? (
				<div className="mt-6 flex justify-center px-6" aria-hidden>
					<div className="h-px w-9/10 max-w-l bg-border/40" />
				</div>
			) : null}
		</div>
	);
}

function IssueRows({ issues }: { issues: DoctorIssue[] }) {
	return (
		<>
			{issues.map((issue) => (
				<div
					key={`${issue.code}:${issue.path ?? ""}:${issue.message}`}
					className="border-b px-3.5 py-2.5 last:border-b-0"
				>
					<p className="text-[13px] leading-snug">{issue.message}</p>
					{issue.path ? (
						<p className="mt-0.5 truncate text-muted-foreground text-xs">
							{issue.path}
						</p>
					) : null}
				</div>
			))}
		</>
	);
}

/** Split a full line so `focus` appears once. */
function splitLineAroundFocus(
	line: string | undefined,
	focus: string,
): { before: string; after: string } {
	if (!line || !focus) return { before: line ?? "", after: "" };
	const index = line.lastIndexOf(focus);
	if (index < 0) return { before: line, after: "" };
	return {
		before: line.slice(0, index),
		after: line.slice(index + focus.length),
	};
}

const MONO_FONT =
	'12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

let monoMeasureCanvas: HTMLCanvasElement | null = null;

function measureMonoText(text: string): number {
	if (typeof document === "undefined" || !text) return 0;
	if (!monoMeasureCanvas) monoMeasureCanvas = document.createElement("canvas");
	const ctx = monoMeasureCanvas.getContext("2d");
	if (!ctx) return text.length * 7;
	ctx.font = MONO_FONT;
	return ctx.measureText(text).width;
}

/** Keep the right end of `text` so it fits `maxPx` (left ellipsis). */
function fitEnd(text: string, maxPx: number): string {
	if (!text || maxPx <= 0) return "";
	if (measureMonoText(text) <= maxPx) return text;
	const ellipsis = "…";
	const ellipsisW = measureMonoText(ellipsis);
	if (maxPx <= ellipsisW) return ellipsis;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.floor((lo + hi) / 2);
		const candidate = ellipsis + text.slice(mid);
		if (measureMonoText(candidate) <= maxPx) hi = mid;
		else lo = mid + 1;
	}
	return lo >= text.length ? ellipsis : ellipsis + text.slice(lo);
}

/** Keep the left start of `text` so it fits `maxPx` (right ellipsis). */
function fitStart(text: string, maxPx: number): string {
	if (!text || maxPx <= 0) return "";
	if (measureMonoText(text) <= maxPx) return text;
	const ellipsis = "…";
	const ellipsisW = measureMonoText(ellipsis);
	if (maxPx <= ellipsisW) return ellipsis;
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		const candidate = text.slice(0, mid) + ellipsis;
		if (measureMonoText(candidate) <= maxPx) lo = mid;
		else hi = mid - 1;
	}
	return lo <= 0 ? ellipsis : text.slice(0, lo) + ellipsis;
}

/**
 * Window the full line around `focus` so the core stays centered and the
 * container width shows as much surrounding context as possible.
 */
function windowAroundFocus(
	before: string,
	focus: string,
	after: string,
	containerPx: number,
): { before: string; after: string } {
	if (containerPx <= 0) {
		return { before, after };
	}
	const focusW = Math.max(measureMonoText(focus), 24);
	const sideBudget = Math.max(0, (containerPx - focusW) / 2);
	let left = fitEnd(before, sideBudget);
	let right = fitStart(after, sideBudget);
	// Give leftover space from one side to the other.
	const usedLeft = measureMonoText(left);
	const usedRight = measureMonoText(right);
	const leftover = Math.max(0, containerPx - focusW - usedLeft - usedRight);
	if (leftover > 1) {
		if (left.startsWith("…") || measureMonoText(before) > usedLeft) {
			left = fitEnd(before, usedLeft + leftover);
		} else if (right.endsWith("…") || measureMonoText(after) > usedRight) {
			right = fitStart(after, usedRight + leftover);
		}
	}
	return { before: left, after: right };
}

function useWindowedLine(before: string, focus: string, after: string) {
	const ref = useRef<HTMLDivElement>(null);
	const [windowed, setWindowed] = useState({ before, after });

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const update = () => {
			// Content area excludes the "+/-" gutter (~1.5rem) and horizontal padding.
			const contentPx = Math.max(0, el.clientWidth - 28);
			setWindowed(windowAroundFocus(before, focus, after, contentPx));
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => ro.disconnect();
	}, [before, focus, after]);

	return { ref, windowed };
}

function WikiIssueRows({ issues }: { issues: WikiCheckIssue[] }) {
	return (
		<>
			{issues.map((issue) => {
				const { before, after } = splitLineAroundFocus(
					issue.context,
					issue.targetRaw,
				);
				return (
					<div
						key={`${issue.source}:${issue.line}:${issue.targetRaw}:${issue.status}:${issue.context ?? ""}`}
						className="border-b px-3.5 py-2.5 last:border-b-0"
					>
						<p className="truncate font-mono text-muted-foreground text-xs">
							{issue.source}:{issue.line}
						</p>
						<div className="mt-1 overflow-hidden rounded-md border font-mono text-xs">
							<GitLine
								sign="-"
								tone="bad"
								before={before}
								focus={issue.targetRaw}
								after={after}
							/>
						</div>
					</div>
				);
			})}
		</>
	);
}

/** One git-style line: full available width, focus centered, context truncated. */
function GitLine({
	sign,
	tone,
	before,
	focus,
	after,
	focusNode,
}: {
	sign: "+" | "-";
	tone: "bad" | "good";
	before: string;
	focus: string;
	after: string;
	/** When set, replaces the static focus highlight (e.g. editable input). */
	focusNode?: ReactNode;
}) {
	const { ref, windowed } = useWindowedLine(before, focus, after);
	const focusClass =
		tone === "bad"
			? "shrink-0 rounded-sm bg-destructive/25 px-0.5 font-medium text-destructive"
			: "shrink-0 rounded-sm bg-emerald-500/25 px-0.5 font-medium text-emerald-800 dark:text-emerald-300";
	const rowClass =
		tone === "bad"
			? "flex min-w-0 items-center bg-destructive/10"
			: "flex min-w-0 items-center bg-emerald-500/10 dark:bg-emerald-500/15";
	const signClass =
		tone === "bad"
			? "shrink-0 select-none px-2 py-1 text-destructive/80"
			: "shrink-0 select-none px-2 py-1 text-emerald-700/80 dark:text-emerald-400/80";

	return (
		<div ref={ref} className={rowClass}>
			<span className={signClass}>{sign}</span>
			<span className="flex min-w-0 flex-1 items-center overflow-hidden whitespace-nowrap py-1 pr-2 leading-relaxed">
				{windowed.before ? (
					<span className="shrink-0 text-muted-foreground">
						{windowed.before}
					</span>
				) : null}
				{focusNode ?? <span className={focusClass}>{focus}</span>}
				{windowed.after ? (
					<span className="shrink-0 text-muted-foreground">
						{windowed.after}
					</span>
				) : null}
			</span>
		</div>
	);
}

/** Path header + red/green hunk; focus stays centered as the modal grows. */
function WikiLinkDiff({
	source,
	line,
	prefix,
	suffix,
	oldText,
	newText,
	onNewTextChange,
	newTextAriaLabel,
}: {
	source: string;
	line: number;
	prefix?: string;
	suffix?: string;
	oldText: string;
	newText: string;
	onNewTextChange?: (value: string) => void;
	newTextAriaLabel?: string;
}) {
	const before = prefix ?? "";
	const after = suffix ?? "";
	return (
		<div className="min-w-0 flex-1">
			<p className="truncate font-mono text-muted-foreground text-xs">
				{source}:{line}
			</p>
			<div className="mt-1 overflow-hidden rounded-md border font-mono text-xs">
				<GitLine
					sign="-"
					tone="bad"
					before={before}
					focus={oldText}
					after={after}
				/>
				<GitLine
					sign="+"
					tone="good"
					before={before}
					focus={newText}
					after={after}
					focusNode={
						onNewTextChange ? (
							<Input
								aria-label={newTextAriaLabel}
								value={newText}
								onChange={(event) => onNewTextChange(event.currentTarget.value)}
								className="mx-0.5 h-6 min-w-[4rem] max-w-[min(100%,28rem)] border-0 bg-emerald-500/20 px-1.5 py-0 font-mono text-emerald-800 text-xs shadow-none focus-visible:border-0 focus-visible:ring-1 focus-visible:ring-emerald-500/40 dark:bg-emerald-500/25 dark:text-emerald-300"
								style={{
									// Prefer content width for CJK; still allow growth.
									width: `min(28rem, max(4rem, ${Math.ceil(measureMonoText(newText) + 16)}px))`,
								}}
							/>
						) : undefined
					}
				/>
			</div>
		</div>
	);
}

export function DoctorPane({
	vaultPath,
	hostContext,
}: {
	vaultPath?: string | null;
	hostContext: SettingsHostContext;
}) {
	const { t, i18n } = useTranslation("settings");
	const [report, setReport] = useState<DoctorReport | null>(null);
	const [drafts, setDrafts] = useState<CandidateDraft[]>([]);
	const [loading, setLoading] = useState(false);
	const [applying, setApplying] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);

	const [wikiDrafts, setWikiDrafts] = useState<WikilinkDraft[]>([]);
	const [wikiResiduals, setWikiResiduals] = useState<WikilinkRepairResidual[]>(
		[],
	);
	const [wikiPlanning, setWikiPlanning] = useState(false);
	const [wikiApplying, setWikiApplying] = useState(false);
	const [wikiConfirmOpen, setWikiConfirmOpen] = useState(false);
	const [wikiProgress, setWikiProgress] = useState<{
		percent: number;
		detail: string;
	} | null>(null);
	const [wikiReviewMode, setWikiReviewMode] = useState(false);

	const refresh = useCallback(async () => {
		if (!vaultPath || hostContext.kind === "remote") return;
		setLoading(true);
		try {
			const next = await doctorCheck(vaultPath);
			setReport(next);
			setDrafts(
				next.aliases.candidates.map((candidate) => ({
					...candidate,
					selected: candidate.selectedByDefault,
				})),
			);
			setWikiDrafts([]);
			setWikiResiduals([]);
			setWikiReviewMode(false);
			setWikiProgress(null);
		} catch (error) {
			notifyError(error instanceof Error ? error.message : String(error));
		} finally {
			setLoading(false);
		}
	}, [hostContext.kind, vaultPath]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const selected = useMemo(
		() => drafts.filter((draft) => draft.fixable && draft.selected),
		[drafts],
	);
	const selectedWiki = useMemo(
		() => wikiDrafts.filter((draft) => draft.selected),
		[wikiDrafts],
	);

	const patchDraft = (
		path: string,
		patch: Partial<
			Pick<CandidateDraft, "selected" | "titleAlias" | "shortAlias">
		>,
	) => {
		setDrafts((current) =>
			current.map((draft) =>
				draft.path === path ? { ...draft, ...patch } : draft,
			),
		);
	};

	const patchWikiDraft = (
		id: string,
		patch: Partial<Pick<WikilinkDraft, "selected" | "suggestedReplacement">>,
	) => {
		setWikiDrafts((current) =>
			current.map((draft) =>
				draft.id === id ? { ...draft, ...patch } : draft,
			),
		);
	};

	const apply = async () => {
		if (!vaultPath || selected.length === 0) return;
		setApplying(true);
		try {
			const result = await doctorApplyAliases(
				vaultPath,
				selected.map((draft) => ({
					path: draft.path,
					titleAlias: draft.titleAlias,
					shortAlias: draft.shortAlias,
					expectedHash: draft.expectedHash,
				})),
			);
			setConfirmOpen(false);
			notifySuccess(
				t("doctor.repair.success", { count: result.updatedPaths.length }),
			);
			await refresh();
		} catch (error) {
			notifyError(error instanceof Error ? error.message : String(error));
		} finally {
			setApplying(false);
		}
	};

	const ignorePaths = async (paths: string[], ignore: boolean) => {
		if (!vaultPath || paths.length === 0) return;
		try {
			await doctorIgnoreAliases(vaultPath, paths, ignore);
			notifySuccess(
				ignore
					? t("doctor.repair.ignored", { count: paths.length })
					: t("doctor.repair.restored", { count: paths.length }),
			);
			await refresh();
		} catch (error) {
			notifyError(error instanceof Error ? error.message : String(error));
		}
	};

	/** Deterministic plan only → review list + optional Agent prompt handoff. */
	const startWikiProbe = async () => {
		if (!vaultPath) return;
		setWikiPlanning(true);
		setWikiReviewMode(false);
		setWikiProgress({ percent: 15, detail: t("doctor.wikilink.planning") });
		try {
			const plan = await doctorPlanWikilinks(vaultPath);
			const draftsFromPlan = plan.suggestions.map((item) => ({
				...item,
				// Manual rows stay unselected until the user edits/chooses them.
				selected: item.selectedByDefault,
			}));
			setWikiDrafts(draftsFromPlan);
			setWikiResiduals(plan.residuals);
			setWikiReviewMode(true);
			setWikiProgress(null);
			const autoCount = draftsFromPlan.filter(
				(item) => item.layer === "deterministic",
			).length;
			const manualCount = draftsFromPlan.filter(
				(item) => item.layer === "manual",
			).length;
			if (draftsFromPlan.length === 0) {
				notifyError(t("doctor.wikilink.noSuggestions"));
			} else {
				notifySuccess(
					t("doctor.wikilink.probeDone", {
						auto: autoCount,
						manual: manualCount,
						total: draftsFromPlan.length,
					}),
				);
			}
		} catch (error) {
			notifyError(error instanceof Error ? error.message : String(error));
			setWikiProgress(null);
		} finally {
			setWikiPlanning(false);
		}
	};

	const agentPrompt = useMemo(() => {
		if (!vaultPath || !wikiReviewMode) return "";
		if (wikiResiduals.length === 0 && wikiDrafts.length === 0) return "";
		return buildDoctorWikilinkAgentPrompt({
			vaultPath,
			residuals: wikiResiduals,
			suggestions: wikiDrafts,
			issues: report?.wikilinks.issues,
			language: i18n.resolvedLanguage ?? i18n.language,
		});
	}, [
		vaultPath,
		wikiReviewMode,
		wikiResiduals,
		wikiDrafts,
		report,
		i18n.resolvedLanguage,
		i18n.language,
	]);

	const copyAgentPrompt = async () => {
		if (!agentPrompt) return;
		await copyTextToClipboard(agentPrompt, {
			successMessage: t("doctor.wikilink.promptCopied"),
		});
	};

	const openAgentWithPrompt = () => {
		if (!agentPrompt) return;
		broadcastOpenAgentWithPrompt(agentPrompt);
		closeSettingsWindow();
	};

	const applyWiki = async () => {
		if (!vaultPath || selectedWiki.length === 0) return;
		setWikiApplying(true);
		try {
			const result = await doctorApplyWikilinks(
				vaultPath,
				selectedWiki.map((draft) => ({
					source: draft.source,
					rangeStart: draft.rangeStart,
					rangeEnd: draft.rangeEnd,
					expected: draft.expected,
					replacement: draft.suggestedReplacement,
					expectedHash: draft.expectedHash,
				})),
			);
			setWikiConfirmOpen(false);
			notifySuccess(
				t("doctor.wikilink.success", { count: result.updatedPaths.length }),
			);
			await refresh();
		} catch (error) {
			notifyError(error instanceof Error ? error.message : String(error));
		} finally {
			setWikiApplying(false);
		}
	};

	if (hostContext.kind === "remote") {
		return (
			<>
				<PageTitle title={t("doctor.title")} />
				<p className="rounded-xl border bg-muted/30 px-4 py-3 text-muted-foreground text-sm">
					{t("doctor.remoteUnavailable")}
				</p>
			</>
		);
	}
	if (!vaultPath) {
		return (
			<>
				<PageTitle title={t("doctor.title")} />
				<p className="rounded-xl border bg-muted/30 px-4 py-3 text-muted-foreground text-sm">
					{t("doctor.openVault")}
				</p>
			</>
		);
	}

	const vaultIssues = report?.vault.issues ?? [];
	const catalogIssues = report?.catalog.issues ?? [];
	const wikiIssues = report?.wikilinks.issues ?? [];
	const aliasIssues = report?.aliases.issues ?? [];
	const ignoredAliasPaths = report?.aliases.ignoredPaths ?? [];
	const aliasIssueCount =
		drafts.length +
		aliasIssues.filter(
			(issue) => !drafts.some((draft) => draft.path === issue.path),
		).length;
	const hasFixableAliases = drafts.some((draft) => draft.fixable);
	const wikiAllSelected =
		wikiDrafts.length > 0 && wikiDrafts.every((draft) => draft.selected);

	const toggleWikiSelectAll = () => {
		const next = !wikiAllSelected;
		setWikiDrafts((current) =>
			current.map((draft) => ({ ...draft, selected: next })),
		);
	};

	const wikiSectionAction = (() => {
		if (wikiPlanning) {
			return (
				<Button type="button" size="sm" disabled>
					{t("doctor.wikilink.working")}
				</Button>
			);
		}
		if (wikiReviewMode && wikiDrafts.length > 0) {
			return (
				<div className="flex shrink-0 items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={toggleWikiSelectAll}
					>
						{wikiAllSelected
							? t("doctor.wikilink.deselectAll")
							: t("doctor.wikilink.selectAll")}
					</Button>
					<Button
						type="button"
						size="sm"
						disabled={selectedWiki.length === 0}
						onClick={() => setWikiConfirmOpen(true)}
					>
						{t("doctor.repair.apply")}
					</Button>
				</div>
			);
		}
		if (wikiIssues.length > 0) {
			return (
				<Button type="button" size="sm" onClick={() => void startWikiProbe()}>
					{t("doctor.wikilink.probe")}
				</Button>
			);
		}
		return undefined;
	})();

	return (
		<>
			<PageTitle
				title={t("doctor.title")}
				actions={
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								size="icon-sm"
								variant="ghost"
								aria-label={t("doctor.refresh")}
								disabled={loading || wikiPlanning}
								onClick={() => void refresh()}
							>
								<RefreshCw className={loading ? "animate-spin" : undefined} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>{t("doctor.refresh")}</TooltipContent>
					</Tooltip>
				}
			/>

			<DoctorSection
				title={t("doctor.sections.vault")}
				description={t("doctor.sectionHints.vault")}
				ok={report?.vault.ok ?? true}
				issueCount={vaultIssues.length}
			>
				{vaultIssues.length > 0 ? <IssueRows issues={vaultIssues} /> : null}
			</DoctorSection>

			<DoctorSection
				title={t("doctor.sections.catalog")}
				description={t("doctor.sectionHints.catalog")}
				ok={report?.catalog.ok ?? true}
				issueCount={catalogIssues.length}
			>
				{catalogIssues.length > 0 ? <IssueRows issues={catalogIssues} /> : null}
			</DoctorSection>

			<DoctorSection
				title={t("doctor.sections.wikilinks")}
				description={t("doctor.sectionHints.wikilinks")}
				ok={wikiIssues.length === 0}
				issueCount={wikiIssues.length}
				action={wikiSectionAction}
				scrollable
			>
				{wikiPlanning || wikiProgress ? (
					<div className="space-y-2 px-3.5 py-3">
						<p className="text-muted-foreground text-xs">
							{wikiProgress?.detail ?? t("doctor.wikilink.planning")}
						</p>
						<Progress value={wikiProgress?.percent ?? 10} />
					</div>
				) : null}

				{wikiReviewMode ? (
					<>
						{wikiDrafts.map((draft) => (
							<div
								key={draft.id}
								className="border-b px-3.5 py-3 last:border-b-0"
							>
								<div className="flex items-start gap-2">
									<Checkbox
										className="mt-0.5"
										checked={draft.selected}
										aria-label={t("doctor.wikilink.select", {
											source: draft.source,
										})}
										onCheckedChange={(checked) =>
											patchWikiDraft(draft.id, {
												selected: checked === true,
											})
										}
									/>
									<WikiLinkDiff
										source={draft.source}
										line={draft.line}
										prefix={draft.linePrefix}
										suffix={draft.lineSuffix}
										oldText={draft.expected}
										newText={draft.suggestedReplacement}
										newTextAriaLabel={t("doctor.wikilink.replacement")}
										onNewTextChange={(value) =>
											patchWikiDraft(draft.id, {
												suggestedReplacement: value,
											})
										}
									/>
								</div>
							</div>
						))}
						{/* Residuals are already mirrored as manual suggestions; only used for Agent prompt. */}
						{wikiDrafts.length === 0 ? (
							<p className="px-3.5 py-3 text-muted-foreground text-xs">
								{t("doctor.wikilink.noSuggestions")}
							</p>
						) : null}
					</>
				) : wikiIssues.length > 0 ? (
					<WikiIssueRows issues={wikiIssues} />
				) : null}
			</DoctorSection>

			{wikiReviewMode && agentPrompt ? (
				<div className="mb-5 space-y-2 px-0.5">
					<p className="text-[13px] text-muted-foreground leading-relaxed">
						{t("doctor.wikilink.agentHint")}
					</p>
					<div className="overflow-hidden rounded-xl border bg-card">
						<div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
							<span className="font-medium text-muted-foreground text-xs">
								{t("doctor.wikilink.agentPromptLabel")}
							</span>
							<div className="flex items-center gap-1.5">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-7 px-2"
									onClick={() => void copyAgentPrompt()}
								>
									<Copy className="size-3.5" data-icon="inline-start" />
									{t("doctor.wikilink.copyPrompt")}
								</Button>
								<Button
									type="button"
									size="sm"
									className="h-7"
									onClick={openAgentWithPrompt}
								>
									{t("doctor.wikilink.openInAgent")}
								</Button>
							</div>
						</div>
						<pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
							{agentPrompt}
						</pre>
					</div>
				</div>
			) : null}

			<DoctorSection
				title={t("doctor.sections.aliases")}
				description={t("doctor.sectionHints.aliases")}
				ok={report?.aliases.ok ?? true}
				issueCount={aliasIssueCount}
				action={
					hasFixableAliases ? (
						<div className="flex shrink-0 items-center gap-2">
							{selected.length > 0 ? (
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() =>
										void ignorePaths(
											selected.map((draft) => draft.path),
											true,
										)
									}
								>
									{t("doctor.repair.ignoreSelected")}
								</Button>
							) : null}
							<Button
								type="button"
								size="sm"
								disabled={selected.length === 0}
								onClick={() => setConfirmOpen(true)}
							>
								{t("doctor.repair.apply")}
							</Button>
						</div>
					) : undefined
				}
				scrollable
				showDivider={false}
			>
				{drafts.length > 0 ||
				aliasIssues.length > 0 ||
				ignoredAliasPaths.length > 0 ? (
					<>
						{drafts.map((draft) => (
							<div
								key={draft.path}
								className="border-b px-3.5 py-3 last:border-b-0"
							>
								<div className="mb-2 flex items-start gap-2">
									<Checkbox
										checked={draft.selected}
										disabled={!draft.fixable}
										aria-label={t("doctor.repair.select", {
											path: draft.path,
										})}
										onCheckedChange={(checked) =>
											patchDraft(draft.path, { selected: checked === true })
										}
									/>
									<div className="min-w-0 flex-1">
										<p className="truncate text-[13px]">{draft.paperTitle}</p>
										<p className="truncate text-muted-foreground text-xs">
											{draft.path}
										</p>
									</div>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="size-7 shrink-0"
												aria-label={t("doctor.repair.ignore", {
													path: draft.path,
												})}
												onClick={() => void ignorePaths([draft.path], true)}
											>
												<EyeOff className="size-3.5" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>
											{t("doctor.repair.ignoreHint")}
										</TooltipContent>
									</Tooltip>
								</div>
								{draft.fixable ? (
									<div className="grid gap-2 pl-6">
										<div className="grid gap-1">
											<Label className="text-muted-foreground text-xs">
												{t("doctor.repair.titleAlias")}
											</Label>
											<Input
												aria-label={t("doctor.repair.titleAlias")}
												value={draft.titleAlias}
												onChange={(event) =>
													patchDraft(draft.path, {
														titleAlias: event.currentTarget.value,
													})
												}
											/>
										</div>
										<div className="grid gap-1">
											<Label className="text-muted-foreground text-xs">
												{t("doctor.repair.shortAlias")}
											</Label>
											<Input
												aria-label={t("doctor.repair.shortAlias")}
												value={draft.shortAlias}
												onChange={(event) =>
													patchDraft(draft.path, {
														shortAlias: event.currentTarget.value,
													})
												}
											/>
										</div>
										{draft.currentAliases.length > 0 ? (
											<p className="text-muted-foreground text-xs">
												{t("doctor.repair.preserved", {
													aliases: draft.currentAliases.join(", "),
												})}
											</p>
										) : null}
									</div>
								) : (
									<p className="pl-6 text-amber-700 text-xs dark:text-amber-400">
										{draft.reason ?? t("doctor.repair.manual")}
									</p>
								)}
							</div>
						))}
						{aliasIssues
							.filter(
								(issue) => !drafts.some((draft) => draft.path === issue.path),
							)
							.map((issue) => (
								<div
									key={`${issue.code}:${issue.path ?? ""}:${issue.message}`}
									className="border-b px-3.5 py-2.5 last:border-b-0"
								>
									<div className="flex items-start gap-2">
										<div className="min-w-0 flex-1">
											<p className="text-[13px] leading-snug">
												{issue.message}
											</p>
											{issue.path ? (
												<p className="mt-0.5 truncate text-muted-foreground text-xs">
													{issue.path}
												</p>
											) : null}
										</div>
										{issue.path ? (
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														type="button"
														variant="ghost"
														size="icon"
														className="size-7 shrink-0"
														aria-label={t("doctor.repair.ignore", {
															path: issue.path,
														})}
														onClick={() =>
															void ignorePaths([issue.path as string], true)
														}
													>
														<EyeOff className="size-3.5" />
													</Button>
												</TooltipTrigger>
												<TooltipContent>
													{t("doctor.repair.ignoreHint")}
												</TooltipContent>
											</Tooltip>
										) : null}
									</div>
								</div>
							))}
						{ignoredAliasPaths.length > 0 ? (
							<div className="border-b px-3.5 py-2.5 last:border-b-0">
								<div className="mb-1.5 flex items-center justify-between gap-2">
									<p className="text-muted-foreground text-xs">
										{t("doctor.repair.ignoredCount", {
											count: ignoredAliasPaths.length,
										})}
									</p>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-7 px-2 text-xs"
										onClick={() => void ignorePaths(ignoredAliasPaths, false)}
									>
										{t("doctor.repair.restoreAll")}
									</Button>
								</div>
								<ul className="space-y-1">
									{ignoredAliasPaths.map((path) => (
										<li
											key={path}
											className="flex items-center gap-2 text-muted-foreground text-xs"
										>
											<span className="min-w-0 flex-1 truncate">{path}</span>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className="h-6 shrink-0 px-1.5 text-xs"
												onClick={() => void ignorePaths([path], false)}
											>
												{t("doctor.repair.restore")}
											</Button>
										</li>
									))}
								</ul>
							</div>
						) : null}
					</>
				) : null}
			</DoctorSection>

			<Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("doctor.repair.confirmTitle")}</DialogTitle>
						<DialogDescription>
							{t("doctor.repair.confirmDescription", {
								count: selected.length,
							})}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline">{t("doctor.repair.cancel")}</Button>
						</DialogClose>
						<Button disabled={applying} onClick={() => void apply()}>
							{applying
								? t("doctor.repair.applying")
								: t("doctor.repair.confirm")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={wikiConfirmOpen} onOpenChange={setWikiConfirmOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("doctor.wikilink.confirmTitle")}</DialogTitle>
						<DialogDescription>
							{t("doctor.wikilink.confirmDescription", {
								count: selectedWiki.length,
							})}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline">{t("doctor.repair.cancel")}</Button>
						</DialogClose>
						<Button disabled={wikiApplying} onClick={() => void applyWiki()}>
							{wikiApplying
								? t("doctor.repair.applying")
								: t("doctor.repair.confirm")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
