'use client'

import { useMemo, useState } from 'react'
import { ShieldAlert, GitCompare, TrendingUp } from 'lucide-react'
import LiveGraph, { type GraphInsightView } from '../components/LiveGraph'
import type { Conflict, GraphSnapshot } from '../api'

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

interface CityIntelligenceMapProps {
  graph?: GraphSnapshot | null
  conflicts?: Conflict[]
  onNodeClick?: (id: string) => void
  selectedId?: string | null
}

// ─── Mock data (fallback when no live graph is connected) ─────────────────────

const NODES: NodeDef[] = [
  { id: 'you',      initials: 'YOU',      label: 'FDE · Sarah Chen',      x: 120,  y: 620, size: 64, shape: 'circle', fill: '#3B82F6', textColor: '#FFFFFF', glow: '#3B82F640' },
  { id: 'reeves',   initials: 'MR',       label: 'Field Ops Reeves',      x: 320,  y: 420, size: 56, shape: 'circle', fill: '#1F2A40', textColor: '#E8ECF4', border: '#F59E0B', glow: '#F59E0B30' },
  { id: 'walsh',    initials: 'DW',       label: 'Deputy Walsh',          x: 580,  y: 340, size: 56, shape: 'circle', fill: '#1F2A40', textColor: '#E8ECF4', border: '#F59E0B', glow: '#F59E0B30' },
  { id: 'chen',     initials: 'DC',       label: 'Director Chen',         x: 870,  y: 240, size: 70, shape: 'circle', fill: '#1F2A40', textColor: '#F59E0B', border: '#F59E0B', borderWidth: 3, labelColor: '#F59E0B', glow: '#F59E0B40' },
  { id: 'contract', initials: 'CONTRACT', label: '',                      x: 1150, y: 180, size: 80, height: 44, shape: 'rect',   fill: '#F59E0B', textColor: '#0A0E17', glow: '#F59E0B50' },
  { id: 'torres',   initials: 'BT',       label: 'Budget Torres',         x: 400,  y: 200, size: 52, shape: 'circle', fill: '#1F2A40', textColor: '#E8ECF4', border: '#6B7280' },
  { id: 'nak',      initials: 'IN',       label: 'IT Nakamura',           x: 580,  y: 570, size: 52, shape: 'circle', fill: '#1F2A40', textColor: '#E8ECF4', border: '#EF4444' },
  { id: 'davis',    initials: 'PD',       label: 'Procurement Davis',     x: 870,  y: 460, size: 52, shape: 'circle', fill: '#1F2A40', textColor: '#E8ECF4', border: '#EF4444' },
  { id: 'abadi',    initials: 'CA',       label: 'Council Abadi',         x: 800,  y: 640, size: 52, shape: 'circle', fill: '#1F2A40', textColor: '#E8ECF4', border: '#6B7280' },
  { id: 'sap',      initials: 'SAP',      label: 'SAP ERP',               x: 1050, y: 600, size: 52, shape: 'rect',   fill: '#1F2A40', textColor: '#E8ECF4', border: '#6B7280' },
  { id: 'gis',      initials: 'GIS',      label: 'GIS Platform',          x: 860,  y: 780, size: 52, shape: 'rect',   fill: '#1F2A40', textColor: '#E8ECF4', border: '#EF4444' },
  { id: 'asset',    initials: 'ADB',      label: 'Asset Mgmt DB',         x: 1100, y: 420, size: 52, shape: 'rect',   fill: '#1F2A40', textColor: '#E8ECF4', border: '#22C55E' },
  { id: 'legacy',   initials: 'LPS',      label: 'Legacy Permits',        x: 620,  y: 780, size: 52, shape: 'rect',   fill: '#1F2A40', textColor: '#E8ECF4', border: '#6B7280' },
]

const nc = (id: string) => {
  const n = NODES.find(n => n.id === id)!
  return { x: n.x + (n.size / 2), y: n.y + ((n.height ?? n.size) / 2) }
}

const mkEdges = (): EdgeDef[] => {
  const cp = (a: [number, number], b: [number, number], ox = 0, oy = -60): [number, number] =>
    [Math.round((a[0] + b[0]) / 2 + ox), Math.round((a[1] + b[1]) / 2 + oy)]

  const amber3 = '#F59E0B'
  const green2 = '#22C55E'
  const red2   = '#EF4444'
  const gray15 = '#6B7280'

  const n = (id: string): [number, number] => { const c = nc(id); return [c.x, c.y] }

  return [
    { from: n('you'),    to: n('reeves'), color: amber3, width: 3, cp: cp(n('you'), n('reeves'), 0, -40) },
    { from: n('reeves'), to: n('walsh'),  color: amber3, width: 3, cp: cp(n('reeves'), n('walsh'), 0, -30) },
    { from: n('walsh'),  to: n('chen'),   color: amber3, width: 3, cp: cp(n('walsh'), n('chen'), 0, -50) },
    { from: n('chen'),   to: n('contract'), color: amber3, width: 3, cp: cp(n('chen'), n('contract'), 0, -40) },
    { from: n('reeves'), to: n('asset'),  color: green2, width: 2, cp: cp(n('reeves'), n('asset'), 80, -60) },
    { from: n('walsh'),  to: n('asset'),  color: green2, width: 2, cp: cp(n('walsh'),  n('asset'), 40, -60) },
    { from: n('chen'),   to: n('asset'),  color: green2, width: 1.5, cp: cp(n('chen'), n('asset'), 0, -40) },
    { from: n('you'),    to: n('reeves'), color: green2, width: 1.5, cp: cp(n('you'), n('reeves'), 80, 40) },
    { from: n('nak'),    to: n('davis'),  color: red2,   width: 2, cp: cp(n('nak'),   n('davis'), 60, -30) },
    { from: n('davis'),  to: n('sap'),    color: red2,   width: 2, cp: cp(n('davis'), n('sap'), 40, 30) },
    { from: n('nak'),    to: n('gis'),    color: red2,   width: 1.5, cp: cp(n('nak'), n('gis'), -20, 60) },
    { from: n('torres'), to: n('walsh'),  color: gray15, width: 1.5, cp: cp(n('torres'), n('walsh'), 0, -60) },
    { from: n('abadi'),  to: n('legacy'), color: gray15, width: 1.5, cp: cp(n('abadi'), n('legacy'), 0, 50) },
    { from: n('sap'),    to: n('gis'),    color: gray15, width: 1.5, cp: cp(n('sap'),  n('gis'), 20, 40) },
    { from: n('abadi'),  to: n('sap'),    color: gray15, width: 1.5, cp: cp(n('abadi'), n('sap'), 40, 0) },
  ]
}

function GraphNode({ node }: { node: NodeDef }) {
  const bw = node.borderWidth ?? (node.border ? 1.5 : 0)
  const r = node.size / 2

  return (
    <g>
      {node.shape === 'circle' ? (
        <>
          {node.glow && (
            <circle
              cx={node.x + r} cy={node.y + r} r={r + 6}
              fill={node.glow} style={{ filter: 'blur(8px)' }}
            />
          )}
          <circle
            cx={node.x + r} cy={node.y + r} r={r}
            fill={node.fill}
            stroke={node.border ?? 'none'}
            strokeWidth={bw}
          />
          <text
            x={node.x + r} y={node.y + r + 5}
            textAnchor="middle" dominantBaseline="middle"
            fill={node.textColor}
            fontSize={node.size > 60 ? 16 : 14}
            fontWeight="700"
            fontFamily="JetBrains Mono, monospace"
          >
            {node.initials}
          </text>
        </>
      ) : (
        <>
          {node.glow && (
            <rect
              x={node.x - 6} y={node.y - 6}
              width={(node.size) + 12} height={(node.height ?? node.size) + 12}
              rx={12} fill={node.glow} style={{ filter: 'blur(8px)' }}
            />
          )}
          <rect
            x={node.x} y={node.y}
            width={node.size} height={node.height ?? node.size}
            rx={node.size > 60 ? 6 : 8}
            fill={node.fill}
            stroke={node.border ?? 'none'}
            strokeWidth={bw}
          />
          <text
            x={node.x + node.size / 2}
            y={node.y + (node.height ?? node.size) / 2 + 1}
            textAnchor="middle" dominantBaseline="middle"
            fill={node.textColor}
            fontSize={11}
            fontWeight="700"
            fontFamily="JetBrains Mono, monospace"
          >
            {node.initials}
          </text>
        </>
      )}

      {node.label && (
        <text
          x={node.x + node.size / 2}
          y={node.y + (node.height ?? node.size) + 14}
          textAnchor="middle"
          fill={node.labelColor ?? '#8892A8'}
          fontSize={10}
          fontFamily="JetBrains Mono, monospace"
        >
          {node.label}
        </text>
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
      fill="none"
      stroke={edge.color}
      strokeWidth={edge.width}
      strokeLinecap="round"
      opacity={0.7}
    />
  )
}

// ─── Risk Analysis Sidebar ────────────────────────────────────────────────────

const MOCK_FACTORS = [
  { color: '#DC2626', label: 'Budget freeze — procurement stalled',          val: '3.2' },
  { color: '#F59E0B', label: 'Champion turnover — Dir. Chen retiring Q4',    val: '2.8' },
  { color: '#F59E0B', label: 'Technical debt — legacy permitting system',     val: '1.8' },
]

const MOCK_CONFLICTS = [
  { label: 'C-01', src1: 'Voice Ledger 2024-10-14', src2: 'AM Email 2024-10-18', desc: 'Budget approval stated verbally vs. pending written sign-off' },
  { label: 'C-02', src1: 'Voice Ledger 2024-09-30', src2: 'Telemetry Log',        desc: 'System marked complete; field narrative cites active blocker' },
  { label: 'C-03', src1: 'FDE Report',               src2: 'GIS Platform Log',    desc: 'Integration milestone dates conflict by 6 weeks' },
  { label: 'C-04', src1: 'AM Email Chain',            src2: 'Voice Ledger',        desc: 'Contract scope described differently between parties' },
]

function RiskSidebar({
  graph,
  conflicts,
}: {
  graph?: GraphSnapshot | null
  conflicts?: Conflict[]
}) {
  const live = !!graph

  // Compute live heat index: blend of friction-edges-ratio + low-sentiment nodes
  const { heat, delta, friction, blockedNodes } = useMemo(() => {
    if (!graph) return { heat: 7.8, delta: '+1.2', friction: 3, blockedNodes: [] as string[] }
    const blockerEdges = graph.edges.filter(e => e.type === 'BLOCKS').length
    const lowSentimentNodes = graph.nodes.filter(n => (n.sentiment ?? 0.5) <= 0.35)
    const ratio = graph.edges.length > 0 ? blockerEdges / graph.edges.length : 0
    const sentimentWeight = graph.nodes.length > 0 ? lowSentimentNodes.length / graph.nodes.length : 0
    const h = Math.min(9.9, 2 + ratio * 40 + sentimentWeight * 50)
    return {
      heat: Math.round(h * 10) / 10,
      delta: h > 5 ? '+0.5' : '−0.2',
      friction: blockerEdges,
      blockedNodes: lowSentimentNodes.map(n => n.name ?? n.id).slice(0, 3),
    }
  }, [graph])

  const heatColor = heat >= 7 ? '#DC2626' : heat >= 4 ? '#F59E0B' : '#22C55E'
  const factors = live && blockedNodes.length > 0
    ? blockedNodes.map((name, i) => ({
        color: i === 0 ? '#DC2626' : '#F59E0B',
        label: `Low sentiment — ${name}`,
        val: '—',
      }))
    : MOCK_FACTORS

  const showConflicts = conflicts && conflicts.length > 0
  const conflictCount = conflicts?.length ?? 4

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ width: 440, background: '#111827', borderLeft: '1px solid #2A3650' }}>
      <div className="flex items-center gap-2.5 px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid #2A3650' }}>
        <ShieldAlert size={18} color={heatColor} />
        <span className="font-mono font-bold tracking-widest text-sm" style={{ color: '#E8ECF4', letterSpacing: '0.1em' }}>RISK ANALYSIS</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1 px-2 py-0.5 rounded" style={{ background: `${heatColor}30` }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: heatColor }} />
          <span className="font-mono font-bold text-xs tracking-widest" style={{ color: heatColor }}>
            {heat >= 7 ? 'HIGH' : heat >= 4 ? 'MED' : 'LOW'}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3 px-5 py-4 flex-shrink-0" style={{ borderBottom: '1px solid #2A3650' }}>
        <span className="font-mono font-semibold text-xs tracking-widest" style={{ color: '#5A6580', letterSpacing: '0.1em' }}>
          HEAT INDEX {live && <span style={{ color: '#3B82F6', fontWeight: 600 }}> · LIVE</span>}
        </span>
        <div className="flex items-end gap-4">
          <span className="font-mono font-bold text-5xl leading-none" style={{ color: heatColor }}>{heat.toFixed(1)}</span>
          <span className="font-mono text-xl" style={{ color: '#5A6580', lineHeight: 1.6 }}>/ 10</span>
          <div className="flex items-center gap-1 px-2 py-0.5 rounded ml-auto" style={{ background: '#EF444420' }}>
            <TrendingUp size={14} color="#EF4444" />
            <span className="font-mono font-semibold text-xs" style={{ color: '#EF4444' }}>{delta}</span>
          </div>
        </div>
        <div className="h-2 w-full rounded overflow-hidden" style={{ background: '#1F2A40' }}>
          <div className="h-full rounded" style={{ width: `${heat * 10}%`, background: 'linear-gradient(90deg, #F59E0B, #DC2626)' }} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-mono font-semibold text-xs tracking-widest" style={{ color: '#5A6580', letterSpacing: '0.08em' }}>Contributing Factors</span>
          {factors.map((f, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded" style={{ background: '#1A2035' }}>
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: f.color }} />
              <span className="font-sans text-xs flex-1" style={{ color: '#E8ECF4', lineHeight: 1.4 }}>{f.label}</span>
              <span className="font-mono font-semibold text-xs" style={{ color: f.color }}>{f.val}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 px-5 py-4 flex-1 overflow-hidden">
        <div className="flex items-center gap-2">
          <GitCompare size={14} color="#3B82F6" />
          <span className="font-mono font-semibold text-xs tracking-widest" style={{ color: '#5A6580', letterSpacing: '0.1em' }}>LOGIC RECONCILIATION</span>
          <div className="flex-1" />
          <div className="px-1.5 py-0.5 rounded" style={{ background: '#1F2A40' }}>
            <span className="font-mono text-xs font-medium" style={{ color: '#F59E0B' }}>{conflictCount} conflicts</span>
          </div>
        </div>
        <p className="font-sans text-xs" style={{ color: '#5A6580', lineHeight: 1.5 }}>
          {live
            ? `${friction} BLOCKS edges in Neo4j · ${conflictCount} sentiment conflicts in vault`
            : 'Conflicting statements between FDE Voice Ledgers and AM Emails'}
        </p>
        <div className="flex flex-col gap-2 overflow-y-auto flex-1">
          {showConflicts
            ? conflicts!.slice(0, 8).map((c, i) => {
                const meta = c.metadata as Record<string, unknown>
                const sentDelta = typeof meta.delta === 'number' ? meta.delta.toFixed(2) : '—'
                const stakeholder = typeof meta.stakeholder === 'string' ? meta.stakeholder : c.path
                return (
                  <div key={c.path} className="flex flex-col gap-2 p-2.5 rounded-md" style={{ background: '#1A2035', border: '1px solid #1E2A3E' }}>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-xs" style={{ color: '#F59E0B' }}>
                        C-{String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="font-sans text-xs truncate" style={{ color: '#8892A8' }}>{stakeholder}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs px-1 rounded" style={{ background: '#22C55E20', color: '#22C55E' }}>Δ</span>
                        <span className="font-sans text-xs" style={{ color: '#5A6580' }}>sentiment delta = {sentDelta}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-xs px-1 rounded" style={{ background: '#EF444420', color: '#EF4444' }}>PATH</span>
                        <span className="font-sans text-xs truncate" style={{ color: '#5A6580' }}>{c.path}</span>
                      </div>
                    </div>
                  </div>
                )
              })
            : MOCK_CONFLICTS.map((c) => (
                <div key={c.label} className="flex flex-col gap-2 p-2.5 rounded-md" style={{ background: '#1A2035', border: '1px solid #1E2A3E' }}>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-xs" style={{ color: '#F59E0B' }}>{c.label}</span>
                    <span className="font-sans text-xs" style={{ color: '#8892A8' }}>{c.desc}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs px-1 rounded" style={{ background: '#22C55E20', color: '#22C55E' }}>SRC</span>
                      <span className="font-sans text-xs" style={{ color: '#5A6580' }}>{c.src1}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs px-1 rounded" style={{ background: '#EF444420', color: '#EF4444' }}>CHK</span>
                      <span className="font-sans text-xs" style={{ color: '#5A6580' }}>{c.src2}</span>
                    </div>
                  </div>
                </div>
              ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const LEGEND = [
  { color: '#22C55E', label: 'Alignment' },
  { color: '#EF4444', label: 'Friction'  },
  { color: '#F59E0B', label: 'Neutral'   },
  { color: '#3B82F6', label: 'Influence / Selected', bold: true },
]

const INSIGHT_OPTIONS: { id: GraphInsightView; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'org', label: 'ORG' },
  { id: 'product', label: 'PRODUCT' },
  { id: 'combined', label: 'COMBO' },
]

const EDGES = mkEdges()

export default function CityIntelligenceMap({
  graph,
  conflicts,
  onNodeClick,
  selectedId,
}: CityIntelligenceMapProps = {}) {
  const live = !!graph
  const [insight, setInsight] = useState<GraphInsightView>('all')
  const nodeCount = graph?.nodes.length ?? NODES.length
  const edgeCount = graph?.edges.length ?? EDGES.length

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ background: '#0A0E17' }}>
      <div className="relative flex-1 overflow-hidden" style={{ background: '#0A0E17' }}>
        <div
          className="absolute flex flex-col gap-1.5 p-3 rounded-md z-10"
          style={{ left: 24, top: 20, background: '#0A0E17CC', border: '1px solid #2A3650' }}
        >
          <span className="font-mono font-bold text-xs tracking-widest" style={{ color: '#E8ECF4', letterSpacing: '0.1em' }}>
            {live ? 'VAULT NETWORK — LIVE FROM NEO4J' : 'DEPT. OF TRANSPORTATION — PORTLAND, OR'}
          </span>
          <span className="font-mono text-xs" style={{ color: '#5A6580' }}>
            {live ? 'Force-directed · ' : 'Network Topology · '}{nodeCount} nodes · {edgeCount} edges
            {live && graph?.source && <span style={{ color: '#3B82F6' }}> · {graph.source}</span>}
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
          {LEGEND.map(l => (
            <div key={l.label} className="flex items-center gap-1.5">
              <div className="h-0.5 w-5 rounded-sm" style={{ background: l.color }} />
              <span className="font-mono text-xs" style={{ color: l.bold ? l.color : '#8892A8' }}>{l.label}</span>
            </div>
          ))}
        </div>

        {live && (
          <div
            className="absolute z-10 rounded-md px-3 py-2 max-w-[320px]"
            style={{ left: 24, top: 258, background: '#0A0E17CC', border: '1px solid #2A3650' }}
          >
            <div className="font-mono text-[10px]" style={{ color: '#5A6580', letterSpacing: '0.08em' }}>HOW TO READ</div>
            <div className="mt-1 font-mono text-xs" style={{ color: '#8892A8', lineHeight: 1.55 }}>
              Node size = influence, border color = sentiment, lines = relationship type.
              Use ORG for reporting power, PRODUCT for adoption friction, and COMBO to compare both.
            </div>
          </div>
        )}

        {live ? (
          <LiveGraph
            graph={graph!}
            onNodeClick={onNodeClick}
            selectedId={selectedId}
            graphInsightView={insight}
          />
        ) : (
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1480 1080" preserveAspectRatio="xMidYMid meet">
            <defs>
              <filter id="glow-blue">
                <feGaussianBlur stdDeviation="10" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
              <filter id="glow-amber">
                <feGaussianBlur stdDeviation="8" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>
            {EDGES.map((e, i) => <GraphEdge key={i} edge={e} />)}
            {NODES.map(n => <GraphNode key={n.id} node={n} />)}
          </svg>
        )}
      </div>

      <RiskSidebar graph={graph} conflicts={conflicts} />
    </div>
  )
}
