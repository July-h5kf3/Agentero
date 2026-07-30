import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AgentModelSelects,
	useAgentModelCatalog,
} from "@/components/settings/agent-model-picker";
import {
	PageTitle,
	SettingsGroup,
	SettingsRow,
} from "@/components/settings/settings-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { isTauri } from "@/lib/core/tauri";
import type {
	AppSettings,
	TranslateProviderId,
	TranslateTargetLang,
} from "@/lib/settings";
import {
	FREE_MT_PROVIDER_IDS,
	type FreeMtProbeMap,
	type FreeMtProbeStatus,
	isFreeMtProvider,
	listSelectableProviders,
	probeFreeMtProviders,
} from "@/lib/translate";

function ProviderProbeIcon({
	status,
	labelIdle,
	labelOk,
	labelFail,
	labelProbing,
}: {
	status: FreeMtProbeStatus;
	labelIdle: string;
	labelOk: string;
	labelFail: string;
	labelProbing: string;
}) {
	if (status === "probing") {
		return (
			<Loader2
				className="size-3.5 shrink-0 animate-spin text-muted-foreground"
				aria-label={labelProbing}
			/>
		);
	}
	if (status === "ok") {
		return (
			<CheckCircle2
				className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
				aria-label={labelOk}
			/>
		);
	}
	if (status === "fail") {
		return (
			<XCircle
				className="size-3.5 shrink-0 text-destructive/80"
				aria-label={labelFail}
			/>
		);
	}
	// idle (not yet probed)
	return (
		<Circle
			className="size-3.5 shrink-0 text-muted-foreground/50"
			aria-label={labelIdle}
		/>
	);
}

export function TranslatePane({
	settings,
	patch,
	onOpenAgentSettings,
}: {
	settings: AppSettings;
	patch: (p: Partial<AppSettings>) => void;
	onOpenAgentSettings?: () => void;
}) {
	const { t } = useTranslation("settings");
	const tr = settings.translate;
	const providers = listSelectableProviders();
	const patchTranslate = useCallback(
		(partial: Partial<typeof tr>) =>
			patch({ translate: { ...tr, ...partial } }),
		[patch, tr],
	);
	const showEndpoint = tr.provider === "libre" || tr.freeBaseUrl.length > 0;
	const showAgent = tr.provider === "agent";

	/** Free-MT probe status (Agent never probed here). */
	const [probeMap, setProbeMap] = useState<FreeMtProbeMap>({});
	const probeAbortRef = useRef<AbortController | null>(null);
	const probingRef = useRef(false);

	const agentModelValue = useMemo(
		() => ({ agentId: tr.agentId, modelId: tr.modelId }),
		[tr.agentId, tr.modelId],
	);
	const onAgentModelChange = useCallback(
		(next: { agentId: string; modelId: string }) => {
			patchTranslate(next);
		},
		[patchTranslate],
	);
	const agentModelCatalog = useAgentModelCatalog({
		active: showAgent,
		value: agentModelValue,
		onChange: onAgentModelChange,
	});

	/** Parallel free-MT probe when the default-service Select opens. */
	const runFreeMtProbe = useCallback(() => {
		if (!isTauri() || probingRef.current) return;
		probingRef.current = true;
		probeAbortRef.current?.abort();
		const ac = new AbortController();
		probeAbortRef.current = ac;

		const initial: FreeMtProbeMap = {};
		for (const id of FREE_MT_PROVIDER_IDS) {
			initial[id] = "probing";
		}
		setProbeMap(initial);

		void probeFreeMtProviders({
			freeBaseUrl: tr.freeBaseUrl,
			signal: ac.signal,
			onResult: (id, ok) => {
				if (ac.signal.aborted) return;
				setProbeMap((prev) => ({
					...prev,
					[id]: ok ? "ok" : "fail",
				}));
			},
		}).finally(() => {
			if (probeAbortRef.current === ac) {
				probingRef.current = false;
			}
		});
	}, [tr.freeBaseUrl]);

	useEffect(() => {
		return () => {
			probeAbortRef.current?.abort();
		};
	}, []);

	return (
		<>
			<PageTitle title={t("translate.title")} />
			<SettingsGroup>
				<SettingsRow label={t("translate.provider.label")}>
					<Select
						value={tr.provider}
						onValueChange={(v) =>
							patchTranslate({ provider: v as TranslateProviderId })
						}
						onOpenChange={(open) => {
							if (open) runFreeMtProbe();
						}}
					>
						<SelectTrigger size="sm" className="min-w-[200px] max-w-[280px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="max-h-72">
							{providers.map((s) => {
								const freeId = isFreeMtProvider(s.id) ? s.id : null;
								const status: FreeMtProbeStatus | undefined = freeId
									? (probeMap[freeId] ?? "idle")
									: undefined;
								return (
									<SelectItem key={s.id} value={s.id}>
										<span className="flex min-w-0 items-center gap-1.5">
											{status != null ? (
												<ProviderProbeIcon
													status={status}
													labelIdle={t("translate.provider.probeIdle")}
													labelOk={t("translate.provider.probeOk")}
													labelFail={t("translate.provider.probeFail")}
													labelProbing={t("translate.provider.probeProbing")}
												/>
											) : null}
											<span className="truncate">
												{t(
													`translate.provider.${s.nameKey}` as "translate.provider.bing",
												)}
											</span>
										</span>
									</SelectItem>
								);
							})}
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow label={t("translate.targetLang.label")}>
					<Select
						value={tr.targetLang}
						onValueChange={(v) =>
							patchTranslate({ targetLang: v as TranslateTargetLang })
						}
					>
						<SelectTrigger size="sm" className="min-w-[160px] max-w-[220px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="ui">{t("translate.targetLang.ui")}</SelectItem>
							<SelectItem value="en">{t("translate.targetLang.en")}</SelectItem>
							<SelectItem value="zh-CN">
								{t("translate.targetLang.zhCN")}
							</SelectItem>
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow
					label={t("translate.autoSelection.label")}
					htmlFor="translate-auto-selection"
				>
					<Switch
						id="translate-auto-selection"
						checked={tr.autoTranslateSelection}
						onCheckedChange={(v) =>
							patchTranslate({ autoTranslateSelection: v })
						}
					/>
				</SettingsRow>
			</SettingsGroup>

			{showAgent && (
				<>
					<SettingsGroup>
						{agentModelCatalog.availableAgents.length === 0 && isTauri() ? (
							<div className="flex flex-col gap-2 px-3.5 py-2.5">
								<p className="text-muted-foreground text-xs leading-relaxed">
									{t("translate.agentId.empty")}
								</p>
								{onOpenAgentSettings && (
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="w-fit"
										onClick={onOpenAgentSettings}
									>
										{t("translate.agentId.openAgentSettings")}
									</Button>
								)}
							</div>
						) : !isTauri() ? (
							<div className="px-3.5 py-2.5 text-muted-foreground text-xs">
								{t("agent.desktopOnly")}
							</div>
						) : (
							<AgentModelSelects
								value={agentModelValue}
								onChange={onAgentModelChange}
								agentSelectValue={agentModelCatalog.agentSelectValue}
								modelSelectValue={agentModelCatalog.modelSelectValue}
								availableAgents={agentModelCatalog.availableAgents}
								defaultAgent={agentModelCatalog.defaultAgent}
								models={agentModelCatalog.models}
								agentLabel={t("translate.agentId.label")}
								modelLabel={t("translate.modelId.label")}
								followDefaultLabel={t("translate.agentId.followDefault")}
								followDefaultNamedLabel={(name) =>
									t("translate.agentId.followDefaultNamed", { name })
								}
								followModelLabel={t("translate.modelId.followAgent")}
							/>
						)}
					</SettingsGroup>
					{agentModelCatalog.availableAgents.length > 0 &&
					agentModelCatalog.models.length === 0 ? (
						<p className="mb-3 px-0.5 text-muted-foreground text-xs leading-relaxed">
							{t("translate.modelId.needWarm")}
						</p>
					) : null}
				</>
			)}

			{showEndpoint && (
				<>
					<SettingsGroup>
						<div className="flex flex-col gap-1.5 px-3.5 py-2.5">
							<Label
								htmlFor="translate-free-base-url"
								className="font-normal text-[13px]"
							>
								{t("translate.freeBaseUrl.label")}
							</Label>
							<Input
								id="translate-free-base-url"
								value={tr.freeBaseUrl}
								onChange={(e) =>
									patchTranslate({ freeBaseUrl: e.target.value })
								}
								onBlur={() => {
									const trimmed = tr.freeBaseUrl.trim().replace(/\/+$/, "");
									if (trimmed !== tr.freeBaseUrl) {
										patchTranslate({ freeBaseUrl: trimmed });
									}
								}}
								placeholder="https://libretranslate.example"
								className="h-8 font-mono text-xs"
								spellCheck={false}
								autoComplete="off"
							/>
						</div>
					</SettingsGroup>
					<p className="px-0.5 text-muted-foreground text-xs leading-relaxed">
						{t("translate.freeBaseUrl.hint")}
					</p>
				</>
			)}
		</>
	);
}
