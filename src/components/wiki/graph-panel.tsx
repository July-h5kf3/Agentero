import { Network } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { useTranslation } from "react-i18next";

import { PaneHeader } from "@/components/shell/pane-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/core/utils";
import { paperDirFromPath } from "@/lib/paper";
import {
	type GraphNode,
	type GraphNodeType,
	type GraphResponse,
	getGraph,
} from "@/lib/wiki";

type GraphMode = "neighborhood" | "full";

type GraphPanelProps = {
	vaultPath: string | null;
	selectedPath: string | null;
	onOpenPath: (vaultRelativePath: string) => void;
	className?: string;
	/**
	 * Bumped after `graph_rebuild` so the graph reloads without a path change.
	 */
	wikiIndexRevision?: number;
};

/** Force-graph mutates x/y at runtime; only declare what we paint/read. */
type FgNode = GraphNode & {
	x?: number;
	y?: number;
};

type FgLink = {
	source: string | FgNode;
	target: string | FgNode;
	id: string;
};

/** Theme-derived colors for canvas (resolved from CSS variables). */
type ThemeColors = {
	foreground: string;
	mutedForeground: string;
	border: string;
	primary: string;
	muted: string;
};

function readThemeColors(el: HTMLElement | null): ThemeColors {
	const style = getComputedStyle(el ?? document.documentElement);
	const pick = (name: string, fallback: string) => {
		const v = style.getPropertyValue(name).trim();
		return v || fallback;
	};
	// Prefer resolved color tokens already used by the UI
	return {
		foreground: pick("--foreground", "oklch(0.145 0 0)"),
		mutedForeground: pick("--muted-foreground", "oklch(0.556 0 0)"),
		border: pick("--border", "oklch(0.922 0 0)"),
		primary: pick("--primary", "oklch(0.205 0 0)"),
		muted: pick("--muted", "oklch(0.97 0 0)"),
	};
}

/** Node fill by type — only theme tokens, no decorative palette. */
function nodeFill(type: GraphNodeType, colors: ThemeColors): string {
	switch (type) {
		case "paper":
			return colors.foreground;
		case "index":
			return colors.primary;
		case "stub":
			return colors.border;
		default:
			return colors.mutedForeground;
	}
}

export function GraphPanel({
	vaultPath,
	selectedPath,
	onOpenPath,
	className,
	wikiIndexRevision = 0,
}: GraphPanelProps) {
	const { t } = useTranslation("sidebar");
	const wrapRef = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ w: 280, h: 240 });
	const [mode, setMode] = useState<GraphMode>("neighborhood");
	const [data, setData] = useState<GraphResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [hoverId, setHoverId] = useState<string | null>(null);
	const [colors, setColors] = useState<ThemeColors>(() =>
		readThemeColors(null),
	);

	const centerHint = useMemo(() => {
		if (!selectedPath) return null;
		// Nested papers: prefer folder containing NOTES/source; fall back to path
		return paperDirFromPath(selectedPath) ?? selectedPath;
	}, [selectedPath]);

	useEffect(() => {
		const el = wrapRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			const cr = entries[0]?.contentRect;
			if (!cr) return;
			setSize({
				w: Math.max(120, Math.floor(cr.width)),
				h: Math.max(160, Math.floor(cr.height)),
			});
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	// Keep canvas colors in sync with light/dark theme
	useEffect(() => {
		const el = wrapRef.current ?? document.documentElement;
		const sync = () => setColors(readThemeColors(el));
		sync();
		const mo = new MutationObserver(sync);
		mo.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class", "style", "data-theme"],
		});
		return () => mo.disconnect();
	}, []);

	useEffect(() => {
		// `wikiIndexRevision` is intentional: re-fetch after graph_rebuild.
		void wikiIndexRevision;
		let cancelled = false;
		setLoading(true);
		setError(null);
		void (async () => {
			try {
				if (mode === "neighborhood" && !centerHint) {
					if (!cancelled) {
						setData({ nodes: [], edges: [], center: null, depth: 2 });
					}
					return;
				}
				const res = await getGraph(vaultPath, {
					center: mode === "neighborhood" ? centerHint : null,
					depth: 2,
				});
				if (cancelled) return;
				setData(res);
			} catch (e) {
				if (cancelled) return;
				setData(null);
				setError(e instanceof Error ? e.message : String(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [vaultPath, mode, centerHint, wikiIndexRevision]);

	const graphData = useMemo(() => {
		if (!data) return { nodes: [] as FgNode[], links: [] as FgLink[] };
		return {
			nodes: data.nodes.map((n) => ({ ...n })),
			links: data.edges.map((e) => ({
				id: e.id,
				source: e.source,
				target: e.target,
			})),
		};
	}, [data]);

	const centerId = data?.center ?? null;

	const openNode = useCallback(
		(node: GraphNode) => {
			if (node.type === "stub" || !node.path) return;
			onOpenPath(node.path);
		},
		[onOpenPath],
	);

	const paintNode = useCallback(
		(node: FgNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
			const r = node.type === "paper" ? 5.5 : 4;
			const x = node.x ?? 0;
			const y = node.y ?? 0;
			const isCenter = node.id === centerId;
			const isHover = node.id === hoverId;
			const dimmed = Boolean(hoverId) && !isHover && !isCenter;

			ctx.beginPath();
			ctx.arc(x, y, isCenter ? r + 2 : r, 0, 2 * Math.PI, false);
			ctx.fillStyle = nodeFill(node.type, colors);
			ctx.globalAlpha = dimmed ? 0.28 : 1;
			ctx.fill();
			if (isCenter) {
				ctx.strokeStyle = colors.foreground;
				ctx.lineWidth = 1.5 / globalScale;
				ctx.globalAlpha = 1;
				ctx.stroke();
			}

			let label = node.label;
			const maxChars = 28;
			if (label.length > maxChars) {
				label = `${label.slice(0, maxChars - 1)}…`;
			}
			const fontSize = 10 / globalScale;
			ctx.font = `${fontSize}px sans-serif`;
			ctx.textAlign = "center";
			ctx.textBaseline = "top";
			ctx.fillStyle = colors.mutedForeground;
			ctx.globalAlpha = dimmed ? 0.35 : 1;
			ctx.fillText(label, x, y + r + 2 / globalScale);
			ctx.globalAlpha = 1;
		},
		[centerId, hoverId, colors],
	);

	const linkColor = useCallback(() => {
		// border token — quiet edges that follow theme
		return colors.border;
	}, [colors]);

	return (
		<div
			className={cn(
				"flex h-full min-h-0 flex-col overflow-hidden bg-background",
				className,
			)}
		>
			<PaneHeader
				trailing={
					<div className="flex items-center gap-0.5">
						<Button
							type="button"
							variant="ghost"
							size="xs"
							className={cn(
								"h-6 px-1.5 text-xs",
								mode === "neighborhood" && "bg-muted text-foreground",
							)}
							onClick={() => setMode("neighborhood")}
						>
							{t("graph.near")}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="xs"
							className={cn(
								"h-6 px-1.5 text-xs",
								mode === "full" && "bg-muted text-foreground",
							)}
							onClick={() => setMode("full")}
						>
							{t("graph.all")}
						</Button>
					</div>
				}
			>
				<Network
					className="size-3.5 shrink-0 text-muted-foreground"
					aria-hidden
				/>
				<span className="min-w-0 flex-1 truncate font-medium text-sm leading-none">
					{t("graph.title")}
				</span>
			</PaneHeader>

			<div ref={wrapRef} className="relative min-h-0 flex-1 bg-background">
				{loading ? (
					<p className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
						{t("graph.loading")}
					</p>
				) : null}
				{error ? (
					<p className="absolute inset-0 flex items-center justify-center px-3 text-center text-destructive text-xs">
						{error}
					</p>
				) : null}
				{!loading && !error && graphData.nodes.length === 0 ? (
					<p className="absolute inset-0 flex items-center justify-center px-3 text-center text-muted-foreground text-xs">
						{mode === "neighborhood" && !selectedPath
							? t("graph.selectPrompt")
							: t("graph.noEdges")}
					</p>
				) : null}
				{!loading && !error && graphData.nodes.length > 0 ? (
					<ForceGraph2D
						width={size.w}
						height={size.h}
						graphData={graphData}
						nodeId="id"
						linkSource="source"
						linkTarget="target"
						backgroundColor="rgba(0,0,0,0)"
						linkColor={linkColor}
						linkWidth={1}
						nodeCanvasObject={paintNode}
						nodePointerAreaPaint={(node, color, ctx) => {
							const n = node as FgNode;
							ctx.beginPath();
							ctx.arc(n.x ?? 0, n.y ?? 0, 6, 0, 2 * Math.PI, false);
							ctx.fillStyle = color;
							ctx.fill();
						}}
						onNodeHover={(node) => {
							setHoverId(node ? (node as FgNode).id : null);
						}}
						onNodeClick={(node) => {
							openNode(node as FgNode);
						}}
						cooldownTicks={80}
						enableNodeDrag
					/>
				) : null}
			</div>
		</div>
	);
}
