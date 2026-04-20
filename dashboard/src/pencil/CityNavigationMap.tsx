'use client'

import { useMemo, useState } from 'react'
import { Compass, TriangleAlert, Zap } from 'lucide-react'
import LiveGraph, { type GraphInsightView } from '../components/LiveGraph'
import type { ActionPlan, GraphSnapshot } from '../api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeDef {
  id: string
  initials: string
  label: string
  labelColor?: string
  x: number
  y: number
  size: number
  height?: number
  shape: 'circle' | 'rect'
  fill: string
  textColor: string
  border?: string
  borderWidth?: number
  glow?: string
}

interface EdgeDef {
  from: [number, number]
  to: [number, number]
  color: string
  width: number
  cp?: [number, number]
}

interface CityNavigationMapProps {
  graph?: GraphSnapshot | null
  plans?: ActionPlan[]
  onNodeClick?: (id: string) => void
  selectedId?: string | null
}

// ─── Mock data (fallback when no live graph is connected) ─────────────────────

const NODES: NodeDef[] = [
  { id: 'you',      initials: 'YOU',  label: 'FDE · S. Chen',       x: 220,  y: 440, size: 64, shape: 'circle', fill: '#3B82F6', textColor: '#FFFFFF', glow: '#3B82F640' },
  { id: 'chen',     initials: 'DC',   label: 'Director Chen',       x: 830,  y: 180, size: 70, shape: 'circle', fill: '#1F2A40', textColor: '#F59E0B', border: '#F59E0B', borderWidth: 3, labelColor: '#F59E0B', glow: '#F59E0B40' },
  { id: 'walsh',    initials: 'DW',   label: 'Dep. Walsh',          x: 540,  y: 320, size: 56, shape: 'circle', fill: '#1F2A40', textColor: '#E8ECF4', border: '#22C55E' },
  { id: 'reeves',   initials: 'MR',   label: 'Field Ops Reeves',    x: 520,  y: 560, size: 56, shape: 'circle', fill: '#1F2A40', textColor: '#E8ECF4', border: '#22C55E' },
  { id: 'torres',   initials: 'BT',   label: 'Budget Torres',       x: 260,  y: 220, size: 52, shape: 'circle', fill: '#1F2A40', textColor: '#E8ECF4', border: '#6B7280' },
  { id: 'nak',      initials: 'IN',   label: 'IT Nakamura',         x: 380,  y: 570, size: 52, shape: 'circle', fill: '#1F2A40', textColor: '#E8ECF4', border: '#EF4444' },
  { id: 'davis',    initials: 'PD',   label: 'Procurement Davis',   x: 750,  y: 350, size: 52, shape: 'circle', fill: '#1F2A40', textColor: '#E8ECF4', border: '#EF4444' },
  { id: 'abadi',    initials: 'CA',   label: 'Council Abadi',       x: 680,  y: 580, size: 52, shape: 'circle', fill: '#1F2A40', textColor: '#E8ECF4', border: '#6B7280' },
  { id: 'sap',      initials: 'SAP',  label: 'SAP ERP',             x: 880,  y: 450, size: 52, shape: 'rect',   fill: '#1F2A40', textColor: '#E8ECF4', border: '#6B7280' },
  { id: 'gis',      initials: 'GIS',  label: 'GIS Platform',        x: 960,  y: 580, size: 52, shape: 'rect',   fill: '#1F2A40', textColor: '#E8ECF4', border: '#EF4444' },
  { id: 'asset',    initials: 'ADB',  label: 'Asset Mgmt DB',       x: 1060, y: 440, size: 52, shape: 'rect',   fill: '#1F2A40', textColor: '#E8ECF4', border: '#22C55E' },
  { id: 'legacy',   initials: 'LPS',  label: 'Legacy Permits',      x: 880,  y: 700, size: 52, shape: 'rect',   fill: '#1F2A40', textColor: '#E8ECF4', border: '#6B7280' },
]

const nc = (id: string): [number, number] => {
  const n = NODES.find(n => n.id === id)!
  return [n.x + n.size / 2, n.y + (n.height ?? n.size) / 2]
}

function mkEdges(): EdgeDef[] {
  const cp = (a: [number, number], b: [number, number], ox = 0, oy = -50): [number, number] =>
    [Math.round((a[0] + b[0]) / 2 + ox), Math.round((a[1] + b[1]) / 2 + oy)]

  const green = '#22C55E', red = '#EF4444', gray = '#6B7280'

  return [
    { from: nc('you'),   to: nc('walsh'),  color: green, width: 2, cp: cp(nc('you'),  nc('walsh'),  0, -40) },
    { from: nc('you'),   to: nc('reeves'), color: green, width: 2, cp: cp(nc('you'),  nc('reeves'), 0, 30) },
    { from: nc('walsh'), to: nc('chen'),   color: green, width: 1.5, cp: cp(nc('walsh'), nc('chen'), 0, -50) },
    { from: nc('nak'),   to: nc('davis'),  color: red,   width: 2, cp: cp(nc('nak'),  nc('davis'),  60, -40) },
    { from: nc('davis'), to: nc('gis'),    color: red,   width: 2, cp: cp(nc('davis'), nc('gis'),   20, 30) },
    { from: nc('torres'), to: nc('you'),   color: gray,  width: 1.5, cp: cp(nc('torres'), nc('you'), -40, 0) },
    { from: nc('abadi'),  to: nc('sap'),   color: gray,  width: 1.5, cp: cp(nc('abadi'),  nc('sap'), 40, -20) },
    { from: nc('sap'),    to: nc('asset'), color: gray,  width: 1.5, cp: cp(nc('sap'),  nc('asset'), 0, -40) },
    { from: nc('legacy'), to: nc('gis'),   color: gray,  width: 1.5, cp: cp(nc('legacy'), nc('gis'), 40, 0) },
    { from: nc('chen'),   to: nc('asset'), color: green, width: 1.5, cp: cp(nc('chen'), nc('asset'), 60, -20) },
  ]
}

function GraphNode({ node }: { node: NodeDef }) {
  const r = node.size / 2
  const bw = node.borderWidth ?? (node.border ? 1.5 : 0)
  const h = node.height ?? node.size

  return (
    <g>
      {node.shape === 'circle' ? (
        <>
          {node.glow && (
            <circle cx={node.x + r} cy={node.y + r} r={r + 8} fill={node.glow} style={{ filter: 'blur(10px)' }} />
          )}
          <circle cx={node.x + r} cy={node.y + r} r={r} fill={node.fill} stroke={node.border ?? 'none'} strokeWidth={bw} />
          <text
            x={node.x + r} y={node.y + r + 1}
            textAnchor="middle" dominantBaseline="middle"
            fill={node.textColor} fontSize={node.size > 60 ? 16 : 14} fontWeight="600"
            fontFamily="JetBrains Mono, monospace"
          >{node.initials}</text>
        </>
      ) : (
        <>
          <rect x={node.x} y={node.y} width={node.size} height={h} rx={8}
            fill={node.fill} stroke={node.border ?? 'none'} strokeWidth={bw} />
          <text
            x={node.x + node.size / 2} y={node.y + h / 2 + 1}
            textAnchor="middle" dominantBaseline="middle"
            fill={node.textColor} fontSize={11} fontWeight="600"
            fontFamily="JetBrains Mono, monospace"
          >{node.initials}</text>
        </>
      )}
      {node.label && (
        <text
          x={node.x + node.size / 2} y={node.y + h + 14}
          textAnchor="middle" fill={node.labelColor ?? '#8892A8'}
          fontSize={10} fontFamily="JetBrains Mono, monospace"
        >{node.label}</text>
      )}
    </g>
  )
}

function GraphEdge({ edge }: { edge: EdgeDef }) {
  const [x1, y1] = edge.from
  const [x2, y2] = edge.to
  const [cx, cy] = edge.cp ?? [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2 - 40)]
  return (
    <path
      d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
      fill="none" stroke={edge.color} strokeWidth={edge.width}
      strokeLinecap="round" opacity={0.7}
    />
  )
}

// ─── Pathfinder Sidebar ───────────────────────────────────────────────────────

const MOCK_STATS = [
  { value: '11', label: 'NODES',    color: '#E8ECF4' },
  { value: '16', label: 'EDGES',    color: '#E8ECF4' },
  { value: '3',  label: 'FRICTION', color: '#EF4444' },
  { value: '4',  label: 'ORPHANS',  color: '#F59E0B' },
]

const MOCK_ORPHANS = [
  { id: 'bt',  initials: 'BT',  name: 'Budget Torres',       role: 'Budget Management',          influence: '8.1', sentiment: '5.2', borderColor: '#F59E0B' },
  { id: 'ca',  initials: 'CA',  name: 'Council Abadi',        role: 'Infrastructure Committee',   influence: '7.4', sentiment: '4.8', borderColor: '#F59E0B' },
  { id: 'pd',  initials: 'PD',  name: 'Procurement Davis',    role: 'Vendor Compliance',          influence: '6.8', sentiment: '3.9', borderColor: '#6B7280', shape: 'rect' },
  { id: 'lps', initials: 'LPS', name: 'Legacy Permits Sys.',  role: 'Permitting Platform',        influence: '5.2', sentiment: '2.1', borderColor: '#6B7280', shape: 'rect' },
]

const MOCK_ACTIONS = [
  { priority: 'CRITICAL', priColor: '#DC2626', bg: '#DC262625', text: 'Schedule meeting with Council Rep. Abadi — leverage infrastructure committee position before Q4 budget cycle' },
  { priority: 'HIGH',     priColor: '#F59E0B', bg: '#F59E0B25', text: 'Re-engage Budget Mgr. Torres — confirm budget status directly, resolve Voice Ledger / Email conflict' },
  { priority: 'HIGH',     priColor: '#F59E0B', bg: '#F59E0B25', text: 'Assign integration owner for Legacy Permitting — unblocks critical path to contract' },
  { priority: 'MEDIUM',   priColor: '#3B82F6', bg: '#3B82F620', text: 'Technical deep-dive with Nakamura to resolve GIS API compatibility concerns' },
]

function initials(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function PathfinderSidebar({
  graph,
  plans,
  onNodeClick,
}: {
  graph?: GraphSnapshot | null
  plans?: ActionPlan[]
  onNodeClick?: (id: string) => void
}) {
  const live = !!graph

  const { stats, orphans } = useMemo(() => {
    if (!graph) return { stats: MOCK_STATS, orphans: MOCK_ORPHANS }

    // Orphans = high influence (>=0.65) with 0 or 1 edges (isolated power)
    const degree = new Map<string, number>()
    for (const e of graph.edges) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
    }
    const orphanList = graph.nodes
      .filter(n => (n.influence ?? 0) >= 0.55 && (degree.get(n.id) ?? 0) <= 1)
      .sort((a, b) => (b.influence ?? 0) - (a.influence ?? 0))
      .slice(0, 6)

    const friction = graph.edges.filter(e => e.type === 'BLOCKS').length
    const s = [
      { value: String(graph.nodes.length), label: 'NODES',    color: '#E8ECF4' },
      { value: String(graph.edges.length), label: 'EDGES',    color: '#E8ECF4' },
      { value: String(friction),            label: 'FRICTION', color: friction > 0 ? '#EF4444' : '#22C55E' },
      { value: String(orphanList.length),   label: 'ORPHANS',  color: orphanList.length > 0 ? '#F59E0B' : '#22C55E' },
    ]

    return {
      stats: s,
      orphans: orphanList.map(n => ({
        id: n.id,
        initials: initials(n.name ?? n.id),
        name: n.name ?? n.id,
        role: (n.type ?? 'Unknown') as string,
        influence: ((n.influence ?? 0) * 10).toFixed(1),
        sentiment: ((n.sentiment ?? 0.5) * 10).toFixed(1),
        borderColor:
          (n.sentiment ?? 0.5) <= 0.35 ? '#EF4444' :
          (n.sentiment ?? 0.5) >= 0.65 ? '#22C55E' : '#F59E0B',
        shape: (n.type ?? '').toLowerCase() === 'system' ? 'rect' as const : undefined,
      })),
    }
  }, [graph])

  const actions = useMemo(() => {
    if (!plans || plans.length === 0) return MOCK_ACTIONS
    return plans.slice(0, 6).map((p) => {
      const head = p.content.split('\n').find((l) => l.trim().length > 0) ?? p.path
      const clean = head.replace(/^#+\s*/, '').slice(0, 160)
      const hasCritical = /critical|blocker|inertia/i.test(p.content)
      const hasHigh = /high|stall|friction/i.test(p.content)
      const priority = hasCritical ? 'CRITICAL' : hasHigh ? 'HIGH' : 'MEDIUM'
      const priColor = priority === 'CRITICAL' ? '#DC2626' : priority === 'HIGH' ? '#F59E0B' : '#3B82F6'
      const bg = priority === 'CRITICAL' ? '#DC262625' : priority === 'HIGH' ? '#F59E0B25' : '#3B82F620'
      return { priority, priColor, bg, text: clean }
    })
  }, [plans])

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ width: 420, background: '#111827', borderLeft: '1px solid #2A3650' }}>
      <div className="flex items-center gap-2.5 px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid #2A3650' }}>
        <Compass size={18} color="#3B82F6" />
        <span className="font-mono font-bold tracking-widest text-sm" style={{ color: '#E8ECF4', letterSpacing: '0.1em' }}>PATHFINDER INSIGHTS</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1 px-2 py-0.5 rounded" style={{ background: live ? '#22C55E20' : '#3B82F620' }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: live ? '#22C55E' : '#3B82F6' }} />
          <span className="font-mono font-bold text-xs tracking-widest" style={{ color: live ? '#22C55E' : '#3B82F6' }}>
            {live ? 'LIVE' : 'DESIGN'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 px-5 py-3 flex-shrink-0" style={{ borderBottom: '1px solid #2A3650' }}>
        {stats.map(s => (
          <div key={s.label} className="flex flex-col items-center gap-0.5 px-2.5 py-2 rounded-md" style={{ background: '#1A2035' }}>
            <span className="font-mono font-bold text-2xl leading-none" style={{ color: s.color }}>{s.value}</span>
            <span className="font-mono font-medium text-xs tracking-widest" style={{ color: '#5A6580', letterSpacing: '0.08em' }}>{s.label}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2.5 px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid #2A3650' }}>
        <div className="flex items-center gap-2">
          <TriangleAlert size={14} color="#F59E0B" />
          <span className="font-mono font-semibold text-xs tracking-widest" style={{ color: '#5A6580', letterSpacing: '0.1em' }}>ORPHANED NODES</span>
          <div className="flex-1" />
          <div className="px-1.5 py-0.5 rounded" style={{ background: '#1F2A40' }}>
            <span className="font-mono text-xs font-medium" style={{ color: '#F59E0B' }}>High influence · ≤1 edge</span>
          </div>
        </div>
        <p className="font-sans text-xs" style={{ color: '#5A6580', lineHeight: 1.5 }}>
          {live
            ? 'Stakeholders with significant decision power but little engagement'
            : 'Stakeholders with significant decision power but no recent FDE engagement'}
        </p>
        <div className="flex flex-col gap-1.5 max-h-[240px] overflow-y-auto">
          {orphans.length === 0 ? (
            <div className="px-3 py-3 rounded-md" style={{ background: '#1A2035', border: '1px dashed #2A3650' }}>
              <p className="font-mono text-xs" style={{ color: '#22C55E' }}>All high-influence nodes are engaged.</p>
            </div>
          ) : orphans.map((o) => (
            <button
              key={o.id}
              onClick={onNodeClick ? () => onNodeClick(o.id) : undefined}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-md text-left"
              style={{ background: '#1A2035', border: '1px solid #1E2A3E', cursor: onNodeClick ? 'pointer' : 'default' }}
            >
              <div
                className="flex items-center justify-center flex-shrink-0 font-mono font-semibold text-xs"
                style={{
                  width: 36, height: 36,
                  borderRadius: o.shape === 'rect' ? 6 : '50%',
                  background: '#1F2A40', color: '#E8ECF4',
                  border: `1.5px solid ${o.borderColor}`,
                }}
              >{o.initials}</div>
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="font-mono font-semibold text-xs truncate" style={{ color: '#E8ECF4' }}>{o.name}</span>
                <span className="font-sans text-xs" style={{ color: '#5A6580' }}>{o.role}</span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="font-mono font-bold text-xs" style={{ color: '#F59E0B' }}>{o.influence}</span>
                <span className="font-mono text-xs" style={{ color: o.borderColor }}>{o.sentiment}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 px-5 py-3.5 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2">
          <Zap size={14} color="#F59E0B" />
          <span className="font-mono font-semibold text-xs tracking-widest" style={{ color: '#5A6580', letterSpacing: '0.1em' }}>RECOMMENDED ACTIONS</span>
          <div className="flex-1" />
          {plans && plans.length > 0 && (
            <div className="px-1.5 py-0.5 rounded" style={{ background: '#1F2A40' }}>
              <span className="font-mono text-xs font-medium" style={{ color: '#3B82F6' }}>{plans.length} plans</span>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          {actions.map((a, i) => (
            <div key={i} className="flex items-start gap-2 px-2.5 py-2 rounded-md" style={{ background: '#1A2035', border: '1px solid #1E2A3E' }}>
              <div className="px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: a.bg }}>
                <span className="font-mono font-bold text-xs" style={{ color: a.priColor }}>{a.priority}</span>
              </div>
              <span className="font-sans text-xs" style={{ color: '#E8ECF4', lineHeight: 1.5 }}>{a.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const LEGEND = [
  { shape: 'circle', label: 'Person / Role' },
  { shape: 'rect',   label: 'System' },
  { color: '#22C55E', label: 'Aligned' },
  { color: '#F59E0B', label: 'Neutral' },
  { color: '#EF4444', label: 'Friction' },
]

const INSIGHT_OPTIONS: { id: GraphInsightView; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'org', label: 'ORG' },
  { id: 'product', label: 'PRODUCT' },
  { id: 'combined', label: 'COMBO' },
]

const EDGES = mkEdges()

export default function CityNavigationMap({
  graph,
  plans,
  onNodeClick,
  selectedId,
}: CityNavigationMapProps = {}) {
  const live = !!graph
  const [insight, setInsight] = useState<GraphInsightView>('all')

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ background: '#0A0E17' }}>
      <div className="relative flex-1 overflow-hidden">
        <div
          className="absolute flex flex-col gap-1.5 p-3 rounded-md z-10"
          style={{ left: 24, top: 20, background: '#0A0E17CC', border: '1px solid #2A3650' }}
        >
          <span className="font-mono font-bold text-xs tracking-widest" style={{ color: '#E8ECF4', letterSpacing: '0.1em' }}>
            {live ? 'PATHFINDER MAP — LIVE FROM VAULT' : 'CITY NAVIGATION MAP — PORTLAND DOT'}
          </span>
          <span className="font-mono text-xs" style={{ color: '#5A6580' }}>
            {live
              ? `Force-directed · ${graph!.nodes.length} nodes · ${graph!.edges.length} edges · ${graph!.source}`
              : 'Pathfinder View · Sentiment Analysis · Live'}
          </span>
          {live && (
            <div className="flex flex-wrap gap-1 mt-1.5" role="radiogroup" aria-label="Graph insight filter">
              {INSIGHT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={insight === opt.id}
                  onClick={() => setInsight(opt.id)}
                  className="font-mono text-[10px] px-2 py-0.5 rounded"
                  style={{
                    background: insight === opt.id ? '#1F3A5F' : '#1F2A40',
                    color: insight === opt.id ? '#E8ECF4' : '#8892A8',
                    border: '1px solid #2A3650',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          className="absolute flex flex-col gap-4 px-3.5 py-2 rounded-md z-10"
          style={{ left: 24, top: live ? 130 : 100, background: '#0A0E17CC', border: '1px solid #2A3650' }}
        >
          {LEGEND.map((l, i) => (
            <div key={i} className="flex items-center gap-1.5">
              {l.shape === 'circle' && (
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#1F2A40', border: '1.5px solid #8892A8' }} />
              )}
              {l.shape === 'rect' && (
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#1F2A40', border: '1.5px solid #8892A8' }} />
              )}
              {l.color && (
                <div className="h-0.5 w-5 rounded-sm" style={{ background: l.color }} />
              )}
              <span className="font-mono text-xs" style={{ color: '#8892A8' }}>{l.label}</span>
            </div>
          ))}
        </div>

        {live ? (
          <LiveGraph
            graph={graph!}
            onNodeClick={onNodeClick}
            selectedId={selectedId}
            graphInsightView={insight}
          />
        ) : (
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1500 1080" preserveAspectRatio="xMidYMid meet">
            {EDGES.map((e, i) => <GraphEdge key={i} edge={e} />)}
            {NODES.map(n => <GraphNode key={n.id} node={n} />)}
          </svg>
        )}
      </div>

      <PathfinderSidebar graph={graph} plans={plans} onNodeClick={onNodeClick} />
    </div>
  )
}
