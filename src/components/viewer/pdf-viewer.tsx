import type { UnlistenFn } from "@tauri-apps/api/event";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import { Crop, Minus, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { AskGutter } from "@/components/viewer/pdf-ask/ask-gutter";
import { AskPopover } from "@/components/viewer/pdf-ask/ask-popover";
import {
	applyMarqueeResize,
	type MarqueeHandle,
	MarqueeOverlay,
} from "@/components/viewer/pdf-ask/marquee-overlay";
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
	captureNormalizedRegion,
	capturePageRegion,
	clientBoxFromPoints,
	clientBoxToNormalized,
	createEmptyThread,
	dataUrlToBase64,
	deletePdfAskThread,
	findPageElByNumber,
	listPdfAskThreads,
	newMessageId,
	PDF_PAGE_ATTR,
	popoverScreenPoint,
	toSummaries,
	writePdfAskThread,
} from "@/lib/pdf-ask";
import { buildPdfAskPrompt } from "@/lib/pdf-ask/prompt";
import { threadHasUserQuestion, threadPin } from "@/lib/pdf-ask/schema";
import type {
	PdfAskAnchor,
	PdfAskNormalizedRect,
	PdfAskThread,
} from "@/lib/pdf-ask/types";
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
	/** Explicit marquee mode (also Alt/⌥+drag works without toggle) */
	const [marqueeMode, setMarqueeMode] = useState(false);
	/** Live draft rect while drawing (page-local) */
	const [draftMarquee, setDraftMarquee] = useState<{
		page: number;
		rect: PdfAskNormalizedRect;
	} | null>(null);

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

	const remote = source && /^https?:\/\//i.test(source) ? source : null;

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

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-bind observer when remote viewer mounts
	useEffect(() => {
		const el = hostRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const w = entries[0]?.contentRect.width;
			if (w) setFitWidth(Math.max(280, Math.floor(w - 40)));
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [remote]);

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
	}, [remote]);

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
	}, [remote, numPages, pageWidth]);

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
		if (!el || !remote) return;
		const onWheel = (e: WheelEvent) => {
			if (!(e.ctrlKey || e.metaKey)) return;
			e.preventDefault();
			const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SENSITIVITY);
			const z = clampZoom(zoomRef.current * factor);
			zoomAtClientPoint(z, e.clientX, e.clientY);
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [remote, zoomAtClientPoint]);

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
		if (!host || !remote) return;

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
	}, [remote, startFromAnchor]);

	// Marquee: Alt/⌥+drag, or marqueeMode toggle. 3-finger touch when available.
	useEffect(() => {
		const host = hostRef.current;
		if (!host || !remote) return;

		type DragState = {
			pageEl: HTMLElement;
			page: number;
			x0: number;
			y0: number;
			pointerId: number;
		};
		let drag: DragState | null = null;

		const finish = (x1: number, y1: number, pageEl: HTMLElement) => {
			if (!drag) return;
			const box = clientBoxFromPoints(drag.x0, drag.y0, x1, y1);
			if (box.w < 12 || box.h < 12) {
				setDraftMarquee(null);
				drag = null;
				return;
			}
			const capture = capturePageRegion(pageEl, box);
			setDraftMarquee(null);
			drag = null;
			if (!capture) return;

			const paperPath = paperRelPath || paperAbsPath || "paper";
			const anchor: PdfAskAnchor = {
				page: capture.page,
				rects: capture.rects,
				trigger: "marquee",
			};
			const thread = createEmptyThread({ paperPath, anchor });
			thread.pendingImage = {
				mimeType: capture.mimeType,
				dataUrl: capture.dataUrl,
			};
			// Draft only until user sends a question
			setThreads((prev) => [thread, ...prev.filter(threadHasUserQuestion)]);
			openThread(thread);
			suppressSelectionUntilRef.current = Date.now() + 400;
		};

		const onPointerDown = (e: PointerEvent) => {
			if (e.button !== 0) return;
			if ((e.target as HTMLElement).closest?.("[data-pdf-ask-ui]")) return;
			// Alt/⌥+drag or explicit marquee mode. (OS often steals 3-finger trackpad.)
			if (!marqueeMode && !e.altKey) return;

			const el = document.elementFromPoint(e.clientX, e.clientY);
			let resolved: HTMLElement | null = null;
			let n: Node | null = el;
			while (n && n !== host) {
				if (n instanceof HTMLElement && n.hasAttribute(PDF_PAGE_ATTR)) {
					resolved = n;
					break;
				}
				n = n.parentNode;
			}
			if (!resolved) return;

			e.preventDefault();
			const page = Number(resolved.getAttribute(PDF_PAGE_ATTR)) || 1;
			drag = {
				pageEl: resolved,
				page,
				x0: e.clientX,
				y0: e.clientY,
				pointerId: e.pointerId,
			};
			try {
				host.setPointerCapture(e.pointerId);
			} catch {
				// ignore
			}
		};

		const onPointerMove = (e: PointerEvent) => {
			if (!drag) return;
			const box = clientBoxFromPoints(drag.x0, drag.y0, e.clientX, e.clientY);
			const rects = clientBoxToNormalized(drag.pageEl, box);
			if (rects[0]) {
				setDraftMarquee({ page: drag.page, rect: rects[0] });
			}
		};

		const onPointerUp = (e: PointerEvent) => {
			if (!drag) return;
			const pageEl = drag.pageEl;
			finish(e.clientX, e.clientY, pageEl);
		};

		host.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("pointercancel", onPointerUp);

		return () => {
			host.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
			window.removeEventListener("pointercancel", onPointerUp);
		};
	}, [remote, marqueeMode, paperAbsPath, paperRelPath, openThread]);

	// Resize handles on active marquee selection
	const resizeRef = useRef<{
		handle: MarqueeHandle;
		startX: number;
		startY: number;
		origin: PdfAskNormalizedRect;
		pageEl: HTMLElement;
		threadId: string;
	} | null>(null);

	const onMarqueeResizeStart = useCallback(
		(handle: MarqueeHandle, e: React.PointerEvent) => {
			const thread = activeThread;
			const host = hostRef.current;
			if (!thread || !host) return;
			const pageEl = findPageElByNumber(host, thread.anchor.page);
			const origin = thread.anchor.rects[0];
			if (!pageEl || !origin) return;
			resizeRef.current = {
				handle,
				startX: e.clientX,
				startY: e.clientY,
				origin: { ...origin },
				pageEl,
				threadId: thread.id,
			};
			(e.target as HTMLElement).setPointerCapture?.(e.pointerId);

			const onMove = (ev: PointerEvent) => {
				const st = resizeRef.current;
				if (!st) return;
				const box = st.pageEl.getBoundingClientRect();
				const dx = (ev.clientX - st.startX) / (box.width || 1);
				const dy = (ev.clientY - st.startY) / (box.height || 1);
				const next = applyMarqueeResize(st.origin, st.handle, dx, dy);
				setThreads((prev) =>
					prev.map((th) =>
						th.id === st.threadId
							? { ...th, anchor: { ...th.anchor, rects: [next] } }
							: th,
					),
				);
			};
			const onUp = () => {
				const st = resizeRef.current;
				resizeRef.current = null;
				window.removeEventListener("pointermove", onMove);
				window.removeEventListener("pointerup", onUp);
				if (!st) return;
				const th = threadsRef.current.find((x) => x.id === st.threadId);
				const rect = th?.anchor.rects[0];
				if (!th || !rect) return;
				const cap = captureNormalizedRegion(st.pageEl, rect);
				if (!cap) return;
				const updated: PdfAskThread = {
					...th,
					anchor: { ...th.anchor, rects: cap.rects, page: cap.page },
					pendingImage: {
						mimeType: cap.mimeType,
						dataUrl: cap.dataUrl,
					},
					updatedAt: new Date().toISOString(),
				};
				upsertThread(updated);
				void persist(updated);
				placePopover(updated);
			};
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
		},
		[activeThread, upsertThread, persist, placePopover],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-anchor dialog after zoom/layout
	useEffect(() => {
		if (!activeThread) return;
		const host = hostRef.current;
		const scrollEl = host?.querySelector(".motif-scroll");
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

	const handleSend = useCallback(
		async (question: string) => {
			const threadId = activeThreadId;
			if (!threadId) return;
			const thread = threadsRef.current.find((th) => th.id === threadId);
			if (!thread) return;

			const image = thread.pendingImage;
			if (!question.trim() && !image) return;

			const userMsg = {
				id: newMessageId(),
				role: "user" as const,
				content: question,
				createdAt: new Date().toISOString(),
				...(image ? { image } : {}),
			};
			const withUser: PdfAskThread = {
				...thread,
				status: "open",
				pendingImage: undefined,
				messages: [...thread.messages, userMsg],
				updatedAt: new Date().toISOString(),
			};
			upsertThread(withUser);
			void persist(withUser);
			setAskError(null);
			setStreaming(true);

			const assistantId = newMessageId();
			const prompt = buildPdfAskPrompt(withUser, question, {
				hasImage: Boolean(image),
			});
			const images = image
				? [
						{
							data: dataUrlToBase64(image.dataUrl),
							mimeType: image.mimeType,
						},
					]
				: undefined;

			try {
				const accepted = await runOnce({
					prompt,
					vaultPath: vaultPath ?? undefined,
					workflow: "free",
					autoApprove: true,
					images,
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
			className={cn(
				"relative flex h-full min-h-0 flex-col",
				marqueeMode && "cursor-crosshair",
				className,
			)}
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
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								size="icon-sm"
								variant={marqueeMode ? "default" : "outline"}
								className="pointer-events-auto shadow-sm"
								aria-label={t("pdfAsk.marqueeToggle")}
								aria-pressed={marqueeMode}
								onClick={() => setMarqueeMode((v) => !v)}
							>
								<Crop className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="left">
							{t("pdfAsk.marqueeToggleHint")}
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</div>
			<div ref={scrollRef} className="motif-scroll min-h-0 flex-1 bg-muted/20">
				{error ? (
					<p className="p-6 text-destructive text-sm">{error}</p>
				) : (
					// Shell reserves scroll space. Scale from top-left so scroll
					// compensation can keep the cursor/viewport focus stable.
					<div
						className="relative"
						style={{
							width: Math.max(shellWidth + 24, fitWidth),
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
								className="flex w-full flex-col items-center gap-3"
							>
								{Array.from({ length: numPages }, (_, i) => i + 1).map(
									(pageNumber) => {
										const pageSummaries = summaries.filter(
											(s) => s.page === pageNumber,
										);
										const isMarqueeActive =
											activeThread?.anchor.trigger === "marquee" &&
											activeThread.anchor.page === pageNumber;
										const marqueeRect =
											isMarqueeActive && activeThread
												? (activeThread.anchor.rects[0] ?? null)
												: null;
										const draft =
											draftMarquee?.page === pageNumber
												? draftMarquee.rect
												: null;
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
														width={pageWidth}
														renderTextLayer={!marqueeMode}
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
												{/* Text selection highlight only for real划词 (has quote) */}
												{activeThread?.anchor.page === pageNumber &&
												activeThread.anchor.trigger !== "marquee" &&
												activeThread.anchor.quote
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
												{draft ? <MarqueeOverlay rect={draft} draft /> : null}
												{marqueeRect ? (
													<div data-pdf-ask-ui="">
														<MarqueeOverlay
															rect={marqueeRect}
															active
															onResizeStart={onMarqueeResizeStart}
														/>
													</div>
												) : null}
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
		</div>
	);
}
