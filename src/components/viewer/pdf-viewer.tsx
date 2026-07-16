import type { UnlistenFn } from "@tauri-apps/api/event";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import { Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { AskGutter } from "@/components/viewer/pdf-ask/ask-gutter";
import { AskPopover } from "@/components/viewer/pdf-ask/ask-popover";
import { HighlightLayer } from "@/components/viewer/pdf-ask/highlight-layer";
import { SelectionMenu } from "@/components/viewer/pdf-ask/selection-menu";
import i18n from "@/i18n";
import {
	cancelAgentRun,
	listenAgentCompleted,
	listenAgentFailed,
	listenAgentStream,
	runOnce,
} from "@/lib/agent";
import { isPdfViewerSource } from "@/lib/paper-metadata";
import {
	anchorFromPoint,
	anchorFromSelection,
	clientPointInPage,
	createEmptyThread,
	deletePdfAskThread,
	findPageElByNumber,
	listPdfAskThreads,
	newMessageId,
	PDF_PAGE_ATTR,
	popoverScreenPoint,
	toSummaries,
	writePdfAskThread,
} from "@/lib/pdf-ask";
import {
	buildPdfAskPrompt,
	buildPdfTranslatePrompt,
} from "@/lib/pdf-ask/prompt";
import { threadHasUserQuestion, threadPin } from "@/lib/pdf-ask/schema";
import type { PdfAskAnchor, PdfAskThread } from "@/lib/pdf-ask/types";
import {
	createHighlight,
	deletePdfHighlight,
	listPdfHighlights,
	writePdfHighlight,
} from "@/lib/pdf-highlight";
import type { PdfHighlight } from "@/lib/pdf-highlight/types";
import { cn } from "@/lib/utils";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const DWELL_MS = 700;
const DWELL_MOVE_PX = 8;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
/** Button step — larger for snappier +/- */
const ZOOM_STEP = 0.15;
/**
 * Wheel sensitivity for exp(-deltaY * k). Higher = faster zoom.
 * Trackpads send small continuous deltas; mice send larger steps.
 */
const WHEEL_ZOOM_SENSITIVITY = 0.0032;

function clampZoom(z: number): number {
	const rounded = Math.round(z * 1000) / 1000;
	return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rounded));
}

type PdfViewerProps = {
	/**
	 * PDF.js file source: local `blob:` (bytes via fs) or remote https.
	 * Prefer local vault PDF; remote URL is fallback when download fails.
	 * Do not pass `asset://` — PDF.js XHR fails on Tauri asset protocol.
	 */
	source: string | null;
	/** Absolute path to paper folder for asks/*.json persistence */
	paperAbsPath?: string | null;
	/** Vault-relative paper path stored inside JSON */
	paperRelPath?: string | null;
	/** Current vault root for ACP cwd */
	vaultPath?: string | null;
	/** Append a quoted passage to the paper's NOTES.md (handled by parent) */
	onAddNote?: (quote: string) => void;
	className?: string;
};

export function PdfViewer({
	source,
	paperAbsPath = null,
	paperRelPath = null,
	vaultPath = null,
	onAddNote,
	className,
}: PdfViewerProps) {
	const { t } = useTranslation("viewer");
	const hostRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const [numPages, setNumPages] = useState(0);
	const [error, setError] = useState<string | null>(null);
	/** Container fit width (100% zoom baseline) — PDF.js always rasters at this width */
	const [fitWidth, setFitWidth] = useState(640);
	/**
	 * Visual zoom via CSS transform only (never changes Page width while zooming).
	 * Avoids react-pdf re-raster flash that caused flicker.
	 */
	const [zoom, setZoom] = useState(1);
	const [contentHeight, setContentHeight] = useState(0);

	const pageWidth = Math.max(200, fitWidth);
	const shellWidth = pageWidth * zoom;
	const shellHeight = Math.max(0, contentHeight * zoom);

	const [threads, setThreads] = useState<PdfAskThread[]>([]);
	const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
	const [popoverScreen, setPopoverScreen] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const [streaming, setStreaming] = useState(false);
	const [askError, setAskError] = useState<string | null>(null);

	const [highlights, setHighlights] = useState<PdfHighlight[]>([]);
	/** Selection action menu (highlight/note/ask/translate) near a selection */
	const [selectionMenu, setSelectionMenu] = useState<{
		anchor: PdfAskAnchor;
		screen: { x: number; y: number };
	} | null>(null);
	/** Floating remove button for a clicked highlight */
	const [highlightMenu, setHighlightMenu] = useState<{
		id: string;
		screen: { x: number; y: number };
	} | null>(null);
	const highlightsRef = useRef(highlights);
	highlightsRef.current = highlights;

	const activeSessionRef = useRef<string | null>(null);
	const suppressSelectionUntilRef = useRef(0);
	const dwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const dwellOriginRef = useRef<{ x: number; y: number } | null>(null);
	const threadsRef = useRef(threads);
	threadsRef.current = threads;
	const activeThreadIdRef = useRef<string | null>(null);
	/** Delayed hide after leave pin / dialog (hover UX) */
	const hidePopoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const contentRef = useRef<HTMLDivElement>(null);
	const zoomRef = useRef(zoom);
	zoomRef.current = zoom;

	const fileUrl = isPdfViewerSource(source) ? source.trim() : null;

	const activeThread = useMemo(
		() => threads.find((th) => th.id === activeThreadId) ?? null,
		[threads, activeThreadId],
	);
	activeThreadIdRef.current = activeThreadId;

	// Only threads with a real user question keep a pin
	const summaries = useMemo(
		() => toSummaries(threads.filter(threadHasUserQuestion)),
		[threads],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-bind observer when fileUrl viewer mounts
	useEffect(() => {
		const el = hostRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width;
			if (w) setFitWidth(Math.max(280, Math.floor(w - 40)));
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [fileUrl]);

	/**
	 * Zoom keeping the document point under (clientX, clientY) stable.
	 * Pure CSS scale — never remounts PDF pages (no flicker).
	 */
	const zoomAtClientPoint = useCallback(
		(nextZoom: number, clientX: number, clientY: number) => {
			const z = clampZoom(nextZoom);
			const oldZ = zoomRef.current;
			if (Math.abs(z - oldZ) < 0.0005) return;

			const scrollEl = scrollRef.current;
			if (!scrollEl) {
				setZoom(z);
				return;
			}

			const rect = scrollEl.getBoundingClientRect();
			const ox = clientX - rect.left;
			const oy = clientY - rect.top;
			const ratio = z / oldZ;
			const nextLeft = (scrollEl.scrollLeft + ox) * ratio - ox;
			const nextTop = (scrollEl.scrollTop + oy) * ratio - oy;

			setZoom(z);
			// Apply scroll in the same frame as the new shell size / transform
			scrollEl.scrollLeft = nextLeft;
			scrollEl.scrollTop = nextTop;
			requestAnimationFrame(() => {
				scrollEl.scrollLeft = nextLeft;
				scrollEl.scrollTop = nextTop;
			});
		},
		[],
	);

	const zoomAtViewportCenter = useCallback(
		(nextZoom: number) => {
			const scrollEl = scrollRef.current;
			if (!scrollEl) {
				setZoom(clampZoom(nextZoom));
				return;
			}
			const rect = scrollEl.getBoundingClientRect();
			zoomAtClientPoint(
				nextZoom,
				rect.left + rect.width / 2,
				rect.top + rect.height / 2,
			);
		},
		[zoomAtClientPoint],
	);

	// Reset zoom when switching PDF source
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run when PDF URL changes
	useEffect(() => {
		setZoom(1);
		const scrollEl = scrollRef.current;
		if (scrollEl) {
			scrollEl.scrollLeft = 0;
			scrollEl.scrollTop = 0;
		}
	}, [fileUrl]);

	// Measure unscaled content height for scroll shell
	// biome-ignore lint/correctness/useExhaustiveDependencies: remeasure when page set / width changes
	useEffect(() => {
		const el = contentRef.current;
		if (!el) return;
		const ro = new ResizeObserver(() => {
			setContentHeight(el.offsetHeight);
		});
		ro.observe(el);
		setContentHeight(el.offsetHeight);
		return () => ro.disconnect();
	}, [fileUrl, numPages, pageWidth]);

	const zoomIn = useCallback(() => {
		zoomAtViewportCenter(zoomRef.current + ZOOM_STEP);
	}, [zoomAtViewportCenter]);
	const zoomOut = useCallback(() => {
		zoomAtViewportCenter(zoomRef.current - ZOOM_STEP);
	}, [zoomAtViewportCenter]);
	const zoomReset = useCallback(() => {
		zoomAtViewportCenter(1);
	}, [zoomAtViewportCenter]);

	// ⌘/Ctrl + wheel: zoom toward cursor (faster continuous scale)
	useEffect(() => {
		const el = hostRef.current;
		if (!el || !fileUrl) return;
		const onWheel = (e: WheelEvent) => {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
			const z = clampZoom(zoomRef.current * factor);
			zoomAtClientPoint(z, e.clientX, e.clientY);
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [fileUrl, zoomAtClientPoint]);

	useEffect(() => {
		let cancelled = false;
		setThreads([]);
		setActiveThreadId(null);
		setPopoverScreen(null);
		setAskError(null);
		setStreaming(false);
		setHighlights([]);
		setSelectionMenu(null);
		setHighlightMenu(null);
		activeSessionRef.current = null;

		if (!paperAbsPath) return;

		void (async () => {
			const list = await listPdfAskThreads(paperAbsPath);
			if (!cancelled) setThreads(list);
		})();
		void (async () => {
			const list = await listPdfHighlights(paperAbsPath);
			if (!cancelled) setHighlights(list);
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
		// Dialog sits next to the pin (near selection), not the page margin
		const pin = threadPin(thread);
		const pt = popoverScreenPoint(pageEl, thread.anchor.rects, pin);
		if (pt) setPopoverScreen(pt);
		else setPopoverScreen({ x: 80, y: 120 });
	}, []);

	const cancelHoverHide = useCallback(() => {
		if (hidePopoverTimerRef.current) {
			clearTimeout(hidePopoverTimerRef.current);
			hidePopoverTimerRef.current = null;
		}
	}, []);

	/** Drop draft threads that never received a user question (no pin / no disk). */
	const discardIfEmptyDraft = useCallback((threadId: string | null) => {
		if (!threadId) return;
		const th = threadsRef.current.find((t) => t.id === threadId);
		if (!th || threadHasUserQuestion(th)) return;
		setThreads((prev) => prev.filter((t) => t.id !== threadId));
	}, []);

	/** Leave pin or dialog → hide after a short grace period */
	const scheduleHoverHide = useCallback(() => {
		cancelHoverHide();
		hidePopoverTimerRef.current = setTimeout(() => {
			hidePopoverTimerRef.current = null;
			discardIfEmptyDraft(activeThreadIdRef.current);
			setActiveThreadId(null);
			setPopoverScreen(null);
			setAskError(null);
		}, 1000);
	}, [cancelHoverHide, discardIfEmptyDraft]);

	const openThread = useCallback(
		(thread: PdfAskThread) => {
			cancelHoverHide();
			setActiveThreadId(thread.id);
			setAskError(null);
			placePopover(thread);
		},
		[placePopover, cancelHoverHide],
	);

	const startFromAnchor = useCallback(
		(anchor: PdfAskAnchor) => {
			const paperPath = paperRelPath || paperAbsPath || "paper";
			const thread = createEmptyThread({ paperPath, anchor });
			// Drop other empty drafts; never persist until the user asks
			setThreads((prev) => [thread, ...prev.filter(threadHasUserQuestion)]);
			openThread(thread);
		},
		[paperAbsPath, paperRelPath, openThread],
	);

	// Selection + double-click + dwell triggers
	useEffect(() => {
		const host = hostRef.current;
		if (!host || !fileUrl) return;

		const clearDwell = () => {
			if (dwellTimerRef.current) {
				clearTimeout(dwellTimerRef.current);
				dwellTimerRef.current = null;
			}
			dwellOriginRef.current = null;
		};

		const onMouseUp = (e: MouseEvent) => {
			// detail>=2 is the second click of a double-click — never treat as 划词
			if (e.detail >= 2) {
				window.getSelection()?.removeAllRanges();
				return;
			}
			if ((e.target as HTMLElement).closest?.("[data-pdf-ask-ui]")) return;
			if (Date.now() < suppressSelectionUntilRef.current) return;
			const cx = e.clientX;
			const cy = e.clientY;
			window.setTimeout(() => {
				if (Date.now() < suppressSelectionUntilRef.current) return;
				const sel = window.getSelection();
				const anchor =
					sel && sel.rangeCount > 0 && host.contains(sel.anchorNode)
						? anchorFromSelection(sel, host, "selection")
						: null;
				// Real划词 → show the action menu (highlight/note/ask/translate)
				if (sel && anchor && (anchor.quote?.length ?? 0) >= 2) {
					const rect = sel.getRangeAt(0).getBoundingClientRect();
					setHighlightMenu(null);
					setSelectionMenu({
						anchor,
						screen: { x: rect.left + rect.width / 2, y: rect.top },
					});
					return;
				}
				// Plain click → hit-test existing highlights for a remove affordance
				setSelectionMenu(null);
				const hit = clientPointInPage(cx, cy, host);
				if (!hit) {
					setHighlightMenu(null);
					return;
				}
				const found = highlightsRef.current.find(
					(h) =>
						h.page === hit.page &&
						h.rects.some(
							(r) =>
								hit.x >= r.x &&
								hit.x <= r.x + r.w &&
								hit.y >= r.y &&
								hit.y <= r.y + r.h,
						),
				);
				setHighlightMenu(
					found ? { id: found.id, screen: { x: cx, y: cy } } : null,
				);
			}, 0);
		};

		const onDblClick = (e: MouseEvent) => {
			if (!host.contains(e.target as Node)) return;
			if ((e.target as HTMLElement).closest?.("[data-pdf-ask-ui]")) return;
			// Do not use browser word/page selection — open ask with page context only.
			e.preventDefault();
			e.stopPropagation();
			suppressSelectionUntilRef.current = Date.now() + 500;
			window.getSelection()?.removeAllRanges();

			const pt = anchorFromPoint(e.clientX, e.clientY, host, "dblclick");
			if (!pt) return;
			// Tiny pin for popover placement only (no quote → no amber text highlight)
			startFromAnchor({
				...pt,
				quote: undefined,
				rects: pt.rects.length
					? pt.rects.map((r) => ({
							x: r.x,
							y: r.y,
							w: Math.min(0.02, r.w || 0.02),
							h: Math.min(0.02, r.h || 0.02),
						}))
					: [{ x: 0.5, y: 0.1, w: 0.02, h: 0.02 }],
			});
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
	}, [fileUrl, startFromAnchor]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-anchor dialog after zoom/layout
	useEffect(() => {
		if (!activeThread) return;
		const host = hostRef.current;
		const scrollEl = host?.querySelector(".agentero-scroll");
		const reposition = () => placePopover(activeThread);
		// After zoom, layout may lag one frame — schedule twice
		reposition();
		const raf = requestAnimationFrame(reposition);
		scrollEl?.addEventListener("scroll", reposition, { passive: true });
		window.addEventListener("resize", reposition);
		return () => {
			cancelAnimationFrame(raf);
			scrollEl?.removeEventListener("scroll", reposition);
			window.removeEventListener("resize", reposition);
		};
	}, [activeThread, placePopover, zoom, pageWidth]);

	const sendToThread = useCallback(
		async (thread: PdfAskThread, question: string, promptOverride?: string) => {
			const threadId = thread.id;
			if (!question.trim()) return;

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
			const prompt = promptOverride ?? buildPdfAskPrompt(withUser, question);

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
		[upsertThread, persist, vaultPath, t],
	);

	const handleSend = useCallback(
		(question: string) => {
			const threadId = activeThreadId;
			if (!threadId) return;
			const thread = threadsRef.current.find((th) => th.id === threadId);
			if (!thread) return;
			void sendToThread(thread, question);
		},
		[activeThreadId, sendToThread],
	);

	const dismissPopoverChrome = useCallback(() => {
		if (activeSessionRef.current) {
			void cancelAgentRun(activeSessionRef.current).catch(() => undefined);
			activeSessionRef.current = null;
		}
		setStreaming(false);
		setActiveThreadId(null);
		setPopoverScreen(null);
		setAskError(null);
	}, []);

	/** Hide dialog: keep pin only if user already asked; else discard draft */
	const handleHide = useCallback(() => {
		if (activeThreadId) {
			const thread = threadsRef.current.find((th) => th.id === activeThreadId);
			if (thread) {
				if (!threadHasUserQuestion(thread)) {
					setThreads((prev) => prev.filter((t) => t.id !== thread.id));
				} else if (thread.status !== "ended") {
					const ended: PdfAskThread = {
						...thread,
						status: "ended",
						updatedAt: new Date().toISOString(),
					};
					upsertThread(ended);
					void persist(ended);
				}
			}
		}
		dismissPopoverChrome();
	}, [activeThreadId, upsertThread, persist, dismissPopoverChrome]);

	/** Delete thread permanently (file + pin) */
	const handleDelete = useCallback(() => {
		const id = activeThreadId;
		if (id) {
			setThreads((prev) => prev.filter((th) => th.id !== id));
			if (paperAbsPath) {
				void deletePdfAskThread(paperAbsPath, id);
			}
		}
		dismissPopoverChrome();
	}, [activeThreadId, paperAbsPath, dismissPopoverChrome]);

	const handleOpenPill = useCallback(
		(id: string) => {
			cancelHoverHide();
			const thread = threadsRef.current.find((th) => th.id === id);
			if (!thread) return;
			const open: PdfAskThread = { ...thread, status: "open" };
			upsertThread(open);
			openThread(open);
		},
		[upsertThread, openThread, cancelHoverHide],
	);

	// --- Selection action menu (highlight / note / ask / translate) ---

	const handleMenuAsk = useCallback(() => {
		const sm = selectionMenu;
		if (!sm) return;
		setSelectionMenu(null);
		startFromAnchor(sm.anchor);
	}, [selectionMenu, startFromAnchor]);

	const handleMenuTranslate = useCallback(() => {
		const sm = selectionMenu;
		if (!sm) return;
		setSelectionMenu(null);
		const quote = sm.anchor.quote?.trim();
		if (!quote) return;
		const paperPath = paperRelPath || paperAbsPath || "paper";
		const thread = createEmptyThread({ paperPath, anchor: sm.anchor });
		setThreads((prev) => [thread, ...prev.filter(threadHasUserQuestion)]);
		openThread(thread);
		const targetLang = i18n.language?.toLowerCase().startsWith("zh")
			? "Chinese"
			: "English";
		void sendToThread(
			thread,
			t("selection.translateAction"),
			buildPdfTranslatePrompt(quote, sm.anchor.page, targetLang),
		);
	}, [selectionMenu, paperAbsPath, paperRelPath, openThread, sendToThread, t]);

	const handleMenuHighlight = useCallback(() => {
		const sm = selectionMenu;
		if (!sm) return;
		setSelectionMenu(null);
		const quote = sm.anchor.quote?.trim();
		if (!quote || !sm.anchor.rects.length) return;
		const paperPath = paperRelPath || paperAbsPath || "paper";
		const hl = createHighlight({
			paperPath,
			page: sm.anchor.page,
			rects: sm.anchor.rects,
			quote,
		});
		setHighlights((prev) => [hl, ...prev]);
		window.getSelection()?.removeAllRanges();
		if (paperAbsPath) {
			void writePdfHighlight(paperAbsPath, hl).catch(() => undefined);
		}
	}, [selectionMenu, paperAbsPath, paperRelPath]);

	const handleMenuNote = useCallback(() => {
		const quote = selectionMenu?.anchor.quote?.trim();
		if (quote) onAddNote?.(quote);
		// SelectionMenu shows its own confirmation, then calls onClose.
	}, [selectionMenu, onAddNote]);

	const removeHighlight = useCallback(
		(id: string) => {
			setHighlights((prev) => prev.filter((h) => h.id !== id));
			setHighlightMenu(null);
			if (paperAbsPath) {
				void deletePdfHighlight(paperAbsPath, id).catch(() => undefined);
			}
		},
		[paperAbsPath],
	);

	// Dismiss menus on outside pointerdown / Escape / scroll
	useEffect(() => {
		if (!selectionMenu && !highlightMenu) return;
		const closeAll = () => {
			setSelectionMenu(null);
			setHighlightMenu(null);
		};
		const onDocPointerDown = (e: PointerEvent) => {
			if ((e.target as HTMLElement).closest?.("[data-pdf-ask-ui]")) return;
			closeAll();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") closeAll();
		};
		const scrollEl = hostRef.current?.querySelector(".agentero-scroll");
		window.addEventListener("pointerdown", onDocPointerDown, true);
		window.addEventListener("keydown", onKey);
		scrollEl?.addEventListener("scroll", closeAll, { passive: true });
		return () => {
			window.removeEventListener("pointerdown", onDocPointerDown, true);
			window.removeEventListener("keydown", onKey);
			scrollEl?.removeEventListener("scroll", closeAll);
		};
	}, [selectionMenu, highlightMenu]);

	if (!fileUrl) {
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
			id="agentero-pdf-host"
			className={cn("relative flex h-full min-h-0 flex-col", className)}
		>
			<div className="pointer-events-none absolute top-2 right-3 z-20 flex items-center gap-1">
				<TooltipProvider delayDuration={200}>
					<div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-border/80 bg-background/95 p-0.5 shadow-sm backdrop-blur-sm">
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-xs"
									variant="ghost"
									aria-label={t("pdf.zoomOut")}
									disabled={zoom <= ZOOM_MIN}
									onClick={zoomOut}
								>
									<Minus className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">{t("pdf.zoomOut")}</TooltipContent>
						</Tooltip>
						<button
							type="button"
							className="min-w-11 px-1 text-center font-medium text-muted-foreground text-xs tabular-nums hover:text-foreground"
							aria-label={t("pdf.zoomReset")}
							title={t("pdf.zoomReset")}
							onClick={zoomReset}
						>
							{Math.round(zoom * 100)}%
						</button>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-xs"
									variant="ghost"
									aria-label={t("pdf.zoomIn")}
									disabled={zoom >= ZOOM_MAX}
									onClick={zoomIn}
								>
									<Plus className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">{t("pdf.zoomIn")}</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									size="icon-xs"
									variant="ghost"
									aria-label={t("pdf.zoomFit")}
									onClick={zoomReset}
								>
									<RotateCcw className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom">{t("pdf.zoomFit")}</TooltipContent>
						</Tooltip>
					</div>
				</TooltipProvider>
			</div>
			<div
				ref={scrollRef}
				className="agentero-scroll min-h-0 flex-1 bg-muted/20"
			>
				{error ? (
					<p className="p-6 text-destructive text-sm">{error}</p>
				) : (
					// Shell reserves scroll space. Scale from top-left so scroll
					// compensation can keep the cursor/viewport focus stable.
					<div
						className="relative mx-auto"
						style={{
							width: shellWidth + 24,
							height: shellHeight > 0 ? shellHeight + 24 : undefined,
							minHeight: "100%",
						}}
					>
						<div
							ref={contentRef}
							className="absolute top-3 left-3 flex flex-col items-center gap-3 will-change-transform"
							style={{
								width: pageWidth,
								transform: `scale(${zoom})`,
								transformOrigin: "top left",
								// No CSS transition: keeps cursor-anchored zoom in sync and avoids flash
							}}
						>
							<Document
								key={fileUrl}
								file={fileUrl}
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
								className="flex w-full flex-col items-center gap-3"
							>
								{Array.from({ length: numPages }, (_, i) => i + 1).map(
									(pageNumber) => {
										const pageSummaries = summaries.filter(
											(s) => s.page === pageNumber,
										);
										const pageHighlights = highlights.filter(
											(h) => h.page === pageNumber,
										);
										return (
											<div
												key={`${fileUrl}-p${pageNumber}`}
												className="relative overflow-visible"
												{...{
													[PDF_PAGE_ATTR]: pageNumber,
												}}
											>
												<div className="overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-black/5 dark:ring-white/10">
													<Page
														pageNumber={pageNumber}
														width={pageWidth}
														renderTextLayer
														renderAnnotationLayer
														loading={
															<div
																className="bg-muted/40"
																style={{
																	width: pageWidth,
																	height: pageWidth * 1.3,
																}}
															/>
														}
													/>
												</div>
												{/* Persisted highlights (visual only; removal via click hit-test) */}
												<HighlightLayer
													items={pageHighlights}
													activeId={highlightMenu?.id ?? null}
												/>
												<div data-pdf-ask-ui="">
													<AskGutter
														items={pageSummaries}
														activeId={activeThreadId}
														onOpen={handleOpenPill}
														onEnter={cancelHoverHide}
														onLeave={scheduleHoverHide}
													/>
												</div>
											</div>
										);
									},
								)}
							</Document>
						</div>
					</div>
				)}
			</div>

			{activeThread && popoverScreen ? (
				<div data-pdf-ask-ui="">
					<AskPopover
						thread={activeThread}
						screen={popoverScreen}
						streaming={streaming}
						error={askError}
						initialPrompt={
							activeThread.anchor.trigger === "dblclick" &&
							!activeThread.messages.length
								? t("pdfAsk.pagePrompt", {
										page: activeThread.anchor.page,
									})
								: undefined
						}
						onSend={(q) => void handleSend(q)}
						onHide={handleHide}
						onDelete={handleDelete}
						onPointerEnter={cancelHoverHide}
						onPointerLeave={scheduleHoverHide}
						onStop={() => {
							const sid = activeSessionRef.current;
							if (!sid) return;
							void cancelAgentRun(sid).catch(() => undefined);
							activeSessionRef.current = null;
							setStreaming(false);
						}}
					/>
				</div>
			) : null}

			{selectionMenu ? (
				<div data-pdf-ask-ui="">
					<SelectionMenu
						screen={selectionMenu.screen}
						onHighlight={handleMenuHighlight}
						onNote={handleMenuNote}
						onAsk={handleMenuAsk}
						onTranslate={handleMenuTranslate}
						onClose={() => setSelectionMenu(null)}
					/>
				</div>
			) : null}

			{highlightMenu ? (
				<div data-pdf-ask-ui="">
					<button
						type="button"
						className="fixed z-50 flex h-7 items-center gap-1 rounded-lg border border-border/80 bg-background px-2 text-muted-foreground text-xs shadow-2xl ring-1 ring-black/5 hover:text-foreground dark:ring-white/10"
						style={{
							left: Math.min(
								Math.max(12, highlightMenu.screen.x - 40),
								(typeof window !== "undefined" ? window.innerWidth : 1200) -
									120,
							),
							top: highlightMenu.screen.y + 12,
						}}
						onMouseDown={(e) => e.stopPropagation()}
						onClick={() => removeHighlight(highlightMenu.id)}
					>
						<Trash2 className="size-3.5" />
						{t("selection.removeHighlight")}
					</button>
				</div>
			) : null}
		</div>
	);
}
