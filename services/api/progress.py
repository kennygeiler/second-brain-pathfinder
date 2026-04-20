"""Portfolio progress aggregates and trend helpers."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from . import actions, today as today_mod, vault
from .config import settings


def _parse_ts(raw: Any) -> Optional[datetime]:
    if not raw:
        return None
    try:
        s = str(raw)
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _days_ago(now: datetime, days: int) -> datetime:
    return now - timedelta(days=days)


def _bucket_key(ts: datetime, bucket: str) -> str:
    if bucket == "week":
        iso = ts.isocalendar()
        return f"{iso.year}-W{iso.week:02d}"
    return ts.date().isoformat()


def _seed_buckets(now: datetime, window_days: int, bucket: str) -> list[str]:
    keys: list[str] = []
    if bucket == "week":
        cursor = now - timedelta(days=window_days)
        seen: set[str] = set()
        while cursor <= now:
            k = _bucket_key(cursor, "week")
            if k not in seen:
                seen.add(k)
                keys.append(k)
            cursor += timedelta(days=1)
    else:
        cursor = now - timedelta(days=window_days)
        while cursor <= now:
            keys.append(cursor.date().isoformat())
            cursor += timedelta(days=1)
    return keys


def _lineage_events(window_start: datetime) -> Iterable[tuple[datetime, str, dict[str, Any]]]:
    for note in vault.iter_stakeholder_notes():
        for entry in note.data.get("source_lineage") or []:
            if not isinstance(entry, dict):
                continue
            ts = _parse_ts(entry.get("timestamp"))
            if not ts or ts < window_start:
                continue
            yield ts, note.id, note.data


def summary(window_days: int = 30) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    start = _days_ago(now, window_days)
    prev_start = _days_ago(now, window_days * 2)

    today_now = today_mod.build_today_payload(stale_days=settings.stale_days)

    current_actions = actions.list_actions(settings.vault)
    open_actions = [a for a in current_actions if a.get("status") in {"todo", "in_progress"}]
    overdue_actions = [
        a for a in open_actions
        if _parse_ts(str(a.get("due_by") or "")) and _parse_ts(str(a.get("due_by") or "")) < now
    ]
    done_actions = [a for a in current_actions if a.get("status") == "done"]
    completed_recent = [a for a in done_actions if (_parse_ts(a.get("completed_at")) or datetime.min.replace(tzinfo=timezone.utc)) >= start]
    completed_prev = [
        a for a in done_actions
        if prev_start <= (_parse_ts(a.get("completed_at")) or datetime.min.replace(tzinfo=timezone.utc)) < start
    ]
    total_recent = len([a for a in current_actions if (_parse_ts(a.get("created_at")) or now) >= start])
    total_prev = len([a for a in current_actions if prev_start <= (_parse_ts(a.get("created_at")) or now) < start])
    rate_recent = (len(completed_recent) / total_recent) if total_recent else 0.0
    rate_prev = (len(completed_prev) / total_prev) if total_prev else 0.0

    sentiments: list[float] = []
    for note in vault.iter_stakeholder_notes():
        v = note.data.get("sentiment_vector")
        if isinstance(v, (int, float)):
            sentiments.append(float(v))
    median_sent = sorted(sentiments)[len(sentiments)//2] if sentiments else 0.0

    health = max(
        0,
        min(
            100,
            int(
                100
                - min(30, len(today_now.get("conflicts", [])) * 5)
                - min(25, len(today_now.get("stale", [])) * 2)
                - min(25, len(today_now.get("at_risk", [])) * 4)
                - min(20, len(overdue_actions) * 3)
            ),
        ),
    )

    return {
        "as_of": now.isoformat(timespec="seconds"),
        "window_days": window_days,
        "totals": {
            "stakeholders": len(list(vault.iter_stakeholder_notes())),
            "open_conflicts": len(today_now.get("conflicts", [])),
            "at_risk_hotspots": len(today_now.get("at_risk", [])),
            "open_actions": len(open_actions),
            "overdue_actions": len(overdue_actions),
        },
        "trends": {
            "open_conflicts_delta": 0,
            "at_risk_hotspots_delta": 0,
            "stale_contacts_delta": 0,
            "action_completion_rate": round(rate_recent, 3),
            "action_completion_rate_delta": round(rate_recent - rate_prev, 3),
            "median_sentiment_shift": round(median_sent, 3),
        },
        "health_score": {
            "value": health,
            "delta": 0,
            "components": {
                "conflict_burden": round(min(1.0, len(today_now.get("conflicts", [])) / 10), 3),
                "staleness_burden": round(min(1.0, len(today_now.get("stale", [])) / 10), 3),
                "adoption_friction_burden": round(min(1.0, len(today_now.get("at_risk", [])) / 10), 3),
                "execution_burden": round(min(1.0, len(overdue_actions) / 10), 3),
            },
        },
    }


def timeline(window_days: int = 90, bucket: str = "week") -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    start = _days_ago(now, window_days)
    keys = _seed_buckets(now, window_days, bucket)
    series = {
        "conflicts_open": defaultdict(int),
        "at_risk_hotspots": defaultdict(int),
        "stale_contacts": defaultdict(int),
        "action_completion_rate": defaultdict(float),
    }
    # Use current snapshot for coarse trend baseline.
    today_now = today_mod.build_today_payload(stale_days=settings.stale_days)
    for k in keys:
        series["conflicts_open"][k] = len(today_now.get("conflicts", []))
        series["at_risk_hotspots"][k] = len(today_now.get("at_risk", []))
        series["stale_contacts"][k] = len(today_now.get("stale", []))
        series["action_completion_rate"][k] = 0.0
    done = actions.list_actions(settings.vault, status="done")
    total = actions.list_actions(settings.vault)
    done_by = defaultdict(int)
    total_by = defaultdict(int)
    for a in total:
        ts = _parse_ts(a.get("created_at")) or now
        if ts < start:
            continue
        k = _bucket_key(ts, bucket)
        total_by[k] += 1
    for a in done:
        ts = _parse_ts(a.get("completed_at")) or _parse_ts(a.get("updated_at"))
        if not ts or ts < start:
            continue
        k = _bucket_key(ts, bucket)
        done_by[k] += 1
    for k in keys:
        t = total_by[k]
        series["action_completion_rate"][k] = round((done_by[k] / t), 3) if t else 0.0
    return {
        "as_of": now.isoformat(timespec="seconds"),
        "window_days": window_days,
        "bucket": bucket,
        "series": {
            name: [{"ts": k, "value": values[k]} for k in keys]
            for name, values in series.items()
        },
    }


def stakeholder_progress(stakeholder_id: str, window_days: int = 180) -> Optional[dict[str, Any]]:
    note = vault.find_by_id(stakeholder_id)
    if not note:
        return None
    now = datetime.now(timezone.utc)
    start = _days_ago(now, window_days)
    sentiment_points: list[dict[str, Any]] = []
    touch_points: list[dict[str, Any]] = []
    for entry in note.data.get("source_lineage") or []:
        if not isinstance(entry, dict):
            continue
        ts = _parse_ts(entry.get("timestamp"))
        if not ts or ts < start:
            continue
        kind = str(entry.get("type") or "unknown")
        if kind in today_mod.CONTACT_SOURCE_TYPES:
            touch_points.append(
                {"ts": ts.isoformat(timespec="seconds"), "kind": kind, "source_id": str(entry.get("id") or "")}
            )
        if "sentiment" in entry and isinstance(entry.get("sentiment"), (int, float)):
            sentiment_points.append({"ts": ts.isoformat(timespec="seconds"), "value": float(entry["sentiment"])})
    curr_sent = float(note.data.get("sentiment_vector", 0.5))
    curr_inf = float(note.data.get("influence_score", 0.5))
    last_contact = today_mod._last_contact_at(note)
    days_since = 999 if last_contact is None else max(0, int((now - last_contact).total_seconds() // 86_400))
    stakeholder_actions = actions.list_actions(settings.vault, stakeholder_id=stakeholder_id)
    open_actions = [a for a in stakeholder_actions if a.get("status") in {"todo", "in_progress"}]
    done_actions = [a for a in stakeholder_actions if a.get("status") == "done"]
    return {
        "stakeholder_id": note.id,
        "name": note.name,
        "window_days": window_days,
        "current": {
            "influence": curr_inf,
            "sentiment": curr_sent,
            "days_since_contact": days_since,
            "open_conflicts": 0,
            "open_actions": len(open_actions),
        },
        "delta": {
            "sentiment_30d": 0.0,
            "influence_90d": 0.0,
            "conflicts_30d": 0,
        },
        "timeline": {
            "sentiment": sentiment_points,
            "touches": touch_points,
            "actions": [
                {"ts": str(a.get("updated_at") or ""), "status": str(a.get("status") or ""), "task_id": str(a.get("id") or "")}
                for a in done_actions
            ],
        },
    }
