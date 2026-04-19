"""Detect sentiment conflicts and emit reconciliation markdown for the FDE."""
from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path
from typing import Any

from . import vault
from .config import settings

CONFLICT_DELTA_THRESHOLD = 0.5


def _conflict_path(note: vault.StakeholderNote) -> Path:
    conflicts = settings.vault / "conflicts"
    conflicts.mkdir(parents=True, exist_ok=True)
    slug = vault.slugify(note.name)
    return conflicts / f"{slug}-CONFLICT-{date.today().isoformat()}.md"


def _reconciliation_question(name: str, prev: float, new: float) -> str:
    direction = "improved" if new > prev else "deteriorated"
    return (
        f"Sentiment for {name} {direction} from {prev:.2f} to {new:.2f}. "
        "Which signal reflects reality on the ground — the most recent ledger entry or the "
        "previous baseline — and what structural factor drove the shift?"
    )


def check_conflict(
    note: vault.StakeholderNote,
    *,
    previous_sentiment: float,
    new_sentiment: float,
    context: str = "",
) -> Path | None:
    delta = new_sentiment - previous_sentiment
    if abs(delta) <= CONFLICT_DELTA_THRESHOLD:
        return None

    path = _conflict_path(note)
    payload: dict[str, Any] = {
        "stakeholder": note.name,
        "entity_id": note.id,
        "previous_sentiment": previous_sentiment,
        "new_sentiment": new_sentiment,
        "delta": delta,
    }
    body = (
        "---\n"
        f"stakeholder: \"{payload['stakeholder']}\"\n"
        f"entity_id: \"{payload['entity_id']}\"\n"
        f"previous_sentiment: {payload['previous_sentiment']}\n"
        f"new_sentiment: {payload['new_sentiment']}\n"
        f"delta: {payload['delta']:.3f}\n"
        f"created: \"{vault.now_iso()}\"\n"
        "---\n\n"
        f"# Conflict — {note.name}\n\n"
        f"- Previous sentiment: **{previous_sentiment:.2f}**\n"
        f"- New sentiment: **{new_sentiment:.2f}**\n"
        f"- Delta: **{delta:+.2f}** (threshold {CONFLICT_DELTA_THRESHOLD})\n\n"
        "## Reconciliation question\n\n"
        f"{_reconciliation_question(note.name, previous_sentiment, new_sentiment)}\n\n"
        "## Context excerpt\n\n"
        f"> {context.strip() or '_(no context captured)_'}\n"
    )
    path.write_text(body, encoding="utf-8")
    return path


def _cli() -> None:
    parser = argparse.ArgumentParser(description="Compare sentiment and emit conflict markdown.")
    parser.add_argument("--name", required=True, help="Stakeholder display name in vault.")
    parser.add_argument("--new-sentiment", type=float, required=True)
    parser.add_argument("--context", default="")
    args = parser.parse_args()

    note = vault.find_by_name(args.name)
    if not note:
        raise SystemExit(f"No note found for '{args.name}'")
    previous = float(note.data.get("sentiment_vector", 0.5))
    result = check_conflict(
        note,
        previous_sentiment=previous,
        new_sentiment=args.new_sentiment,
        context=args.context,
    )
    if result:
        print(f"Conflict written to {result}")
    else:
        print("Within threshold, no conflict emitted.")


if __name__ == "__main__":
    _cli()
