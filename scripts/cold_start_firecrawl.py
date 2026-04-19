"""Firecrawl-powered cold start: scrape public sources and seed Obsidian ghosts."""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts._ghost_nodes import ghost_nodes_from_text  # noqa: E402
from services.api.config import settings  # noqa: E402


def firecrawl_scrape(url: str) -> str:
    """Call Firecrawl /v1/scrape; returns markdown/text content."""
    if not settings.firecrawl_api_key:
        raise RuntimeError("FIRECRAWL_API_KEY is required for cold start scraping.")
    endpoint = f"{settings.firecrawl_base_url.rstrip('/')}/v1/scrape"
    headers = {
        "Authorization": f"Bearer {settings.firecrawl_api_key}",
        "Content-Type": "application/json",
    }
    payload = {"url": url, "formats": ["markdown"]}
    with httpx.Client(timeout=60.0) as client:
        response = client.post(endpoint, headers=headers, json=payload)
    response.raise_for_status()
    data = response.json()
    content = data.get("data") or {}
    return content.get("markdown") or content.get("content") or ""


def _urls_from_env() -> list[str]:
    raw = settings.nyc_dot_seed_urls or ""
    return [u.strip() for u in raw.split(",") if u.strip()]


def run(urls: list[str] | None = None) -> dict[str, object]:
    targets = urls or _urls_from_env()
    if not targets:
        raise RuntimeError(
            "No URLs provided. Pass --url or set NYC_DOT_SEED_URLS in .env."
        )

    crawl_run_id = f"firecrawl-{uuid.uuid4()}"
    all_created: list[dict[str, object]] = []
    for url in targets:
        try:
            text = firecrawl_scrape(url)
        except Exception as exc:
            print(f"skip {url}: {exc}", file=sys.stderr)
            continue
        if not text.strip():
            continue
        created = ghost_nodes_from_text(
            text,
            source_type="public_record",
            source_id=f"{crawl_run_id}::{url}",
        )
        all_created.extend(created)

    return {
        "crawl_run_id": crawl_run_id,
        "urls": targets,
        "ghost_nodes": all_created,
    }


def _cli() -> None:
    parser = argparse.ArgumentParser(description="Cold-start ghost node seeding via Firecrawl.")
    parser.add_argument(
        "--url",
        action="append",
        help="URL to scrape. Can be repeated; falls back to NYC_DOT_SEED_URLS env.",
    )
    args = parser.parse_args()
    result = run(args.url)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    _cli()
