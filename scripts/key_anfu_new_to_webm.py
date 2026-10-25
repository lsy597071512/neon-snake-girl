#!/usr/bin/env python3
"""Batch key anfu (comfort-room idle) green-screen mp4s to transparent WebM.

Staging output keeps traceable clip names; final {Stem}_anfu.webm ship names
are assigned after the user confirms the source->character mapping.
Mirrors scripts/key_tiaojiao_new_to_webm.py conventions (safe rembg pipeline,
key auto, VP9 yuva420p CRF 20, QA dir + manifest).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.chroma_key_lib import process_video  # noqa: E402

SRC = Path(r"F:\AI\wudao\单独\调教待机")
STAGE = ROOT / "tex" / "juese" / "pifu" / "anfu" / "new"
OUT = STAGE / "_webm_out"
QA = STAGE / "_key_qa"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="", help="comma-separated clip ids, e.g. 01,05")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--preserve", action="store_true",
                        help="preserve_subject mode: softer keys, min_keep 0.94, lenient spill")
    args = parser.parse_args()

    sources = sorted(SRC.glob("*.mp4"))
    if not sources:
        raise SystemExit(f"no mp4 sources in {SRC}")
    staged = [(f"{i:02d}", p) for i, p in enumerate(sources, 1)]
    selected = {v.strip() for v in args.only.split(",") if v.strip()}
    if selected:
        staged = [(cid, p) for cid, p in staged if cid in selected]
    if not staged:
        raise SystemExit("nothing selected")

    OUT.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)

    from rembg import new_session
    session = new_session("u2net")

    results: list[dict] = []
    for cid, source in staged:
        target = OUT / f"clip{cid}.webm"
        print(f"[{cid}] {source.name} -> {target.name}", flush=True)
        if target.exists() and target.stat().st_size > 80_000 and not args.force:
            results.append({"clip": cid, "source": source.name,
                            "target": target.name, "ok": True, "skipped": True})
            continue
        try:
            result = process_video(source, target, session=session,
                                   qa_dir=QA, qa_tag=f"clip{cid}",
                                   key_color="auto", force=args.force,
                                   preserve_subject=args.preserve)
            result.update({"clip": cid, "source": source.name, "target": target.name})
            results.append(result)
            print(f"  {'OK' if result.get('ok') else 'FAIL'} {result.get('error', '')}", flush=True)
        except Exception as exc:  # noqa: BLE001
            results.append({"clip": cid, "source": source.name,
                            "target": target.name, "ok": False, "error": str(exc)})
            print(f"  ERROR {exc}", flush=True)

    manifest = {"input": str(SRC), "output": str(OUT),
                "results": results,
                "ok": sum(1 for r in results if r.get("ok")),
                "failed": sum(1 for r in results if not r.get("ok"))}
    (OUT / "anfu_scan_manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": manifest["ok"], "failed": manifest["failed"]}, ensure_ascii=False))
    return 0 if manifest["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
