/**
 * Background tasks floater (bottom-left).
 * Collapsed: circular progress ring only.
 * Expanded / hover: task detail list (no summary toast chip).
 * Ring center cycles: progress % ↔ task icon.
 */
import {
	BookOpen,
	CheckCircle2,
	CircleX,
	Download,
	FileUp,
	LayoutGrid,
	ListOrdered,
	Loader2,
	Package,
	Plug,
	Search,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBackgroundTasks } from "@/hooks/use-background-tasks";
import {
	type BackgroundTask,
	type BackgroundTaskKind,
	cancelBackgroundTask,
	clearFinishedBackgroundTasks,
	getActiveBackgroundTasks,
	isFinishedBackgroundTask,
	setBackgroundTasksExpanded,
} from "@/lib/core/background-tasks";
import { cn } from "@/lib/core/utils";

/** Dwell before expanding detail from the ring (avoids flicker on pass-over). */
const HOVER_EXPAND_MS = 400;

/** Center icon for the primary active task kind. */
function kindIcon(kind: BackgroundTaskKind | undefined) {
	const cls = "relative size-3.5 text-primary";
	switch (kind) {
		case "download":
		case "downloadAll":
			return <Download className={cls} aria-hidden />;
		case "lookup":
			return <Search className={cls} aria-hidden />;
		case "import":
			return <FileUp className={cls} aria-hidden />;
		case "export":
			return <Package className={cls} aria-hidden />;
		case "parse":
			return <LayoutGrid className={cls} aria-hidden />;
		case "paperRead":
			return <BookOpen className={cls} aria-hidden />;
		case "connector":
			return <Plug className={cls} aria-hidden />;
		default:
			return <ListOrdered className={cls} aria-hidden />;
	}
}

function statusIcon(task: BackgroundTask) {
	switch (task.status) {
		case "running":
			return (
				<Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
			);
		case "queued":
			return (
				<ListOrdered className="size-3.5 shrink-0 text-muted-foreground" />
			);
		case "completed":
			return (
				<CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
			);
		case "failed":
			return <CircleX className="size-3.5 shrink-0 text-destructive" />;
		case "cancelled":
			return <CircleX className="size-3.5 shrink-0 text-muted-foreground" />;
	}
}

function TaskRow({ task }: { task: BackgroundTask }) {
	const { t } = useTranslation("app");
	const showBar =
		task.status === "running" ||
		task.status === "queued" ||
		task.progress !== null;

	return (
		<div className="flex flex-col gap-1 border-b border-border/60 px-2.5 py-2 last:border-b-0">
			<div className="flex min-w-0 items-start gap-2">
				<span className="mt-0.5">{statusIcon(task)}</span>
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-1.5">
						{task.queueIndex > 0 ? (
							<span className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
								#{task.queueIndex}
							</span>
						) : null}
						<span className="truncate font-medium text-xs leading-tight">
							{task.title}
						</span>
						{task.progress != null &&
						(task.status === "running" || task.status === "queued") ? (
							<span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
								{Math.round(task.progress)}%
							</span>
						) : null}
					</div>
					{task.detail ? (
						<p
							className={cn(
								"mt-0.5 truncate text-[11px] leading-snug text-muted-foreground",
								task.status === "failed" && "text-destructive",
							)}
							title={task.detail}
						>
							{task.detail}
						</p>
					) : null}
				</div>
				{task.status === "queued" || task.status === "running" ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								className="size-6 shrink-0"
								aria-label={t("tasks.cancel")}
								onClick={() => cancelBackgroundTask(task.id)}
							>
								<X className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="left">{t("tasks.cancel")}</TooltipContent>
					</Tooltip>
				) : null}
			</div>
			{showBar &&
			task.status !== "completed" &&
			task.status !== "failed" &&
			task.status !== "cancelled" ? (
				<Progress
					value={task.progress ?? undefined}
					className={cn(
						"h-1",
						task.progress == null && "animate-pulse opacity-70",
					)}
				/>
			) : null}
		</div>
	);
}

type RingCenterPhase = "progress" | "icon";

const RING_CENTER_MS = 2400;

/** Circular progress control — center cycles progress / kind icon. */
function ProgressRing({
	activeCount,
	failed,
	label,
	progress,
	taskKind,
	onActivate,
}: {
	activeCount: number;
	failed: boolean;
	label: string;
	progress: number | null;
	taskKind?: BackgroundTaskKind;
	onActivate: () => void;
}) {
	const radius = 16;
	const circumference = 2 * Math.PI * radius;
	const normalizedProgress =
		progress == null ? null : Math.max(0, Math.min(100, progress));
	const offset =
		normalizedProgress == null
			? 0
			: circumference - (normalizedProgress / 100) * circumference;

	const [phase, setPhase] = useState<RingCenterPhase>("progress");
	const active = activeCount > 0 && !failed;

	useEffect(() => {
		if (!active) {
			setPhase("progress");
			return;
		}
		const order: RingCenterPhase[] = ["progress", "icon"];
		const id = window.setInterval(() => {
			setPhase((prev) => {
				const i = order.indexOf(prev);
				return order[(i + 1) % order.length] ?? "progress";
			});
		}, RING_CENTER_MS);
		return () => window.clearInterval(id);
	}, [active]);

	const center = (() => {
		if (failed) {
			return <CircleX className="relative size-3.5 text-destructive" />;
		}
		if (activeCount === 0) {
			return (
				<CheckCircle2 className="relative size-3.5 text-emerald-600 dark:text-emerald-400" />
			);
		}
		// Active work: cycle progress ↔ kind icon.
		if (phase === "icon") {
			return kindIcon(taskKind);
		}
		// progress phase
		if (activeCount > 1) {
			return (
				<span className="relative font-mono font-medium text-[11px] tabular-nums">
					{activeCount}
				</span>
			);
		}
		if (normalizedProgress != null) {
			return (
				<span className="relative font-mono font-medium text-[9px] tabular-nums leading-none text-foreground">
					{Math.round(normalizedProgress)}%
				</span>
			);
		}
		// No numeric progress yet — show task icon.
		return kindIcon(taskKind);
	})();

	return (
		<button
			type="button"
			className="relative flex size-9 items-center justify-center bg-transparent text-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
			aria-label={label}
			aria-expanded={false}
			onClick={onActivate}
			onFocus={onActivate}
		>
			{/* Progress ring is the outermost visual — no chip background. */}
			<svg
				className="pointer-events-none absolute inset-0 size-9 -rotate-90"
				viewBox="0 0 40 40"
				aria-hidden="true"
			>
				<circle
					cx="20"
					cy="20"
					r={radius}
					fill="none"
					stroke="currentColor"
					strokeWidth="3"
					className="text-muted"
				/>
				<circle
					cx="20"
					cy="20"
					r={radius}
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
					strokeWidth="3"
					strokeDasharray={
						normalizedProgress == null
							? `${circumference * 0.28} ${circumference}`
							: circumference
					}
					strokeDashoffset={offset}
					className={cn(
						"text-primary transition-[stroke-dashoffset]",
						failed && "text-destructive",
						activeCount === 0 &&
							!failed &&
							"text-emerald-600 dark:text-emerald-400",
					)}
				/>
			</svg>
			{/* Center content — same midpoint as the ring */}
			<span className="pointer-events-none absolute inset-0 flex items-center justify-center">
				{center}
			</span>
		</button>
	);
}

export function BackgroundTasksPanel({ className }: { className?: string }) {
	const { t } = useTranslation("app");
	const { tasks, expanded } = useBackgroundTasks();
	const hoverExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	const clearHoverExpandTimer = () => {
		if (hoverExpandTimerRef.current) {
			clearTimeout(hoverExpandTimerRef.current);
			hoverExpandTimerRef.current = null;
		}
	};

	const scheduleHoverExpand = () => {
		clearHoverExpandTimer();
		hoverExpandTimerRef.current = setTimeout(() => {
			hoverExpandTimerRef.current = null;
			setBackgroundTasksExpanded(true);
		}, HOVER_EXPAND_MS);
	};

	const collapseOnLeave = () => {
		clearHoverExpandTimer();
		setBackgroundTasksExpanded(false);
	};

	useEffect(() => {
		return () => {
			if (hoverExpandTimerRef.current) {
				clearTimeout(hoverExpandTimerRef.current);
				hoverExpandTimerRef.current = null;
			}
		};
	}, []);

	const active = useMemo(() => getActiveBackgroundTasks(tasks), [tasks]);
	const visible = useMemo(() => {
		const act = [...active].sort((a, b) => a.queueIndex - b.queueIndex);
		const done = tasks
			.filter(isFinishedBackgroundTask)
			.sort((a, b) => b.updatedAt - a.updatedAt)
			.slice(0, 6);
		return [...act, ...done];
	}, [tasks, active]);

	const hasFinished = tasks.some(isFinishedBackgroundTask);
	const hasFailed = visible.some((task) => task.status === "failed");

	if (tasks.length === 0) return null;

	const ringProgress =
		active.length > 0 && active.some((task) => task.progress != null)
			? Math.round(
					active
						.filter((task) => task.progress != null)
						.reduce((sum, task) => sum + (task.progress ?? 0), 0) /
						active.filter((task) => task.progress != null).length,
				)
			: null;

	const ringLabel =
		active.length === 0
			? t("tasks.idle")
			: active.length === 1
				? (active[0]?.title ?? t("tasks.title"))
				: t("tasks.activeCount", { count: active.length });

	return (
		<TooltipProvider delayDuration={300}>
			<section
				className={cn(
					"pointer-events-auto fixed bottom-3 left-3 z-50 flex flex-col items-start gap-1",
					expanded ? "w-[min(20rem,calc(100vw-1.5rem))]" : "w-9",
					className,
				)}
				aria-label={t("tasks.title")}
				onMouseEnter={scheduleHoverExpand}
				onMouseLeave={collapseOnLeave}
			>
				{expanded ? (
					<div className="w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg">
						<div className="flex h-8 items-center gap-1 border-b bg-muted/40 px-2">
							<span className="min-w-0 flex-1 truncate px-1 font-medium text-xs">
								{t("tasks.title")}
								{active.length > 0 ? (
									<span className="ml-1.5 text-muted-foreground tabular-nums">
										({active.length})
									</span>
								) : null}
							</span>
							{hasFinished ? (
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											className="size-6"
											aria-label={t("tasks.clearFinished")}
											onClick={() => clearFinishedBackgroundTasks()}
										>
											<X className="size-3.5" />
										</Button>
									</TooltipTrigger>
									<TooltipContent side="top">
										{t("tasks.clearFinished")}
									</TooltipContent>
								</Tooltip>
							) : null}
						</div>
						<div className="agentero-scroll max-h-56 overflow-y-auto">
							{visible.length === 0 ? (
								<p className="px-3 py-4 text-center text-muted-foreground text-xs">
									{t("tasks.empty")}
								</p>
							) : (
								visible.map((task) => <TaskRow key={task.id} task={task} />)
							)}
						</div>
					</div>
				) : (
					<ProgressRing
						activeCount={active.length}
						failed={hasFailed}
						label={ringLabel}
						progress={ringProgress}
						taskKind={active[0]?.kind}
						onActivate={() => setBackgroundTasksExpanded(true)}
					/>
				)}
			</section>
		</TooltipProvider>
	);
}
