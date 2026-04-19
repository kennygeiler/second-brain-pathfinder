"""Convert a folder of council-minute PDFs into Obsidian ghost nodes."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts._ghost_nodes import ghost_nodes_from_text  # noqa: E402


def pdf_to_text(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except Exception as exc:
        raise RuntimeError("pypdf is required; pip install pypdf") from exc
    reader = PdfReader(str(path))
    chunks: list[str] = []
    for page in reader.pages:
        try:
            chunks.append(page.extract_text() or "")
        except Exception:
            continue
    return "\n".join(chunk for chunk in chunks if chunk.strip())


def run(folder: Path) -> dict[str, object]:
    if not folder.exists() or not folder.is_dir():
        raise RuntimeError(f"Folder not found: {folder}")

    results: list[dict[str, object]] = []
    for pdf_path in sorted(folder.glob("*.pdf")):
        text = pdf_to_text(pdf_path)
        if not text.strip():
            continue
        created = ghost_nodes_from_text(
            text,
            source_type="pdf_import",
            source_id=f"pdf::{pdf_path.name}",
        )
        results.append({"pdf": str(pdf_path), "ghost_nodes": created})
    return {"folder": str(folder), "processed": results}


def _cli() -> None:
    parser = argparse.ArgumentParser(description="PDF folder -> Obsidian ghost nodes.")
    parser.add_argument("folder", type=Path, help="Folder of PDFs to import.")
    args = parser.parse_args()
    print(json.dumps(run(args.folder), indent=2))


if __name__ == "__main__":
    _cli()
