import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import {
	BookOpen,
	Bot,
	Camera,
	ChevronRight,
	Circle,
	FileText,
	Laptop,
	Library,
	LoaderCircle,
	LogOut,
	Search,
	Send,
	Settings2,
	WifiOff,
	X,
} from "lucide-react";
import { nanoid } from "nanoid";
import {
	lazy,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	type BridgeClientStatus,
	bridgeConnect,
	bridgeDisconnect,
	bridgeResume,
	bridgeRpc,
	bridgeStatus,
	listenBridgeEvent,
	listenBridgeStatus,
	listenPairPending,
	type PairPendingEvent,
} from "@/lib/bridge/client";
import { loadBridgePaperPdf } from "@/lib/bridge/pdf";
import { isTauri } from "@/lib/core/tauri";
import { cn } from "@/lib/core/utils";
import type { PaperMetadata } from "@/lib/paper/types";

type MobileTab = "library" | "reader" | "agent" | "settings";

const MobilePdfViewer = lazy(() =>
	import("@/components/viewer/embed/pdf-viewer").then((module) => ({
		default: module.PdfViewer,
	})),
);

const TABS: Array<{ id: MobileTab; icon: typeof Library }> = [
	{ id: "library", icon: Library },
	{ id: "reader", icon: BookOpen },
	{ id: "agent", icon: Bot },
	{ id: "settings", icon: Settings2 },
];

export default function MobileApp() {
	const { t } = useTranslation("mobile");
	const [tab, setTab] = useState<MobileTab>("library");
	const [status, setStatus] = useState<BridgeClientStatus>({
		connected: false,
		paired: false,
	});
	const [papers, setPapers] = useState<PaperMetadata[]>([]);
	const [selectedPaper, setSelectedPaper] = useState<PaperMetadata | null>(
		null,
	);
	const [pairPending, setPairPending] = useState<PairPendingEvent | null>(null);

	useEffect(() => {
		if (!isTauri()) return;
		let active = true;
		const unlisten: Array<() => void> = [];
		void bridgeResume()
			.catch(() => bridgeStatus())
			.then((next) => active && setStatus(next))
			.catch(() => undefined);
		void listenBridgeStatus((next) => active && setStatus(next)).then((off) =>
			unlisten.push(off),
		);
		void listenPairPending((next) => active && setPairPending(next)).then(
			(off) => unlisten.push(off),
		);
		return () => {
			active = false;
			for (const off of unlisten) off();
		};
	}, []);

	useEffect(() => {
		if (!status.paired) {
			setPapers([]);
			setSelectedPaper(null);
			return;
		}
		void bridgeRpc<PaperMetadata[]>("paper_list")
			.then(setPapers)
			.catch(() => undefined);
	}, [status.paired]);

	if (!status.paired) {
		return (
			<MobilePairing
				status={status}
				pending={pairPending}
				onStatus={setStatus}
			/>
		);
	}

	return (
		<div className="mobile-shell flex min-h-dvh bg-background text-foreground">
			<aside className="hidden w-20 shrink-0 flex-col items-center border-r bg-muted/25 py-6 md:flex">
				<MobileBrand />
				<MobileNav tab={tab} onTab={setTab} vertical />
			</aside>
			<main className="flex min-h-dvh min-w-0 flex-1 flex-col pb-20 md:pb-0">
				<header className="flex h-14 shrink-0 items-center justify-between border-b px-4 md:px-6">
					<div className="flex min-w-0 items-center gap-2">
						<div className="md:hidden">
							<MobileBrand />
						</div>
						<Laptop className="size-4 shrink-0 text-muted-foreground" />
						<span className="truncate font-medium text-sm">
							{status.hostName ?? t("connect.offline")}
						</span>
					</div>
					<span className="flex items-center gap-1.5 text-muted-foreground text-xs">
						<Circle
							className={cn(
								"size-2 fill-current",
								status.connected ? "text-emerald-500" : "text-muted-foreground",
							)}
						/>
						{status.connected ? t("settings.connected") : t("settings.offline")}
					</span>
				</header>
				<div className="min-h-0 flex-1 overflow-hidden">
					{tab === "library" ? (
						<MobileLibrary
							papers={papers}
							selected={selectedPaper}
							onSelect={(paper) => {
								setSelectedPaper(paper);
								setTab("reader");
							}}
						/>
					) : null}
					{tab === "reader" ? <MobileReader paper={selectedPaper} /> : null}
					{tab === "agent" ? <MobileAgent /> : null}
					{tab === "settings" ? (
						<MobileSettings status={status} onStatus={setStatus} />
					) : null}
				</div>
			</main>
			<nav className="fixed right-0 bottom-0 left-0 z-20 border-t bg-background/95 px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
				<MobileNav tab={tab} onTab={setTab} />
			</nav>
		</div>
	);
}

function MobileBrand() {
	return (
		<div className="grid size-8 place-items-center border bg-foreground text-background">
			<span className="font-semibold text-sm">A</span>
		</div>
	);
}

function MobileNav({
	tab,
	onTab,
	vertical = false,
}: {
	tab: MobileTab;
	onTab: (tab: MobileTab) => void;
	vertical?: boolean;
}) {
	const { t } = useTranslation("mobile");
	return (
		<div
			className={cn(
				"flex gap-1",
				vertical ? "mt-10 flex-col" : "justify-around",
			)}
		>
			{TABS.map(({ id, icon: Icon }) => (
				<button
					key={id}
					type="button"
					onClick={() => onTab(id)}
					className={cn(
						"flex items-center justify-center gap-1.5 px-3 py-2 text-xs outline-none transition-colors",
						vertical ? "size-10 px-0" : "min-w-14 flex-1 flex-col py-1",
						tab === id ? "text-foreground" : "text-muted-foreground",
					)}
					aria-label={t(`tabs.${id}`)}
					aria-current={tab === id ? "page" : undefined}
				>
					<Icon className="size-5" />
					{vertical ? null : <span>{t(`tabs.${id}`)}</span>}
				</button>
			))}
		</div>
	);
}

function MobilePairing({
	status,
	pending,
	onStatus,
}: {
	status: BridgeClientStatus;
	pending: PairPendingEvent | null;
	onStatus: (status: BridgeClientStatus) => void;
}) {
	const { t } = useTranslation("mobile");
	const [offerUrl, setOfferUrl] = useState("");
	const [connecting, setConnecting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [scannerOpen, setScannerOpen] = useState(false);
	const handleScannedOffer = useCallback((value: string) => {
		setOfferUrl(value);
		setError(null);
		setScannerOpen(false);
	}, []);
	const connect = async () => {
		setConnecting(true);
		setError(null);
		try {
			const next = await bridgeConnect({
				offerUrl,
				deviceName: navigator.userAgent.includes("iPad") ? "iPad" : "iPhone",
			});
			onStatus(next);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t("errors.connect"));
		} finally {
			setConnecting(false);
		}
	};
	return (
		<div className="flex min-h-dvh flex-col bg-background px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-8 sm:px-8 md:mx-auto md:max-w-2xl">
			<MobileBrand />
			<div className="flex flex-1 flex-col justify-center py-12">
				<h1 className="text-2xl font-semibold">{t("connect.title")}</h1>
				<div className="mt-8 space-y-3">
					<label className="text-sm font-medium" htmlFor="pair-link">
						{t("connect.paste")}
					</label>
					<Textarea
						id="pair-link"
						value={offerUrl}
						onChange={(event) => setOfferUrl(event.target.value)}
						placeholder={t("connect.placeholder")}
						className="min-h-28 resize-none font-mono text-xs"
						autoCapitalize="off"
						autoCorrect="off"
						spellCheck={false}
					/>
					<Button
						className="w-full"
						size="lg"
						disabled={connecting || !offerUrl.trim()}
						onClick={() => void connect()}
					>
						{connecting ? (
							<LoaderCircle className="size-4 animate-spin" />
						) : (
							<Laptop className="size-4" />
						)}
						{connecting ? t("connect.connecting") : t("connect.action")}
					</Button>
					<Button
						type="button"
						variant="outline"
						className="w-full"
						onClick={() => setScannerOpen(true)}
					>
						<Camera className="size-4" />
						{t("connect.camera")}
					</Button>
				</div>
				{pending ? (
					<div className="mt-8 border-l-2 border-foreground px-4 py-2">
						<p className="text-sm">{t("connect.pending")}</p>
						<p className="mt-1 font-mono text-2xl tabular-nums">
							{pending.verificationCode}
						</p>
					</div>
				) : null}
				{error || status.lastError ? (
					<p className="mt-4 text-destructive text-sm">
						{error ?? status.lastError}
					</p>
				) : null}
			</div>
			{scannerOpen ? (
				<MobileQrScanner
					onClose={() => setScannerOpen(false)}
					onScan={handleScannedOffer}
				/>
			) : null}
		</div>
	);
}

function MobileQrScanner({
	onClose,
	onScan,
}: {
	onClose: () => void;
	onScan: (value: string) => void;
}) {
	const { t } = useTranslation("mobile");
	const videoRef = useRef<HTMLVideoElement>(null);
	const controlsRef = useRef<IScannerControls | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		let active = true;
		const reader = new BrowserQRCodeReader();
		void reader
			.decodeFromConstraints(
				{ audio: false, video: { facingMode: { ideal: "environment" } } },
				video,
				(result, _error, controls) => {
					controlsRef.current = controls;
					if (!result || !active) return;
					controls.stop();
					onScan(result.getText());
				},
			)
			.then((controls) => {
				controlsRef.current = controls;
			})
			.catch(() => active && setFailed(true));
		return () => {
			active = false;
			controlsRef.current?.stop();
		};
	}, [onScan]);

	return (
		<div
			className="fixed inset-0 z-50 flex flex-col bg-background px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
			role="dialog"
			aria-modal="true"
			aria-label={t("connect.camera")}
		>
			<div className="flex items-center justify-between">
				<p className="font-medium text-sm">{t("connect.camera")}</p>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={t("connect.cancel")}
					onClick={onClose}
				>
					<X className="size-4" />
				</Button>
			</div>
			<div className="relative my-auto aspect-square overflow-hidden border bg-black">
				<video
					ref={videoRef}
					className="size-full object-cover"
					muted
					playsInline
				/>
				<div className="pointer-events-none absolute inset-[15%] border-2 border-white/90" />
			</div>
			<p className="mt-5 text-center text-muted-foreground text-sm">
				{failed ? t("connect.cameraUnavailable") : t("connect.cameraHint")}
			</p>
		</div>
	);
}

function MobileLibrary({
	papers,
	selected,
	onSelect,
}: {
	papers: PaperMetadata[];
	selected: PaperMetadata | null;
	onSelect: (paper: PaperMetadata) => void;
}) {
	const { t } = useTranslation("mobile");
	const [query, setQuery] = useState("");
	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) return papers;
		return papers.filter((paper) =>
			`${paper.title} ${paper.authors.join(" ")}`
				.toLowerCase()
				.includes(normalized),
		);
	}, [papers, query]);
	return (
		<section className="flex h-full min-h-0 flex-col">
			<div className="border-b px-4 py-4 md:px-6">
				<h1 className="font-semibold text-lg">{t("library.title")}</h1>
				<div className="relative mt-3">
					<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t("library.search")}
						className="pl-9"
					/>
				</div>
			</div>
			<div className="agentero-scroll flex-1">
				<ul className="divide-y">
					{filtered.map((paper) => (
						<li key={paper.path ?? paper.id}>
							<button
								type="button"
								onClick={() => onSelect(paper)}
								className={cn(
									"flex w-full items-center gap-3 px-4 py-4 text-left md:px-6",
									selected?.id === paper.id && "bg-muted/60",
								)}
							>
								<div className="grid size-10 shrink-0 place-items-center border bg-muted text-muted-foreground">
									<BookOpen className="size-4" />
								</div>
								<span className="min-w-0 flex-1">
									<span className="line-clamp-2 block font-medium text-sm">
										{paper.title}
									</span>
									<span className="mt-1 block truncate text-muted-foreground text-xs">
										{paper.authors.join(", ")}
										{paper.year ? ` · ${paper.year}` : ""}
									</span>
								</span>
								<ChevronRight className="size-4 shrink-0 text-muted-foreground" />
							</button>
						</li>
					))}
				</ul>
				{filtered.length === 0 ? (
					<div className="grid h-full place-items-center text-muted-foreground text-sm">
						{t("library.empty")}
					</div>
				) : null}
			</div>
		</section>
	);
}

function MobileReader({ paper }: { paper: PaperMetadata | null }) {
	const { t } = useTranslation("mobile");
	const [notes, setNotes] = useState("");
	const [saving, setSaving] = useState(false);
	const [mode, setMode] = useState<"pdf" | "notes">("pdf");
	const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);
	const [pdfError, setPdfError] = useState<string | null>(null);
	useEffect(() => {
		setNotes("");
		setPdfBytes(null);
		setPdfError(null);
		if (!paper?.path) return;
		let active = true;
		void bridgeRpc<string>("vault_read_text", {
			path: `${paper.path}/NOTES.md`,
		})
			.then((content) => active && setNotes(content))
			.catch(() => undefined);
		void loadBridgePaperPdf(paper.path)
			.then((blob) => blob.arrayBuffer())
			.then((bytes) => active && setPdfBytes(bytes))
			.catch((error) => {
				if (!active) return;
				setPdfError(
					error instanceof Error ? error.message : t("reader.pdfUnavailable"),
				);
			});
		return () => {
			active = false;
		};
	}, [paper?.path, t]);
	if (!paper)
		return (
			<div className="grid h-full place-items-center text-muted-foreground text-sm">
				{t("reader.empty")}
			</div>
		);
	const save = async () => {
		if (!paper.path) return;
		setSaving(true);
		try {
			await bridgeRpc("vault_write_text", {
				path: `${paper.path}/NOTES.md`,
				content: notes,
			});
		} finally {
			setSaving(false);
		}
	};
	const pdf = (
		<MobilePdfPreview
			bytes={pdfBytes}
			error={pdfError}
			docId={`bridge:${paper.id}`}
			paperPath={paper.path ?? null}
			t={t}
		/>
	);
	const notesEditor = (
		<div className="flex min-h-0 flex-1 flex-col">
			<Textarea
				value={notes}
				onChange={(event) => setNotes(event.target.value)}
				className="min-h-0 flex-1 resize-none rounded-none border-0 p-4 font-mono text-sm shadow-none focus-visible:ring-0 md:px-6"
				placeholder=""
			/>
			<footer className="flex justify-end border-t px-4 py-3 md:px-6">
				<Button size="sm" disabled={saving} onClick={() => void save()}>
					{saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
					{saving ? t("reader.saving") : t("reader.save")}
				</Button>
			</footer>
		</div>
	);
	return (
		<section className="flex h-full min-h-0 flex-col">
			<header className="flex shrink-0 items-center gap-3 border-b px-4 py-3 md:px-6">
				<div className="min-w-0 flex-1">
					<p className="line-clamp-2 font-semibold text-base">{paper.title}</p>
					<p className="mt-1 text-muted-foreground text-xs">
						{t("reader.title")}
					</p>
				</div>
				<div className="flex shrink-0 border bg-muted p-0.5 md:hidden">
					<button
						type="button"
						aria-label={t("reader.pdf")}
						aria-pressed={mode === "pdf"}
						onClick={() => setMode("pdf")}
						className={cn(
							"grid size-8 place-items-center",
							mode === "pdf" && "bg-background shadow-sm",
						)}
					>
						<BookOpen className="size-4" />
					</button>
					<button
						type="button"
						aria-label={t("reader.notes")}
						aria-pressed={mode === "notes"}
						onClick={() => setMode("notes")}
						className={cn(
							"grid size-8 place-items-center",
							mode === "notes" && "bg-background shadow-sm",
						)}
					>
						<FileText className="size-4" />
					</button>
				</div>
			</header>
			<div className="min-h-0 flex-1 md:hidden">
				{mode === "pdf" ? pdf : notesEditor}
			</div>
			<div className="hidden min-h-0 flex-1 md:grid md:grid-cols-2 md:divide-x">
				{pdf}
				{notesEditor}
			</div>
		</section>
	);
}

function MobilePdfPreview({
	bytes,
	error,
	docId,
	paperPath,
	t,
}: {
	bytes: ArrayBuffer | null;
	error: string | null;
	docId: string;
	paperPath: string | null;
	t: (key: "reader.loadingPdf" | "reader.pdfUnavailable") => string;
}) {
	if (error) {
		return (
			<div className="grid h-full place-items-center p-6 text-center text-muted-foreground text-sm">
				{error || t("reader.pdfUnavailable")}
			</div>
		);
	}
	if (!bytes) {
		return (
			<div className="grid h-full place-items-center gap-2 text-muted-foreground text-sm">
				<LoaderCircle className="size-5 animate-spin" />
				{t("reader.loadingPdf")}
			</div>
		);
	}
	return (
		<div className="h-full min-h-0">
			<Suspense
				fallback={
					<div className="grid h-full place-items-center">
						<LoaderCircle className="size-5 animate-spin text-muted-foreground" />
					</div>
				}
			>
				<MobilePdfViewer
					source={null}
					sourceBytes={bytes}
					docId={docId}
					paperRelPath={paperPath}
					className="h-full"
				/>
			</Suspense>
		</div>
	);
}

type AgentStreamEvent = {
	sessionId: string;
	chunk: string;
};

type AgentResultEvent = {
	sessionId: string;
	content: string;
};

type AgentPermissionOption = {
	optionId: string;
	name: string;
	kind: string;
};

type AgentPermissionRequest = {
	requestId: string;
	sessionId: string;
	title: string;
	paths: string[];
	options: AgentPermissionOption[];
};

type AgentLine = {
	id: string;
	role: "assistant" | "user";
	text: string;
	streaming?: boolean;
};

function MobileAgent() {
	const { t } = useTranslation("mobile");
	const [text, setText] = useState("");
	const [lines, setLines] = useState<AgentLine[]>([]);
	const [sending, setSending] = useState(false);
	const [permission, setPermission] = useState<AgentPermissionRequest | null>(
		null,
	);
	const sessionRef = useRef<string | null>(null);
	const pendingPermissionRef = useRef<AgentPermissionRequest | null>(null);
	pendingPermissionRef.current = permission;

	useEffect(() => {
		let active = true;
		const unlisten: Array<() => void> = [];
		void listenBridgeEvent<AgentStreamEvent>("agent:stream", (event) => {
			if (!active || event.sessionId !== sessionRef.current) return;
			setLines((current) => {
				const last = current.at(-1);
				if (last?.role === "assistant" && last.streaming) {
					return [
						...current.slice(0, -1),
						{ ...last, text: `${last.text}${event.chunk}` },
					];
				}
				return [
					...current,
					{
						id: nanoid(),
						role: "assistant",
						text: event.chunk,
						streaming: true,
					},
				];
			});
		}).then((off) => unlisten.push(off));
		void listenBridgeEvent<AgentResultEvent>("agent:completed", (event) => {
			if (!active || event.sessionId !== sessionRef.current) return;
			setSending(false);
			setLines((current) => {
				const last = current.at(-1);
				if (last?.role === "assistant" && last.streaming) {
					return [...current.slice(0, -1), { ...last, streaming: false }];
				}
				return event.content
					? [
							...current,
							{ id: nanoid(), role: "assistant", text: event.content },
						]
					: current;
			});
		}).then((off) => unlisten.push(off));
		void listenBridgeEvent<{ sessionId: string; error?: string }>(
			"agent:failed",
			(event) => {
				if (!active || event.sessionId !== sessionRef.current) return;
				setSending(false);
				setLines((current) => [
					...current,
					{
						id: nanoid(),
						role: "assistant",
						text: event.error ?? t("agent.failed"),
					},
				]);
			},
		).then((off) => unlisten.push(off));
		void listenBridgeEvent<AgentPermissionRequest>(
			"agent:permission-request",
			(event) => {
				if (!active || event.sessionId !== sessionRef.current) return;
				setPermission(event);
			},
		).then((off) => unlisten.push(off));
		return () => {
			active = false;
			for (const off of unlisten) off();
			const pending = pendingPermissionRef.current;
			if (pending) {
				void bridgeRpc("agent_respond_permission", {
					requestId: pending.requestId,
					optionId: null,
				});
			}
		};
	}, [t]);

	const respondToPermission = (optionId: string | null) => {
		const pending = permission;
		if (!pending) return;
		setPermission(null);
		void bridgeRpc("agent_respond_permission", {
			requestId: pending.requestId,
			optionId,
		});
	};

	const send = async () => {
		const next = text.trim();
		if (!next || sending) return;
		setLines((previous) => [
			...previous,
			{ id: nanoid(), role: "user", text: next },
		]);
		setText("");
		setSending(true);
		try {
			const accepted = await bridgeRpc<{ sessionId: string }>(
				"agent_run_once",
				{
					prompt: next,
					permissionMode: "ask",
				},
			);
			sessionRef.current = accepted.sessionId;
		} catch (error) {
			setSending(false);
			setLines((current) => [
				...current,
				{
					id: nanoid(),
					role: "assistant",
					text: error instanceof Error ? error.message : t("agent.failed"),
				},
			]);
		}
	};
	return (
		<>
			<section className="flex h-full min-h-0 flex-col">
				<header className="border-b px-4 py-4 md:px-6">
					<h1 className="font-semibold text-lg">{t("agent.title")}</h1>
				</header>
				<div className="agentero-scroll flex-1 px-4 py-5 md:px-6">
					{lines.length === 0 ? (
						<p className="text-muted-foreground text-sm">{t("agent.empty")}</p>
					) : (
						<div className="space-y-3">
							{lines.map((line) => (
								<div
									key={line.id}
									className={cn(
										"max-w-[85%] border px-3 py-2 text-sm",
										line.role === "user"
											? "ml-auto bg-muted"
											: "mr-auto bg-background",
									)}
								>
									{line.text}
								</div>
							))}
						</div>
					)}
				</div>
				<footer className="flex gap-2 border-t p-3 md:px-6">
					<Input
						value={text}
						onChange={(event) => setText(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								void send();
							}
						}}
						placeholder={t("agent.placeholder")}
					/>
					<Button
						size="icon"
						aria-label={t("agent.send")}
						disabled={sending || !text.trim()}
						onClick={() => void send()}
					>
						{sending ? (
							<LoaderCircle className="size-4 animate-spin" />
						) : (
							<Send className="size-4" />
						)}
					</Button>
				</footer>
			</section>
			<MobilePermissionDialog
				permission={permission}
				onRespond={respondToPermission}
			/>
		</>
	);
}

function MobilePermissionDialog({
	permission,
	onRespond,
}: {
	permission: AgentPermissionRequest | null;
	onRespond: (optionId: string | null) => void;
}) {
	const { t } = useTranslation("agent");
	return (
		<Dialog
			open={permission !== null}
			onOpenChange={(open) => {
				if (!open) onRespond(null);
			}}
		>
			<DialogContent showCloseButton={false} className="max-w-md rounded-lg">
				{permission ? (
					<>
						<DialogHeader>
							<DialogTitle>{t("permission.title")}</DialogTitle>
							<DialogDescription>{permission.title}</DialogDescription>
						</DialogHeader>
						{permission.paths.length ? (
							<div className="space-y-1">
								{permission.paths.map((path) => (
									<code
										key={path}
										className="block truncate bg-muted px-2 py-1 text-xs"
										title={path}
									>
										{path}
									</code>
								))}
							</div>
						) : null}
						<DialogFooter className="sm:flex-col">
							{permission.options.map((option) => (
								<Button
									key={option.optionId}
									variant={
										option.kind.startsWith("allow") ? "default" : "outline"
									}
									onClick={() => onRespond(option.optionId)}
								>
									{option.name || option.kind}
								</Button>
							))}
							<Button variant="ghost" onClick={() => onRespond(null)}>
								{t("permission.deny")}
							</Button>
						</DialogFooter>
					</>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function MobileSettings({
	status,
	onStatus,
}: {
	status: BridgeClientStatus;
	onStatus: (status: BridgeClientStatus) => void;
}) {
	const { t } = useTranslation("mobile");
	const disconnect = async () => {
		await bridgeDisconnect();
		onStatus({ connected: false, paired: false });
	};
	return (
		<section className="px-4 py-5 md:px-6">
			<h1 className="font-semibold text-lg">{t("settings.title")}</h1>
			<dl className="mt-5 divide-y border-y">
				<div className="flex items-center justify-between gap-4 py-3">
					<dt className="text-muted-foreground text-sm">
						{t("settings.computer")}
					</dt>
					<dd className="truncate text-sm">{status.hostName ?? "-"}</dd>
				</div>
				<div className="flex items-center justify-between gap-4 py-3">
					<dt className="text-muted-foreground text-sm">
						{t("settings.vault")}
					</dt>
					<dd className="truncate text-sm">{status.vaultName ?? "-"}</dd>
				</div>
			</dl>
			<Button
				variant="outline"
				className="mt-5"
				onClick={() => void disconnect()}
			>
				<LogOut className="size-4" />
				{t("settings.disconnect")}
			</Button>
			{!status.connected ? (
				<p className="mt-4 flex items-center gap-2 text-muted-foreground text-sm">
					<WifiOff className="size-4" />
					{t("connect.offline")}
				</p>
			) : null}
		</section>
	);
}
