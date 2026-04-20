import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

interface Props {
  value: string;
  onSave: (content: string) => Promise<unknown>;
  placeholder?: string;
  minHeight?: number;
  debounceMs?: number;
}

/**
 * Private notes editor with debounced autosave.
 *
 * - Typing sets state to "dirty" immediately.
 * - `debounceMs` after the user stops typing, we POST; state becomes "saving".
 * - On success, state becomes "saved" for a brief moment, then back to "idle".
 * - On error, the stale-draft is preserved so the user can retry manually.
 *
 * We intentionally don't do optimistic re-saves on every keystroke — debounce
 * is enough for notes, and it avoids spamming the server.
 */
export default function NotesEditor({
  value,
  onSave,
  placeholder = "Private notes (autosaves)…",
  minHeight = 160,
  debounceMs = 900,
}: Props) {
  const [draft, setDraft] = useState(value);
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  // Sync external value changes (e.g. stakeholder switched) without clobbering
  // an in-flight edit. If the external value shifts, reset the draft.
  useEffect(() => {
    setDraft(value);
    setState("idle");
    setError(null);
  }, [value]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  const scheduleSave = (next: string) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(async () => {
      setState("saving");
      setError(null);
      try {
        await onSave(next);
        setState("saved");
        // Fade "saved" away after 1.2s.
        window.setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 1200);
      } catch (err) {
        setError(err instanceof Error ? err.message : "save failed");
        setState("error");
      }
    }, debounceMs);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span
          className="font-mono text-[10px] tracking-widest"
          style={{ color: "#5A6580", letterSpacing: "0.18em" }}
        >
          PRIVATE NOTES
        </span>
        <StatusBadge state={state} error={error} />
      </div>
      <textarea
        value={draft}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          setState("dirty");
          scheduleSave(next);
        }}
        onBlur={() => {
          // If we have a pending debounce, flush immediately on blur so the
          // user's work is never lost when they tab away.
          if (state === "dirty" && timerRef.current) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
            scheduleSave(draft);
          }
        }}
        placeholder={placeholder}
        style={{
          background: "#1A2035",
          border: "1px solid #2A3650",
          borderRadius: 6,
          padding: "10px 12px",
          color: "#E8ECF4",
          fontFamily: "JetBrains Mono, ui-monospace, monospace",
          fontSize: 13,
          lineHeight: 1.5,
          minHeight,
          resize: "vertical",
          outline: "none",
        }}
      />
    </div>
  );
}

function StatusBadge({ state, error }: { state: SaveState; error: string | null }) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1 font-mono text-[10px]" style={{ color: "#8892A8" }}>
        <Loader2 size={10} className="animate-spin" />
        saving…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="flex items-center gap-1 font-mono text-[10px]" style={{ color: "#86EFAC" }}>
        <Check size={10} />
        saved
      </span>
    );
  }
  if (state === "dirty") {
    return (
      <span className="font-mono text-[10px]" style={{ color: "#F59E0B" }}>
        unsaved…
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="font-mono text-[10px]" style={{ color: "#FCA5A5" }} title={error ?? ""}>
        save failed
      </span>
    );
  }
  return null;
}
