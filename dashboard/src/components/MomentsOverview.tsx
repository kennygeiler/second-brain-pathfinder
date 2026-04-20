import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { api } from "../api";
import type { MomentLegendItem, MomentRow, MomentsPayload } from "../api";

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function utcDayKey(ts: number): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildUtcYearGrid(year: number): { weekCount: number; cells: { ts: number; dayKey: string; inYear: boolean }[][] } {
  const jan1 = Date.UTC(year, 0, 1);
  const dec31 = Date.UTC(year, 11, 31);
  const dow = new Date(jan1).getUTCDay(); // 0 Sun
  const mondayIndex = dow === 0 ? 6 : dow - 1; // Mon=0 .. Sun=6 (row index)
  const startMonday = jan1 - mondayIndex * DAY_MS;
  const decDow = new Date(dec31).getUTCDay();
  const endMonday = dec31 - ((decDow + 6) % 7) * DAY_MS;
  const weekCount = Math.max(1, Math.floor((endMonday - startMonday) / (7 * DAY_MS)) + 1);
  const cells: { ts: number; dayKey: string; inYear: boolean }[][] = [];
  for (let w = 0; w < weekCount; w++) {
    const col: { ts: number; dayKey: string; inYear: boolean }[] = [];
    for (let row = 0; row < 7; row++) {
      const ts = startMonday + w * 7 * DAY_MS + row * DAY_MS;
      const dayKey = utcDayKey(ts);
      const inYear = ts >= jan1 && ts <= dec31;
      col.push({ ts, dayKey, inYear });
    }
    cells.push(col);
  }
  return { weekCount: cells.length, cells };
}

function monthLabels(year: number, weekCount: number, startMonday: number): string[] {
  const labels: string[] = [];
  let prev = -1;
  for (let w = 0; w < weekCount; w++) {
    const mid = startMonday + w * 7 * DAY_MS + 3 * DAY_MS;
    const d = new Date(mid);
    if (d.getUTCFullYear() !== year) {
      labels.push("");
      continue;
    }
    const m = d.getUTCMonth();
    if (m !== prev) {
      labels.push(MONTHS[m]);
      prev = m;
    } else {
      labels.push("");
    }
  }
  return labels;
}

function groupByDay(moments: MomentRow[]): Map<string, MomentRow[]> {
  const m = new Map<string, MomentRow[]>();
  for (const row of moments) {
    const list = m.get(row.day) ?? [];
    list.push(row);
    m.set(row.day, list);
  }
  for (const [, list] of m) {
    list.sort((a, b) => b.at.localeCompare(a.at));
  }
  return m;
}

function formatLedgerWhen(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  refreshNonce: number;
  onSelectStakeholder: (id: string) => void;
};

export default function MomentsOverview({ refreshNonce, onSelectStakeholder }: Props) {
  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const [payload, setPayload] = useState<MomentsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; dayKey: string } | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.moments(year);
      setPayload(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load moments");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load, refreshNonce]);

  const byDay = useMemo(() => (payload ? groupByDay(payload.moments) : new Map<string, MomentRow[]>()), [payload]);

  const grid = useMemo(() => buildUtcYearGrid(year), [year]);
  const jan1 = Date.UTC(year, 0, 1);
  const dow = new Date(jan1).getUTCDay();
  const mondayIndex = dow === 0 ? 6 : dow - 1;
  const startMonday = jan1 - mondayIndex * DAY_MS;
  const monthRow = useMemo(() => monthLabels(year, grid.weekCount, startMonday), [year, grid.weekCount, startMonday]);

  const scrollToMoment = (id: string) => {
    setFlashId(id);
    window.setTimeout(() => setFlashId(null), 1400);
    const el = document.getElementById(`moment-ledger-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const yearOptions = useMemo(() => {
    const cy = new Date().getUTCFullYear();
    const out: number[] = [];
    for (let y = cy; y >= cy - 5; y--) out.push(y);
    return out;
  }, []);

  const legend: MomentLegendItem[] = payload?.legend ?? [];

  return (
    <div className="h-full w-full overflow-y-auto" style={{ background: "#0A0E17" }}>
      <div className="mx-auto max-w-7xl px-8 py-10 flex flex-col gap-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1
              className="font-mono font-bold text-lg tracking-widest flex items-center gap-2"
              style={{ color: "#E8ECF4", letterSpacing: "0.12em" }}
            >
              <CalendarDays size={20} color="#22C55E" />
              MOMENTS
            </h1>
            <p className="font-mono text-xs mt-2" style={{ color: "#5A6580" }}>
              Source lineage on stakeholders, sentiment conflicts, and Red Team runs — mapped to the calendar. Click a day to jump
              to the ledger.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px]" style={{ color: "#5A6580" }}>
              Year
            </span>
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="font-mono text-xs rounded-md px-3 py-2"
              style={{ background: "#1A2035", border: "1px solid #2A3650", color: "#E8ECF4" }}
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading && (
          <p className="font-mono text-xs" style={{ color: "#5A6580" }}>
            Loading moments…
          </p>
        )}
        {error && (
          <p className="font-mono text-xs" style={{ color: "#FCA5A5" }}>
            {error}
          </p>
        )}

        {payload && !loading && (
          <>
            <div className="rounded-lg p-5 flex flex-col gap-4" style={{ background: "#111827", border: "1px solid #2A3650" }}>
              <div className="flex flex-wrap items-center gap-4 justify-between">
                <span className="font-mono text-[11px] tracking-widest" style={{ color: "#8892A8" }}>
                  {payload.moments.length} moment{payload.moments.length === 1 ? "" : "s"} in {year}
                </span>
                <span className="font-mono text-[10px]" style={{ color: "#5A6580" }}>
                  Less · intensity · More (per day)
                </span>
              </div>

              <div className="overflow-x-auto pb-1">
                <div className="inline-flex flex-col gap-1 min-w-max">
                  <div className="flex pl-8" style={{ gap: 3 }}>
                    {monthRow.map((lab, i) => (
                      <div
                        key={i}
                        className="font-mono text-[10px] text-left"
                        style={{ width: 13, color: lab ? "#8892A8" : "transparent" }}
                      >
                        {lab}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1 items-start">
                    <div className="flex flex-col justify-between pt-0.5 pr-1" style={{ height: 7 * 13 + 6 * 3 }}>
                      <span className="font-mono text-[9px]" style={{ color: "#5A6580" }}>
                        Mon
                      </span>
                      <span className="font-mono text-[9px]" style={{ color: "#5A6580" }}>
                        Wed
                      </span>
                      <span className="font-mono text-[9px]" style={{ color: "#5A6580" }}>
                        Fri
                      </span>
                    </div>
                    <div className="flex" style={{ gap: 3 }}>
                      {grid.cells.map((week, wi) => (
                        <div key={wi} className="flex flex-col" style={{ gap: 3 }}>
                          {week.map((cell) => {
                            const list = byDay.get(cell.dayKey) ?? [];
                            const count = list.length;
                            const primary = count ? list[0] : null;
                            const level = count === 0 ? 0 : Math.min(4, count);
                            const bg =
                              !cell.inYear ? "#161B26" : count === 0 ? "#1F2937" : primary?.color ?? "#374151";
                            const opacity = !cell.inYear ? 0.35 : count === 0 ? 1 : 0.35 + level * 0.16;
                            return (
                              <button
                                key={cell.dayKey}
                                type="button"
                                disabled={!cell.inYear || count === 0}
                                className="rounded-sm border-0 p-0"
                                style={{
                                  width: 11,
                                  height: 11,
                                  background: bg,
                                  opacity,
                                  cursor: !cell.inYear || count === 0 ? "default" : "pointer",
                                }}
                                aria-label={
                                  count
                                    ? `${cell.dayKey}: ${count} moment(s)`
                                    : cell.inYear
                                      ? `${cell.dayKey}: no activity`
                                      : ""
                                }
                                onMouseEnter={(e) => {
                                  if (!cell.inYear || count === 0) return;
                                  setHover({ x: e.clientX, y: e.clientY, dayKey: cell.dayKey });
                                }}
                                onMouseMove={(e) => {
                                  if (!cell.inYear || count === 0) return;
                                  setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : null));
                                }}
                                onMouseLeave={() => setHover(null)}
                                onClick={() => {
                                  if (!count) return;
                                  scrollToMoment(list[0].id);
                                }}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-1 border-t" style={{ borderColor: "#1E2A3E" }}>
                {legend.map((L) => (
                  <span key={L.kind} className="flex items-center gap-2">
                    <span className="rounded-sm flex-shrink-0" style={{ width: 12, height: 12, background: L.color }} />
                    <span className="font-mono text-[11px]" style={{ color: "#8892A8" }}>
                      {L.label}
                    </span>
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-lg p-5 flex flex-col gap-3" style={{ background: "#111827", border: "1px solid #2A3650" }}>
              <h2 className="font-mono text-xs tracking-widest" style={{ color: "#E8ECF4", letterSpacing: "0.12em" }}>
                LEDGER
              </h2>
              <p className="font-mono text-[11px]" style={{ color: "#5A6580" }}>
                Newest first. Rows are tagged to graph nodes via stakeholder ids in the vault.
              </p>
              {payload.moments.length === 0 ? (
                <p className="font-mono text-sm" style={{ color: "#5A6580" }}>
                  No moments for {year}. Capture transcripts or run Red Team to populate lineage.
                </p>
              ) : (
                <div className="flex flex-col gap-6">
                  {(() => {
                    const groups = new Map<string, MomentRow[]>();
                    for (const m of payload.moments) {
                      const d = Date.parse(m.at);
                      const label = Number.isNaN(d)
                        ? "Unknown date"
                        : new Date(d).toLocaleString(undefined, { month: "long", year: "numeric" });
                      const g = groups.get(label) ?? [];
                      g.push(m);
                      groups.set(label, g);
                    }
                    return [...groups.entries()].map(([glabel, rows]) => (
                      <div key={glabel}>
                        <p className="font-mono text-[11px] mb-2" style={{ color: "#5A6580" }}>
                          {glabel.toUpperCase()}
                        </p>
                        <div className="flex flex-col gap-0">
                          {rows.map((row) => {
                            const flash = flashId === row.id;
                            return (
                              <div
                                id={`moment-ledger-${row.id}`}
                                key={row.id}
                                className="flex items-start gap-3 py-3 px-2 rounded-md transition-shadow"
                                style={{
                                  borderBottom: "1px solid #1E2A3E",
                                  boxShadow: flash ? "0 0 0 2px #22C55E80" : undefined,
                                }}
                              >
                                <div
                                  className="flex-shrink-0 mt-0.5 rounded-sm"
                                  style={{ width: 10, height: 10, background: row.color }}
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono font-semibold text-xs" style={{ color: "#E8ECF4" }}>
                                      {row.label}
                                    </span>
                                    <span className="font-mono text-[10px]" style={{ color: "#5A6580" }}>
                                      {formatLedgerWhen(row.at)}
                                    </span>
                                  </div>
                                  <p className="font-sans text-xs mt-1" style={{ color: "#8892A8", lineHeight: 1.45 }}>
                                    {row.detail || "—"}
                                  </p>
                                  <div className="flex flex-wrap gap-2 mt-2">
                                    {row.stakeholder_id ? (
                                      <button
                                        type="button"
                                        className="font-mono text-[11px]"
                                        style={{ color: "#3B82F6" }}
                                        onClick={() => onSelectStakeholder(row.stakeholder_id)}
                                      >
                                        {row.stakeholder_name}
                                      </button>
                                    ) : row.kind === "red_team" ? (
                                      <span className="font-mono text-[11px]" style={{ color: "#EC4899" }}>
                                        {row.stakeholder_name}
                                      </span>
                                    ) : (
                                      <span className="font-mono text-[11px]" style={{ color: "#5A6580" }}>
                                        {row.stakeholder_name}
                                      </span>
                                    )}
                                    {row.path && (
                                      <code className="font-mono text-[10px] truncate" style={{ color: "#5A6580" }}>
                                        {row.path}
                                      </code>
                                    )}
                                    {row.plan_path && (
                                      <code className="font-mono text-[10px] truncate" style={{ color: "#5A6580" }}>
                                        {row.plan_path}
                                      </code>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {hover && byDay.get(hover.dayKey) && byDay.get(hover.dayKey)!.length > 0 && (
        <div
          className="fixed z-50 pointer-events-none rounded-md px-3 py-2 max-w-sm font-mono text-[11px]"
          style={{
            left: hover.x + 12,
            top: hover.y + 12,
            background: "#1A2035",
            border: "1px solid #2A3650",
            color: "#E8ECF4",
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          }}
        >
          <p style={{ color: "#8892A8", marginBottom: 6 }}>{hover.dayKey}</p>
          {byDay.get(hover.dayKey)!.map((m) => (
            <div key={m.id} className="mb-2 last:mb-0">
              <span style={{ color: m.color }}>● </span>
              <span>{m.label}</span>
              {m.stakeholder_name && (
                <span style={{ color: "#5A6580" }}>
                  {" "}
                  · {m.stakeholder_name}
                </span>
              )}
              {m.detail && <p style={{ color: "#8892A8", marginTop: 4, lineHeight: 1.35 }}>{m.detail.slice(0, 160)}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
