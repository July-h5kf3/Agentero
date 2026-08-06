import { CheckCircle2, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	PageTitle,
	SettingsGroup,
} from "@/components/settings/settings-layout";
import type { SettingsHostContext } from "@/components/settings/types";
import { Badge } from "@/components/ui/badge";
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
	type DoctorReport,
	doctorApplyAliases,
	doctorCheck,
} from "@/lib/doctor/api";

type CandidateDraft = AliasRepairCandidate & { selected: boolean };

function StatusRow({
	label,
	ok,
	detail,
	statusLabel,
}: {
	label: string;
	ok: boolean;
	detail: string;
	statusLabel: string;
}) {
	return (
		<div className="flex items-center gap-3 border-b px-3.5 py-3 last:border-b-0">
			{ok ? (
				<CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
			) : (
				<TriangleAlert className="size-4 shrink-0 text-amber-600" />
			)}
			<div className="min-w-0 flex-1">
				<p className="text-[13px]">{label}</p>
				<p className="truncate text-muted-foreground text-xs">{detail}</p>
			</div>
			<Badge variant={ok ? "secondary" : "destructive"}>{statusLabel}</Badge>
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

	const linkIssueCount = report?.wikilinks.issues.length ?? 0;
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

			<SettingsGroup>
				<StatusRow
					label={t("doctor.sections.vault")}
					ok={report?.vault.ok ?? false}
					detail={t("doctor.issueCount", {
						count: report?.vault.issues.length ?? 0,
					})}
					statusLabel={t(
						report?.vault.ok ? "doctor.status.ok" : "doctor.status.issues",
					)}
				/>
				<StatusRow
					label={t("doctor.sections.catalog")}
					ok={report?.catalog.ok ?? false}
					detail={
						report?.catalog.schemaVersion == null
							? t("doctor.catalogUnavailable")
							: t("doctor.catalogVersion", {
									current: report.catalog.schemaVersion,
									expected: report.catalog.expectedSchemaVersion,
								})
					}
					statusLabel={t(
						report?.catalog.ok ? "doctor.status.ok" : "doctor.status.issues",
					)}
				/>
				<StatusRow
					label={t("doctor.sections.wikilinks")}
					ok={linkIssueCount === 0}
					detail={t("doctor.wikilinkSummary", {
						files: report?.wikilinks.checkedFiles ?? 0,
						count: linkIssueCount,
					})}
					statusLabel={t(
						linkIssueCount === 0 ? "doctor.status.ok" : "doctor.status.issues",
					)}
				/>
				<StatusRow
					label={t("doctor.sections.aliases")}
					ok={report?.aliases.ok ?? false}
					detail={t("doctor.aliasSummary", {
						complete: report?.aliases.completePapers ?? 0,
						total: report?.aliases.checkedPapers ?? 0,
					})}
					statusLabel={t(
						report?.aliases.ok ? "doctor.status.ok" : "doctor.status.issues",
					)}
				/>
			</SettingsGroup>

			{drafts.length > 0 ? (
				<div className="mb-4 space-y-2">
					<p className="font-medium text-[13px]">{t("doctor.repair.title")}</p>
					{drafts.map((draft) => (
						<div key={draft.path} className="rounded-xl border bg-card p-3">
							<div className="mb-2 flex items-start gap-2">
								<Checkbox
									checked={draft.selected}
									disabled={!draft.fixable}
									aria-label={t("doctor.repair.select", { path: draft.path })}
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
									{t("doctor.repair.manual")}
								</p>
							)}
						</div>
					))}
					<div className="flex justify-end pt-1">
						<Button
							type="button"
							disabled={selected.length === 0}
							onClick={() => setConfirmOpen(true)}
						>
							{t("doctor.repair.apply", { count: selected.length })}
						</Button>
					</div>
				</div>
			) : null}

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
