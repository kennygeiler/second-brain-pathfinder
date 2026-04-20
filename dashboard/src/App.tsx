import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Compass,
  Gauge,
  LayoutGrid,
  Mic,
  Network,
  RefreshCw,
  Server,
  Sparkles,
  X,
} from "lucide-react";
import { api } from "./api";
import type {
  ActionPlan,
  Conflict,
  GraphSnapshot,
  LedgerResponse,
  RedTeamResult,
  Stakeholder,
  StakeholderDetail,
} from "./api";
import CaptureTab from "./pencil/CaptureTab";
import CityIntelligenceMap from "./pencil/CityIntelligenceMap";
import CityNavigationMap from "./pencil/CityNavigationMap";
import StakeholderAuditDashboard from "./pencil/StakeholderAuditDashboard";
import ExecutiveHealthMatrix from "./pencil/ExecutiveHealthMatrix";
import CommandPalette from "./components/CommandPalette";

type LoadState = "idle" | "loading" | "ready" | "error";

type TabId = "overview" | "capture" | "matrix" | "audit" | "intel" | "nav";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview",         icon: LayoutGrid },
  { id: "capture",  label: "Capture",          icon: Mic },
  { id: "matrix",   label: "Health Matrix",    icon: Gauge },
  { id: "audit",    label: "Stakeholder",      icon: Activity },
  { id: "intel",    label: "Risk Intel",       icon: Network },
  { id: "nav",      label: "Pathfinder Map",   icon: Compass },
];

export function App() {
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [plans, setPlans] = useState<ActionPlan[]>([]);
  const [graph, setGraph] = useState<GraphSnapshot | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StakeholderDetail | null>(null);
  const [pivotState, setPivotState] = useState<"idle" | "running" | "error">("idle");
  const [pivotResult, setPivotResult] = useState<RedTeamResult | null>(null);
  const [pivotError, setPivotError] = useState<string | null>(null);
  const [captureFlash, setCaptureFlash] = useState<LedgerResponse | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  async function runPivot() {
    if (pivotState === "running") return;
    setPivotState("running");
    setPivotError(null);
    try {
      const result = await api.redTeam();
      setPivotResult(result);
      setPivotState("idle");
      await load();
    } catch (err) {
      setPivotError(err instanceof Error ? err.message : "red-team failed");
      setPivotState("error");
    }
  }

  async function load() {
    setState("loading");
    try {
      const [s, c, p, g] = await Promise.all([
        api.stakeholders(),
        api.conflicts(),
        api.actionPlans(),
        api.graph(),
      ]);
      setStakeholders(s);
      setConflicts(c);
      setPlans(p);
      setGraph(g);
      setState("ready");
      if (!selectedId && s.length > 0) setSelectedId(s[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Global Cmd+K / Ctrl+K opens the palette from any tab. We also close on
  // Cmd+K so a double-tap toggles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    api
      .stakeholder(selectedId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const conflictForSelected = useMemo<Conflict | null>(() => {
    if (!selectedId) return null;
    const match = conflicts.find((c) => {
      const meta = c.metadata as Record<string, unknown>;
      const id = typeof meta.stakeholder === "string" ? meta.stakeholder : undefined;
      if (id && id === selectedId) return true;
      const name = detail?.name?.toLowerCase();
      return name ? c.path.toLowerCase().includes(name.replace(/\s+/g, "-")) : false;
    });
    return match ?? null;
  }, [conflicts, selectedId, detail]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden" style={{ background: "#0A0E17" }}>
      <TopBar
        tab={tab}
        setTab={setTab}
        onRefresh={() => void load()}
        onOpenPalette={() => setPaletteOpen(true)}
        stakeholderCount={stakeholders.length}
        conflictCount={conflicts.length}
        graphSource={graph?.source ?? "offline"}
        loading={state === "loading"}
      />

      {state === "error" && (
        <div className="px-6 py-3" style={{ background: "#DC262618", borderBottom: "1px solid #DC262640" }}>
          <p className="font-mono text-xs" style={{ color: "#FCA5A5" }}>
            Failed to load vault: {error}. Start the API with <code>make run</code> (port 8000) and click Refresh.
          </p>
        </div>
      )}

      {pivotState === "running" && (
        <div className="flex items-center gap-2 px-6 py-2" style={{ background: "#F59E0B18", borderBottom: "1px solid #F59E0B40" }}>
          <Sparkles size={14} color="#F59E0B" className="animate-pulse" />
          <p className="font-mono text-xs" style={{ color: "#FCD34D" }}>
            Red Team running — querying Neo4j for institutional inertia, generating plan…
          </p>
        </div>
      )}

      {pivotState === "error" && pivotError && (
        <div className="flex items-center gap-2 px-6 py-2" style={{ background: "#DC262618", borderBottom: "1px solid #DC262640" }}>
          <p className="flex-1 font-mono text-xs" style={{ color: "#FCA5A5" }}>
            Red Team failed: {pivotError}
          </p>
          <button onClick={() => setPivotState("idle")} style={{ color: "#FCA5A5" }}>
            <X size={14} />
          </button>
        </div>
      )}

      {captureFlash && (
        <div className="flex items-center gap-3 px-6 py-2" style={{ background: "#22C55E15", borderBottom: "1px solid #22C55E40" }}>
          <Sparkles size={14} color="#22C55E" />
          <p className="flex-1 font-mono text-xs" style={{ color: "#86EFAC" }}>
            Captured · {captureFlash.files_touched.length} note{captureFlash.files_touched.length === 1 ? "" : "s"} written
            {captureFlash.conflicts.length > 0 && (
              <span style={{ color: "#FCA5A5" }}> · {captureFlash.conflicts.length} conflict(s) flagged</span>
            )}
          </p>
          <button
            onClick={() => setTab("overview")}
            className="px-2 py-0.5 rounded font-mono text-xs"
            style={{ background: "#1F2A40", color: "#86EFAC", border: "1px solid #22C55E40" }}
          >
            OVERVIEW
          </button>
          <button onClick={() => setCaptureFlash(null)} style={{ color: "#86EFAC" }}>
            <X size={14} />
          </button>
        </div>
      )}

      {pivotState === "idle" && pivotResult && (
        <div className="flex items-center gap-3 px-6 py-2" style={{ background: "#22C55E15", borderBottom: "1px solid #22C55E40" }}>
          <Sparkles size={14} color="#22C55E" />
          <p className="flex-1 font-mono text-xs" style={{ color: "#86EFAC" }}>
            Plan generated — {pivotResult.hotspots} hotspot(s)
            {pivotResult.hotspot_names.length > 0 && (
              <span style={{ color: "#8892A8" }}> · {pivotResult.hotspot_names.slice(0, 3).join(", ")}</span>
            )}
            {pivotResult.plan_path && (
              <>
                {" · "}
                <code style={{ color: "#E8ECF4" }}>{pivotResult.plan_path}</code>
              </>
            )}
          </p>
          <button
            onClick={() => setTab("overview")}
            className="px-2 py-0.5 rounded font-mono text-xs"
            style={{ background: "#1F2A40", color: "#86EFAC", border: "1px solid #22C55E40" }}
          >
            VIEW
          </button>
          <button onClick={() => setPivotResult(null)} style={{ color: "#86EFAC" }}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {tab === "overview" && (
          <Overview
            stakeholders={stakeholders}
            conflicts={conflicts}
            plans={plans}
            graph={graph}
            loading={state === "loading"}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setTab("audit");
            }}
          />
        )}
        {tab === "capture" && (
          <CaptureTab
            onCommitted={(result) => {
              setCaptureFlash(result);
              void load();
            }}
          />
        )}
        {tab === "matrix" && (
          <ExecutiveHealthMatrix
            stakeholders={stakeholders}
            conflicts={conflicts}
            onPivot={() => void runPivot()}
            pivotRunning={pivotState === "running"}
          />
        )}
        {tab === "audit" && (
          <div className="flex h-full w-full">
            <StakeholderSidebar
              stakeholders={stakeholders}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            <div className="flex-1 overflow-hidden">
              <StakeholderAuditDashboard
                stakeholder={detail}
                conflict={conflictForSelected}
                stakeholders={stakeholders}
                onUpdated={(updated) => {
                  // Local update so the audit panel feels instant. A full
                  // `load()` then backfills the sidebar list, graph, conflicts.
                  setDetail(updated);
                  void load();
                }}
                onArchived={(archivedId) => {
                  if (selectedId === archivedId) setSelectedId(null);
                  setDetail(null);
                  void load();
                }}
              />
            </div>
          </div>
        )}
        {tab === "intel" && (
          <CityIntelligenceMap
            graph={graph}
            conflicts={conflicts}
            selectedId={selectedId}
            onNodeClick={(id) => {
              setSelectedId(id);
              setTab("audit");
            }}
          />
        )}
        {tab === "nav" && (
          <CityNavigationMap
            graph={graph}
            plans={plans}
            selectedId={selectedId}
            onNodeClick={(id) => {
              setSelectedId(id);
              setTab("audit");
            }}
          />
        )}
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        stakeholders={stakeholders}
        conflicts={conflicts}
        plans={plans}
        onSelect={(s) => {
          if (s.kind === "stakeholder") {
            setSelectedId(s.id);
            setTab("audit");
          } else if (s.kind === "conflict") {
            // Jump to the stakeholder implicated by the conflict, if any, else the overview.
            const conflict = conflicts.find((c) => c.path === s.path);
            const meta = conflict?.metadata as Record<string, unknown> | undefined;
            const sid = typeof meta?.stakeholder === "string" ? meta.stakeholder : null;
            if (sid) {
              setSelectedId(sid);
              setTab("audit");
            } else {
              setTab("overview");
            }
          } else if (s.kind === "plan") {
            setTab("overview");
          }
        }}
      />
    </div>
  );
}

// ─── Top bar / tabs ───────────────────────────────────────────────────────────

function TopBar(props: {
  tab: TabId;
  setTab: (t: TabId) => void;
  onRefresh: () => void;
  onOpenPalette: () => void;
  stakeholderCount: number;
  conflictCount: number;
  graphSource: string;
  loading: boolean;
}) {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const cmdKey = isMac ? "⌘" : "Ctrl";
  return (
    <div
      className="flex items-center gap-6 px-6"
      style={{ background: "#111827", borderBottom: "1px solid #2A3650", height: 56, flexShrink: 0 }}
    >
      <div className="flex items-center gap-2">
        <Server size={16} color="#3B82F6" />
        <span
          className="font-mono font-bold text-sm tracking-widest"
          style={{ color: "#E8ECF4", letterSpacing: "0.15em" }}
        >
          PATHFINDER
        </span>
      </div>

      <div className="flex items-center gap-1 flex-1">
        {TABS.map((t) => {
          const active = props.tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => props.setTab(t.id)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md"
              style={{
                background: active ? "#1F2A40" : "transparent",
                border: active ? "1px solid #2A3650" : "1px solid transparent",
                color: active ? "#E8ECF4" : "#8892A8",
              }}
            >
              <Icon size={14} />
              <span className="font-mono font-medium text-xs tracking-wide" style={{ letterSpacing: "0.06em" }}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-4">
        <Stat label="STAKEHOLDERS" value={props.stakeholderCount.toString()} />
        <Stat label="CONFLICTS" value={props.conflictCount.toString()} tone={props.conflictCount > 0 ? "warn" : "ok"} />
        <Stat label="GRAPH" value={props.graphSource.replace(/^proposed:.+$/, "proposed")} />
        <button
          onClick={props.onOpenPalette}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md"
          style={{
            background: "#1F2A40",
            border: "1px solid #2A3650",
            color: "#8892A8",
          }}
          title="Search stakeholders, conflicts, plans"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span className="font-mono text-xs" style={{ letterSpacing: "0.04em" }}>
            SEARCH
          </span>
          <kbd
            className="font-mono text-[10px] px-1 py-0.5 rounded"
            style={{ background: "#0E141F", border: "1px solid #2A3650", color: "#5A6580" }}
          >
            {cmdKey}K
          </kbd>
        </button>
        <button
          onClick={props.onRefresh}
          disabled={props.loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md"
          style={{
            background: "#1F2A40",
            border: "1px solid #2A3650",
            color: props.loading ? "#5A6580" : "#E8ECF4",
            cursor: props.loading ? "wait" : "pointer",
          }}
        >
          <RefreshCw size={13} className={props.loading ? "animate-spin" : undefined} />
          <span className="font-mono text-xs" style={{ letterSpacing: "0.08em" }}>
            REFRESH
          </span>
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  const color = tone === "warn" ? "#F59E0B" : "#E8ECF4";
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="font-mono font-bold text-sm" style={{ color }}>
        {value}
      </span>
      <span className="font-mono font-medium text-xs" style={{ color: "#5A6580", letterSpacing: "0.1em", fontSize: 9 }}>
        {label}
      </span>
    </div>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────────────

function Overview(props: {
  stakeholders: Stakeholder[];
  conflicts: Conflict[];
  plans: ActionPlan[];
  graph: GraphSnapshot | null;
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="h-full w-full overflow-y-auto" style={{ background: "#0A0E17" }}>
      <div className="mx-auto max-w-7xl px-8 py-10 flex flex-col gap-8">
        <div className="grid grid-cols-4 gap-4">
          <MetricCard label="STAKEHOLDERS" value={props.stakeholders.length.toString()} accent="#3B82F6" hint="tracked in vault" />
          <MetricCard
            label="OPEN CONFLICTS"
            value={props.conflicts.length.toString()}
            accent={props.conflicts.length ? "#F59E0B" : "#22C55E"}
            hint="sentiment deltas flagged"
          />
          <MetricCard
            label="ACTION PLANS"
            value={props.plans.length.toString()}
            accent="#F59E0B"
            hint="from Red Team runs"
          />
          <MetricCard
            label="GRAPH SOURCE"
            value={props.graph?.source === "neo4j" ? "NEO4J" : props.graph?.source?.startsWith("proposed") ? "PROPOSED" : "OFFLINE"}
            accent={props.graph?.source === "neo4j" ? "#22C55E" : "#6B7280"}
            hint={`${props.graph?.nodes.length ?? 0} nodes · ${props.graph?.edges.length ?? 0} edges`}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div
            className="col-span-2 rounded-lg p-5 flex flex-col gap-3"
            style={{ background: "#111827", border: "1px solid #2A3650" }}
          >
            <SectionHeader icon={Activity} label="LATEST STAKEHOLDERS" accent="#3B82F6" />
            {props.loading && !props.stakeholders.length ? (
              <p className="font-mono text-xs" style={{ color: "#5A6580" }}>Loading vault…</p>
            ) : props.stakeholders.length ? (
              <div className="grid grid-cols-2 gap-2">
                {props.stakeholders.slice(0, 8).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => props.onSelect(s.id)}
                    className="flex items-start gap-3 px-3 py-2.5 rounded-md text-left"
                    style={{
                      background: props.selectedId === s.id ? "#1F2A40" : "#1A2035",
                      border: "1px solid #1E2A3E",
                    }}
                  >
                    <div
                      className="flex items-center justify-center flex-shrink-0 font-mono font-bold text-xs"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: (s.type ?? "").toLowerCase() === "system" ? 6 : "50%",
                        background: "#1F2A40",
                        color: "#E8ECF4",
                        border: `1.5px solid ${typeColor(s.type)}`,
                      }}
                    >
                      {initialsOf(s.name)}
                    </div>
                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                      <span className="font-mono font-semibold text-xs truncate" style={{ color: "#E8ECF4" }}>
                        {s.name}
                      </span>
                      <span className="font-sans text-xs" style={{ color: "#5A6580" }}>
                        {s.type ?? "—"}
                      </span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="font-mono font-bold text-xs" style={{ color: "#F59E0B" }}>
                        {fmtScore(s.influence_score)}
                      </span>
                      <span className="font-mono text-xs" style={{ color: scoreColor(s.sentiment_vector) }}>
                        {fmtScore(s.sentiment_vector)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Vault is empty"
                body={"Drop a transcription into inbox/ and run `make demo`."}
              />
            )}
          </div>

          <div
            className="rounded-lg p-5 flex flex-col gap-3"
            style={{ background: "#111827", border: "1px solid #2A3650" }}
          >
            <SectionHeader icon={Gauge} label="PIPELINE HEALTH" accent="#22C55E" />
            <HealthBar
              label="CONFLICTS"
              value={props.conflicts.length}
              threshold={3}
              hint={props.conflicts.length ? "manual review required" : "no open conflicts"}
            />
            <HealthBar
              label="ACTION PLANS"
              value={props.plans.length}
              threshold={10}
              hint={props.plans.length ? "red-team output ready" : "run Red Team to generate"}
            />
            <HealthBar
              label="GHOSTS"
              value={props.stakeholders.filter((s) => s.path?.toLowerCase().includes("ghost")).length}
              threshold={10}
              hint="cold-start placeholders"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div
            className="rounded-lg p-5 flex flex-col gap-3"
            style={{ background: "#111827", border: "1px solid #2A3650" }}
          >
            <SectionHeader icon={Network} label="CONFLICTS" accent="#F59E0B" />
            {props.conflicts.length ? (
              <div className="flex flex-col gap-2">
                {props.conflicts.slice(0, 4).map((c) => (
                  <div
                    key={c.path}
                    className="px-3 py-2.5 rounded-md"
                    style={{ background: "#1A2035", border: "1px solid #1E2A3E" }}
                  >
                    <p className="font-mono font-semibold text-xs" style={{ color: "#F59E0B" }}>
                      {c.path}
                    </p>
                    <p
                      className="mt-1 font-sans text-xs"
                      style={{ color: "#8892A8", lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 72, overflow: "hidden" }}
                    >
                      {c.content.slice(0, 280)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No conflicts" body="Pipeline is green." />
            )}
          </div>

          <div
            className="rounded-lg p-5 flex flex-col gap-3"
            style={{ background: "#111827", border: "1px solid #2A3650" }}
          >
            <SectionHeader icon={Compass} label="ACTION PLANS" accent="#3B82F6" />
            {props.plans.length ? (
              <div className="flex flex-col gap-2">
                {props.plans.slice(0, 4).map((p) => (
                  <div
                    key={p.path}
                    className="px-3 py-2.5 rounded-md"
                    style={{ background: "#1A2035", border: "1px solid #1E2A3E" }}
                  >
                    <p className="font-mono font-semibold text-xs" style={{ color: "#3B82F6" }}>
                      {p.path}
                    </p>
                    <p
                      className="mt-1 font-sans text-xs"
                      style={{ color: "#8892A8", lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 72, overflow: "hidden" }}
                    >
                      {p.content.slice(0, 280)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No plans yet" body="Run the Red Team to generate one." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, label, accent }: { icon: React.ElementType; label: string; accent: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon size={14} color={accent} />
      <span
        className="font-mono font-bold text-xs tracking-widest"
        style={{ color: "#E8ECF4", letterSpacing: "0.12em" }}
      >
        {label}
      </span>
    </div>
  );
}

function MetricCard({ label, value, accent, hint }: { label: string; value: string; accent: string; hint: string }) {
  return (
    <div
      className="rounded-lg px-5 py-4 flex flex-col gap-2"
      style={{ background: "#111827", border: "1px solid #2A3650" }}
    >
      <span className="font-mono font-medium text-xs tracking-widest" style={{ color: "#5A6580", letterSpacing: "0.12em" }}>
        {label}
      </span>
      <span className="font-mono font-bold text-3xl leading-none" style={{ color: accent }}>
        {value}
      </span>
      <span className="font-sans text-xs" style={{ color: "#8892A8" }}>
        {hint}
      </span>
    </div>
  );
}

function HealthBar({ label, value, threshold, hint }: { label: string; value: number; threshold: number; hint: string }) {
  const pct = Math.min(100, (value / threshold) * 100);
  const color = value === 0 ? "#22C55E" : value >= threshold ? "#DC2626" : "#F59E0B";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="font-mono font-medium text-xs" style={{ color: "#8892A8", letterSpacing: "0.1em" }}>
          {label}
        </span>
        <span className="font-mono font-bold text-xs" style={{ color }}>
          {value}
        </span>
      </div>
      <div className="h-1.5 w-full rounded" style={{ background: "#1F2A40" }}>
        <div className="h-full rounded" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-sans text-xs" style={{ color: "#5A6580" }}>
        {hint}
      </span>
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md px-4 py-5 flex flex-col gap-1" style={{ background: "#1A2035", border: "1px dashed #2A3650" }}>
      <span className="font-mono font-semibold text-xs" style={{ color: "#8892A8" }}>
        {title}
      </span>
      <span className="font-sans text-xs" style={{ color: "#5A6580", lineHeight: 1.5 }}>
        {body}
      </span>
    </div>
  );
}

// ─── Stakeholder sidebar for Audit tab ────────────────────────────────────────

function StakeholderSidebar({
  stakeholders,
  selectedId,
  onSelect,
}: {
  stakeholders: Stakeholder[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ width: 280, background: "#111827", borderRight: "1px solid #2A3650", flexShrink: 0 }}
    >
      <div
        className="flex items-center gap-2 px-4"
        style={{ borderBottom: "1px solid #2A3650", height: 44, flexShrink: 0 }}
      >
        <Activity size={14} color="#3B82F6" />
        <span
          className="font-mono font-bold text-xs tracking-widest"
          style={{ color: "#E8ECF4", letterSpacing: "0.12em" }}
        >
          STAKEHOLDERS
        </span>
        <div className="flex-1" />
        <span className="font-mono text-xs" style={{ color: "#5A6580" }}>
          {stakeholders.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
        {stakeholders.length === 0 && (
          <p className="font-mono text-xs px-3 py-3" style={{ color: "#5A6580" }}>
            Vault is empty.
          </p>
        )}
        {stakeholders.map((s) => {
          const active = selectedId === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-md text-left"
              style={{
                background: active ? "#1F2A40" : "transparent",
                border: active ? "1px solid #2A3650" : "1px solid transparent",
              }}
            >
              <div
                className="flex items-center justify-center flex-shrink-0 font-mono font-bold text-xs"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: (s.type ?? "").toLowerCase() === "system" ? 6 : "50%",
                  background: "#1F2A40",
                  color: "#E8ECF4",
                  border: `1.5px solid ${typeColor(s.type)}`,
                }}
              >
                {initialsOf(s.name)}
              </div>
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="font-mono font-semibold text-xs truncate" style={{ color: "#E8ECF4" }}>
                  {s.name}
                </span>
                <span className="font-sans text-xs" style={{ color: "#5A6580" }}>
                  {s.type ?? "—"}
                </span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className="font-mono font-bold text-xs" style={{ color: "#F59E0B" }}>
                  {fmtScore(s.influence_score)}
                </span>
                <span className="font-mono text-xs" style={{ color: scoreColor(s.sentiment_vector) }}>
                  {fmtScore(s.sentiment_vector)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function initialsOf(name: string): string {
  const parts = (name ?? "").trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtScore(v?: number | null): string {
  if (v == null || Number.isNaN(v)) return "—";
  return (v * 10).toFixed(1);
}

function scoreColor(v?: number | null): string {
  if (v == null) return "#5A6580";
  if (v >= 0.65) return "#22C55E";
  if (v <= 0.35) return "#EF4444";
  return "#F59E0B";
}

function typeColor(type?: string): string {
  const t = (type ?? "").toLowerCase();
  if (t === "system") return "#3B82F6";
  if (t === "gatekeeper") return "#F59E0B";
  if (t === "agency") return "#22C55E";
  return "#6B7280";
}
