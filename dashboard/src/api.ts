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

export type GraphSnapshot = {
  source: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<{ source: string; target: string; type: string }>;
};

const BASE = "/api";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export const api = {
  stakeholders: () => getJson<Stakeholder[]>("/stakeholders"),
  stakeholder: (id: string) =>
    getJson<{ id: string; name: string; metadata: Record<string, unknown>; content: string }>(
      `/stakeholders/${encodeURIComponent(id)}`,
    ),
  conflicts: () => getJson<Conflict[]>("/conflicts"),
  actionPlans: () => getJson<ActionPlan[]>("/action-plans"),
  graph: () => getJson<GraphSnapshot>("/graph"),
};
