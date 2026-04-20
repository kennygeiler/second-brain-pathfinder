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
};

export type ArchiveResponse = {
  id: string;
  archived_to: string;
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
};
