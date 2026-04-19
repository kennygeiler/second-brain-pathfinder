'use client'

import type { ElementType } from 'react'
import { ScrollText, ShieldAlert, Phone, Users, FileText, MessageSquare } from 'lucide-react'
import type { Conflict, StakeholderDetail } from '../api'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface StakeholderAuditProps {
  stakeholder?: StakeholderDetail | null
  conflict?: Conflict | null
}

// ─── Gauge ────────────────────────────────────────────────────────────────────

interface GaugeProps {
  value: number      // 0–10
  max?: number
  label: string
  color: string
  subMetrics: { label: string; value: string }[]
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const svgStart = (360 - startDeg) % 360
  const svgSweep = Math.abs(sweepDeg)
  const startRad = toRad(svgStart)
  const endRad   = toRad(svgStart + svgSweep)
  const x1 = cx + r * Math.cos(startRad)
  const y1 = cy - r * Math.sin(startRad)
  const x2 = cx + r * Math.cos(endRad)
  const y2 = cy - r * Math.sin(endRad)
  const largeArc = svgSweep > 180 ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

function Gauge({ value, max = 10, label, color, subMetrics }: GaugeProps) {
  const maxSweep  = 302
  const clamped = Math.max(0, Math.min(value, max))
  const fillSweep = (clamped / max) * maxSweep
  const cx = 80, cy = 80, r = 62
  const innerR = r * 0.78

  const bgPath   = arcPath(cx, cy, r - (r - innerR) / 2, 135, maxSweep)
  const fillPth  = arcPath(cx, cy, r - (r - innerR) / 2, 135, fillSweep)
  const strokeW  = (r - innerR)

  return (
    <div className="flex flex-col items-center gap-5 p-8 rounded-lg flex-1" style={{ background: '#1A2035', border: '1px solid #2A3650' }}>
      <svg width="160" height="160" viewBox="0 0 160 160">
        <path d={bgPath}  fill="none" stroke="#2A3650" strokeWidth={strokeW} strokeLinecap="round" opacity={0.3} />
        <path d={fillPth} fill="none" stroke={color}  strokeWidth={strokeW} strokeLinecap="round" opacity={0.9} />
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#E8ECF4" fontSize="36" fontWeight="700" fontFamily="JetBrains Mono, monospace">
          {clamped.toFixed(1)}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fill={color} fontSize="11" fontWeight="600" letterSpacing="2" fontFamily="JetBrains Mono, monospace">
          / 10
        </text>
      </svg>

      <span className="font-mono font-semibold text-xs tracking-widest" style={{ color: '#8892A8', letterSpacing: '0.15em' }}>{label}</span>

      <div className="flex flex-col gap-2 w-full">
        {subMetrics.map((m, i) => (
          <div key={i} className="flex items-center justify-between w-full">
            <span className="font-mono text-xs" style={{ color: '#5A6580' }}>{m.label}</span>
            <span className="font-mono font-semibold text-xs" style={{ color: '#E8ECF4' }}>{m.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Ledger ───────────────────────────────────────────────────────────────────

interface LedgerEntry {
  icon: ElementType
  iconBg: string
  iconColor: string
  title: string
  body: string
  date: string
}

const MOCK_LEDGER: LedgerEntry[] = [
  { icon: Phone,         iconBg: '#3B82F615', iconColor: '#3B82F6', title: 'Voice ledger recorded',              body: 'Dir. Chen confirms Phase 2 timeline — verbal commitment to Q4 deadline',     date: '2d ago'  },
  { icon: Users,         iconBg: '#22C55E15', iconColor: '#22C55E', title: 'Stakeholder meeting — Morales',      body: 'Budget status confirmed: $2.4M approved, pending procurement sign-off',         date: '4d ago'  },
  { icon: MessageSquare, iconBg: '#F59E0B15', iconColor: '#F59E0B', title: 'Email exchange — Torres',            body: 'Discrepancy flagged: verbal approval not reflected in AM budget system',          date: '8d ago'  },
  { icon: FileText,      iconBg: '#3B82F615', iconColor: '#3B82F6', title: 'Contract review meeting',            body: 'Walsh confirmed integration scope; API middleware requirement added',              date: '14d ago' },
  { icon: Users,         iconBg: '#22C55E15', iconColor: '#22C55E', title: 'Field site visit — Reeves',          body: 'Legacy system pain points documented; GIS compatibility concern escalated',       date: '19d ago' },
  { icon: MessageSquare, iconBg: '#F59E0B15', iconColor: '#F59E0B', title: 'Email — Nakamura',                   body: 'API specification received; 3 incompatibilities flagged with existing GIS stack',  date: '27d ago' },
  { icon: FileText,      iconBg: '#3B82F615', iconColor: '#3B82F6', title: 'Kickoff documentation filed',        body: 'Initial stakeholder map committed to Obsidian knowledge graph',                   date: '37d ago' },
]

const SOURCE_STYLE: Record<string, { icon: ElementType; iconBg: string; iconColor: string; title: string }> = {
  voice_ledger:   { icon: Phone,         iconBg: '#3B82F615', iconColor: '#3B82F6', title: 'Voice ledger recorded' },
  email:          { icon: MessageSquare, iconBg: '#F59E0B15', iconColor: '#F59E0B', title: 'Email exchange' },
  public_record:  { icon: FileText,      iconBg: '#22C55E15', iconColor: '#22C55E', title: 'Public record filed' },
  crawl:          { icon: FileText,      iconBg: '#22C55E15', iconColor: '#22C55E', title: 'Web crawl entry' },
  pdf_import:     { icon: FileText,      iconBg: '#3B82F615', iconColor: '#3B82F6', title: 'PDF import' },
  meeting:        { icon: Users,         iconBg: '#22C55E15', iconColor: '#22C55E', title: 'Stakeholder meeting' },
}

function relativeTime(iso?: string): string {
  if (!iso) return '—'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return iso.slice(0, 10)
  const diff = Date.now() - then
  const days = Math.round(diff / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return '1d ago'
  if (days < 60) return `${days}d ago`
  const months = Math.round(days / 30)
  return `${months}mo ago`
}

function buildLedgerFromStakeholder(detail: StakeholderDetail): LedgerEntry[] {
  const lineage = Array.isArray(detail.metadata.source_lineage) ? detail.metadata.source_lineage : []
  if (!lineage.length) return MOCK_LEDGER
  return lineage.slice().reverse().map((src) => {
    const style = SOURCE_STYLE[src.type ?? ''] ?? SOURCE_STYLE.voice_ledger
    return {
      icon: style.icon,
      iconBg: style.iconBg,
      iconColor: style.iconColor,
      title: style.title,
      body: src.note ?? src.id ?? `Source: ${src.type ?? 'unknown'}`,
      date: relativeTime(src.timestamp),
    }
  })
}

function LedgerRow({ entry, last }: { entry: LedgerEntry; last: boolean }) {
  const Icon = entry.icon
  return (
    <div
      className="flex items-start gap-3 py-3"
      style={last ? {} : { borderBottom: '1px solid #1E2A3E' }}
    >
      <div
        className="flex items-center justify-center flex-shrink-0 rounded-md"
        style={{ width: 32, height: 32, background: entry.iconBg }}
      >
        <Icon size={14} color={entry.iconColor} />
      </div>
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        <span className="font-mono font-semibold text-xs" style={{ color: '#E8ECF4' }}>{entry.title}</span>
        <span className="font-sans text-xs" style={{ color: '#8892A8', lineHeight: 1.4 }}>{entry.body}</span>
      </div>
      <span className="font-mono font-medium text-xs flex-shrink-0 mt-0.5" style={{ color: '#5A6580' }}>{entry.date}</span>
    </div>
  )
}

// ─── Conflict Banner ──────────────────────────────────────────────────────────

interface ConflictView {
  title: string
  body: string
  fdeTitle: string
  fdeQuote: string
  fdeMeta: string
  counterTitle: string
  counterQuote: string
  counterMeta: string
}

function buildConflictView(conflict?: Conflict | null): ConflictView | null {
  if (!conflict) return null
  const meta = conflict.metadata ?? {}
  const incoming = typeof meta.incoming_sentiment === 'number' ? Number(meta.incoming_sentiment).toFixed(2) : null
  const existing = typeof meta.existing_sentiment === 'number' ? Number(meta.existing_sentiment).toFixed(2) : null
  return {
    title: 'LOGIC RECONCILIATION — CONFLICT DETECTED',
    body: (conflict.content.split('\n').find((line) => line.trim().length > 0) ?? 'Sentiment delta exceeded threshold; manual review required.').slice(0, 220),
    fdeTitle: 'INCOMING LEDGER',
    fdeQuote: incoming != null ? `Sentiment ${incoming} (confidence ${Number(meta.confidence_score ?? 0).toFixed(2)})` : 'New voice-ledger entry',
    fdeMeta: `${meta.meeting_id ?? 'ledger'} · ${meta.source_type ?? 'voice_ledger'}`,
    counterTitle: 'EXISTING OBSIDIAN NOTE',
    counterQuote: existing != null ? `Stored sentiment ${existing} from prior reconciliation` : 'Prior note diverges from new signal',
    counterMeta: typeof meta.stakeholder === 'string' ? `entity: ${meta.stakeholder}` : 'vault note',
  }
}

function ConflictBanner({ view }: { view: ConflictView }) {
  return (
    <div className="rounded-lg p-4 flex flex-col gap-3" style={{ background: '#DC262612', border: '1px solid #DC262640' }}>
      <div className="flex items-center gap-2.5">
        <ShieldAlert size={18} color="#DC2626" />
        <span className="font-mono font-bold text-xs tracking-wide" style={{ color: '#DC2626', letterSpacing: '0.08em' }}>
          {view.title}
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1 px-2 py-0.5 rounded" style={{ background: '#DC262630' }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#DC2626' }} />
          <span className="font-mono font-bold text-xs" style={{ color: '#DC2626' }}>CRITICAL</span>
        </div>
      </div>
      <p className="font-sans text-xs" style={{ color: '#8892A8', lineHeight: 1.5 }}>
        {view.body}
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2 p-3.5 rounded-md" style={{ background: '#1A2035', border: '1px solid #1E2A3E' }}>
          <span className="font-mono font-semibold text-xs" style={{ color: '#22C55E' }}>{view.fdeTitle}</span>
          <p className="font-sans text-xs" style={{ color: '#E8ECF4', lineHeight: 1.5 }}>
            {view.fdeQuote}
          </p>
          <span className="font-mono text-xs" style={{ color: '#5A6580' }}>{view.fdeMeta}</span>
        </div>
        <div className="flex flex-col gap-2 p-3.5 rounded-md" style={{ background: '#1A2035', border: '1px solid #DC262640' }}>
          <span className="font-mono font-semibold text-xs" style={{ color: '#DC2626' }}>{view.counterTitle}</span>
          <p className="font-sans text-xs" style={{ color: '#E8ECF4', lineHeight: 1.5 }}>
            {view.counterQuote}
          </p>
          <span className="font-mono text-xs" style={{ color: '#5A6580' }}>{view.counterMeta}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StakeholderAuditDashboard({ stakeholder, conflict }: StakeholderAuditProps = {}) {
  const name = stakeholder?.name ?? 'James Morales'
  const role = (stakeholder?.metadata.type as string | undefined) ?? 'Director of Public Works'
  const org  = stakeholder?.metadata.ghost
    ? 'Ghost node · cold-start placeholder'
    : 'Pathfinder Vault · source of truth'

  const influence = stakeholder?.metadata.influence_score != null
    ? Math.max(0, Math.min(1, stakeholder.metadata.influence_score as number)) * 10
    : 8.4
  const sentiment = stakeholder?.metadata.sentiment_vector != null
    ? Math.max(0, Math.min(1, stakeholder.metadata.sentiment_vector as number)) * 10
    : 7.4
  const confidence = stakeholder?.metadata.confidence_score != null
    ? Math.max(0, Math.min(1, stakeholder.metadata.confidence_score as number)) * 10
    : null
  const blockers = Array.isArray(stakeholder?.metadata.technical_blockers)
    ? (stakeholder!.metadata.technical_blockers as string[])
    : []

  const influenceSub = stakeholder
    ? [
        { label: 'Confidence',      value: confidence != null ? `${confidence.toFixed(1)} / 10` : '—' },
        { label: 'Blockers tracked', value: blockers.length.toString() },
        { label: 'Type',             value: role },
      ]
    : [
        { label: 'Decision Authority', value: '9.1 / 10' },
        { label: 'Network Reach',      value: '7.8 / 10' },
        { label: 'Engagement Freq.',   value: '8.2 / 10' },
      ]
  const sentimentSub = stakeholder
    ? [
        { label: 'Last updated',      value: relativeTime(stakeholder.metadata.last_updated) },
        { label: 'Source count',      value: (Array.isArray(stakeholder.metadata.source_lineage) ? stakeholder.metadata.source_lineage.length : 0).toString() },
        { label: 'Confidence',        value: confidence != null ? `${confidence.toFixed(1)} / 10` : '—' },
      ]
    : [
        { label: 'Verbal Tone',        value: '+0.62' },
        { label: 'Response Latency',   value: '1.4d avg' },
        { label: 'Meeting Attendance', value: '100%' },
      ]

  const ledger = stakeholder ? buildLedgerFromStakeholder(stakeholder) : MOCK_LEDGER
  const conflictView = buildConflictView(conflict)
  const activeBadge = stakeholder?.metadata.ghost
    ? { color: '#F59E0B', label: 'Ghost · Needs Verification', bg: '#F59E0B18' }
    : stakeholder && sentiment >= 6.5
      ? { color: '#22C55E', label: 'Active Champion', bg: '#16a34a18' }
      : stakeholder && sentiment <= 3.5
        ? { color: '#EF4444', label: 'At Risk', bg: '#DC262618' }
        : stakeholder
          ? { color: '#3B82F6', label: 'In Play', bg: '#3B82F618' }
          : { color: '#22C55E', label: 'Active Champion', bg: '#16a34a18' }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: '#0A0E17', fontFamily: 'Geist, sans-serif' }}>
      {/* ── Header + Gauges ── */}
      <div className="flex flex-col" style={{ borderBottom: '1px solid #1E2A3E' }}>
        {/* Name header */}
        <div
          className="flex items-center justify-between px-8 py-5"
          style={{ background: '#1A2035', borderBottom: '1px solid #1E2A3E' }}
        >
          <div className="flex flex-col gap-1.5">
            <span style={{ color: '#E8ECF4', fontSize: 22, fontWeight: 600 }}>{name}</span>
            <span style={{ color: '#8892A8', fontSize: 14 }}>{role}</span>
            <span style={{ color: '#5A6580', fontSize: 13 }}>{org}</span>
          </div>
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded" style={{ background: activeBadge.bg }}>
            <div className="w-2 h-2 rounded-full" style={{ background: activeBadge.color }} />
            <span className="font-mono font-medium text-xs" style={{ color: activeBadge.color }}>{activeBadge.label}</span>
          </div>
        </div>

        {/* Gauges */}
        <div className="grid grid-cols-2 gap-6 px-8 py-6">
          <Gauge
            value={influence}
            label="INFLUENCE SCORE"
            color="#F59E0B"
            subMetrics={influenceSub}
          />
          <Gauge
            value={sentiment}
            label="SENTIMENT SCORE"
            color="#3B82F6"
            subMetrics={sentimentSub}
          />
        </div>
      </div>

      {/* ── Ledger + Conflict Section ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Interaction Ledger */}
        <div className="flex flex-col flex-1 overflow-hidden" style={{ borderRight: '1px solid #1E2A3E' }}>
          {/* Ledger header */}
          <div
            className="flex items-center gap-2.5 px-6 py-3.5"
            style={{ background: '#111827', borderBottom: '1px solid #2A3650' }}
          >
            <ScrollText size={16} color="#3B82F6" />
            <span className="font-mono font-bold text-xs tracking-widest" style={{ color: '#E8ECF4', letterSpacing: '0.1em' }}>
              INTERACTION LEDGER
            </span>
            <div className="flex-1" />
            <span className="font-mono text-xs" style={{ color: '#5A6580' }}>{ledger.length} entries</span>
          </div>

          {/* Feed */}
          <div className="flex-1 overflow-y-auto px-6">
            {ledger.map((entry, i) => (
              <LedgerRow key={i} entry={entry} last={i === ledger.length - 1} />
            ))}
          </div>
        </div>

        {/* Conflict Banner Column */}
        <div className="flex flex-col" style={{ width: 520, padding: '20px 24px', overflowY: 'auto' }}>
          {conflictView ? (
            <ConflictBanner view={conflictView} />
          ) : (
            <div className="rounded-lg p-4" style={{ background: '#22C55E10', border: '1px solid #22C55E30' }}>
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-2 h-2 rounded-full" style={{ background: '#22C55E' }} />
                <span className="font-mono font-bold text-xs tracking-wide" style={{ color: '#22C55E', letterSpacing: '0.08em' }}>
                  NO OPEN CONFLICTS
                </span>
              </div>
              <p className="font-sans text-xs" style={{ color: '#8892A8', lineHeight: 1.5 }}>
                {stakeholder
                  ? `${name} has no unresolved sentiment deltas in the ledger.`
                  : 'Pipeline is green. Drop a transcription into inbox/ to trigger a new conflict check.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
