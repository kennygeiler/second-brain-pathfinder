import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, FileText, Search, Users } from "lucide-react";
import type { ActionPlan, Conflict, Stakeholder } from "../api";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PaletteItem =
  | { kind: "stakeholder"; id: string; label: string; sub: string; data: Stakeholder }
  | { kind: "conflict"; id: string; label: string; sub: string; data: Conflict }
  | { kind: "plan"; id: string; label: string; sub: string; data: ActionPlan };

export type PaletteSelection =
  | { kind: "stakeholder"; id: string }
  | { kind: "conflict"; path: string }
  | { kind: "plan"; path: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stakeholders: Stakeholder[];
  conflicts: Conflict[];
  plans: ActionPlan[];
  onSelect: (selection: PaletteSelection) => void;
}

// ─── Fuzzy matcher ────────────────────────────────────────────────────────────
// Small, purpose-built matcher. For a few hundred items, this is plenty — and it
// keeps us out of cmdk/fuse.js dependency hell inside the sandbox.
//
// Scoring rules (higher = better):
//   1000  exact substring match at start
//    700  exact substring match (anywhere)
//    400  all query chars appear in order (subsequence)
//    ±0   no match → filtered out
// Ties broken by shorter label.

function score(query: string, label: string): number {
  if (!query) return 1; // empty query → everything passes with minimal score
  const q = query.toLowerCase();
  const l = label.toLowerCase();
  const idx = l.indexOf(q);
  if (idx === 0) return 1000;
  if (idx > 0) return 700;

  // Subsequence check
  let qi = 0;
  for (let i = 0; i < l.length && qi < q.length; i++) {
    if (l[i] === q[qi]) qi++;
  }
  return qi === q.length ? 400 : 0;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CommandPalette({
  open,
  onOpenChange,
  stakeholders,
  conflicts,
  plans,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Flattened + scored result list the palette renders.
  const results = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [];

    for (const s of stakeholders) {
      const sub = [s.type, typeof s.influence_score === "number" ? `infl ${(s.influence_score * 10).toFixed(1)}` : null]
        .filter(Boolean)
        .join(" · ");
      items.push({ kind: "stakeholder", id: s.id, label: s.name, sub, data: s });
    }
    for (const c of conflicts) {
      const meta = c.metadata as Record<string, unknown>;
      const created = typeof meta.created_at === "string" ? meta.created_at.slice(0, 10) : undefined;
      const name = typeof meta.stakeholder_name === "string" ? meta.stakeholder_name : c.path.split("/").pop() ?? c.path;
      const sub = ["conflict", created].filter(Boolean).join(" · ");
      items.push({ kind: "conflict", id: c.path, label: name, sub, data: c });
    }
    for (const p of plans) {
      const meta = p.metadata as Record<string, unknown>;
      const hotspots = typeof meta.hotspot_count === "number" ? `${meta.hotspot_count} hotspot(s)` : null;
      const generated = typeof meta.generated_at === "string" ? meta.generated_at.slice(0, 10) : null;
      const label = p.path.split("/").pop()?.replace(/\.md$/, "") ?? p.path;
      const sub = ["action plan", generated, hotspots].filter(Boolean).join(" · ");
      items.push({ kind: "plan", id: p.path, label, sub, data: p });
    }

    if (!query.trim()) {
      // Show most-useful defaults: stakeholders first, then conflicts, then plans.
      return items;
    }

    const scored = items
      .map((it) => ({ it, s: Math.max(score(query, it.label), score(query, it.sub) * 0.6) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.it.label.length - b.it.label.length)
      .map((x) => x.it);
    return scored;
  }, [stakeholders, conflicts, plans, query]);

  // Reset cursor + focus when opening; clear query when closed.
  useEffect(() => {
    if (open) {
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    // Defer clearing to avoid a flash of "no results" while the close animation plays.
    const t = setTimeout(() => setQuery(""), 150);
    return () => clearTimeout(t);
  }, [open]);

  // Keep the active row in view while arrow-navigating.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Clamp cursor when the result count changes.
  useEffect(() => {
    if (active >= results.length) setActive(Math.max(0, results.length - 1));
  }, [results.length, active]);

  if (!open) return null;

  const commit = (idx: number) => {
    const item = results[idx];
    if (!item) return;
    if (item.kind === "stakeholder") onSelect({ kind: "stakeholder", id: item.id });
    else if (item.kind === "conflict") onSelect({ kind: "conflict", path: item.data.path });
    else onSelect({ kind: "plan", path: item.data.path });
    onOpenChange(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  // Group results for display while preserving the scored ordering within each group.
  const grouped: { kind: PaletteItem["kind"]; label: string; items: PaletteItem[] }[] = [];
  const pushGroup = (kind: PaletteItem["kind"], label: string) => {
    const items = results.filter((r) => r.kind === kind);
    if (items.length > 0) grouped.push({ kind, label, items });
  };
  pushGroup("stakeholder", "Stakeholders");
  pushGroup("conflict", "Conflicts");
  pushGroup("plan", "Action Plans");

  // Flat index map so arrow keys align with the grouped render.
  const flat: PaletteItem[] = grouped.flatMap((g) => g.items);
  // `results` above is already the flat ordering — we must keep `active` in sync
  // with the grouped render. Rebuild the flat list from grouped to guarantee.

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: "rgba(10, 14, 23, 0.72)", backdropFilter: "blur(4px)", paddingTop: "12vh" }}
      onClick={() => onOpenChange(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="w-full max-w-2xl rounded-xl overflow-hidden shadow-2xl flex flex-col"
        style={{
          background: "#111827",
          border: "1px solid #2A3650",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          maxHeight: "70vh",
        }}
      >
        {/* Search input */}
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{ borderBottom: "1px solid #1E2A3E" }}
        >
          <Search size={16} color="#8892A8" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Search stakeholders, conflicts, plans…"
            className="flex-1 bg-transparent outline-none font-mono text-sm"
            style={{ color: "#E8ECF4" }}
          />
          <kbd
            className="font-mono text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: "#1F2A40", color: "#5A6580", border: "1px solid #2A3650" }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1">
          {flat.length === 0 ? (
            <div
              className="flex items-center justify-center py-12 font-mono text-xs"
              style={{ color: "#5A6580" }}
            >
              No matches. Try a different query.
            </div>
          ) : (
            grouped.map((group) => (
              <PaletteGroup
                key={group.kind}
                label={group.label}
                items={group.items}
                startIndex={flat.indexOf(group.items[0])}
                active={active}
                onHover={setActive}
                onCommit={commit}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-4 px-4 py-2 font-mono text-[10px]"
          style={{ background: "#0E141F", borderTop: "1px solid #1E2A3E", color: "#5A6580" }}
        >
          <FooterHint label="navigate" keys={["↑", "↓"]} />
          <FooterHint label="select" keys={["↵"]} />
          <FooterHint label="close" keys={["esc"]} />
          <span className="ml-auto">{flat.length} result{flat.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Group + row primitives ──────────────────────────────────────────────────

function PaletteGroup({
  label,
  items,
  startIndex,
  active,
  onHover,
  onCommit,
}: {
  label: string;
  items: PaletteItem[];
  startIndex: number;
  active: number;
  onHover: (idx: number) => void;
  onCommit: (idx: number) => void;
}) {
  return (
    <div className="mb-1">
      <div
        className="px-4 py-1.5 font-mono text-[10px] tracking-widest"
        style={{ color: "#5A6580", letterSpacing: "0.18em" }}
      >
        {label.toUpperCase()}
      </div>
      {items.map((item, i) => {
        const idx = startIndex + i;
        const isActive = idx === active;
        return (
          <PaletteRow
            key={`${item.kind}-${item.id}`}
            item={item}
            active={isActive}
            dataIdx={idx}
            onHover={() => onHover(idx)}
            onClick={() => onCommit(idx)}
          />
        );
      })}
    </div>
  );
}

function PaletteRow({
  item,
  active,
  dataIdx,
  onHover,
  onClick,
}: {
  item: PaletteItem;
  active: boolean;
  dataIdx: number;
  onHover: () => void;
  onClick: () => void;
}) {
  const Icon = item.kind === "stakeholder" ? Users : item.kind === "conflict" ? AlertTriangle : FileText;
  const iconColor =
    item.kind === "stakeholder" ? "#3B82F6" : item.kind === "conflict" ? "#EF4444" : "#F59E0B";
  return (
    <div
      data-idx={dataIdx}
      onMouseMove={onHover}
      onClick={onClick}
      className="flex items-center gap-3 px-4 py-2 cursor-pointer"
      style={{
        background: active ? "#1F2A40" : "transparent",
        borderLeft: active ? "2px solid #3B82F6" : "2px solid transparent",
      }}
    >
      <Icon size={14} color={iconColor} />
      <div className="flex-1 min-w-0">
        <div
          className="font-mono text-sm truncate"
          style={{ color: "#E8ECF4" }}
        >
          {item.label}
        </div>
        {item.sub && (
          <div
            className="font-mono text-[11px] truncate"
            style={{ color: "#5A6580" }}
          >
            {item.sub}
          </div>
        )}
      </div>
      {active && <ArrowRight size={12} color="#5A6580" />}
    </div>
  );
}

function FooterHint({ label, keys }: { label: string; keys: string[] }) {
  return (
    <span className="flex items-center gap-1">
      {keys.map((k) => (
        <kbd
          key={k}
          className="px-1 py-0.5 rounded"
          style={{ background: "#1F2A40", border: "1px solid #2A3650", color: "#8892A8" }}
        >
          {k}
        </kbd>
      ))}
      <span>{label}</span>
    </span>
  );
}
