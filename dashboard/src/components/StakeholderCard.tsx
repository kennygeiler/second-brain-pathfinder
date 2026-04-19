import type { FC } from "react";
import type { Stakeholder } from "../api";
import { RadialGauge } from "./RadialGauge";

type Props = { stakeholder: Stakeholder };

export const StakeholderCard: FC<Props> = ({ stakeholder }) => {
  const influence = stakeholder.influence_score ?? 0;
  const sentiment = stakeholder.sentiment_vector ?? 0;
  const inertia = influence > 0.6 && sentiment < 0.3;
  return (
    <article className="flex items-center gap-4 rounded-xl bg-pathfinder-surface p-4 ring-1 ring-white/5">
      <div className="flex-1">
        <header className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-white">{stakeholder.name}</h3>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-300">
            {stakeholder.type ?? "Entity"}
          </span>
        </header>
        <p className="mt-1 text-xs text-slate-400">
          Confidence {(stakeholder.confidence_score ?? 0).toFixed(2)}
          {stakeholder.technical_blockers?.length
            ? ` · ${stakeholder.technical_blockers.length} blocker(s)`
            : ""}
        </p>
        {inertia && (
          <p className="mt-2 text-xs font-medium text-pathfinder-warn">
            Institutional Inertia risk
          </p>
        )}
      </div>
      <RadialGauge label="Influence" value={influence} accent="#38bdf8" />
      <RadialGauge
        label="Sentiment"
        value={sentiment}
        accent={sentiment < 0.4 ? "#ef4444" : "#22c55e"}
      />
    </article>
  );
};
