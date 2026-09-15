#!/usr/bin/env python3
"""Rename tiaojiao clips: designated default -> {stem}_tiaojiao.(webm|mp4), related -> _1,_2…

Also re-ID mislabeled clips:
  SSR05_1_tiaojiao_4/5 -> SR04_1 (黑马尾+橙睡衣+MB-02)
  UR03_1_tiaojiao_4    -> SSR02_1 (银发绿翼)
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "tex" / "juese" / "pifu" / "tiaojiao"
EXTS = [".webm", ".mp4"]

DEFAULT_SRC = {
    "SR01_2": "SR01_2_tiaojiao_2",
    "SR01_3": "SR01_3_tiaojiao_2",
    "SR02_1": "SR02_1_tiaojiao_1",
    "SR03_1": "SR03_1_tiaojiao_1",
    "SR04_1": "SR04_1_tiaojiao_1",
    "SR05_1": "SR05_1_tiaojiao_1",
    "SSR01_1": "SSR01_1_tiaojiao_3",
    "SSR02_1": "UR03_1_tiaojiao_4",  # misnamed; content = 翠翼·铃
    "SSR03_1": "SSR03_1_tiaojiao_1",
    "SSR04_1": "SSR04_1_tiaojiao_2",
    "SSR05_1": "SSR05_1_tiaojiao_3",
    "UR03_1": "UR03_1_tiaojiao_1",
    "UR04_1": "UR04_1_tiaojiao_3",
}

REID = {
    "SSR05_1_tiaojiao_4": "SR04_1",
    "SSR05_1_tiaojiao_5": "SR04_1",
    "UR03_1_tiaojiao_4": "SSR02_1",
}

STEMS = list(DEFAULT_SRC.keys())


def parse_key(name: str) -> tuple[str | None, int | None]:
    m = re.match(r"^(.+)_tiaojiao(?:_(\d+))?$", name)
    if not m:
        return None, None
    return m.group(1), int(m.group(2)) if m.group(2) else 0


def main() -> int:
    report: dict = {"reid": {}, "plan": {}, "final": {}}

    for ext in EXTS:
        files = sorted(ROOT.glob(f"*_tiaojiao*{ext}"))
        items: list[dict] = []
        for p in files:
            base = p.stem
            stem, n = parse_key(base)
            if stem is None or n is None:
                print("skip", p.name)
                continue
            new_stem = REID.get(base, stem)
            if base in REID:
                report["reid"].setdefault(ext, []).append({"from": base, "to_stem": new_stem})
            items.append(
                {
                    "path": p,
                    "base": base,
                    "stem": new_stem,
                    "sort_n": n,
                }
            )

        by_stem: dict[str, list] = {s: [] for s in STEMS}
        for it in items:
            by_stem.setdefault(it["stem"], []).append(it)

        plan: list[tuple[Path, str]] = []
        for stem in STEMS:
            group = by_stem.get(stem, [])
            if not group:
                print(f"[WARN] no files for {stem}{ext}")
                continue
            def_base = DEFAULT_SRC[stem]
            default_item = next((g for g in group if g["base"] == def_base), None)
            if default_item is None:
                print(f"[WARN] default {def_base} missing for {stem}{ext}; using lowest n")
                default_item = sorted(group, key=lambda g: g["sort_n"])[0]
            related = sorted(
                [g for g in group if g is not default_item],
                key=lambda g: (g["sort_n"], g["base"]),
            )
            plan.append((default_item["path"], f"{stem}_tiaojiao{ext}"))
            for i, g in enumerate(related, start=1):
                plan.append((g["path"], f"{stem}_tiaojiao_{i}{ext}"))

        report["plan"][ext] = [{"from": a.name, "to": b} for a, b in plan]

        tag = ext.lstrip(".")
        tmp_pairs: list[tuple[Path, Path]] = []
        for i, (src, dst_name) in enumerate(plan):
            if src.name == dst_name:
                continue
            tmp = ROOT / f"__tmp_tj_{tag}_{i:03d}_{dst_name}"
            print(f"TMP{ext} {src.name} -> {tmp.name}")
            src.rename(tmp)
            tmp_pairs.append((tmp, ROOT / dst_name))
        for tmp, dst in tmp_pairs:
            if dst.exists():
                raise SystemExit(f"collision {dst}")
            print(f"FIN{ext} {tmp.name} -> {dst.name}")
            tmp.rename(dst)

        final: dict = {}
        for stem in STEMS:
            d = ROOT / f"{stem}_tiaojiao{ext}"
            secs = sorted(
                ROOT.glob(f"{stem}_tiaojiao_*{ext}"),
                key=lambda p: int(re.search(r"_tiaojiao_(\d+)", p.stem).group(1)),
            )
            final[stem] = {
                "default": d.exists(),
                "secondaries": [p.name for p in secs],
                "secondaryCount": len(secs),
            }
            print(f"{stem}{ext}: default={d.exists()} +{len(secs)} {[p.name for p in secs]}")
        report["final"][ext] = final

    out = ROOT / "_qa" / "tiaojiao_rename_v2_report.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print("REPORT", out)
    print("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
