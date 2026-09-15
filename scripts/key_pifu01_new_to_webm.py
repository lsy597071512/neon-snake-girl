#!/usr/bin/env python3
"""Project wrapper: pifu/NEW → {stem}_pifu01.webm (+ static png ship).

Uses generic safe chroma pipeline in chroma_key_lib.py.
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

PIFU = ROOT / "tex" / "juese" / "pifu"
NEW = PIFU / "NEW"
OUT_DIR = NEW / "_webm_out"
QA_DIR = NEW / "_key_qa"

# (asset, stem, suffix) — suffix "" = idle primary; "_1" "_2" = 互动 secondary
ASSET_PLAN: list[tuple[str, str, str]] = [
    ("Asset-harnj0idrrm", "SR05_1", ""),  # 黄狐·萤 idle
    ("Asset-7nob2ltvw1x", "SR05_1", "_1"),  # 黄狐·萤 泳池派对互动
]

# Optional static plate per stem (same folder)
STATIC_BY_STEM: dict[str, str] = {
    "SR05_1": "Asset-08gkiet27xta",
}

STEM_NAME = {
    "SR05_1": "黄狐·萤",
}


def ship_static(stem: str, asset: str) -> Path | None:
    src = NEW / f"{asset}.png"
    if not src.exists():
        return None
    dest = PIFU / f"{stem}_pifu01.png"
    if dest.exists():
        bak = dest.with_suffix(".png.bak_before_new")
        if not bak.exists():
            shutil.copy2(dest, bak)
    shutil.copy2(src, dest)
    return dest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--key-color", default="auto")
    ap.add_argument("--key-rgb", default="", help="R,G,B override")
    args = ap.parse_args()
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    key_rgb = None
    if args.key_rgb:
        key_rgb = tuple(int(x) for x in args.key_rgb.split(","))

    from rembg import new_session

    session = new_session("u2net")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    QA_DIR.mkdir(parents=True, exist_ok=True)

    planned = [
        (a, s, suf)
        for a, s, suf in ASSET_PLAN
        if not only or s in only
    ]

    print("=== identity map (泳池派对 pifu01) ===", flush=True)
    for asset, stem, suffix in planned:
        tag = "idle" if not suffix else f"互动{suffix}"
        print(f"  {asset}.mp4 -> {stem}_pifu01{suffix}.webm {STEM_NAME.get(stem, '')} ({tag})", flush=True)

    results = []
    shipped_static: set[str] = set()
    for asset, stem, suffix in planned:
        mp4 = NEW / f"{asset}.mp4"
        out_name = f"{stem}_pifu01{suffix}.webm"
        out = OUT_DIR / out_name
        ship = PIFU / out_name
        qa_tag = f"{stem}{suffix or '_idle'}"
        print(f"=== {stem} {STEM_NAME.get(stem, '')} <- {asset} -> {out_name} ===", flush=True)
        try:
            r = process_video(
                mp4,
                out,
                session=session,
                qa_dir=QA_DIR,
                qa_tag=qa_tag,
                ship_path=ship,
                key_rgb=key_rgb,
                key_color=args.key_color,
                force=args.force,
            )
            static_asset = STATIC_BY_STEM.get(stem)
            if static_asset and stem not in shipped_static:
                png = ship_static(stem, static_asset)
                if png:
                    r["static"] = str(png)
                    shipped_static.add(stem)
                    print(f"  SHIP PNG -> {png.name}", flush=True)
            r["asset"] = asset
            r["stem"] = stem
            r["suffix"] = suffix
            r["name"] = STEM_NAME.get(stem, stem)
            if r.get("ok"):
                print(f"  SHIP WEBM -> {ship.name} ({r.get('detail', '')})", flush=True)
            else:
                print(f"  FAIL {r.get('error', '')}", flush=True)
            results.append(r)
        except Exception as e:
            print(f"  ERROR {e}", flush=True)
            results.append({"stem": stem, "suffix": suffix, "ok": False, "error": str(e)})

    summary = {
        "ok": [r["stem"] for r in results if r.get("ok")],
        "fail": [r["stem"] for r in results if not r.get("ok")],
        "results": results,
    }
    (QA_DIR / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        "SUMMARY",
        json.dumps({"ok": summary["ok"], "fail": summary["fail"]}, ensure_ascii=False),
        flush=True,
    )
    return 0 if not summary["fail"] else 1


if __name__ == "__main__":
    sys.exit(main())
