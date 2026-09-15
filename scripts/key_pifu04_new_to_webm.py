#!/usr/bin/env python3
"""Project wrapper: shenghuoshizhuang01/new → {stem}_pifu04.webm

Uses generic safe chroma pipeline in chroma_key_lib.py.
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

BASE = ROOT / "tex" / "juese" / "pifu" / "shenghuoshizhuang01"
NEW = BASE / "new"
OUT_DIR = NEW / "_webm_out"
QA_DIR = NEW / "_key_qa"

ASSET_TO_STEM: dict[str, str] = {
    "Asset-1qvokckx2rt": "SR03_1",
    "Asset-e2bfjqi13lg": "SR03_1",
    "Asset-4m9oy1ed757": "UR03_1",
    "Asset-65xqv90kd27": "SSR01_1",
    "Asset-74dsmn6pcxs": "SSR05_1",
    "Asset-99ndra67667": "SR01_3",
    "Asset-d9v3ye7cj6i": "SR01_2",
    "Asset-fo0farh9s6l": "SSR02_1",
    "Asset-lnjm3mjj5of": "SR04_1",
    "Asset-wzlz8uhmov8": "SSR04_1",
    "Asset-x2vkmvtm2sb": "SR02_1",
    "Asset-szv8kkqyvlp": "SSR03_1",  # 冰华·雫
}

STEM_NAME = {
    "SR01_2": "苍羽·澪",
    "SR01_3": "苍斩·凛",
    "SR02_1": "白楯·芹奈",
    "SR03_1": "银绯·玲",
    "SR04_1": "焰甲·朱里",
    "SR05_1": "黄狐·萤",
    "SSR01_1": "夜爪·黑织",
    "SSR02_1": "翠翼·铃",
    "SSR03_1": "冰华·雫",
    "SSR04_1": "绯尾·椿",
    "SSR05_1": "橙铠·琥珀",
    "UR03_1": "光轮·天音",
    "UR04_1": "橙兔·美羽",
}


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

    planned: list[tuple[str, str]] = []
    seen: set[str] = set()
    for asset, stem in ASSET_TO_STEM.items():
        if only and stem not in only:
            continue
        if stem in seen:
            print(f"[SKIP DUP] {asset} -> {stem}", flush=True)
            continue
        seen.add(stem)
        planned.append((asset, stem))

    print("=== identity map ===", flush=True)
    for asset, stem in planned:
        print(f"  {asset}.mp4 -> {stem} {STEM_NAME.get(stem, '')}", flush=True)

    results = []
    for asset, stem in planned:
        mp4 = NEW / f"{asset}.mp4"
        out = OUT_DIR / f"{stem}_pifu04.webm"
        ship = BASE / f"{stem}_pifu04.webm"
        print(f"=== {stem} {STEM_NAME.get(stem, '')} <- {asset} ===", flush=True)
        try:
            r = process_video(
                mp4,
                out,
                session=session,
                qa_dir=QA_DIR,
                qa_tag=stem,
                ship_path=ship,
                key_rgb=key_rgb,
                key_color=args.key_color,
                force=args.force,
            )
            r["asset"] = asset
            r["stem"] = stem
            r["name"] = STEM_NAME.get(stem, stem)
            if r.get("ok"):
                print(f"  SHIP -> {ship.name} ({r.get('detail', '')})", flush=True)
            else:
                print(f"  FAIL {r.get('error', '')}", flush=True)
            results.append(r)
        except Exception as e:
            print(f"  ERROR {e}", flush=True)
            results.append({"stem": stem, "ok": False, "error": str(e)})

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
