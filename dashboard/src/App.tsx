import { useEffect, useState } from "react";
import { api } from "./api";
import type { ActionPlan, Conflict, GraphSnapshot, Stakeholder } from "./api";
import { StakeholderCard } from "./components/StakeholderCard";

type LoadState = "idle" | "loading" | "ready" | "error";

export function App() {
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [plans, setPlans] = useState<ActionPlan[]>([]);
  const [graph, setGraph] = useState<GraphSnapshot | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown error");
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-10 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-white">Pathfinder</h1>
          <p className="text-sm text-slate-400">
            FDE second brain · {stakeholders.length} stakeholders ·{" "}
            {graph?.source ?? "offline"}
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="rounded-lg bg-pathfinder-accent/10 px-4 py-2 text-sm font-medium text-pathfinder-accent hover:bg-pathfinder-accent/20"
        >
          Refresh
        </button>
      </header>

      {state === "error" && (
        <p className="rounded-lg bg-red-500/10 p-4 text-sm text-red-300">
          Failed to load: {error}. Is the FastAPI server running on port 8000?
        </p>
      )}

      <section className="mb-10">
        <h2 className="mb-4 text-lg font-medium text-slate-200">Stakeholders</h2>
        {state === "loading" ? (
          <p className="text-sm text-slate-500">Loading vault…</p>
        ) : stakeholders.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {stakeholders.map((item) => (
              <StakeholderCard key={item.id} stakeholder={item} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Vault is empty. Drop a transcription into <code>inbox/</code> and run <code>make
            demo</code>.
          </p>
        )}
      </section>

      <section className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h2 className="mb-3 text-lg font-medium text-slate-200">Conflicts</h2>
          {conflicts.length ? (
            <ul className="space-y-3">
              {conflicts.map((conflict) => (
                <li
                  key={conflict.path}
                  className="rounded-lg bg-pathfinder-surface p-3 ring-1 ring-white/5"
                >
                  <p className="text-sm font-medium text-white">{conflict.path}</p>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-300">
                    {conflict.content.slice(0, 400)}
                  </pre>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No conflicts yet.</p>
          )}
        </div>
        <div>
          <h2 className="mb-3 text-lg font-medium text-slate-200">Action Plans</h2>
          {plans.length ? (
            <ul className="space-y-3">
              {plans.map((plan) => (
                <li
                  key={plan.path}
                  className="rounded-lg bg-pathfinder-surface p-3 ring-1 ring-white/5"
                >
                  <p className="text-sm font-medium text-white">{plan.path}</p>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-slate-300">
                    {plan.content.slice(0, 400)}
                  </pre>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">
              No plans yet. Run the Red Team to generate one.
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-slate-200">Graph</h2>
        <div className="rounded-lg bg-pathfinder-surface p-4 text-xs text-slate-300 ring-1 ring-white/5">
          <p>
            Source: <span className="text-slate-100">{graph?.source ?? "n/a"}</span> · Nodes:{" "}
            <span className="text-slate-100">{graph?.nodes.length ?? 0}</span> · Edges:{" "}
            <span className="text-slate-100">{graph?.edges.length ?? 0}</span>
          </p>
        </div>
      </section>

      <section className="mt-10 rounded-lg border border-dashed border-white/10 p-6 text-sm text-slate-400">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-200">
          Pencil.dev drop zone
        </h3>
        <p className="mt-2">
          Paste exported components into <code>dashboard/src/pencil/</code>. Import them here
          and pass <code>stakeholder.influence_score</code> and{" "}
          <code>stakeholder.sentiment_vector</code> to their radial gauge props.
        </p>
      </section>
    </main>
  );
}
