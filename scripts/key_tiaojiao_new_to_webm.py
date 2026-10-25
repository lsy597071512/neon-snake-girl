#!/usr/bin/env python3
"""Convert the lettered discipline clips in tiaojiao/new to shipped WebM files.

The source folder is intentionally treated as an input staging area. Existing
WebM clips are copied through unchanged; MP4 clips are keyed with the shared
safe chroma pipeline. The letter map is the stable order used by the 13
character roster and is recorded beside the output for auditability.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.chroma_key_lib import process_video  # noqa: E402

NEW = ROOT / "tex" / "juese" / "pifu" / "tiaojiao" / "new"
OUT = ROOT / "tex" / "juese" / "pifu" / "tiaojiao" / "new_webm_crf20_merged"
QA = NEW / "_key_qa"

CHARACTERS = {
    "a": "SR01_2",
    "b": "SR01_3",
    "c": "SR02_1",
    "d": "SR03_1",
    "e": "SR04_1",
    "f": "SR05_1",
    "g": "SSR01_1",
    "h": "SSR02_1",
    "i": "SSR03_1",
    "j": "SSR04_1",
    "k": "SSR05_1",
    "l": "UR03_1",
    "m": "UR04_1",
}


def source_letter(source: Path) -> str:
    return source.stem[0].lower()


def output_name(source: Path) -> str:
    return f"{CHARACTERS[source_letter(source)]}_{source.stem[1:]}.webm"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default="", help="comma-separated letter groups, e.g. c,m")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if not NEW.exists():
        raise SystemExit(f"missing input directory: {NEW}")
    selected = {value.strip().lower() for value in args.only.split(",") if value.strip()}
    unknown = selected - set(CHARACTERS)
    if unknown:
        raise SystemExit(f"unknown letter group(s): {sorted(unknown)}")

    OUT.mkdir(parents=True, exist_ok=True)
    QA.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []
    from rembg import new_session

    session = new_session("u2net")

    sources = sorted(
        p for p in NEW.iterdir()
        if p.is_file() and p.suffix.lower() in {".mp4", ".webm"}
        and source_letter(p) in CHARACTERS
        and (not selected or source_letter(p) in selected)
    )
    if not sources:
        raise SystemExit("no lettered mp4/webm sources found")

    for source in sources:
        target = OUT / output_name(source)
        char = CHARACTERS[source_letter(source)]
        qa_tag = target.stem
        print(f"{source.name} -> {target.name}", flush=True)
        if target.exists() and target.stat().st_size > 80_000 and not args.force:
            results.append({"source": source.name, "target": target.name, "character": char, "ok": True, "skipped": True})
            continue
        try:
            if source.suffix.lower() == ".webm":
                shutil.copy2(source, target)
                result = {"ok": target.stat().st_size > 80_000, "detail": "copied existing WebM"}
            else:
                result = process_video(
                    source,
                    target,
                    session=session,
                    qa_dir=QA,
                    qa_tag=qa_tag,
                    key_color="auto",
                    force=args.force,
                )
            result.update({"source": source.name, "target": target.name, "character": char})
            results.append(result)
            if not result.get("ok"):
                print(f"  FAIL {result.get('error', '')}", flush=True)
        except Exception as exc:
            results.append({"source": source.name, "target": target.name, "character": char, "ok": False, "error": str(exc)})
            print(f"  ERROR {exc}", flush=True)

    manifest = {
        "input": str(NEW),
        "output": str(OUT),
        "character_map": CHARACTERS,
        "results": results,
        "ok": sum(1 for item in results if item.get("ok")),
        "failed": sum(1 for item in results if not item.get("ok")),
    }
    (OUT / "new_scan_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": manifest["ok"], "failed": manifest["failed"], "manifest": str(OUT / 'new_scan_manifest.json')}, ensure_ascii=False))
    return 0 if manifest["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
