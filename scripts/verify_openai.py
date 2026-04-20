"""Verify that OPENAI_API_KEY is loaded, reachable, and usable by the pipeline.

Static check (always runs):
  - .env is loaded and contains OPENAI_API_KEY
  - services.api.config.settings.openai_api_key picks it up
  - langchain_openai is installed

Live check (requires network + a valid key):
  - One-token round-trip to the configured model (default: gpt-4o-mini)
  - Prints the response content and confirms the extractor will use GPT

Usage:
    python scripts/verify_openai.py           # static + live
    python scripts/verify_openai.py --static  # skip live round-trip
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--static", action="store_true", help="skip the live round-trip")
    args = parser.parse_args()

    from services.api.config import settings

    print("─── Static check ──────────────────────────────")
    key = settings.openai_api_key or ""
    if not key:
        print("  FAIL: OPENAI_API_KEY not loaded. Check .env (must be in project root).")
        return 1
    preview = f"{key[:12]}...{key[-4:]}"
    print(f"  key loaded            : True")
    print(f"  key preview           : {preview}  (len={len(key)})")
    print(f"  model                 : {settings.openai_model}")

    try:
        from langchain_openai import ChatOpenAI  # noqa: F401
        print(f"  langchain_openai      : installed")
    except Exception as exc:
        print(f"  FAIL: langchain_openai not installed ({exc})")
        print("        pip install langchain-openai")
        return 1

    if args.static:
        print("\n  OK (static only — skipped live round-trip)")
        return 0

    print()
    print("─── Live round-trip (1 token) ─────────────────")
    try:
        from langchain_core.messages import HumanMessage
        from langchain_openai import ChatOpenAI

        model = ChatOpenAI(
            model=settings.openai_model,
            api_key=settings.openai_api_key,
            temperature=0,
            max_tokens=5,
            timeout=10,
        )
        response = model.invoke([HumanMessage(content="Reply with exactly: pong")])
        print(f"  response              : {response.content!r}")
        print()
        print("  OK — key is valid, GPT extraction is live.")
        print("  Next: make clean-vault && python scripts/run_demo.py --commit")
        return 0
    except Exception as exc:
        print(f"  FAIL: {type(exc).__name__}: {exc}")
        print()
        print("  Likely causes:")
        print("    - invalid or expired key")
        print("    - network blocked (corporate VPN, firewall)")
        print("    - account has no credits / hit rate limit")
        print("    - model name wrong (check OPENAI_MODEL in .env)")
        return 1


if __name__ == "__main__":
    sys.exit(main())
