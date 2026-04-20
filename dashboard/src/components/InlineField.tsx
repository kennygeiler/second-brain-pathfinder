import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Pencil, X } from "lucide-react";

/**
 * A display-until-hovered, editable field with optimistic save + rollback.
 *
 * onSave receives the parsed value (string | number | null) and must return
 * a Promise. If it rejects, the field reverts and shows a red error tooltip.
 *
 * Usage:
 *   <InlineField kind="text"   value={name}        onSave={(v) => api.patch(...)} />
 *   <InlineField kind="number" value={infl * 10}   min={0} max={10} step={0.1}
 *                              onSave={(v) => api.patch(..., { influence_score: v/10 })} />
 *   <InlineField kind="select" value={type}
 *                              options={["Person","Role","Agency","System","Gatekeeper"]}
 *                              onSave={(v) => api.patch(...)} />
 */

type Kind = "text" | "number" | "select";
type Value = string | number | null;

export interface InlineFieldProps {
  value: Value;
  kind: Kind;
  options?: string[];          // for select
  placeholder?: string;
  min?: number;                // for number
  max?: number;
  step?: number;
  display?: (v: Value) => React.ReactNode; // custom display
  onSave: (next: Value) => Promise<unknown>;
  ariaLabel?: string;
}

export default function InlineField({
  value,
  kind,
  options,
  placeholder,
  min,
  max,
  step,
  display,
  onSave,
  ariaLabel,
}: InlineFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Value>(value);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  // Reset draft whenever the parent pushes a new value (e.g. after API refresh).
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = async () => {
    setError(null);
    if (draft === value) {
      setEditing(false);
      return;
    }
    // Local validation for number fields. Server also validates — this just
    // gives immediate feedback without the network round-trip.
    if (kind === "number") {
      const n = typeof draft === "number" ? draft : Number(draft);
      if (!Number.isFinite(n) || (min !== undefined && n < min) || (max !== undefined && n > max)) {
        setError(`must be ${min ?? "−∞"} – ${max ?? "∞"}`);
        setStatus("error");
        return;
      }
    }
    setStatus("saving");
    try {
      await onSave(draft);
      setStatus("idle");
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
      setStatus("error");
      // Revert the draft so the user sees their value restored.
      setDraft(value);
    }
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
    setError(null);
    setStatus("idle");
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  // ─── Read mode ─────────────────────────────────────────────────────────────
  if (!editing) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="group inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left"
        style={{ color: "#E8ECF4" }}
        aria-label={ariaLabel ?? "edit field"}
      >
        <span>
          {display
            ? display(value)
            : value === null || value === ""
              ? <span style={{ color: "#5A6580" }}>{placeholder ?? "—"}</span>
              : String(value)}
        </span>
        <Pencil
          size={11}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
          color="#5A6580"
        />
        {status === "error" && error && (
          <span
            className="font-mono text-[10px] px-1 rounded"
            style={{ background: "#DC262620", color: "#FCA5A5" }}
            title={error}
          >
            !
          </span>
        )}
      </button>
    );
  }

  // ─── Edit mode ─────────────────────────────────────────────────────────────
  const commonInputStyle = {
    background: "#1A2035",
    border: `1px solid ${error ? "#DC2626" : "#3B82F6"}`,
    color: "#E8ECF4",
    borderRadius: 4,
    padding: "4px 8px",
    outline: "none",
    fontFamily: "inherit",
    fontSize: "inherit",
  } as React.CSSProperties;

  return (
    <span className="inline-flex items-center gap-1.5">
      {kind === "select" && options ? (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={(draft as string) ?? ""}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          style={commonInputStyle}
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type={kind === "number" ? "number" : "text"}
          min={min}
          max={max}
          step={step}
          value={draft === null ? "" : String(draft)}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(kind === "number" ? (v === "" ? null : Number(v)) : v);
          }}
          onKeyDown={onKey}
          placeholder={placeholder}
          style={commonInputStyle}
        />
      )}

      <button onClick={() => void commit()} disabled={status === "saving"} title="Save (Enter)">
        {status === "saving"
          ? <Loader2 size={13} className="animate-spin" color="#3B82F6" />
          : <Check size={13} color="#22C55E" />}
      </button>
      <button onClick={cancel} disabled={status === "saving"} title="Cancel (Esc)">
        <X size={13} color="#8892A8" />
      </button>
      {error && (
        <span className="font-mono text-[10px]" style={{ color: "#FCA5A5" }}>
          {error}
        </span>
      )}
    </span>
  );
}
