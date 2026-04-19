import type { FC } from "react";

type Props = {
  label: string;
  value: number;
  accent?: string;
  size?: number;
};

export const RadialGauge: FC<Props> = ({
  label,
  value,
  accent = "#38bdf8",
  size = 96,
}) => {
  const safe = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * safe;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(148,163,184,0.2)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          fill="currentColor"
          className="text-base font-semibold"
        >
          {safe.toFixed(2)}
        </text>
      </svg>
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
    </div>
  );
};
