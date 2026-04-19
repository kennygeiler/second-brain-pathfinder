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

async function postJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const api = {
  stakeholders: () => getJson<Stakeholder[]>("/stakeholders"),
  stakeholder: (id: string) =>
    getJson<StakeholderDetail>(`/stakeholders/${encodeURIComponent(id)}`),
  conflicts: () => getJson<Conflict[]>("/conflicts"),
  actionPlans: () => getJson<ActionPlan[]>("/action-plans"),
  graph: () => getJson<GraphSnapshot>("/graph"),
  redTeam: () => postJson<RedTeamResult>("/red-team"),
};
