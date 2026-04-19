import { useMemo } from "react";
import type { GraphSnapshot, GraphNode, GraphEdge } from "../api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiveGraphProps {
  graph: GraphSnapshot;
  width?: number;
  height?: number;
  onNodeClick?: (id: string) => void;
  selectedId?: string | null;
  highlightIds?: Set<string>;
}

interface Pos {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

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
  INFLUENCES: "#3B82F6",
  BLOCKS: "#EF4444",
  USES: "#6B7280",
  LINKS_TO: "#8892A8",
};

// ─── Deterministic seeded PRNG (so layout doesn't jump on reload) ─────────────

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

// ─── Force-directed layout (Fruchterman–Reingold) ─────────────────────────────

function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  W: number,
  H: number,
): Map<string, Pos> {
  const pos = new Map<string, Pos>();
  if (nodes.length === 0) return pos;

  // Seed from node-id set so the layout is stable across reloads but
  // regenerates whenever the graph changes shape.
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
    // distribute roughly on a circle with jitter
    const angle = (i / nodes.length) * Math.PI * 2 + rand() * 0.3;
    const r = radius * (0.4 + rand() * 0.6);
    pos.set(n.id, {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
    });
  });

  // ideal edge length
  const area = W * H;
  const k = Math.sqrt(area / Math.max(nodes.length, 1)) * 0.55;
  const iterations = nodes.length < 10 ? 250 : 350;

  for (let iter = 0; iter < iterations; iter++) {
    const t = Math.max(0.05, 1 - iter / iterations) * (Math.min(W, H) * 0.08);

    // Repulsion — O(n²), fine for 24 nodes
    for (let i = 0; i < nodes.length; i++) {
      const a = pos.get(nodes[i].id)!;
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const b = pos.get(nodes[j].id)!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        const d = Math.sqrt(d2) || 0.01;
        const force = (k * k) / d;
        a.vx += (dx / d) * force;
        a.vy += (dy / d) * force;
      }
    }

    // Attraction along edges
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

    // Weak pull toward center so disconnected nodes don't drift
    for (const p of pos.values()) {
      p.vx += (cx - p.x) * 0.012;
      p.vy += (cy - p.y) * 0.012;
    }

    // Apply with temperature-capped displacement
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function NodeShape({
  node,
  p,
  selected,
  dim,
  onClick,
}: {
  node: GraphNode;
  p: Pos;
  selected: boolean;
  dim: boolean;
  onClick?: () => void;
}) {
  const r = nodeRadius(node);
  const isSystem = typeIsSystem(node.type);
  const border = sentimentColor(node.sentiment);
  const inf = typeof node.influence === "number" ? node.influence : 0.5;
  const showGlow = inf >= 0.65 || selected;
  const glowStroke = selected ? "#3B82F6" : border;
  const opacity = dim ? 0.35 : 1;
  const initials = labelInitials(node.name);
  const label = node.name ?? node.id;

  return (
    <g
      style={{ cursor: onClick ? "pointer" : "default", opacity }}
      onClick={onClick}
    >
      {showGlow && (
        <>
          {isSystem ? (
            <rect
              x={p.x - r - 6}
              y={p.y - r - 6}
              width={r * 2 + 12}
              height={r * 2 + 12}
              rx={10}
              fill={glowStroke}
              opacity={0.18}
              style={{ filter: "blur(8px)" }}
            />
          ) : (
            <circle
              cx={p.x}
              cy={p.y}
              r={r + 8}
              fill={glowStroke}
              opacity={0.18}
              style={{ filter: "blur(8px)" }}
            />
          )}
        </>
      )}

      {isSystem ? (
        <rect
          x={p.x - r}
          y={p.y - r}
          width={r * 2}
          height={r * 2}
          rx={6}
          fill="#1F2A40"
          stroke={selected ? "#3B82F6" : border}
          strokeWidth={selected ? 3 : 1.5}
        />
      ) : (
        <circle
          cx={p.x}
          cy={p.y}
          r={r}
          fill="#1F2A40"
          stroke={selected ? "#3B82F6" : border}
          strokeWidth={selected ? 3 : 1.5}
        />
      )}

      <text
        x={p.x}
        y={p.y + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#E8ECF4"
        fontSize={r > 30 ? 13 : 11}
        fontWeight={700}
        fontFamily="JetBrains Mono, monospace"
        style={{ pointerEvents: "none" }}
      >
        {initials}
      </text>

      <text
        x={p.x}
        y={p.y + r + 14}
        textAnchor="middle"
        fill={selected ? "#E8ECF4" : "#8892A8"}
        fontSize={10}
        fontFamily="JetBrains Mono, monospace"
        style={{ pointerEvents: "none" }}
      >
        {label.length > 22 ? label.slice(0, 20) + "…" : label}
      </text>
    </g>
  );
}

function EdgeLine({
  a,
  b,
  color,
  width,
  dim,
}: {
  a: Pos;
  b: Pos;
  color: string;
  width: number;
  dim: boolean;
}) {
  // Curved quadratic path — gentle bow so overlapping edges separate visually.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  // Perpendicular offset, sign derived from hash so it's stable
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const offset = Math.min(60, len * 0.12);
  const px = -dy / len;
  const py = dx / len;
  const cx = midX + px * offset;
  const cy = midY + py * offset;
  return (
    <path
      d={`M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      opacity={dim ? 0.15 : 0.6}
    />
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
}: LiveGraphProps) {
  const positions = useMemo(
    () => computeLayout(graph.nodes, graph.edges, width, height),
    [graph, width, height],
  );

  // Which nodes are connected to the selected node (for dimming)
  const neighborhood = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set<string>([selectedId]);
    for (const e of graph.edges) {
      if (e.source === selectedId) set.add(e.target);
      if (e.target === selectedId) set.add(e.source);
    }
    return set;
  }, [graph.edges, selectedId]);

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

  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {graph.edges.map((e, i) => {
        const a = positions.get(e.source);
        const b = positions.get(e.target);
        if (!a || !b) return null;
        const color = EDGE_COLOR[e.type] ?? "#6B7280";
        const isBlocker = e.type === "BLOCKS";
        const width = isBlocker ? 2.5 : 1.5;
        const dim =
          (neighborhood != null &&
            !(neighborhood.has(e.source) && neighborhood.has(e.target))) ||
          (highlightIds != null &&
            !(highlightIds.has(e.source) && highlightIds.has(e.target)));
        return (
          <EdgeLine
            key={`${e.source}→${e.target}-${e.type}-${i}`}
            a={a}
            b={b}
            color={color}
            width={width}
            dim={dim}
          />
        );
      })}

      {graph.nodes.map((n) => {
        const p = positions.get(n.id);
        if (!p) return null;
        const selected = selectedId === n.id;
        const dim =
          (neighborhood != null && !neighborhood.has(n.id)) ||
          (highlightIds != null && !highlightIds.has(n.id));
        return (
          <NodeShape
            key={n.id}
            node={n}
            p={p}
            selected={selected}
            dim={dim}
            onClick={onNodeClick ? () => onNodeClick(n.id) : undefined}
          />
        );
      })}
    </svg>
  );
}
