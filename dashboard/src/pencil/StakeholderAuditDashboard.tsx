'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ElementType } from 'react'
import {
  FileText,
  GitMerge,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Plus,
  ScrollText,
  ShieldAlert,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { api } from '../api'
import type { Conflict, Stakeholder, StakeholderDetail } from '../api'
import InlineField from '../components/InlineField'
import NotesEditor from '../components/NotesEditor'

// ─── Props ────────────────────────────────────────────────────────────────────

const ENTITY_TYPES = ['Person', 'Role', 'Agency', 'System', 'Gatekeeper'] as const

export interface StakeholderAuditProps {
  stakeholder?: StakeholderDetail | null
  conflict?: Conflict | null
  /** Full stakeholder list, used by the merge modal. */
  stakeholders?: Stakeholder[]
  /** Called after a successful patch/notes/merge so App can refresh. */
  onUpdated?: (updated: StakeholderDetail) => void
  /** Called after a successful archive — App should clear selection. */
  onArchived?: (id: string) => void
}

// ─── Gauge ────────────────────────────────────────────────────────────────────

interface GaugeProps {
  value: number      // 0–10
  max?: number
  label: string
  color: string
  subMetrics: { label: string; value: React.ReactNode }[]
  headerRight?: React.ReactNode
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, sweepDeg: number) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const clampedSweep = Math.max(0.01, Math.abs(sweepDeg))
  const x1 = cx + r * Math.cos(toRad(startDeg))
  const y1 = cy + r * Math.sin(toRad(startDeg))
  const endDeg = startDeg + clampedSweep
  const x2 = cx + r * Math.cos(toRad(endDeg))
  const y2 = cy + r * Math.sin(toRad(endDeg))
  const largeArc = clampedSweep > 180 ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

function Gauge({ value, max = 10, label, color, subMetrics, headerRight }: GaugeProps) {
  const startDeg  = 135
  const maxSweep  = 270
  const clamped   = Math.max(0, Math.min(value, max))
  const fillSweep = (clamped / max) * maxSweep
  const cx = 80, cy = 80, r = 60
  const strokeW = 14

  const bgPath   = arcPath(cx, cy, r, startDeg, maxSweep)
  const fillPath = arcPath(cx, cy, r, startDeg, fillSweep)

  return (
    <div className="flex flex-col items-center gap-5 p-8 rounded-lg flex-1" style={{ background: '#1A2035', border: '1px solid #2A3650' }}>
      <svg width="160" height="160" viewBox="0 0 160 160">
        <path d={bgPath}   fill="none" stroke="#2A3650" strokeWidth={strokeW} strokeLinecap="round" />
        <path d={fillPath} fill="none" stroke={color}    strokeWidth={strokeW} strokeLinecap="round" style={{ filter: `drop-shadow(0 0 6px ${color}70)` }} />
        <text x={cx} y={cy - 2} textAnchor="middle" dominantBaseline="central" fill="#E8ECF4" fontSize="34" fontWeight="700" fontFamily="JetBrains Mono, monospace">
          {clamped.toFixed(1)}
        </text>
        <text x={cx} y={cy + 22} textAnchor="middle" dominantBaseline="central" fill={color} fontSize="11" fontWeight="600" letterSpacing="2" fontFamily="JetBrains Mono, monospace">
          / {max}
        </text>
      </svg>

      <div className="flex items-center gap-3 w-full justify-center">
        <span className="font-mono font-semibold text-xs tracking-widest" style={{ color: '#8892A8', letterSpacing: '0.15em' }}>{label}</span>
        {headerRight}
      </div>

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
]

const SOURCE_STYLE: Record<string, { icon: ElementType; iconBg: string; iconColor: string; title: string }> = {
  voice_ledger:   { icon: Phone,         iconBg: '#3B82F615', iconColor: '#3B82F6', title: 'Voice ledger recorded' },
  email:          { icon: MessageSquare, iconBg: '#F59E0B15', iconColor: '#F59E0B', title: 'Email exchange' },
  public_record:  { icon: FileText,      iconBg: '#22C55E15', iconColor: '#22C55E', title: 'Public record filed' },
  crawl:          { icon: FileText,      iconBg: '#22C55E15', iconColor: '#22C55E', title: 'Web crawl entry' },
  pdf_import:     { icon: FileText,      iconBg: '#3B82F615', iconColor: '#3B82F6', title: 'PDF import' },
  meeting:        { icon: Users,         iconBg: '#22C55E15', iconColor: '#22C55E', title: 'Stakeholder meeting' },
  merge:          { icon: GitMerge,      iconBg: '#8B5CF615', iconColor: '#8B5CF6', title: 'Merged from another note' },
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

export default function StakeholderAuditDashboard({
  stakeholder,
  conflict,
  stakeholders = [],
  onUpdated,
  onArchived,
}: StakeholderAuditProps = {}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)

  // Close the ⋯ menu when clicking outside of it.
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const id = stakeholder?.id
  const name = stakeholder?.name ?? 'James Morales'
  const type = (stakeholder?.metadata.type as string | undefined) ?? 'Director of Public Works'
  const role = stakeholder?.metadata.role as string | undefined
  const agency = stakeholder?.metadata.agency as string | undefined
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

  // Called by any InlineField after a successful patch. We forward the
  // refreshed detail to App so the sidebar list + graph colors refresh.
  const afterSave = (detail: StakeholderDetail) => onUpdated?.(detail)

  async function saveField(patch: Parameters<typeof api.patchStakeholder>[1]) {
    if (!id) throw new Error('no stakeholder selected')
    const updated = await api.patchStakeholder(id, patch)
    afterSave(updated)
  }

  async function saveBlockers(next: string[]) {
    await saveField({ technical_blockers: next })
  }

  async function saveNotes(content: string) {
    if (!id) throw new Error('no stakeholder selected')
    const updated = await api.putStakeholderNotes(id, content)
    afterSave(updated)
  }

  async function doArchive() {
    if (!id) return
    await api.archiveStakeholder(id)
    setConfirmArchive(false)
    onArchived?.(id)
  }

  async function doMerge(targetId: string) {
    if (!id) return
    const merged = await api.mergeStakeholder(id, targetId)
    setMergeOpen(false)
    // The source is gone. We tell the parent: the SOURCE is archived, but the
    // current selection should move to the target (which now holds the merged
    // data). We do this via onUpdated + onArchived in sequence.
    onUpdated?.(merged)
    onArchived?.(id)
  }

  // Nothing selected → plain preview (Pencil mock) + disable editing.
  const editable = !!stakeholder

  return (
    <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: '#0A0E17', fontFamily: 'Geist, sans-serif' }}>
      {/* ── Header + Gauges ── */}
      <div className="flex flex-col" style={{ borderBottom: '1px solid #1E2A3E' }}>
        {/* Name header */}
        <div
          className="flex items-start justify-between px-8 py-5"
          style={{ background: '#1A2035', borderBottom: '1px solid #1E2A3E' }}
        >
          <div className="flex flex-col gap-1.5">
            <div style={{ color: '#E8ECF4', fontSize: 22, fontWeight: 600 }}>
              {editable ? (
                <InlineField
                  kind="text"
                  value={name}
                  placeholder="name"
                  onSave={(v) => saveField({ name: (v as string) || undefined })}
                />
              ) : (
                name
              )}
            </div>
            <div className="flex items-center gap-3" style={{ color: '#8892A8', fontSize: 14 }}>
              {editable ? (
                <>
                  <InlineField
                    kind="select"
                    value={type}
                    options={[...ENTITY_TYPES]}
                    onSave={(v) => saveField({ type: v as (typeof ENTITY_TYPES)[number] })}
                  />
                  <span style={{ color: '#5A6580' }}>·</span>
                  <span style={{ fontSize: 13 }}>
                    <span style={{ color: '#5A6580', marginRight: 6 }}>role</span>
                    <InlineField
                      kind="text"
                      value={role ?? ''}
                      placeholder="—"
                      onSave={(v) => saveField({ role: (v as string) || undefined })}
                    />
                  </span>
                  <span style={{ color: '#5A6580' }}>·</span>
                  <span style={{ fontSize: 13 }}>
                    <span style={{ color: '#5A6580', marginRight: 6 }}>agency</span>
                    <InlineField
                      kind="text"
                      value={agency ?? ''}
                      placeholder="—"
                      onSave={(v) => saveField({ agency: (v as string) || undefined })}
                    />
                  </span>
                </>
              ) : (
                <span>{type}</span>
              )}
            </div>
            <span style={{ color: '#5A6580', fontSize: 13 }}>{org}</span>
          </div>

          <div className="flex items-start gap-2">
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded" style={{ background: activeBadge.bg }}>
              <div className="w-2 h-2 rounded-full" style={{ background: activeBadge.color }} />
              <span className="font-mono font-medium text-xs" style={{ color: activeBadge.color }}>{activeBadge.label}</span>
            </div>

            {editable && (
              <div ref={menuRef} className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  className="flex items-center justify-center rounded-md"
                  style={{
                    width: 32,
                    height: 32,
                    background: '#1F2A40',
                    border: '1px solid #2A3650',
                    color: '#8892A8',
                  }}
                  aria-label="More actions"
                >
                  <MoreHorizontal size={16} />
                </button>
                {menuOpen && (
                  <div
                    className="absolute right-0 mt-1 flex flex-col rounded-md overflow-hidden z-10"
                    style={{
                      background: '#111827',
                      border: '1px solid #2A3650',
                      minWidth: 180,
                      boxShadow: '0 8px 20px rgba(0,0,0,0.4)',
                    }}
                  >
                    <MenuItem
                      icon={GitMerge}
                      label="Merge with…"
                      onClick={() => { setMergeOpen(true); setMenuOpen(false) }}
                    />
                    <MenuItem
                      icon={Trash2}
                      label="Archive"
                      danger
                      onClick={() => { setConfirmArchive(true); setMenuOpen(false) }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Gauges */}
        <div className="grid grid-cols-2 gap-6 px-8 py-6">
          <Gauge
            value={influence}
            label="INFLUENCE SCORE"
            color="#F59E0B"
            subMetrics={[
              {
                label: 'Score (0-10)',
                value: editable ? (
                  <InlineField
                    kind="number"
                    value={Number(influence.toFixed(1))}
                    min={0}
                    max={10}
                    step={0.1}
                    onSave={(v) =>
                      saveField({ influence_score: Math.max(0, Math.min(1, (v as number) / 10)) })
                    }
                  />
                ) : `${influence.toFixed(1)} / 10`,
              },
              { label: 'Confidence',      value: confidence != null ? `${confidence.toFixed(1)} / 10` : '—' },
              { label: 'Blockers tracked', value: blockers.length.toString() },
            ]}
          />
          <Gauge
            value={sentiment}
            label="SENTIMENT SCORE"
            color="#3B82F6"
            subMetrics={[
              {
                label: 'Score (0-10)',
                value: editable ? (
                  <InlineField
                    kind="number"
                    value={Number(sentiment.toFixed(1))}
                    min={0}
                    max={10}
                    step={0.1}
                    onSave={(v) =>
                      saveField({ sentiment_vector: Math.max(0, Math.min(1, (v as number) / 10)) })
                    }
                  />
                ) : `${sentiment.toFixed(1)} / 10`,
              },
              { label: 'Last updated',      value: relativeTime(stakeholder?.metadata.last_updated as string | undefined) },
              { label: 'Source count',      value: (Array.isArray(stakeholder?.metadata.source_lineage) ? (stakeholder!.metadata.source_lineage as unknown[]).length : 0).toString() },
            ]}
          />
        </div>

        {/* Technical blockers */}
        {editable && (
          <div className="px-8 pb-6">
            <BlockerEditor blockers={blockers} onChange={saveBlockers} />
          </div>
        )}
      </div>

      {/* ── Ledger + Conflict Section ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Interaction Ledger + Notes */}
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
            <span className="font-mono text-xs" style={{ color: '#5A6580' }}>{ledger.length} {ledger.length === 1 ? 'entry' : 'entries'}</span>
          </div>

          {/* Feed */}
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {ledger.map((entry, i) => (
              <LedgerRow key={i} entry={entry} last={i === ledger.length - 1} />
            ))}

            {editable && stakeholder && (
              <div className="pt-4 mt-2" style={{ borderTop: '1px solid #1E2A3E' }}>
                <NotesEditor
                  value={stakeholder.content ?? ''}
                  onSave={saveNotes}
                />
              </div>
            )}
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

      {/* Modals */}
      {mergeOpen && stakeholder && (
        <MergeModal
          source={stakeholder}
          candidates={stakeholders.filter((s) => s.id !== stakeholder.id)}
          onCancel={() => setMergeOpen(false)}
          onConfirm={doMerge}
        />
      )}

      {confirmArchive && stakeholder && (
        <ConfirmModal
          title={`Archive ${name}?`}
          body={`The note moves to vault/archive/ with an archived_at timestamp. It won't appear in the sidebar or graph. Source lineage is preserved — this is a soft delete.`}
          confirmLabel="Archive"
          confirmDanger
          onCancel={() => setConfirmArchive(false)}
          onConfirm={() => void doArchive()}
        />
      )}
    </div>
  )
}

// ─── Blocker Editor ──────────────────────────────────────────────────────────

function BlockerEditor({
  blockers,
  onChange,
}: {
  blockers: string[]
  onChange: (next: string[]) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)

  const add = async () => {
    const v = draft.trim()
    if (!v || blockers.includes(v)) {
      setDraft('')
      return
    }
    setPending(true)
    try {
      await onChange([...blockers, v])
      setDraft('')
    } finally {
      setPending(false)
    }
  }

  const remove = async (idx: number) => {
    setPending(true)
    try {
      await onChange(blockers.filter((_, i) => i !== idx))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[10px] tracking-widest" style={{ color: '#5A6580', letterSpacing: '0.18em' }}>
        TECHNICAL BLOCKERS
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {blockers.map((b, i) => (
          <span
            key={`${b}-${i}`}
            className="flex items-center gap-1.5 px-2 py-1 rounded font-mono text-xs"
            style={{ background: '#2A1A1A', color: '#FCA5A5', border: '1px solid #7F1D1D60' }}
          >
            {b}
            <button
              onClick={() => void remove(i)}
              disabled={pending}
              style={{ color: '#FCA5A5' }}
              aria-label={`Remove ${b}`}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void add()
              }
            }}
            placeholder={blockers.length === 0 ? '+ add blocker' : '+ add'}
            disabled={pending}
            className="bg-transparent outline-none font-mono text-xs"
            style={{
              color: '#E8ECF4',
              border: '1px solid #2A3650',
              borderRadius: 4,
              padding: '4px 8px',
              minWidth: 140,
            }}
          />
          {draft && (
            <button onClick={() => void add()} disabled={pending}>
              <Plus size={13} color="#22C55E" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Menu primitives ─────────────────────────────────────────────────────────

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: ElementType
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 font-mono text-xs"
      style={{
        color: danger ? '#FCA5A5' : '#E8ECF4',
        background: 'transparent',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#1F2A40')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <Icon size={13} />
      {label}
    </button>
  )
}

// ─── Merge modal ─────────────────────────────────────────────────────────────

function MergeModal({
  source,
  candidates,
  onCancel,
  onConfirm,
}: {
  source: StakeholderDetail
  candidates: Stakeholder[]
  onCancel: () => void
  onConfirm: (targetId: string) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [targetId, setTargetId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((c) => c.name.toLowerCase().includes(q))
  }, [candidates, query])

  const target = candidates.find((c) => c.id === targetId) ?? null
  const sourceBlockers = Array.isArray(source.metadata.technical_blockers) ? (source.metadata.technical_blockers as string[]) : []
  const sourceLineage  = Array.isArray(source.metadata.source_lineage) ? (source.metadata.source_lineage as unknown[]) : []

  const confirm = async () => {
    if (!targetId) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(targetId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'merge failed')
      setBusy(false)
    }
  }

  return (
    <ModalShell title={`Merge "${source.name}" into another stakeholder`} onCancel={onCancel}>
      <div className="flex flex-col gap-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stakeholders to merge into…"
          className="input"
          autoFocus
        />

        <div
          className="rounded overflow-y-auto"
          style={{ background: '#1A2035', border: '1px solid #2A3650', maxHeight: 240 }}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center font-mono text-xs" style={{ color: '#5A6580' }}>
              No matches.
            </div>
          ) : (
            filtered.map((c) => {
              const active = c.id === targetId
              return (
                <button
                  key={c.id}
                  onClick={() => setTargetId(c.id)}
                  className="flex items-center justify-between w-full px-3 py-2 text-left"
                  style={{
                    background: active ? '#1F2A40' : 'transparent',
                    borderLeft: active ? '2px solid #3B82F6' : '2px solid transparent',
                  }}
                >
                  <div className="flex flex-col">
                    <span className="font-mono text-sm" style={{ color: '#E8ECF4' }}>{c.name}</span>
                    <span className="font-mono text-[11px]" style={{ color: '#5A6580' }}>
                      {c.type ?? '—'} · infl {c.influence_score != null ? (c.influence_score * 10).toFixed(1) : '—'}
                    </span>
                  </div>
                </button>
              )
            })
          )}
        </div>

        {target && (
          <div className="rounded p-3" style={{ background: '#0E141F', border: '1px solid #2A3650' }}>
            <span className="font-mono text-[10px] tracking-widest" style={{ color: '#5A6580', letterSpacing: '0.18em' }}>
              WILL HAPPEN
            </span>
            <ul className="font-mono text-xs mt-2 space-y-1" style={{ color: '#8892A8' }}>
              <li>
                <span style={{ color: '#E8ECF4' }}>{target.name}</span> absorbs{' '}
                <span style={{ color: '#FCA5A5' }}>{sourceBlockers.length}</span> blocker{sourceBlockers.length === 1 ? '' : 's'} and{' '}
                <span style={{ color: '#FCA5A5' }}>{sourceLineage.length}</span> lineage entr{sourceLineage.length === 1 ? 'y' : 'ies'} from {source.name}.
              </li>
              <li>
                <span style={{ color: '#E8ECF4' }}>{source.name}</span> moves to <code style={{ color: '#E8ECF4' }}>vault/archive/</code>.
              </li>
              <li>Body of {source.name} is appended to {target.name} under a "Merged from" header.</li>
            </ul>
          </div>
        )}

        {error && (
          <div className="font-mono text-xs px-3 py-2 rounded" style={{ background: '#DC262618', color: '#FCA5A5' }}>
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded font-mono text-xs"
            style={{ background: '#1F2A40', color: '#E8ECF4', border: '1px solid #2A3650' }}
          >
            CANCEL
          </button>
          <button
            onClick={() => void confirm()}
            disabled={!targetId || busy}
            className="px-3 py-1.5 rounded font-mono font-semibold text-xs"
            style={{
              background: !targetId || busy ? '#1F2A40' : '#8B5CF6',
              color: !targetId || busy ? '#5A6580' : '#E8ECF4',
              cursor: !targetId || busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'MERGING…' : 'MERGE'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

// ─── Generic confirm modal ───────────────────────────────────────────────────

function ConfirmModal({
  title,
  body,
  confirmLabel,
  confirmDanger,
  onCancel,
  onConfirm,
}: {
  title: string
  body: string
  confirmLabel: string
  confirmDanger?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const click = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed')
      setBusy(false)
    }
  }

  return (
    <ModalShell title={title} onCancel={onCancel}>
      <p className="font-sans text-sm" style={{ color: '#8892A8', lineHeight: 1.5 }}>
        {body}
      </p>
      {error && (
        <div className="font-mono text-xs px-3 py-2 mt-3 rounded" style={{ background: '#DC262618', color: '#FCA5A5' }}>
          {error}
        </div>
      )}
      <div className="flex items-center justify-end gap-2 mt-5">
        <button
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 rounded font-mono text-xs"
          style={{ background: '#1F2A40', color: '#E8ECF4', border: '1px solid #2A3650' }}
        >
          CANCEL
        </button>
        <button
          onClick={() => void click()}
          disabled={busy}
          className="px-3 py-1.5 rounded font-mono font-semibold text-xs"
          style={{
            background: busy ? '#1F2A40' : confirmDanger ? '#DC2626' : '#3B82F6',
            color: '#E8ECF4',
          }}
        >
          {busy ? 'WORKING…' : confirmLabel.toUpperCase()}
        </button>
      </div>
    </ModalShell>
  )
}

function ModalShell({
  title,
  children,
  onCancel,
}: {
  title: string
  children: React.ReactNode
  onCancel: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(10, 14, 23, 0.78)', backdropFilter: 'blur(4px)' }}
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-xl w-full max-w-lg p-6"
        style={{ background: '#111827', border: '1px solid #2A3650', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
      >
        <h2
          className="font-mono font-bold text-sm tracking-widest mb-4"
          style={{ color: '#E8ECF4', letterSpacing: '0.1em' }}
        >
          {title.toUpperCase()}
        </h2>
        {children}
      </div>
    </div>
  )
}
