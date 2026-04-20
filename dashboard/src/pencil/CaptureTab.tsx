import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api";
import type {
  ConflictPreview,
  ExtractedEntity,
  LedgerResponse,
  PreviewResponse,
} from "../api";

// ─── Types & defaults ─────────────────────────────────────────────────────────

const ENTITY_TYPES = ["Person", "Role", "Agency", "System", "Gatekeeper"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

const SOURCE_TYPES = [
  "voice_ledger",
  "email",
  "public_record",
  "meeting",
  "pdf_import",
  "crawl",
] as const;

type PreviewState =
  | { kind: "idle" }
  | { kind: "previewing" }
  | { kind: "previewed"; data: PreviewResponse }
  | { kind: "error"; message: string };

type CommitState =
  | { kind: "idle" }
  | { kind: "committing" }
  | { kind: "committed"; data: LedgerResponse }
  | { kind: "error"; message: string };

export interface CaptureTabProps {
  onCommitted?: (result: LedgerResponse) => void;
}

function localNowIso(): string {
  // Produce a local-timezone ISO-ish string for the datetime-local input:
  //   YYYY-MM-DDTHH:MM (no seconds, no Z).
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function toApiTimestamp(dtLocal: string): string | undefined {
  if (!dtLocal) return undefined;
  // datetime-local gives us a naive "YYYY-MM-DDTHH:MM"; we convert to ISO w/ offset.
  const d = new Date(dtLocal);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CaptureTab({ onCommitted }: CaptureTabProps = {}) {
  // Form state
  const [transcript, setTranscript] = useState("");
  const [sourceType, setSourceType] = useState<(typeof SOURCE_TYPES)[number]>("voice_ledger");
  const [meetingId, setMeetingId] = useState("");
  const [timestamp, setTimestamp] = useState(localNowIso());
  const [participants, setParticipants] = useState<string[]>([]);
  const [location, setLocation] = useState("");
  const [sourceNote, setSourceNote] = useState("");

  // Preview state + user edits on top of extraction result
  const [preview, setPreview] = useState<PreviewState>({ kind: "idle" });
  const [entities, setEntities] = useState<ExtractedEntity[] | null>(null);
  const [commit, setCommit] = useState<CommitState>({ kind: "idle" });

  // Sync entities back to "unedited" whenever a fresh preview returns so the
  // editable table starts from GPT's output.
  useEffect(() => {
    if (preview.kind === "previewed") {
      setEntities(preview.data.entities.map((e) => ({ ...e, blockers: [...e.blockers] })));
    }
  }, [preview]);

  const canPreview = transcript.trim().length > 0 && preview.kind !== "previewing";
  const canCommit =
    entities !== null && entities.length > 0 && commit.kind !== "committing";

  const runPreview = useCallback(async () => {
    if (!canPreview) return;
    setPreview({ kind: "previewing" });
    setCommit({ kind: "idle" });
    try {
      const data = await api.previewLedger({
        transcription: transcript,
        source_type: sourceType,
        meeting_id: meetingId || null,
        timestamp: toApiTimestamp(timestamp) ?? null,
        participants,
        location: location || null,
        note: sourceNote || null,
      });
      setPreview({ kind: "previewed", data });
    } catch (err) {
      setPreview({
        kind: "error",
        message: err instanceof Error ? err.message : "preview failed",
      });
    }
  }, [canPreview, transcript, sourceType, meetingId, timestamp, participants, location, sourceNote]);

  const runCommit = useCallback(async () => {
    if (!canCommit || entities === null) return;
    setCommit({ kind: "committing" });
    try {
      const data = await api.commitLedger({
        transcription: transcript,
        source_type: sourceType,
        meeting_id: meetingId || null,
        timestamp: toApiTimestamp(timestamp) ?? null,
        participants,
        location: location || null,
        note: sourceNote || null,
        entities_override: entities, // trust user's edits
      });
      setCommit({ kind: "committed", data });
      onCommitted?.(data);
    } catch (err) {
      setCommit({
        kind: "error",
        message: err instanceof Error ? err.message : "commit failed",
      });
    }
  }, [canCommit, entities, transcript, sourceType, meetingId, timestamp, participants, location, sourceNote, onCommitted]);

  // Reset everything after a successful commit so the FDE can log the next meeting.
  const resetAll = useCallback(() => {
    setTranscript("");
    setMeetingId("");
    setParticipants([]);
    setLocation("");
    setSourceNote("");
    setTimestamp(localNowIso());
    setPreview({ kind: "idle" });
    setEntities(null);
    setCommit({ kind: "idle" });
  }, []);

  // Editable-row helpers
  const updateEntity = useCallback((idx: number, patch: Partial<ExtractedEntity>) => {
    setEntities((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }, []);

  const removeEntity = useCallback((idx: number) => {
    setEntities((prev) => (prev ? prev.filter((_, i) => i !== idx) : prev));
  }, []);

  const addBlankEntity = useCallback(() => {
    setEntities((prev) => [
      ...(prev ?? []),
      {
        name: "",
        type: "Person",
        role: null,
        agency: null,
        blockers: [],
        sentiment: 0.5,
        influence: 0.5,
      },
    ]);
  }, []);

  // Keyboard: Cmd+Enter / Ctrl+Enter in the textarea runs Dry Run.
  const onTranscriptKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void runPreview();
    }
  };

  return (
    <div
      className="flex h-full w-full overflow-hidden"
      style={{ background: "#0A0E17" }}
    >
      {/* ── Left column: Transcript + metadata ── */}
      <div
        className="flex flex-col overflow-y-auto"
        style={{ width: "48%", borderRight: "1px solid #1E2A3E" }}
      >
        <div className="px-8 py-6 flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h1
              className="font-mono font-bold text-lg tracking-widest"
              style={{ color: "#E8ECF4", letterSpacing: "0.1em" }}
            >
              CAPTURE A MEETING
            </h1>
            <p className="font-mono text-xs" style={{ color: "#5A6580" }}>
              Paste a transcript or notes. Dry-run to preview extraction, then commit to the vault.
            </p>
          </div>

          {/* Source metadata */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Source type">
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as (typeof SOURCE_TYPES)[number])}
                className="input"
              >
                {SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Timestamp">
              <input
                type="datetime-local"
                value={timestamp}
                onChange={(e) => setTimestamp(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Meeting ID (optional)">
              <input
                type="text"
                value={meetingId}
                onChange={(e) => setMeetingId(e.target.value)}
                placeholder="m-20260419-dot"
                className="input"
              />
            </Field>
            <Field label="Location (optional)">
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="NYC DOT HQ"
                className="input"
              />
            </Field>
          </div>

          <Field label="Participants (comma or Enter)">
            <TagInput tags={participants} onChange={setParticipants} placeholder="Jane Doe, Mark Engineer…" />
          </Field>

          <Field label="Short note (optional)">
            <input
              type="text"
              value={sourceNote}
              onChange={(e) => setSourceNote(e.target.value)}
              placeholder="Quick summary stored alongside the lineage entry"
              className="input"
            />
          </Field>

          {/* Transcript */}
          <Field
            label="Transcript"
            hint={`${transcript.length.toLocaleString()} chars · ⌘↵ to dry-run`}
          >
            <textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              onKeyDown={onTranscriptKey}
              placeholder="Paste meeting transcript, Otter.ai export, or raw notes…"
              className="input font-mono"
              style={{ minHeight: 280, lineHeight: 1.5, resize: "vertical" }}
            />
          </Field>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => void runPreview()}
              disabled={!canPreview}
              className="flex items-center gap-2 px-4 py-2.5 rounded-md font-mono font-semibold text-xs tracking-widest"
              style={{
                background: !canPreview ? "#1F2A40" : "#3B82F6",
                color: !canPreview ? "#5A6580" : "#E8ECF4",
                cursor: !canPreview ? "not-allowed" : "pointer",
                letterSpacing: "0.12em",
              }}
            >
              {preview.kind === "previewing" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              DRY RUN
            </button>

            <button
              onClick={() => void runCommit()}
              disabled={!canCommit}
              className="flex items-center gap-2 px-4 py-2.5 rounded-md font-mono font-semibold text-xs tracking-widest"
              style={{
                background: !canCommit ? "#1F2A40" : "#22C55E",
                color: !canCommit ? "#5A6580" : "#0A0E17",
                cursor: !canCommit ? "not-allowed" : "pointer",
                letterSpacing: "0.12em",
              }}
            >
              {commit.kind === "committing" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
              COMMIT
            </button>

            {commit.kind === "committed" && (
              <button
                onClick={resetAll}
                className="font-mono text-xs px-3 py-1.5 rounded"
                style={{ color: "#8892A8", background: "#1F2A40" }}
              >
                + NEW CAPTURE
              </button>
            )}

            {preview.kind === "previewed" && commit.kind === "idle" && (
              <span className="font-mono text-[11px]" style={{ color: "#5A6580" }}>
                {entities?.length ?? 0} entity{(entities?.length ?? 0) === 1 ? "" : "ies"} ready to commit
              </span>
            )}
          </div>

          {preview.kind === "error" && (
            <Banner kind="error">Preview failed: {preview.message}</Banner>
          )}
          {commit.kind === "error" && (
            <Banner kind="error">Commit failed: {commit.message}</Banner>
          )}
          {commit.kind === "committed" && (
            <Banner kind="success">
              Committed {commit.data.files_touched.length} note{commit.data.files_touched.length === 1 ? "" : "s"}
              {commit.data.conflicts.length > 0 && ` · ${commit.data.conflicts.length} conflict(s) flagged`}
            </Banner>
          )}
        </div>
      </div>

      {/* ── Right column: Extraction preview ── */}
      <div className="flex flex-col overflow-y-auto" style={{ width: "52%" }}>
        <div className="px-8 py-6 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <h2
                className="font-mono font-bold text-sm tracking-widest"
                style={{ color: "#E8ECF4", letterSpacing: "0.12em" }}
              >
                EXTRACTED ENTITIES
              </h2>
              <p className="font-mono text-[11px]" style={{ color: "#5A6580" }}>
                {preview.kind === "previewed"
                  ? `Confidence ${(preview.data.confidence * 10).toFixed(1)} / 10 · overall sentiment ${(preview.data.overall_sentiment * 10).toFixed(1)} / 10`
                  : "Dry-run a transcript to see extracted entities."}
              </p>
            </div>
            {entities !== null && (
              <button
                onClick={addBlankEntity}
                className="flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[11px]"
                style={{ background: "#1F2A40", color: "#8892A8", border: "1px solid #2A3650" }}
              >
                <Plus size={12} />
                ADD ROW
              </button>
            )}
          </div>

          {preview.kind === "idle" && <EmptyState />}

          {preview.kind === "previewing" && (
            <div className="flex items-center gap-3 py-20 justify-center" style={{ color: "#8892A8" }}>
              <Loader2 size={18} className="animate-spin" />
              <span className="font-mono text-xs">Extracting entities…</span>
            </div>
          )}

          {entities !== null && entities.length > 0 && (
            <EntityTable
              entities={entities}
              onChange={updateEntity}
              onRemove={removeEntity}
            />
          )}

          {entities !== null && entities.length === 0 && (
            <div
              className="rounded-lg px-5 py-6 font-mono text-xs"
              style={{ background: "#1A2035", border: "1px dashed #2A3650", color: "#8892A8" }}
            >
              No entities extracted. Add one manually, or edit the transcript and dry-run again.
            </div>
          )}

          {preview.kind === "previewed" && preview.data.conflict_previews.length > 0 && (
            <ConflictPreviewList previews={preview.data.conflict_previews} />
          )}

          {commit.kind === "committed" && commit.data.files_touched.length > 0 && (
            <CommitReceipt data={commit.data} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span
          className="font-mono text-[10px] tracking-widest"
          style={{ color: "#5A6580", letterSpacing: "0.18em" }}
        >
          {label.toUpperCase()}
        </span>
        {hint && (
          <span className="font-mono text-[10px]" style={{ color: "#5A6580" }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </label>
  );
}

function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const commit = (val: string) => {
    const trimmed = val.trim().replace(/,$/, "").trim();
    if (!trimmed) return;
    if (tags.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...tags, trimmed]);
    setDraft("");
  };
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-2.5 py-2 rounded"
      style={{ background: "#1A2035", border: "1px solid #2A3650" }}
    >
      {tags.map((t) => (
        <span
          key={t}
          className="flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[11px]"
          style={{ background: "#2A3650", color: "#E8ECF4" }}
        >
          {t}
          <button
            onClick={() => onChange(tags.filter((x) => x !== t))}
            style={{ color: "#8892A8" }}
            aria-label={`Remove ${t}`}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          if (v.endsWith(",")) commit(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={() => draft && commit(draft)}
        placeholder={tags.length === 0 ? placeholder : ""}
        className="flex-1 bg-transparent font-mono text-xs outline-none"
        style={{ color: "#E8ECF4", minWidth: 120 }}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-20 rounded-lg"
      style={{ background: "#1A2035", border: "1px dashed #2A3650" }}
    >
      <Sparkles size={24} color="#3B82F6" />
      <div className="flex flex-col items-center gap-1">
        <span className="font-mono text-xs" style={{ color: "#8892A8" }}>
          Ready when you are.
        </span>
        <span className="font-mono text-[11px]" style={{ color: "#5A6580" }}>
          Paste a transcript on the left, then click DRY RUN or hit ⌘↵.
        </span>
      </div>
    </div>
  );
}

// ─── Entity table ────────────────────────────────────────────────────────────

function EntityTable({
  entities,
  onChange,
  onRemove,
}: {
  entities: ExtractedEntity[];
  onChange: (idx: number, patch: Partial<ExtractedEntity>) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: "#1A2035", border: "1px solid #2A3650" }}
    >
      <div
        className="grid px-4 py-2.5 font-mono text-[10px] tracking-widest"
        style={{
          gridTemplateColumns: "2fr 1fr 0.8fr 0.8fr 1.5fr 40px",
          color: "#5A6580",
          borderBottom: "1px solid #1E2A3E",
          letterSpacing: "0.15em",
        }}
      >
        <span>NAME</span>
        <span>TYPE</span>
        <span className="text-right pr-1">INFL.</span>
        <span className="text-right pr-1">SENT.</span>
        <span>BLOCKERS</span>
        <span />
      </div>
      <div className="flex flex-col">
        {entities.map((e, i) => (
          <EntityRow key={i} entity={e} onChange={(p) => onChange(i, p)} onRemove={() => onRemove(i)} />
        ))}
      </div>
    </div>
  );
}

function EntityRow({
  entity,
  onChange,
  onRemove,
}: {
  entity: ExtractedEntity;
  onChange: (patch: Partial<ExtractedEntity>) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="grid items-center px-4 py-2 gap-2"
      style={{
        gridTemplateColumns: "2fr 1fr 0.8fr 0.8fr 1.5fr 40px",
        borderBottom: "1px solid #1E2A3E",
      }}
    >
      <input
        type="text"
        value={entity.name}
        onChange={(e) => onChange({ name: e.target.value })}
        className="input-compact font-mono text-sm"
        placeholder="Jane Commissioner"
      />
      <select
        value={entity.type}
        onChange={(e) => onChange({ type: e.target.value as EntityType })}
        className="input-compact font-mono text-xs"
      >
        {ENTITY_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <NumberScale
        value={entity.influence}
        onChange={(v) => onChange({ influence: v })}
        color="#F59E0B"
      />
      <NumberScale
        value={entity.sentiment}
        onChange={(v) => onChange({ sentiment: v })}
        color="#3B82F6"
      />
      <BlockerTags blockers={entity.blockers} onChange={(b) => onChange({ blockers: b })} />
      <button
        onClick={onRemove}
        style={{ color: "#5A6580" }}
        className="justify-self-end hover:text-red-400"
        aria-label="Remove entity"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function NumberScale({
  value,
  onChange,
  color,
}: {
  value: number;
  onChange: (v: number) => void;
  color: string;
}) {
  // Display 0-10 to the user; store 0-1.
  const [raw, setRaw] = useState((value * 10).toFixed(1));
  useEffect(() => {
    setRaw((value * 10).toFixed(1));
  }, [value]);

  const commit = () => {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      setRaw((value * 10).toFixed(1));
      return;
    }
    const clamped = Math.max(0, Math.min(10, n));
    onChange(Number((clamped / 10).toFixed(3)));
    setRaw(clamped.toFixed(1));
  };

  return (
    <input
      type="number"
      min={0}
      max={10}
      step={0.1}
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
      }}
      className="input-compact font-mono text-sm text-right"
      style={{ color }}
    />
  );
}

function BlockerTags({
  blockers,
  onChange,
}: {
  blockers: string[];
  onChange: (b: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1">
      {blockers.map((b, i) => (
        <span
          key={i}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded font-mono text-[10px]"
          style={{ background: "#2A1A1A", color: "#FCA5A5", border: "1px solid #7F1D1D80" }}
          title={b}
        >
          {b.length > 22 ? `${b.slice(0, 20)}…` : b}
          <button
            onClick={() => onChange(blockers.filter((_, j) => j !== i))}
            style={{ color: "#FCA5A5" }}
          >
            <X size={9} />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            e.preventDefault();
            onChange([...blockers, draft.trim()]);
            setDraft("");
          } else if (e.key === "Backspace" && !draft && blockers.length > 0) {
            onChange(blockers.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (draft.trim()) {
            onChange([...blockers, draft.trim()]);
            setDraft("");
          }
        }}
        placeholder={blockers.length === 0 ? "+ blocker" : ""}
        className="bg-transparent font-mono text-[11px] outline-none flex-1 min-w-[60px]"
        style={{ color: "#E8ECF4" }}
      />
    </div>
  );
}

// ─── Conflict preview + commit receipt + banner ──────────────────────────────

function ConflictPreviewList({ previews }: { previews: ConflictPreview[] }) {
  const triggered = previews.filter((p) => p.would_trigger);
  if (triggered.length === 0) {
    return (
      <div
        className="flex items-center gap-2 rounded-lg px-4 py-3"
        style={{ background: "#22C55E10", border: "1px solid #22C55E40" }}
      >
        <CheckCircle2 size={14} color="#22C55E" />
        <span className="font-mono text-xs" style={{ color: "#86EFAC" }}>
          No conflicts triggered by this capture.
        </span>
      </div>
    );
  }
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: "#2A1A1A", border: "1px solid #7F1D1D60" }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ background: "#7F1D1D30", borderBottom: "1px solid #7F1D1D60" }}
      >
        <AlertTriangle size={14} color="#FCA5A5" />
        <span
          className="font-mono font-semibold text-[11px] tracking-widest"
          style={{ color: "#FCA5A5", letterSpacing: "0.15em" }}
        >
          WILL TRIGGER {triggered.length} CONFLICT{triggered.length === 1 ? "" : "S"}
        </span>
      </div>
      <div className="flex flex-col px-4 py-2 gap-1">
        {triggered.map((p) => (
          <div key={p.name} className="flex items-center justify-between py-1">
            <span className="font-mono text-xs" style={{ color: "#E8ECF4" }}>
              {p.name}
            </span>
            <span className="font-mono text-[11px]" style={{ color: "#FCA5A5" }}>
              {(p.previous_sentiment * 10).toFixed(1)} → {(p.new_sentiment * 10).toFixed(1)}
              <span style={{ color: "#8892A8" }}> · Δ {(p.delta * 10).toFixed(1)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommitReceipt({ data }: { data: LedgerResponse }) {
  return (
    <div
      className="rounded-lg px-4 py-3"
      style={{ background: "#22C55E10", border: "1px solid #22C55E40" }}
    >
      <div className="flex items-center gap-2 mb-2">
        <CheckCircle2 size={14} color="#22C55E" />
        <span
          className="font-mono font-semibold text-[11px] tracking-widest"
          style={{ color: "#86EFAC", letterSpacing: "0.15em" }}
        >
          COMMITTED TO VAULT
        </span>
      </div>
      <ul className="flex flex-col gap-0.5 pl-5" style={{ color: "#8892A8" }}>
        {data.files_touched.map((f) => (
          <li key={f} className="font-mono text-[11px]" style={{ listStyle: "circle" }}>
            {f}
          </li>
        ))}
      </ul>
      {data.conflicts.length > 0 && (
        <div className="mt-2 pt-2" style={{ borderTop: "1px solid #22C55E40" }}>
          <span
            className="font-mono font-semibold text-[10px] tracking-widest"
            style={{ color: "#FCA5A5" }}
          >
            CONFLICTS CREATED
          </span>
          <ul className="flex flex-col gap-0.5 pl-5 mt-1" style={{ color: "#FCA5A5" }}>
            {data.conflicts.map((c) => (
              <li key={c} className="font-mono text-[11px]" style={{ listStyle: "circle" }}>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Banner({ kind, children }: { kind: "success" | "error"; children: React.ReactNode }) {
  const palette = useMemo(() => {
    if (kind === "success") {
      return { bg: "#22C55E10", border: "#22C55E40", fg: "#86EFAC" };
    }
    return { bg: "#DC262618", border: "#DC262640", fg: "#FCA5A5" };
  }, [kind]);
  return (
    <div
      className="flex items-center gap-2 rounded-md px-3 py-2"
      style={{ background: palette.bg, border: `1px solid ${palette.border}` }}
    >
      <span className="font-mono text-xs" style={{ color: palette.fg }}>
        {children}
      </span>
    </div>
  );
}
