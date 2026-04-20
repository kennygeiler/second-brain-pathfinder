export type Stakeholder = {
  id: string;
  name: string;
  type?: string;
  influence_score?: number;
  sentiment_vector?: number;
  confidence_score?: number;
  technical_blockers?: string[];
  path?: string;
};

export type Conflict = {
  path: string;
  metadata: Record<string, unknown>;
  content: string;
};

export type ActionPlan = Conflict;

export type SourceLineage = {
  type?: string;
  id?: string;
  timestamp?: string;
  note?: string;
};

export type StakeholderDetail = {
  id: string;
  name: string;
  metadata: Record<string, unknown> & {
    type?: string;
    influence_score?: number;
    sentiment_vector?: number;
    confidence_score?: number;
    technical_blockers?: string[];
    source_lineage?: SourceLineage[];
    last_updated?: string;
    ghost?: boolean;
  };
  content: string;
};

export type GraphNode = {
  id: string;
  name?: string;
  type?: string;
  influence?: number;
  sentiment?: number;
  [key: string]: unknown;
};

export type GraphEdge = {
  source: string;
  target: string;
  type: string;
  weight?: number;
  [key: string]: unknown;
};

export type GraphSnapshot = {
  source: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type ExtractedEntity = {
  name: string;
  type: string;
  role?: string | null;
  agency?: string | null;
  blockers: string[];
  sentiment: number;    // 0-1
  influence: number;    // 0-1
};

export type LedgerPayload = {
  transcription: string;
  source_id?: string | null;
  source_type?: string;
  timestamp?: string | null;
  meeting_id?: string | null;
  participants?: string[];
  location?: string | null;
  note?: string | null;
  entities_override?: ExtractedEntity[] | null;
};

export type ConflictPreview = {
  name: string;
  previous_sentiment: number;
  new_sentiment: number;
  delta: number;
  would_trigger: boolean;
};

export type PreviewResponse = {
  entities: ExtractedEntity[];
  overall_sentiment: number;
  confidence: number;
  conflict_previews: ConflictPreview[];
};

export type LedgerResponse = {
  files_touched: string[];
  entities: Array<{
    id: string;
    name: string;
    type?: string;
    sentiment_vector?: number;
    confidence_score?: number;
  }>;
  conflicts: string[];
};

const BASE = "/api";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export type RedTeamResult = {
  hotspots: number;
  plan_path: string | null;
  conflict_detected: boolean;
  narrative_preview: string;
  hotspot_names: string[];
};

async function sendJson<T>(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${path}`, init);
  if (!response.ok) {
    // Surface FastAPI's validation detail if we can decode it
    let detail = `${response.status} ${response.statusText}`;
    try {
      const data = await response.json();
      if (data?.detail) detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      // fall through
    }
    throw new Error(detail);
  }
  // DELETE sometimes returns JSON, sometimes empty — handle both gracefully.
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

const postJson = <T,>(path: string, body?: unknown) => sendJson<T>("POST", path, body);
const patchJson = <T,>(path: string, body: unknown) => sendJson<T>("PATCH", path, body);
const putJson = <T,>(path: string, body: unknown) => sendJson<T>("PUT", path, body);
const deleteJson = <T,>(path: string) => sendJson<T>("DELETE", path);

export type StakeholderPatch = {
  name?: string;
  type?: "Person" | "Role" | "Agency" | "System" | "Gatekeeper";
  role?: string;
  agency?: string;
  influence_score?: number;    // 0..1
  sentiment_vector?: number;   // 0..1
  technical_blockers?: string[];
  ghost?: boolean;
  reports_to?: string;
  department?: string;
  org_unit?: string;
  rank?: string;
};

export type ProgressSummary = {
  as_of: string;
  window_days: number;
  totals: {
    stakeholders: number;
    open_conflicts: number;
    at_risk_hotspots: number;
    open_actions: number;
    overdue_actions: number;
  };
  trends: {
    open_conflicts_delta: number;
    at_risk_hotspots_delta: number;
    stale_contacts_delta: number;
    action_completion_rate: number;
    action_completion_rate_delta: number;
    median_sentiment_shift: number;
  };
  health_score: {
    value: number;
    delta: number;
    components: Record<string, number>;
  };
};

export type ProgressTimelinePoint = { ts: string; value: number };
export type ProgressTimeline = {
  as_of: string;
  window_days: number;
  bucket: "day" | "week";
  series: Record<string, ProgressTimelinePoint[]>;
};

export type StakeholderProgress = {
  stakeholder_id: string;
  name: string;
  window_days: number;
  current: {
    influence: number;
    sentiment: number;
    days_since_contact: number;
    open_conflicts: number;
    open_actions: number;
  };
  delta: {
    sentiment_30d: number;
    influence_90d: number;
    conflicts_30d: number;
  };
  timeline: {
    sentiment: ProgressTimelinePoint[];
    touches: Array<{ ts: string; kind: string; source_id: string }>;
    actions: Array<{ ts: string; status: string; task_id: string }>;
  };
};

export type ActionItem = {
  id: string;
  title: string;
  stakeholder_id?: string;
  system_id?: string;
  priority: "p0" | "p1" | "p2";
  owner?: string;
  due_by?: string;
  status: "todo" | "in_progress" | "done" | "skipped";
  outcome_note?: string;
  source?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at?: string;
};

export type ArchiveResponse = {
  id: string;
  archived_to: string;
};

export type TodayConflictRow = {
  path: string;
  entity_id: string | null;
  stakeholder_name?: unknown;
  created: string;
  preview: string;
};

export type TodayHotspot = {
  id?: string;
  name?: string;
  influence?: number;
  usage?: number;
  sentiment?: number;
  system_name?: string;
  reason?: string;
};

export type TodayStaleRow = {
  id: string;
  name: string;
  type?: string;
  days_since_contact: number;
  last_contact_at: string | null;
  never_contacted?: boolean;
};

export type TodayGhostRow = {
  id: string;
  name: string;
  type?: string;
  influence_score?: number;
};

export type TodayOpenTask = {
  plan_path: string;
  idx: number;
  action: string;
  rationale: string;
  due_by: string;
  priority: string;
  stakeholder_id: string;
  stakeholder_name: string;
};

export type MomentLegendItem = {
  kind: string;
  label: string;
  color: string;
};

export type MomentRow = {
  id: string;
  kind: string;
  color: string;
  at: string;
  day: string;
  label: string;
  detail: string;
  stakeholder_id: string;
  stakeholder_name: string;
  path?: string;
  plan_path?: string;
};

export type MomentsPayload = {
  year: number;
  legend: MomentLegendItem[];
  moments: MomentRow[];
};

export type TodayPayload = {
  stale_days: number;
  last_red_team_at: string | null;
  plan_path: string | null;
  conflicts: TodayConflictRow[];
  at_risk: TodayHotspot[];
  stale: TodayStaleRow[];
  ghost_nodes: TodayGhostRow[];
  open_tasks: TodayOpenTask[];
};

export type ActionPlanTaskPatchBody = {
  path: string;
  idx: number;
  status: "todo" | "done" | "skipped";
};

export type ActionPlanTaskPatchResponse = {
  path: string;
  idx: number;
  status: string;
  tasks: unknown[];
};

export const api = {
  stakeholders: () => getJson<Stakeholder[]>("/stakeholders"),
  stakeholder: (id: string) =>
    getJson<StakeholderDetail>(`/stakeholders/${encodeURIComponent(id)}`),
  conflicts: () => getJson<Conflict[]>("/conflicts"),
  actionPlans: () => getJson<ActionPlan[]>("/action-plans"),
  graph: () => getJson<GraphSnapshot>("/graph"),
  redTeam: () => postJson<RedTeamResult>("/red-team"),
  previewLedger: (payload: LedgerPayload) =>
    postJson<PreviewResponse>("/ledger/preview", payload),
  commitLedger: (payload: LedgerPayload) =>
    postJson<LedgerResponse>("/ledger", payload),
  patchStakeholder: (id: string, patch: StakeholderPatch) =>
    patchJson<StakeholderDetail>(`/stakeholders/${encodeURIComponent(id)}`, patch),
  putStakeholderNotes: (id: string, content: string) =>
    putJson<StakeholderDetail>(`/stakeholders/${encodeURIComponent(id)}/notes`, { content }),
  mergeStakeholder: (sourceId: string, targetId: string) =>
    postJson<StakeholderDetail>(
      `/stakeholders/${encodeURIComponent(sourceId)}/merge`,
      { target_id: targetId },
    ),
  archiveStakeholder: (id: string) =>
    deleteJson<ArchiveResponse>(`/stakeholders/${encodeURIComponent(id)}`),
  today: () => getJson<TodayPayload>("/today"),
  moments: (year?: number) =>
    getJson<MomentsPayload>(year != null ? `/moments?year=${year}` : "/moments"),
  patchActionPlanTask: (body: ActionPlanTaskPatchBody) =>
    patchJson<ActionPlanTaskPatchResponse>("/action-plans/task", body),
  progressSummary: (window = 30) =>
    getJson<ProgressSummary>(`/progress/summary?window=${window}`),
  progressTimeline: (window = 90, bucket: "day" | "week" = "week") =>
    getJson<ProgressTimeline>(`/progress/timeline?window=${window}&bucket=${bucket}`),
  stakeholderProgress: (id: string, window = 180) =>
    getJson<StakeholderProgress>(`/stakeholders/${encodeURIComponent(id)}/progress?window=${window}`),
  actions: (params?: { status?: string; owner?: string; stakeholder_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.owner) q.set("owner", params.owner);
    if (params?.stakeholder_id) q.set("stakeholder_id", params.stakeholder_id);
    const suffix = q.toString();
    return getJson<ActionItem[]>(suffix ? `/actions?${suffix}` : "/actions");
  },
  createAction: (body: Omit<ActionItem, "id" | "created_at" | "updated_at"> & { title: string }) =>
    postJson<ActionItem>("/actions", body),
  patchAction: (id: string, body: Partial<ActionItem>) =>
    patchJson<ActionItem>(`/actions/${encodeURIComponent(id)}`, body),
};
