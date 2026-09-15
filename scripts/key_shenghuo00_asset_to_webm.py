"""Convert shenghuofuzhuang00 Asset-*.mp4 (greenscreen idle) → {Stem}_shenghuo00.webm.

Background corners are dark/mint green (~0,155,60), not pure #00b140 → default green_dom.
Do not use aggressive colorkey 0.35/0.08 (eats clothes/props).

Usage:
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe -u scripts/key_shenghuo00_asset_to_webm.py --stem all --force
  ... --stem SR01_2,UR04_1 --force --mode safe
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(ROOT / "scripts"))

from chroma_key_gs_video_webm import FFMPEG, gs_mp4_to_webm, verify_has_alpha  # noqa: E402
from key_huanzhuang_h3_to_webm import (  # noqa: E402
    HUANZHUANG_SAFE_VF,
    auto_dual_key_vf,
    encode_green_dom_webm,
)

SRC_DIR = ROOT / "tex" / "juese" / "pifu" / "shenghuofuzhuang00"
QA_DIR = SRC_DIR / "_webm_qa"

# Asset-*.mp4 → game stem (visual ID 2026-09-12)
ASSET_TO_STEM: dict[str, str] = {
    "Asset-1t7rememqje": "SR01_2",  # 苍羽·澪 — ash blonde ponytail + silver wing plates
    "Asset-ormhcb51n99": "SR01_3",  # 苍斩·凛 — lavender hair, violet eyes
    "Asset-r3w9v6lfk2m": "SR02_1",  # 白楯·芹奈 — cyan headphones
    "Asset-ye3321ou7l": "SR03_1",  # 银绯·玲 — silver hair, crimson eyes, heart chain
    "Asset-08rr7azv6ulf": "SSR04_1",  # 绯尾·椿 — pink twin tails + heart motifs
    "Asset-ra4p1jx77": "SR05_1",  # 黄狐·萤 — white hair + fox ears
    "Asset-w35p7vw1ycj": "SSR02_1",  # 翠翼·铃 — green butterfly / wing accents
    "Asset-9fgujb5sp9": "SSR03_1",  # 冰华·雫 — lavender mess + white/black cyber limbs
    "Asset-9ueq0fkd1h": "SSR05_1",  # 橙铠·琥珀 — orange ponytail + white scrunchie
    "Asset-edd9wvwiv3t": "UR03_1",  # 光轮·天音 — black + pink underlayer
    "Asset-e7g7f655c7l": "UR04_1",  # 橙兔·美羽 — bunny ears + robot bunny
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

# dark/mint matte + green clothing accents → prefer green_dom
DEFAULT_GREEN_DOM = set(ASSET_TO_STEM.values())


def mid_preview(webm: Path, png: Path) -> None:
    subprocess.run(
        [FFMPEG, "-y", "-ss", "1.5", "-i", str(webm), "-frames:v", "1", "-update", "1", str(png)],
        check=True,
        capture_output=True,
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--stem", default="all", help="all | SR01_2,UR04_1 | Asset-xxx")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--crf", type=int, default=28)
    ap.add_argument("--mode", default="auto", choices=["auto", "safe", "dual", "green_dom"])
    args = ap.parse_args()

    # invert stem → asset
    stem_to_asset = {v: k for k, v in ASSET_TO_STEM.items()}

    if args.stem == "all":
        stems = list(ASSET_TO_STEM.values())
    else:
        raw = [s.strip() for s in args.stem.split(",") if s.strip()]
        stems = []
        for s in raw:
            if s in ASSET_TO_STEM:
                stems.append(ASSET_TO_STEM[s])
            elif s.startswith("Asset-") and s in ASSET_TO_STEM:
                stems.append(ASSET_TO_STEM[s])
            else:
                stems.append(s)

    QA_DIR.mkdir(parents=True, exist_ok=True)
    results = []

    for stem in stems:
        name = STEM_NAME.get(stem, stem)
        asset = stem_to_asset.get(stem)
        row = {"stem": stem, "name": name, "ok": False}
        if not asset:
            row["error"] = "no Asset mp4 mapped (missing plate)"
            print(f"[MISS map] {stem} {name}", flush=True)
            results.append(row)
            continue
        src = SRC_DIR / f"{asset}.mp4"
        out = SRC_DIR / f"{stem}_shenghuo00.webm"
        row["src"] = str(src)
        row["out"] = str(out)
        row["asset"] = asset
        if not src.exists():
            row["error"] = "missing mp4"
            print(f"[MISS] {stem} {name}: {src.name}", flush=True)
            results.append(row)
            continue
        if out.exists() and out.stat().st_size > 50_000 and not args.force:
            print(f"[SKIP] {stem} {name} webm exists", flush=True)
            row["ok"] = True
            row["skipped"] = True
            results.append(row)
            continue

        mode = args.mode
        if mode == "auto":
            mode = "green_dom" if stem in DEFAULT_GREEN_DOM else "safe"

        print(f"=== {stem} {name} ({asset}.mp4 {src.stat().st_size // 1024} KB) mode={mode} ===", flush=True)
        try:
            if mode == "green_dom":
                encode_green_dom_webm(src, out, fps=24.0, crf=args.crf)
            elif mode == "dual":
                gs_mp4_to_webm(src, out, fps=24.0, crf=args.crf, vf=auto_dual_key_vf(src))
            else:
                gs_mp4_to_webm(src, out, fps=24.0, crf=args.crf, vf=HUANZHUANG_SAFE_VF)
            if not verify_has_alpha(out):
                raise RuntimeError("webm missing alpha")
            prev = QA_DIR / f"{stem}_preview.png"
            mid_preview(out, prev)
            row["ok"] = True
            row["mode"] = mode
            row["preview"] = str(prev)
            row["bytes"] = out.stat().st_size
            print(f"[OK] {out.name} ({out.stat().st_size // 1024} KB)", flush=True)
        except Exception as e:
            row["error"] = str(e)
            print(f"[FAIL] {stem}: {e}", flush=True)
        results.append(row)

    summary = {
        "ok": [r["stem"] for r in results if r.get("ok")],
        "fail": [r["stem"] for r in results if not r.get("ok")],
        "missing_roster": [s for s in STEM_NAME if s not in ASSET_TO_STEM.values()],
        "rows": results,
    }
    (QA_DIR / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print("=== summary ===", flush=True)
    print(json.dumps({"ok": summary["ok"], "fail": summary["fail"], "missing_roster": summary["missing_roster"]}, ensure_ascii=False), flush=True)
    return 0 if not summary["fail"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
