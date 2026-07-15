import type { UnlistenFn } from "@tauri-apps/api/event";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import { AskGutter } from "@/components/viewer/pdf-ask/ask-gutter";
import { AskPopover } from "@/components/viewer/pdf-ask/ask-popover";
import {
	cancelAgentRun,
	listenAgentCompleted,
	listenAgentFailed,
	listenAgentStream,
	runOnce,
} from "@/lib/agent";
import {
	anchorFromPoint,
	anchorFromSelection,
	createEmptyThread,
	findPageElByNumber,
	listPdfAskThreads,
	newMessageId,
	PDF_PAGE_ATTR,
	popoverScreenPoint,
	toSummaries,
	writePdfAskThread,
} from "@/lib/pdf-ask";
import { buildPdfAskPrompt } from "@/lib/pdf-ask/prompt";
import type { PdfAskAnchor, PdfAskThread } from "@/lib/pdf-ask/types";
import { cn } from "@/lib/utils";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const DWELL_MS = 700;
const DWELL_MOVE_PX = 8;

type PdfViewerProps = {
	/** Remote http(s) URL only — PDF.js streams from network, not vault disk */
	source: string | null;
	/** Absolute path to paper folder for asks/*.json persistence */
	paperAbsPath?: string | null;
	/** Vault-relative paper path stored inside JSON */
	paperRelPath?: string | null;
	/** Current vault root for ACP cwd */
	vaultPath?: string | null;
	className?: string;
};

export function PdfViewer({
	source,
	paperAbsPath = null,
	paperRelPath = null,
	vaultPath = null,
	className,
}: PdfViewerProps) {
	const { t } = useTranslation("viewer");
	const hostRef = useRef<HTMLDivElement>(null);
	const [numPages, setNumPages] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [width, setWidth] = useState(640);
	const [pageHeights, setPageHeights] = useState<Record<number, number>>({});

	const [threads, setThreads] = useState<PdfAskThread[]>([]);
	const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
	const [popoverScreen, setPopoverScreen] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const [streaming, setStreaming] = useState(false);
	const [askError, setAskError] = useState<string | null>(null);

	const activeSessionRef = useRef<string | null>(null);
	const suppressSelectionUntilRef = useRef(0);
	const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const dwellOriginRef = useRef<{ x: number; y: number } | null>(null);
	const threadsRef = useRef(threads);
	threadsRef.current = threads;

	const remote = source && /^https?:\/\//i.test(source) ? source : null;

	const activeThread = useMemo(
		() => threads.find((th) => th.id === activeThreadId) ?? null,
		[threads, activeThreadId],
	);

	const summaries = useMemo(() => toSummaries(threads), [threads]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-bind observer when remote viewer mounts
	useEffect(() => {
		const el = hostRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width;
			if (w) setWidth(Math.max(280, Math.floor(w - 40)));
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [remote]);

	useEffect(() => {
		let cancelled = false;
		setThreads([]);
		setActiveThreadId(null);
		setPopoverScreen(null);
		setAskError(null);
		setStreaming(false);
		activeSessionRef.current = null;

		if (!paperAbsPath) return;

		void (async () => {
			const list = await listPdfAskThreads(paperAbsPath);
			if (!cancelled) setThreads(list);
		})();

		return () => {
			cancelled = true;
		};
	}, [paperAbsPath]);

	const persist = useCallback(
		async (thread: PdfAskThread) => {
			if (!paperAbsPath) return;
			try {
				await writePdfAskThread(paperAbsPath, thread);
			} catch {
				// disk errors surface on next load; keep UI responsive
			}
		},
		[paperAbsPath],
	);

	const upsertThread = useCallback((thread: PdfAskThread) => {
		setThreads((prev) => {
			const i = prev.findIndex((x) => x.id === thread.id);
			if (i < 0) return [thread, ...prev];
			const next = [...prev];
			next[i] = thread;
			return next;
		});
	}, []);

	const placePopover = useCallback((thread: PdfAskThread) => {
		const host = hostRef.current;
		if (!host) return;
		const pageEl = findPageElByNumber(host, thread.anchor.page);
		const pt = popoverScreenPoint(pageEl, thread.anchor.rects);
		if (pt) setPopoverScreen(pt);
		else setPopoverScreen({ x: 80, y: 120 });
	}, []);

	const openThread = useCallback(
		(thread: PdfAskThread) => {
			setActiveThreadId(thread.id);
			setAskError(null);
			placePopover(thread);
		},
		[placePopover],
	);

	const startFromAnchor = useCallback(
		(anchor: PdfAskAnchor) => {
			const paperPath = paperRelPath || paperAbsPath || "paper";
			const thread = createEmptyThread({ paperPath, anchor });
			upsertThread(thread);
			openThread(thread);
			void persist(thread);
		},
		[paperAbsPath, paperRelPath, upsertThread, openThread, persist],
	);

	// Selection + double-click + dwell triggers
	useEffect(() => {
		const host = hostRef.current;
		if (!host || !remote) return;

		const clearDwell = () => {
			if (dwellTimerRef.current) {
				clearTimeout(dwellTimerRef.current);
				dwellTimerRef.current = null;
			}
			dwellOriginRef.current = null;
		};

		const onMouseUp = () => {
			if (Date.now() < suppressSelectionUntilRef.current) return;
			window.setTimeout(() => {
				if (Date.now() < suppressSelectionUntilRef.current) return;
				const sel = window.getSelection();
				if (!sel || !host.contains(sel.anchorNode)) return;
				const anchor = anchorFromSelection(sel, host, "selection");
				if (!anchor) return;
				// Ignore trivial selections (accidental click noise)
				if ((anchor.quote?.length ?? 0) < 2) return;
				startFromAnchor(anchor);
			}, 0);
		};

		const onDblClick = (e: MouseEvent) => {
			if (!host.contains(e.target as Node)) return;
			suppressSelectionUntilRef.current = Date.now() + 400;
			window.setTimeout(() => {
				const sel = window.getSelection();
				const fromSel =
					sel && !sel.isCollapsed
						? anchorFromSelection(sel, host, "dblclick")
						: null;
				if (fromSel) {
					startFromAnchor(fromSel);
					return;
				}
				const pt = anchorFromPoint(e.clientX, e.clientY, host, "dblclick");
				if (pt) startFromAnchor(pt);
			}, 0);
		};

		const onPointerDown = (e: PointerEvent) => {
			if (e.button !== 0) return;
			if (!host.contains(e.target as Node)) return;
			if ((e.target as HTMLElement).closest?.("[data-pdf-ask-ui]")) return;
			clearDwell();
			dwellOriginRef.current = { x: e.clientX, y: e.clientY };
			dwellTimerRef.current = setTimeout(() => {
				const origin = dwellOriginRef.current;
				if (!origin) return;
				const sel = window.getSelection();
				const fromSel =
					sel && !sel.isCollapsed && host.contains(sel.anchorNode)
						? anchorFromSelection(sel, host, "dwell")
						: null;
				if (fromSel) {
					startFromAnchor(fromSel);
					return;
				}
				const pt = anchorFromPoint(origin.x, origin.y, host, "dwell");
				if (pt) startFromAnchor(pt);
			}, DWELL_MS);
		};

		const onPointerMove = (e: PointerEvent) => {
			const origin = dwellOriginRef.current;
			if (!origin) return;
			const dx = e.clientX - origin.x;
			const dy = e.clientY - origin.y;
			if (dx * dx + dy * dy > DWELL_MOVE_PX * DWELL_MOVE_PX) clearDwell();
		};

		const onPointerUp = () => clearDwell();
		const onPointerCancel = () => clearDwell();

		host.addEventListener("mouseup", onMouseUp);
		host.addEventListener("dblclick", onDblClick);
		host.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("pointercancel", onPointerCancel);

		return () => {
			clearDwell();
			host.removeEventListener("mouseup", onMouseUp);
			host.removeEventListener("dblclick", onDblClick);
			host.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
			window.removeEventListener("pointercancel", onPointerCancel);
		};
	}, [remote, startFromAnchor]);

	useEffect(() => {
		if (!activeThread) return;
		const host = hostRef.current;
		const scrollEl = host?.querySelector(".motif-scroll");
		const reposition = () => placePopover(activeThread);
		scrollEl?.addEventListener("scroll", reposition, { passive: true });
		window.addEventListener("resize", reposition);
		return () => {
			scrollEl?.removeEventListener("scroll", reposition);
			window.removeEventListener("resize", reposition);
		};
	}, [activeThread, placePopover]);

	const handleSend = useCallback(
		async (question: string) => {
			const threadId = activeThreadId;
			if (!threadId) return;
			const thread = threadsRef.current.find((th) => th.id === threadId);
			if (!thread) return;

			const userMsg = {
				id: newMessageId(),
				role: "user" as const,
				content: question,
				createdAt: new Date().toISOString(),
			};
			const withUser: PdfAskThread = {
				...thread,
				status: "open",
				messages: [...thread.messages, userMsg],
				updatedAt: new Date().toISOString(),
			};
			upsertThread(withUser);
			void persist(withUser);
			setAskError(null);
			setStreaming(true);

			const assistantId = newMessageId();
			const prompt = buildPdfAskPrompt(withUser, question);

			try {
				const accepted = await runOnce({
					prompt,
					vaultPath: vaultPath ?? undefined,
					workflow: "free",
					autoApprove: true,
				});
				activeSessionRef.current = accepted.sessionId;

				const withAssistant: PdfAskThread = {
					...withUser,
					messages: [
						...withUser.messages,
						{
							id: assistantId,
							role: "assistant",
							content: "",
							createdAt: new Date().toISOString(),
							agentSessionId: accepted.sessionId,
						},
					],
				};
				upsertThread(withAssistant);

				const sessionId = accepted.sessionId;
				const unsubs: UnlistenFn[] = [];

				const cleanup = () => {
					for (const u of unsubs) u();
					if (activeSessionRef.current === sessionId) {
						activeSessionRef.current = null;
					}
					setStreaming(false);
				};

				unsubs.push(
					await listenAgentStream((ev) => {
						if (ev.sessionId !== sessionId) return;
						if ((ev.kind ?? "message") === "thought") return;
						setThreads((prev) =>
							prev.map((th) => {
								if (th.id !== threadId) return th;
								const msgs = [...th.messages];
								const last = msgs[msgs.length - 1];
								if (last?.id !== assistantId) return th;
								msgs[msgs.length - 1] = {
									...last,
									content: last.content + ev.chunk,
								};
								return { ...th, messages: msgs };
							}),
						);
					}),
				);

				unsubs.push(
					await listenAgentCompleted((ev) => {
						if (ev.sessionId !== sessionId) return;
						setThreads((prev) => {
							const next = prev.map((th) => {
								if (th.id !== threadId) return th;
								const msgs = [...th.messages];
								const last = msgs[msgs.length - 1];
								if (last?.id === assistantId) {
									msgs[msgs.length - 1] = {
										...last,
										content: ev.content || last.content,
										sources: (ev.sources ?? []).map((uri) => ({ uri })),
									};
								}
								const done: PdfAskThread = {
									...th,
									messages: msgs,
									updatedAt: new Date().toISOString(),
								};
								void persist(done);
								return done;
							});
							return next;
						});
						cleanup();
					}),
				);

				unsubs.push(
					await listenAgentFailed((ev) => {
						if (ev.sessionId !== sessionId) return;
						setAskError(ev.error || t("pdfAsk.agentFailed"));
						setThreads((prev) =>
							prev.map((th) => {
								if (th.id !== threadId) return th;
								const msgs = th.messages.filter((m) => m.id !== assistantId);
								const done = { ...th, messages: msgs };
								void persist(done);
								return done;
							}),
						);
						cleanup();
					}),
				);
			} catch (e) {
				setStreaming(false);
				setAskError(e instanceof Error ? e.message : t("pdfAsk.agentFailed"));
			}
		},
		[activeThreadId, upsertThread, persist, vaultPath, t],
	);

	const handleClose = useCallback(() => {
		setActiveThreadId(null);
		setPopoverScreen(null);
		setAskError(null);
	}, []);

	const handleEnd = useCallback(() => {
		if (!activeThreadId) {
			handleClose();
			return;
		}
		const thread = threadsRef.current.find((th) => th.id === activeThreadId);
		if (thread) {
			const ended: PdfAskThread = {
				...thread,
				status: "ended",
				updatedAt: new Date().toISOString(),
			};
			upsertThread(ended);
			void persist(ended);
		}
		if (activeSessionRef.current) {
			void cancelAgentRun(activeSessionRef.current).catch(() => undefined);
			activeSessionRef.current = null;
		}
		setStreaming(false);
		handleClose();
	}, [activeThreadId, upsertThread, persist, handleClose]);

	const handleOpenPill = useCallback(
		(id: string) => {
			const thread = threadsRef.current.find((th) => th.id === id);
			if (!thread) return;
			const open: PdfAskThread = { ...thread, status: "open" };
			upsertThread(open);
			openThread(open);
		},
		[upsertThread, openThread],
	);

	if (!remote) {
		return (
			<div
				className={cn(
					"flex h-full items-center justify-center p-6 text-center text-muted-foreground text-sm",
					className,
				)}
			>
				{t("pdf.empty")}
			</div>
		);
	}

	return (
		<div
			ref={hostRef}
			id="motif-pdf-host"
			className={cn("relative flex h-full min-h-0 flex-col", className)}
		>
			<div className="motif-scroll min-h-0 flex-1 bg-muted/20">
				{error ? (
					<p className="p-6 text-destructive text-sm">{error}</p>
				) : (
					<Document
						key={remote}
						file={remote}
						loading={
							<p className="p-6 text-center text-muted-foreground text-sm">
								{t("pdf.loading")}
							</p>
						}
						onLoadSuccess={(doc) => {
							setNumPages(doc.numPages);
							setError(null);
						}}
						onLoadError={(err) => {
							setError(err.message || t("pdf.loadError"));
						}}
						className="flex flex-col items-center gap-3 px-3 py-3 pr-8"
					>
						{Array.from({ length: numPages }, (_, i) => i + 1).map(
							(pageNumber) => {
								const pageSummaries = summaries.filter(
									(s) => s.page === pageNumber,
								);
								const ph = pageHeights[pageNumber] || Math.round(width * 1.3);
								return (
									<div
										key={`${remote}-p${pageNumber}`}
										className="relative overflow-visible"
										{...{
											[PDF_PAGE_ATTR]: pageNumber,
										}}
									>
										<div className="overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-black/5 dark:ring-white/10">
											<Page
												pageNumber={pageNumber}
												width={width}
												renderTextLayer
												renderAnnotationLayer
												onRenderSuccess={() => {
													const host = hostRef.current;
													const pageEl = host
														? findPageElByNumber(host, pageNumber)
														: null;
													const h = pageEl?.getBoundingClientRect().height;
													if (h) {
														setPageHeights((prev) =>
															prev[pageNumber] === h
																? prev
																: { ...prev, [pageNumber]: h },
														);
													}
												}}
												loading={
													<div
														className="bg-muted/40"
														style={{ width, height: width * 1.3 }}
													/>
												}
											/>
										</div>
										{activeThread?.anchor.page === pageNumber
											? activeThread.anchor.rects.map((r) => (
													<div
														key={`${activeThread.id}-${r.x}-${r.y}-${r.w}`}
														className="pointer-events-none absolute z-[1] bg-amber-300/35 dark:bg-amber-400/25"
														style={{
															left: `${r.x * 100}%`,
															top: `${r.y * 100}%`,
															width: `${r.w * 100}%`,
															height: `${r.h * 100}%`,
														}}
													/>
												))
											: null}
										<div data-pdf-ask-ui="">
											<AskGutter
												items={pageSummaries}
												pageHeight={ph}
												activeId={activeThreadId}
												onOpen={handleOpenPill}
											/>
										</div>
									</div>
								);
							},
						)}
					</Document>
				)}
			</div>

			{activeThread && popoverScreen ? (
				<div data-pdf-ask-ui="">
					<AskPopover
						thread={activeThread}
						screen={popoverScreen}
						streaming={streaming}
						error={askError}
						onSend={(q) => void handleSend(q)}
						onClose={handleClose}
						onEnd={handleEnd}
					/>
				</div>
			) : null}
		</div>
	);
}
