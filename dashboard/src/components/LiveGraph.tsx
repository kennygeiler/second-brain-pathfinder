import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphSnapshot, GraphNode, GraphEdge } from "../api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GraphInsightView = "all" | "org" | "product" | "combined";

export interface LiveGraphProps {
  graph: GraphSnapshot;
  width?: number;
  height?: number;
  onNodeClick?: (id: string) => void;
  selectedId?: string | null;
  highlightIds?: Set<string>;
  /** When not `all`, only matching relationship types are drawn (nodes stay the same). */
  graphInsightView?: GraphInsightView;
}

interface Pos {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

type DragOp =
  | { type: "pan"; startClientX: number; startClientY: number; startPanX: number; startPanY: number }
  | { type: "node"; id: string; startClientX: number; startClientY: number; startX: number; startY: number };

// ─── Color / shape helpers ────────────────────────────────────────────────────

function sentimentColor(s: number | undefined): string {
  if (s == null || Number.isNaN(s)) return "#6B7280";
  if (s >= 0.65) return "#22C55E";
  if (s <= 0.35) return "#EF4444";
  return "#F59E0B";
}

function typeIsSystem(type: string | undefined): boolean {
  return (type ?? "").toLowerCase() === "system";
}

function nodeRadius(n: GraphNode): number {
  const inf = typeof n.influence === "number" ? n.influence : 0.5;
  return 22 + Math.min(Math.max(inf, 0), 1) * 22;
}

function labelInitials(name: string | undefined): string {
  const s = (name ?? "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const EDGE_COLOR: Record<string, string> = {
  REPORTS_TO: "#22C55E",
  MEMBER_OF: "#A855F7",
  INFLUENCES: "#3B82F6",
  BLOCKS: "#EF4444",
  USES: "#6B7280",
  LINKS_TO: "#8892A8",
};

function edgeRelType(e: GraphEdge): string {
  const rel = (e as GraphEdge & { relationship?: string }).relationship;
  const raw = e.type ?? rel;
  return String(raw ?? "LINKS_TO")
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");
}

function filterGraphEdges(
  insight: GraphInsightView | undefined,
  nodes: GraphNode[],
  edges: GraphEdge[],
): GraphEdge[] {
  const view = insight ?? "all";
  if (view === "all") return edges;

  const idToType = new Map<string, string | undefined>();
  for (const n of nodes) {
    idToType.set(n.id, typeof n.type === "string" ? n.type : undefined);
  }

  const orgTypes = new Set(["REPORTS_TO", "MEMBER_OF"]);
  const productCore = new Set(["USES", "BLOCKS", "INFLUENCES"]);

  return edges.filter((e) => {
    const rel = edgeRelType(e);
    const sT = idToType.get(e.source);
    const tT = idToType.get(e.target);
    const touchesSystem = typeIsSystem(sT) || typeIsSystem(tT);

    if (view === "org") return orgTypes.has(rel);
    if (view === "product") {
      if (productCore.has(rel)) return true;
      return rel === "LINKS_TO" && touchesSystem;
    }
    if (orgTypes.has(rel)) return true;
    if (productCore.has(rel)) return true;
    return rel === "LINKS_TO" && touchesSystem;
  });
}

// ─── Deterministic seeded PRNG ───────────────────────────────────────────────

function seedFromString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Fruchterman–Reingold layout ──────────────────────────────────────────────

function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  W: number,
  H: number,
): Map<string, Pos> {
  const pos = new Map<string, Pos>();
  if (nodes.length === 0) return pos;

  const seed = seedFromString(
    nodes
      .map((n) => n.id)
      .sort()
      .join("|"),
  );
  const rand = mulberry32(seed);

  const cx = W / 2;
  const cy = H / 2;
  const radius = Math.min(W, H) * 0.35;

  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2 + rand() * 0.3;
    const r = radius * (0.4 + rand() * 0.6);
    pos.set(n.id, {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
    });
  });

  const area = W * H;
  const k = Math.sqrt(area / Math.max(nodes.length, 1)) * 0.55;
  const iterations = nodes.length < 10 ? 250 : 350;

  for (let iter = 0; iter < iterations; iter++) {
    const t = Math.max(0.05, 1 - iter / iterations) * (Math.min(W, H) * 0.08);

    for (let i = 0; i < nodes.length; i++) {
      const a = pos.get(nodes[i].id)!;
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const b = pos.get(nodes[j].id)!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / d;
        a.vx += (dx / d) * force;
        a.vy += (dy / d) * force;
      }
    }

    for (const e of edges) {
      const a = pos.get(e.source);
      const b = pos.get(e.target);
      if (!a || !b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (d * d) / k;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }

    for (const p of pos.values()) {
      p.vx += (cx - p.x) * 0.012;
      p.vy += (cy - p.y) * 0.012;
    }

    const pad = 90;
    for (const p of pos.values()) {
      const v = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 0.01;
      const step = Math.min(v, t);
      p.x += (p.vx / v) * step;
      p.y += (p.vy / v) * step;
      p.x = Math.max(pad, Math.min(W - pad, p.x));
      p.y = Math.max(pad, Math.min(H - pad, p.y));
      p.vx = 0;
      p.vy = 0;
    }
  }

  return pos;
}

// ─── NodeShape (interactive) ──────────────────────────────────────────────────

function NodeShape({
  node,
  x,
  y,
  selected,
  dim,
  hovered,
  onMouseDown,
  onMouseEnter,
  onMouseLeave,
}: {
  node: GraphNode;
  x: number;
  y: number;
  selected: boolean;
  dim: boolean;
  hovered: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const r = nodeRadius(node);
  const isSystem = typeIsSystem(node.type);
  const border = sentimentColor(node.sentiment);
  const inf = typeof node.influence === "number" ? node.influence : 0.5;
  const showGlow = inf >= 0.65 || selected || hovered;
  const glowStroke = selected ? "#3B82F6" : hovered ? "#E8ECF4" : border;
  const opacity = dim ? 0.35 : 1;
  const initials = labelInitials(node.name);
  const label = node.name ?? node.id;

  return (
    <g
      style={{ cursor: "grab", opacity }}
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {showGlow && (
        isSystem ? (
          <rect
            x={x - r - 6}
            y={y - r - 6}
            width={r * 2 + 12}
            height={r * 2 + 12}
            rx={10}
            fill={glowStroke}
            opacity={0.18}
            style={{ filter: "blur(8px)", pointerEvents: "none" }}
          />
        ) : (
          <circle
            cx={x}
            cy={y}
            r={r + 8}
            fill={glowStroke}
            opacity={0.18}
            style={{ filter: "blur(8px)", pointerEvents: "none" }}
          />
        )
      )}

      {isSystem ? (
        <rect
          x={x - r}
          y={y - r}
          width={r * 2}
          height={r * 2}
          rx={6}
          fill="#1F2A40"
          stroke={selected ? "#3B82F6" : hovered ? "#E8ECF4" : border}
          strokeWidth={selected || hovered ? 3 : 1.5}
        />
      ) : (
        <circle
          cx={x}
          cy={y}
          r={r}
          fill="#1F2A40"
          stroke={selected ? "#3B82F6" : hovered ? "#E8ECF4" : border}
          strokeWidth={selected || hovered ? 3 : 1.5}
        />
      )}

      <text
        x={x}
        y={y + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#E8ECF4"
        fontSize={r > 30 ? 13 : 11}
        fontWeight={700}
        fontFamily="JetBrains Mono, monospace"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {initials}
      </text>

      <text
        x={x}
        y={y + r + 14}
        textAnchor="middle"
        fill={selected || hovered ? "#E8ECF4" : "#8892A8"}
        fontSize={10}
        fontFamily="JetBrains Mono, monospace"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {label.length > 22 ? label.slice(0, 20) + "…" : label}
      </text>
    </g>
  );
}

// ─── Edge ─────────────────────────────────────────────────────────────────────

function EdgeLine({
  ax,
  ay,
  bx,
  by,
  color,
  width,
  dim,
}: {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  color: string;
  width: number;
  dim: boolean;
}) {
  const dx = bx - ax;
  const dy = by - ay;
  const midX = (ax + bx) / 2;
  const midY = (ay + by) / 2;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const offset = Math.min(60, len * 0.12);
  const px = -dy / len;
  const py = dx / len;
  const cpX = midX + px * offset;
  const cpY = midY + py * offset;
  return (
    <path
      d={`M ${ax} ${ay} Q ${cpX} ${cpY} ${bx} ${by}`}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      opacity={dim ? 0.15 : 0.6}
    />
  );
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function Tooltip({
  node,
  edgeCount,
  blockerCount,
  left,
  top,
}: {
  node: GraphNode;
  edgeCount: number;
  blockerCount: number;
  left: number;
  top: number;
}) {
  const sent = typeof node.sentiment === "number" ? node.sentiment : 0.5;
  const inf = typeof node.influence === "number" ? node.influence : 0.5;
  const sentCol = sentimentColor(sent);
  return (
    <div
      className="absolute z-20 flex flex-col gap-1.5 rounded-md px-3 py-2.5"
      style={{
        left,
        top,
        background: "#0A0E17F0",
        border: "1px solid #2A3650",
        pointerEvents: "none",
        minWidth: 200,
        maxWidth: 280,
        boxShadow: "0 8px 24px #00000080",
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="h-2 w-2 rounded-full"
          style={{ background: sentCol }}
        />
        <span
          className="font-mono font-bold text-xs"
          style={{ color: "#E8ECF4" }}
        >
          {node.name ?? node.id}
        </span>
      </div>
      <span
        className="font-mono text-xs"
        style={{ color: "#8892A8", letterSpacing: "0.05em" }}
      >
        {(node.type ?? "Unknown")}
      </span>
      <div className="flex items-center gap-3 mt-1">
        <div className="flex flex-col">
          <span className="font-mono text-xs" style={{ color: "#5A6580", fontSize: 9, letterSpacing: "0.08em" }}>
            INFLUENCE
          </span>
          <span className="font-mono font-bold text-xs" style={{ color: "#F59E0B" }}>
            {(inf * 10).toFixed(1)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="font-mono text-xs" style={{ color: "#5A6580", fontSize: 9, letterSpacing: "0.08em" }}>
            SENTIMENT
          </span>
          <span className="font-mono font-bold text-xs" style={{ color: sentCol }}>
            {(sent * 10).toFixed(1)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="font-mono text-xs" style={{ color: "#5A6580", fontSize: 9, letterSpacing: "0.08em" }}>
            EDGES
          </span>
          <span className="font-mono font-bold text-xs" style={{ color: "#E8ECF4" }}>
            {edgeCount}
          </span>
        </div>
        {blockerCount > 0 && (
          <div className="flex flex-col">
            <span className="font-mono text-xs" style={{ color: "#5A6580", fontSize: 9, letterSpacing: "0.08em" }}>
              BLOCKS
            </span>
            <span className="font-mono font-bold text-xs" style={{ color: "#EF4444" }}>
              {blockerCount}
            </span>
          </div>
        )}
      </div>
      <span
        className="font-sans text-xs mt-1"
        style={{ color: "#5A6580", fontSize: 10 }}
      >
        click to open audit · drag to reposition
      </span>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function LiveGraph({
  graph,
  width = 1480,
  height = 1020,
  onNodeClick,
  selectedId = null,
  highlightIds,
  graphInsightView = "all",
}: LiveGraphProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [pinned, setPinned] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragOp, setDragOp] = useState<DragOp | null>(null);
  const dragMovedRef = useRef(false);

  const displayEdges = useMemo(
    () => filterGraphEdges(graphInsightView, graph.nodes, graph.edges),
    [graphInsightView, graph.nodes, graph.edges],
  );

  const positions = useMemo(
    () => computeLayout(graph.nodes, displayEdges, width, height),
    [graph.nodes, displayEdges, width, height],
  );

  // Clear pinned positions when graph shape changes
  useEffect(() => {
    setPinned(new Map());
  }, [graph, graphInsightView]);

  const getPos = useCallback(
    (id: string) => {
      const pin = pinned.get(id);
      if (pin) return pin;
      const p = positions.get(id);
      return p ? { x: p.x, y: p.y } : null;
    },
    [pinned, positions],
  );

  const neighborhood = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set<string>([selectedId]);
    for (const e of displayEdges) {
      if (e.source === selectedId) set.add(e.target);
      if (e.target === selectedId) set.add(e.source);
    }
    return set;
  }, [displayEdges, selectedId]);

  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of displayEdges) {
      d.set(e.source, (d.get(e.source) ?? 0) + 1);
      d.set(e.target, (d.get(e.target) ?? 0) + 1);
    }
    return d;
  }, [displayEdges]);

  const blockerDegree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of displayEdges) {
      if (edgeRelType(e) !== "BLOCKS") continue;
      d.set(e.source, (d.get(e.source) ?? 0) + 1);
      d.set(e.target, (d.get(e.target) ?? 0) + 1);
    }
    return d;
  }, [displayEdges]);

  // ─── Coord conversion helpers ─────────────────────────────────────────────

  const clientDeltaToVb = useCallback((dxClient: number, dyClient: number) => {
    const wrap = wrapperRef.current;
    if (!wrap) return { dx: 0, dy: 0 };
    const rect = wrap.getBoundingClientRect();
    const scale = Math.min(rect.width / width, rect.height / height) || 1;
    return {
      dx: dxClient / scale,
      dy: dyClient / scale,
    };
  }, [width, height]);

  const vbContentToClient = useCallback(
    (vbX: number, vbY: number) => {
      const wrap = wrapperRef.current;
      if (!wrap) return { x: 0, y: 0 };
      const rect = wrap.getBoundingClientRect();
      const scale = Math.min(rect.width / width, rect.height / height) || 1;
      // preserveAspectRatio="xMidYMid meet" centers the viewBox in the container
      const renderedW = width * scale;
      const renderedH = height * scale;
      const offsetX = (rect.width - renderedW) / 2;
      const offsetY = (rect.height - renderedH) / 2;
      // transform: content -> viewBox (apply g-transform: scale then translate)
      const postVbX = zoom * vbX + pan.x;
      const postVbY = zoom * vbY + pan.y;
      return {
        x: offsetX + postVbX * scale,
        y: offsetY + postVbY * scale,
      };
    },
    [width, height, zoom, pan],
  );

  // ─── Event handlers ───────────────────────────────────────────────────────

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      const wrap = wrapperRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const scale = Math.min(rect.width / width, rect.height / height) || 1;
      const renderedW = width * scale;
      const renderedH = height * scale;
      const offsetX = (rect.width - renderedW) / 2;
      const offsetY = (rect.height - renderedH) / 2;

      // Mouse in viewBox coords (post-transform space)
      const mxVb = (e.clientX - rect.left - offsetX) / scale;
      const myVb = (e.clientY - rect.top - offsetY) / scale;

      // Point under mouse in CONTENT space (pre g-transform)
      const contentX = (mxVb - pan.x) / zoom;
      const contentY = (myVb - pan.y) / zoom;

      const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.max(0.4, Math.min(3, zoom * delta));

      // Keep that content point under the mouse after zoom
      const newPanX = mxVb - newZoom * contentX;
      const newPanY = myVb - newZoom * contentY;

      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    },
    [width, height, zoom, pan],
  );

  const handleSvgMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start pan if the click isn't on a node (nodes call stopPropagation)
    setDragOp({
      type: "pan",
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    });
  }, [pan]);

  const handleNodeMouseDown = useCallback(
    (id: string) => (e: React.MouseEvent) => {
      e.stopPropagation();
      const p = getPos(id);
      if (!p) return;
      dragMovedRef.current = false;
      setDragOp({
        type: "node",
        id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: p.x,
        startY: p.y,
      });
    },
    [getPos],
  );

  // Doc-level listeners so drags work when mouse leaves the SVG.
  useEffect(() => {
    if (!dragOp) return;

    const onMove = (ev: MouseEvent) => {
      const dxClient = ev.clientX - dragOp.startClientX;
      const dyClient = ev.clientY - dragOp.startClientY;
      const { dx, dy } = clientDeltaToVb(dxClient, dyClient);

      if (dragOp.type === "pan") {
        if (Math.abs(dxClient) > 3 || Math.abs(dyClient) > 3) dragMovedRef.current = true;
        setPan({ x: dragOp.startPanX + dx, y: dragOp.startPanY + dy });
      } else {
        if (Math.abs(dxClient) > 3 || Math.abs(dyClient) > 3) dragMovedRef.current = true;
        const newX = dragOp.startX + dx / zoom;
        const newY = dragOp.startY + dy / zoom;
        setPinned((prev) => {
          const next = new Map(prev);
          next.set(dragOp.id, { x: newX, y: newY });
          return next;
        });
      }
    };

    const onUp = () => {
      if (dragOp.type === "node" && !dragMovedRef.current && onNodeClick) {
        onNodeClick(dragOp.id);
      }
      setDragOp(null);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragOp, clientDeltaToVb, zoom, onNodeClick]);

  const handleReset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setPinned(new Map());
  }, []);

  // ─── Empty state ──────────────────────────────────────────────────────────

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div
          className="rounded-lg px-6 py-5 text-center"
          style={{ background: "#1A2035", border: "1px dashed #2A3650" }}
        >
          <p
            className="font-mono font-semibold text-sm"
            style={{ color: "#8892A8" }}
          >
            Graph is empty
          </p>
          <p
            className="mt-1 font-sans text-xs"
            style={{ color: "#5A6580" }}
          >
            Drop a transcript in <code>inbox/</code> and run <code>make demo-commit</code>.
          </p>
        </div>
      </div>
    );
  }

  // ─── Tooltip data ─────────────────────────────────────────────────────────

  const hoveredNode = hoveredId ? graph.nodes.find((n) => n.id === hoveredId) : null;
  let tooltipPos: { left: number; top: number } | null = null;
  if (hoveredNode) {
    const p = getPos(hoveredNode.id);
    if (p) {
      const clientP = vbContentToClient(p.x, p.y);
      const r = nodeRadius(hoveredNode);
      tooltipPos = {
        left: clientP.x + r * zoom + 16,
        top: Math.max(8, clientP.y - 40),
      };
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      ref={wrapperRef}
      className="absolute inset-0 select-none"
      onWheel={handleWheel}
      style={{ cursor: dragOp?.type === "pan" ? "grabbing" : "default" }}
    >
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        onMouseDown={handleSvgMouseDown}
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {displayEdges.map((e, i) => {
            const a = getPos(e.source);
            const b = getPos(e.target);
            if (!a || !b) return null;
            const rel = edgeRelType(e);
            const color = EDGE_COLOR[rel] ?? "#6B7280";
            const isBlocker = rel === "BLOCKS";
            const strokeW = isBlocker ? 2.5 : 1.5;
            const dim =
              (neighborhood != null &&
                !(neighborhood.has(e.source) && neighborhood.has(e.target))) ||
              (highlightIds != null &&
                !(highlightIds.has(e.source) && highlightIds.has(e.target)));
            return (
              <EdgeLine
                key={`${e.source}→${e.target}-${rel}-${i}`}
                ax={a.x}
                ay={a.y}
                bx={b.x}
                by={b.y}
                color={color}
                width={strokeW}
                dim={dim}
              />
            );
          })}

          {graph.nodes.map((n) => {
            const p = getPos(n.id);
            if (!p) return null;
            const selected = selectedId === n.id;
            const hovered = hoveredId === n.id;
            const dim =
              (neighborhood != null && !neighborhood.has(n.id)) ||
              (highlightIds != null && !highlightIds.has(n.id));
            return (
              <NodeShape
                key={n.id}
                node={n}
                x={p.x}
                y={p.y}
                selected={selected}
                dim={dim}
                hovered={hovered}
                onMouseDown={handleNodeMouseDown(n.id)}
                onMouseEnter={() => setHoveredId(n.id)}
                onMouseLeave={() => setHoveredId((id) => (id === n.id ? null : id))}
              />
            );
          })}
        </g>
      </svg>

      {hoveredNode && tooltipPos && (
        <Tooltip
          node={hoveredNode}
          edgeCount={degree.get(hoveredNode.id) ?? 0}
          blockerCount={blockerDegree.get(hoveredNode.id) ?? 0}
          left={tooltipPos.left}
          top={tooltipPos.top}
        />
      )}

      {/* Controls overlay — zoom level + reset button */}
      <div
        className="absolute z-10 flex items-center gap-1.5 rounded-md px-2 py-1"
        style={{
          right: 16,
          bottom: 16,
          background: "#0A0E17CC",
          border: "1px solid #2A3650",
        }}
      >
        <button
          onClick={() => setZoom((z) => Math.min(3, z * 1.2))}
          className="px-1.5 py-0.5 rounded font-mono text-xs"
          style={{ background: "#1F2A40", color: "#E8ECF4", border: "1px solid #2A3650" }}
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.4, z / 1.2))}
          className="px-1.5 py-0.5 rounded font-mono text-xs"
          style={{ background: "#1F2A40", color: "#E8ECF4", border: "1px solid #2A3650" }}
          title="Zoom out"
        >
          −
        </button>
        <span
          className="font-mono text-xs px-1.5"
          style={{ color: "#8892A8" }}
        >
          {(zoom * 100).toFixed(0)}%
        </span>
        <button
          onClick={handleReset}
          className="px-2 py-0.5 rounded font-mono text-xs"
          style={{ background: "#1F2A40", color: "#8892A8", border: "1px solid #2A3650" }}
          title="Reset view"
        >
          RESET
        </button>
      </div>
    </div>
  );
}
