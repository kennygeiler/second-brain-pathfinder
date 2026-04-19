'use client'

import { Database, RefreshCw, Zap, Info, CircleCheck, CircleAlert, CircleX } from 'lucide-react'
import type { Stakeholder as LiveStakeholder, Conflict } from '../api'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ExecutiveHealthMatrixProps {
  stakeholders?: LiveStakeholder[]
  conflicts?: Conflict[]
  onPivot?: () => void
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stakeholder {
  initials: string
  name: string
  shape: 'circle' | 'rect'
  sentiment: number  // 0–10
  usage: number      // 0–10
  borderColor: string
  size?: number
}

// ─── Mock (Pencil) data used as fallback ─────────────────────────────────────

const MOCK_STAKEHOLDERS: Stakeholder[] = [
  { initials: 'DC',  name: 'Director Chen',       shape: 'circle', sentiment: 8.2, usage: 7.5, borderColor: '#F59E0B', size: 56 },
  { initials: 'DW',  name: 'Deputy Walsh',         shape: 'circle', sentiment: 6.4, usage: 6.8, borderColor: '#22C55E', size: 44 },
  { initials: 'MR',  name: 'Field Ops Reeves',     shape: 'circle', sentiment: 7.1, usage: 7.9, borderColor: '#22C55E', size: 44 },
  { initials: 'IN',  name: 'IT Nakamura',           shape: 'circle', sentiment: 3.8, usage: 8.4, borderColor: '#EF4444', size: 44 },
  { initials: 'PD',  name: 'Procurement Davis',    shape: 'circle', sentiment: 2.9, usage: 5.2, borderColor: '#EF4444', size: 40 },
  { initials: 'CA',  name: 'Council Abadi',         shape: 'circle', sentiment: 4.2, usage: 2.1, borderColor: '#6B7280', size: 40 },
  { initials: 'BT',  name: 'Budget Torres',         shape: 'circle', sentiment: 5.1, usage: 1.8, borderColor: '#6B7280', size: 40 },
  { initials: 'SAP', name: 'SAP ERP',               shape: 'rect',   sentiment: 3.2, usage: 6.1, borderColor: '#6B7280', size: 40 },
  { initials: 'GIS', name: 'GIS Platform',          shape: 'rect',   sentiment: 2.1, usage: 7.2, borderColor: '#EF4444', size: 40 },
  { initials: 'ADB', name: 'Asset Mgmt DB',         shape: 'rect',   sentiment: 7.8, usage: 8.1, borderColor: '#22C55E', size: 40 },
  { initials: 'LPS', name: 'Legacy Permits',        shape: 'rect',   sentiment: 1.5, usage: 3.4, borderColor: '#6B7280', size: 36 },
]

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function quadrantColor(sentiment: number, usage: number): string {
  if (sentiment >= 5 && usage >= 5) return '#22C55E' // champion
  if (sentiment < 5  && usage >= 5) return '#EF4444' // risk
  if (sentiment >= 5 && usage < 5)  return '#F59E0B' // opportunity
  return '#6B7280'
}

function mapLiveToChart(live: LiveStakeholder[]): Stakeholder[] {
  return live
    .filter((s) => s.name)
    .map((s) => {
      const sent = Math.max(0, Math.min(1, s.sentiment_vector ?? 0.5)) * 10
      // usage proxy = confidence_score (how well reconciled) until real telemetry merged
      const usage = Math.max(0, Math.min(1, s.confidence_score ?? 0.5)) * 10
      const influence = Math.max(0, Math.min(1, s.influence_score ?? 0.5))
      const base = 36 + influence * 28 // 36-64 by influence
      const isSystem = (s.type ?? '').toLowerCase() === 'system'
      return {
        initials: initialsFromName(s.name),
        name: s.name,
        shape: isSystem ? 'rect' : 'circle',
        sentiment: sent,
        usage,
        borderColor: quadrantColor(sent, usage),
        size: Math.round(base),
      }
    })
}

// ─── Quadrant Chart ───────────────────────────────────────────────────────────

const QUADRANT_LABELS = [
  { x: '75%', y: '25%', title: 'CHAMPION',    subtitle: 'High usage · High sentiment',  color: '#22C55E20', border: '#22C55E30', textColor: '#22C55E' },
  { x: '25%', y: '25%', title: 'RISK',        subtitle: 'High usage · Low sentiment',   color: '#EF444410', border: '#EF444430', textColor: '#EF4444' },
  { x: '75%', y: '75%', title: 'OPPORTUNITY', subtitle: 'Low usage · High sentiment',   color: '#3B82F610', border: '#3B82F630', textColor: '#3B82F6' },
  { x: '25%', y: '75%', title: 'DISENGAGED',  subtitle: 'Low usage · Low sentiment',    color: '#6B728010', border: '#6B728030', textColor: '#6B7280' },
]

function QuadrantChart({ stakeholders, subtitle }: { stakeholders: Stakeholder[]; subtitle: string }) {
  const W = 960, H = 720, PAD = 48

  const plotX = (sentiment: number) => PAD + ((sentiment / 10) * (W - PAD * 2))
  const plotY = (usage: number)     => (H - PAD) - ((usage / 10) * (H - PAD * 2))

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 py-5" style={{ borderBottom: '1px solid #2A3650' }}>
        <div className="flex flex-col gap-1.5">
          <span className="font-mono font-bold tracking-widest text-sm" style={{ color: '#E8ECF4', letterSpacing: '0.2em' }}>
            EXECUTIVE HEALTH MATRIX
          </span>
          <span style={{ color: '#5A6580', fontSize: 12 }}>
            {subtitle}
          </span>
        </div>
      </div>

      <div className="flex-1 flex items-stretch">
        <div className="flex items-center justify-center relative" style={{ width: 48 }}>
          <div className="flex flex-col items-center gap-2 relative" style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap' }}>
            <span className="font-mono font-normal text-xs tracking-widest" style={{ color: '#5A6580', letterSpacing: '0.15em' }}>
              SYSTEM USAGE TELEMETRY
            </span>
          </div>
          <div className="absolute" style={{ bottom: 16, left: '50%', transform: 'translateX(-50%)' }}>
            <span className="font-mono text-xs" style={{ color: '#5A6580' }}>Low</span>
          </div>
          <div className="absolute" style={{ top: 16, left: '50%', transform: 'translateX(-50%)' }}>
            <span className="font-mono text-xs" style={{ color: '#5A6580' }}>High</span>
          </div>
        </div>

        <div className="flex flex-col flex-1">
          <div className="flex-1 relative overflow-hidden">
            <svg className="absolute inset-0" width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
              <rect x={W / 2} y={0}      width={W / 2} height={H / 2} rx={0} fill="#22C55E08" stroke="#22C55E20" strokeWidth={1} />
              <rect x={0}    y={0}       width={W / 2} height={H / 2} rx={0} fill="#EF444408" stroke="#EF444420" strokeWidth={1} />
              <rect x={W / 2} y={H / 2} width={W / 2} height={H / 2} rx={0} fill="#3B82F608" stroke="#3B82F620" strokeWidth={1} />
              <rect x={0}    y={H / 2}  width={W / 2} height={H / 2} rx={0} fill="#6B728008" stroke="#6B728020" strokeWidth={1} />

              <line x1={W / 2} y1={0}     x2={W / 2} y2={H}     stroke="#2A3650" strokeWidth={1} strokeDasharray="4 4" />
              <line x1={0}     y1={H / 2} x2={W}     y2={H / 2} stroke="#2A3650" strokeWidth={1} strokeDasharray="4 4" />

              {QUADRANT_LABELS.map((q, i) => (
                <text
                  key={i}
                  x={q.x === '75%' ? W * 0.75 : W * 0.25}
                  y={q.y === '25%' ? H * 0.15 : H * 0.85}
                  textAnchor="middle"
                  fill={q.textColor}
                  fontSize={13}
                  fontWeight="600"
                  fontFamily="JetBrains Mono, monospace"
                  opacity={0.5}
                  letterSpacing="2"
                >
                  {q.title}
                </text>
              ))}

              {stakeholders.map((s, i) => {
                const x = plotX(s.sentiment)
                const y = plotY(s.usage)
                const sz = s.size ?? 40
                const r = sz / 2

                return (
                  <g key={i}>
                    {s.shape === 'circle' ? (
                      <>
                        <circle cx={x} cy={y} r={r + 6} fill={s.borderColor} opacity={0.1} style={{ filter: 'blur(6px)' }} />
                        <circle cx={x} cy={y} r={r} fill="#1F2A40" stroke={s.borderColor} strokeWidth={2} />
                        <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle"
                          fill="#E8ECF4" fontSize={sz > 50 ? 16 : 12} fontWeight="700"
                          fontFamily="JetBrains Mono, monospace">{s.initials}</text>
                      </>
                    ) : (
                      <>
                        <rect x={x - r} y={y - r} width={sz} height={sz} rx={8}
                          fill="#1F2A40" stroke={s.borderColor} strokeWidth={2} />
                        <text x={x} y={y + 1} textAnchor="middle" dominantBaseline="middle"
                          fill="#E8ECF4" fontSize={11} fontWeight="700"
                          fontFamily="JetBrains Mono, monospace">{s.initials}</text>
                      </>
                    )}
                    <text x={x} y={y + r + 16} textAnchor="middle"
                      fill="#5A6580" fontSize={10} fontFamily="Geist, sans-serif">{s.name}</text>
                  </g>
                )
              })}
            </svg>
          </div>

          <div className="flex items-center justify-between px-12 py-2" style={{ borderTop: '1px solid #2A3650' }}>
            <span className="font-mono text-xs" style={{ color: '#5A6580' }}>Low</span>
            <span className="font-mono font-normal text-xs tracking-widest" style={{ color: '#5A6580', letterSpacing: '0.15em' }}>
              RELATIONSHIP SENTIMENT
            </span>
            <span className="font-mono text-xs" style={{ color: '#5A6580' }}>High</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Data Lineage Sidebar ─────────────────────────────────────────────────────

interface LineageNode {
  name: string
  hash: string
  status: 'verified' | 'partial' | 'missing'
}

const MOCK_LINEAGE: LineageNode[] = [
  { name: 'Director Chen',      hash: 'a3f8c2d', status: 'verified' },
  { name: 'Deputy Walsh',        hash: '7b12e9f', status: 'verified' },
  { name: 'Field Ops Reeves',    hash: 'e4d01a8', status: 'verified' },
  { name: 'IT Nakamura',          hash: '91fc3b7', status: 'verified' },
  { name: 'Council Abadi',        hash: 'partial', status: 'partial'  },
  { name: 'Budget Torres',        hash: 'partial', status: 'partial'  },
  { name: 'Procurement Davis',   hash: 'missing', status: 'missing'  },
]

function lineageFromLive(live: LiveStakeholder[]): LineageNode[] {
  return live.slice(0, 20).map((s) => {
    const hasInfluence = s.influence_score != null
    const hasSentiment = s.sentiment_vector != null
    const status: LineageNode['status'] = hasInfluence && hasSentiment
      ? 'verified'
      : hasInfluence || hasSentiment
        ? 'partial'
        : 'missing'
    return {
      name: s.name,
      hash: s.id ? s.id.slice(0, 7) : status,
      status,
    }
  })
}

const STATUS_CONFIG = {
  verified: { color: '#22C55E', Icon: CircleCheck,  label: 'verified' },
  partial:  { color: '#F59E0B', Icon: CircleAlert,  label: 'partial'  },
  missing:  { color: '#DC2626', Icon: CircleX,      label: 'missing'  },
} as const

function ArcRing({ pct, color }: { pct: number; color: string }) {
  const cx = 70, cy = 70, r = 56, strokeW = 16
  const innerR = r * 0.78
  const ringR = innerR + (r - innerR) / 2
  const circ = 2 * Math.PI * ringR
  const dash = pct * circ

  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx={cx} cy={cy} r={ringR} fill="none" stroke="#1F2A40" strokeWidth={strokeW} />
      <circle
        cx={cx} cy={cy} r={ringR} fill="none"
        stroke={color} strokeWidth={strokeW}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x={cx} y={cy - 8}  textAnchor="middle" fill="#E8ECF4" fontSize="28" fontWeight="700" fontFamily="JetBrains Mono, monospace">
        {Math.round(pct * 100)}%
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill={color} fontSize="9" fontWeight="600" letterSpacing="2" fontFamily="JetBrains Mono, monospace">
        VERIFIED
      </text>
    </svg>
  )
}

interface LineageStats {
  verified: number
  partial: number
  missing: number
  pct: number
}

function DataLineageSidebar({
  lineage,
  stats,
  conflictCount,
  onPivot,
  pivotEnabled,
}: {
  lineage: LineageNode[]
  stats: LineageStats
  conflictCount: number
  onPivot?: () => void
  pivotEnabled: boolean
}) {
  const planColor = conflictCount > 0 ? '#F59E0B' : '#22C55E'
  const planLabel = conflictCount > 0 ? 'Plan: PENDING REVIEW' : 'Plan: GREEN — graph reconciled'
  const planBody  = conflictCount > 0
    ? `${conflictCount} conflicts flagged · ${stats.missing + stats.partial} unverified nodes · Action required`
    : `${stats.verified} verified nodes · ${stats.partial} partial · ${stats.missing} missing`

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ width: 400, background: '#111827', borderLeft: '1px solid #2A3650' }}>
      <div className="flex items-center gap-2.5 px-5 py-4" style={{ borderBottom: '1px solid #2A3650' }}>
        <Database size={16} color="#3B82F6" />
        <span className="font-mono font-bold text-xs tracking-wide" style={{ color: '#E8ECF4', letterSpacing: '0.1em' }}>DATA LINEAGE HEALTH</span>
        <div className="flex-1" />
        <RefreshCw size={14} color="#5A6580" />
      </div>

      <div className="flex flex-col items-center gap-3.5 px-5 py-5" style={{ borderBottom: '1px solid #2A3650' }}>
        <ArcRing pct={stats.pct} color={stats.pct >= 0.7 ? '#22C55E' : stats.pct >= 0.4 ? '#F59E0B' : '#DC2626'} />
        <p className="font-sans text-xs text-center" style={{ color: '#8892A8', lineHeight: 1.5 }}>
          Graph nodes backed by vault-verified Obsidian records
        </p>
        <div className="grid grid-cols-3 gap-2 w-full">
          {[
            { value: stats.verified.toString(), label: 'VERIFIED', color: '#22C55E' },
            { value: stats.partial.toString(),  label: 'PARTIAL',  color: '#F59E0B' },
            { value: stats.missing.toString(),  label: 'MISSING',  color: '#DC2626' },
          ].map(s => (
            <div key={s.label} className="flex flex-col items-center gap-0.5 px-2 py-2.5 rounded-md" style={{ background: '#1A2035' }}>
              <span className="font-mono font-bold text-xl leading-none" style={{ color: s.color }}>{s.value}</span>
              <span className="font-mono font-medium text-xs tracking-widest" style={{ color: '#5A6580', letterSpacing: '0.08em', fontSize: 9 }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 px-5 py-3.5 flex-1 overflow-y-auto" style={{ borderBottom: '1px solid #2A3650' }}>
        <span className="font-mono font-semibold text-xs tracking-widest" style={{ color: '#5A6580', letterSpacing: '0.1em' }}>
          NODE VERIFICATION STATUS
        </span>
        <div className="flex flex-col gap-1">
          {lineage.map((node, i) => {
            const cfg = STATUS_CONFIG[node.status]
            const Icon = cfg.Icon
            return (
              <div
                key={i}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded"
                style={{
                  background: node.status === 'missing' ? '#DC262608' : '#1A2035',
                  border: node.status === 'missing' ? '1px solid #DC262620' : 'none',
                }}
              >
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cfg.color }} />
                <span className="font-sans font-medium text-xs flex-1" style={{ color: '#E8ECF4', lineHeight: 1.3 }}>{node.name}</span>
                <div className="flex-1" />
                <span className="font-mono text-xs" style={{ color: '#5A6580' }}>{node.hash}</span>
                <Icon size={14} color={cfg.color} />
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2.5 px-5 py-3.5" style={{ borderBottom: '1px solid #2A3650' }}>
        <span className="font-mono font-semibold text-xs tracking-widest" style={{ color: '#5A6580', letterSpacing: '0.1em' }}>
          RECONCILIATION STATUS
        </span>
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-md" style={{ background: '#1A2035', border: '1px solid #1E2A3E' }}>
          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: planColor, boxShadow: `0 0 8px ${planColor}40` }} />
          <div className="flex flex-col gap-0.5 flex-1">
            <span className="font-mono font-semibold text-xs" style={{ color: planColor }}>{planLabel}</span>
            <span className="font-sans text-xs" style={{ color: '#8892A8', lineHeight: 1.4 }}>
              {planBody}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-5 justify-end">
        <p className="font-sans text-xs" style={{ color: '#5A6580', lineHeight: 1.5 }}>
          Strategic intervention will trigger a Red-Team re-run against the current vault state.
        </p>
        <button
          onClick={onPivot}
          disabled={!pivotEnabled}
          className="flex items-center justify-center gap-2.5 px-6 py-4 rounded-lg font-mono font-bold text-sm tracking-widest w-full"
          style={{
            background: pivotEnabled ? '#F59E0B' : '#3B3F52',
            color: pivotEnabled ? '#0A0E17' : '#8892A8',
            letterSpacing: '0.08em',
            boxShadow: pivotEnabled ? '0 4px 16px #F59E0B30' : 'none',
            border: 'none',
            cursor: pivotEnabled ? 'pointer' : 'not-allowed',
          }}
        >
          <Zap size={20} color={pivotEnabled ? '#0A0E17' : '#8892A8'} />
          INITIATE STRATEGIC PIVOT
        </button>
        <div className="flex items-start gap-1.5 px-2.5 py-2 rounded" style={{ background: '#1A2035' }}>
          <Info size={12} color="#5A6580" className="mt-0.5 flex-shrink-0" />
          <span className="font-mono text-xs" style={{ color: '#5A6580', lineHeight: 1.4, fontSize: 9 }}>
            Button color reflects reconciliation_plan state: amber=pending, green=resolved
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ExecutiveHealthMatrix({ stakeholders, conflicts, onPivot }: ExecutiveHealthMatrixProps = {}) {
  const live = stakeholders && stakeholders.length > 0
  const chartData = live ? mapLiveToChart(stakeholders!) : MOCK_STAKEHOLDERS
  const lineage   = live ? lineageFromLive(stakeholders!) : MOCK_LINEAGE
  const verified  = lineage.filter((n) => n.status === 'verified').length
  const partial   = lineage.filter((n) => n.status === 'partial').length
  const missing   = lineage.filter((n) => n.status === 'missing').length
  const total     = lineage.length || 1
  const pct       = verified / total
  const subtitle  = live
    ? `Live vault · ${stakeholders!.length} stakeholders · ${conflicts?.length ?? 0} conflicts`
    : 'Stakeholder Risk Assessment · Portland DOT · Q2 2026'

  return (
    <div className="flex h-full w-full overflow-hidden" style={{ background: '#0A0E17' }}>
      <div className="flex-1 overflow-hidden" style={{ background: '#0A0E17' }}>
        <QuadrantChart stakeholders={chartData} subtitle={subtitle} />
      </div>
      <DataLineageSidebar
        lineage={lineage}
        stats={{ verified, partial, missing, pct }}
        conflictCount={conflicts?.length ?? 0}
        onPivot={onPivot}
        pivotEnabled={!!onPivot}
      />
    </div>
  )
}
