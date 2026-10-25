#!/usr/bin/env python3
"""Key an arbitrary 安抚-series green-screen folder to transparent WebM.

Generalised from key_anfu_new_to_webm.py: takes --src/--out, dedupes by md5,
names staging clips clipNNN by sorted source order (rename to {Stem}_anfu_N
after the character mapping is confirmed).

Usage:
  python scripts/key_anfu_series_to_webm.py --src "F:\\path\\mp4" --out tex/.../anfu2/new/_webm_out \\
      [--preserve] [--only 1,2,3] [--force]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.chroma_key_lib import process_video  # noqa: E402


def md5(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--qa", default="")
    ap.add_argument("--only", default="")
    ap.add_argument("--preserve", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--tag", default="anfu_series")
    args = ap.parse_args()

    src = Path(args.src)
    out = (ROOT / args.out) if not Path(args.out).is_absolute() else Path(args.out)
    qa = (ROOT / args.qa) if args.qa and not Path(args.qa).is_absolute() else (Path(args.qa) if args.qa else out.parent / "_key_qa")
    out.mkdir(parents=True, exist_ok=True)
    qa.mkdir(parents=True, exist_ok=True)

    files = sorted(src.glob("*.mp4"))
    uniq: list[Path] = []
    seen: set[str] = set()
    for f in files:
        d = md5(f)
        if d in seen:
            continue
        seen.add(d)
        uniq.append(f)

    staged = [(i, p) for i, p in enumerate(uniq, 1)]
    want = {int(v) for v in args.only.split(",") if v.strip().isdigit()}
    if want:
        staged = [(i, p) for i, p in staged if i in want]
    if not staged:
        print("nothing selected")
        return 1

    from rembg import new_session
    session = new_session("u2net")

    results: list[dict] = []
    for i, source in staged:
        target = out / f"clip{i:03d}.webm"
        print(f"[{i}] {source.name} -> {target.name}", flush=True)
        if target.exists() and target.stat().st_size > 80_000 and not args.force:
            results.append({"clip": i, "source": source.name, "ok": True, "skipped": True})
            continue
        try:
            r = process_video(source, target, session=session, qa_dir=qa,
                              qa_tag=f"clip{i:03d}", key_color="auto",
                              force=args.force, preserve_subject=args.preserve)
            r.update({"clip": i, "source": source.name, "target": target.name})
            results.append(r)
            print(f"  {'OK' if r.get('ok') else 'FAIL'} {r.get('error', '')} | {r.get('detail', '')}", flush=True)
        except Exception as exc:  # noqa: BLE001
            results.append({"clip": i, "source": source.name, "ok": False, "error": str(exc)})
            print(f"  ERROR {exc}", flush=True)

    manifest_path = out / f"{args.tag}_manifest.json"
    prev = {}
    if manifest_path.exists():
        try:
            prev = {r["clip"]: r for r in json.loads(manifest_path.read_text(encoding="utf-8")).get("results", [])}
        except Exception:  # noqa: BLE001
            prev = {}
    for r in results:
        prev[r["clip"]] = r
    merged = [prev[k] for k in sorted(prev)]
    manifest = {"src": str(src), "out": str(out), "results": merged,
                "ok": sum(1 for r in merged if r.get("ok")),
                "failed": sum(1 for r in merged if not r.get("ok"))}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": manifest["ok"], "failed": manifest["failed"]}, ensure_ascii=False))
    return 0 if manifest["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
