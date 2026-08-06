import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { notifyError, notifySuccess } from "@/lib/core/notify";
import {
	type AliasRepairCandidate,
	type DoctorIssue,
	type DoctorReport,
	doctorApplyAliases,
	doctorCheck,
	type WikiCheckIssue,
} from "@/lib/doctor/api";

type CandidateDraft = AliasRepairCandidate & { selected: boolean };

/** Section title with status on the right; issue list below when present. */
function DoctorSection({
	title,
	ok,
	issueCount,
	action,
	children,
}: {
	title: string;
	ok: boolean;
	issueCount: number;
	action?: ReactNode;
	children?: ReactNode;
}) {
	const { t } = useTranslation("settings");
	const hasList = Boolean(children);

	return (
		<div className="mb-5">
			<div className="mb-2 flex items-center gap-3 px-0.5">
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
			{hasList ? (
				<div className="overflow-hidden rounded-xl border bg-card">
					{children}
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

function WikiIssueRows({ issues }: { issues: WikiCheckIssue[] }) {
	return (
		<>
			{issues.map((issue) => (
				<div
					key={`${issue.source}:${issue.line}:${issue.targetRaw}:${issue.status}:${issue.context ?? ""}`}
					className="border-b px-3.5 py-2.5 last:border-b-0"
				>
					<p className="text-[13px] leading-snug">
						{issue.targetRaw}
						<span className="text-muted-foreground"> · {issue.status}</span>
					</p>
					<p className="mt-0.5 truncate text-muted-foreground text-xs">
						{issue.source}:{issue.line}
						{issue.context ? ` · ${issue.context}` : ""}
					</p>
				</div>
			))}
		</>
	);
}

export function DoctorPane({
	vaultPath,
	hostContext,
}: {
	vaultPath?: string | null;
	hostContext: SettingsHostContext;
}) {
	const { t } = useTranslation("settings");
	const [report, setReport] = useState<DoctorReport | null>(null);
	const [drafts, setDrafts] = useState<CandidateDraft[]>([]);
	const [loading, setLoading] = useState(false);
	const [applying, setApplying] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);

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
	const aliasIssueCount =
		drafts.length +
		aliasIssues.filter(
			(issue) => !drafts.some((draft) => draft.path === issue.path),
		).length;
	const hasFixableAliases = drafts.some((draft) => draft.fixable);

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
								disabled={loading}
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
				ok={report?.vault.ok ?? true}
				issueCount={vaultIssues.length}
			>
				{vaultIssues.length > 0 ? <IssueRows issues={vaultIssues} /> : null}
			</DoctorSection>

			<DoctorSection
				title={t("doctor.sections.catalog")}
				ok={report?.catalog.ok ?? true}
				issueCount={catalogIssues.length}
			>
				{catalogIssues.length > 0 ? <IssueRows issues={catalogIssues} /> : null}
			</DoctorSection>

			<DoctorSection
				title={t("doctor.sections.wikilinks")}
				ok={wikiIssues.length === 0}
				issueCount={wikiIssues.length}
			>
				{wikiIssues.length > 0 ? <WikiIssueRows issues={wikiIssues} /> : null}
			</DoctorSection>

			<DoctorSection
				title={t("doctor.sections.aliases")}
				ok={report?.aliases.ok ?? true}
				issueCount={aliasIssueCount}
				action={
					hasFixableAliases ? (
						<Button
							type="button"
							size="sm"
							disabled={selected.length === 0}
							onClick={() => setConfirmOpen(true)}
						>
							{t("doctor.repair.apply")}
						</Button>
					) : undefined
				}
			>
				{drafts.length > 0 || aliasIssues.length > 0 ? (
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
									<div className="min-w-0">
										<p className="truncate text-[13px]">{draft.paperTitle}</p>
										<p className="truncate text-muted-foreground text-xs">
											{draft.path}
										</p>
									</div>
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
									<p className="text-[13px] leading-snug">{issue.message}</p>
									{issue.path ? (
										<p className="mt-0.5 truncate text-muted-foreground text-xs">
											{issue.path}
										</p>
									) : null}
								</div>
							))}
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
		</>
	);
}
