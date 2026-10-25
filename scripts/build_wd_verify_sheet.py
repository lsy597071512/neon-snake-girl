#!/usr/bin/env python3
"""Verification sheet: proposed danceidle names (user confirms/corrects)."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FINAL = ROOT / "tex" / "juese" / "pifu" / "danceidle"


def main() -> None:
    man = json.loads((FINAL / "danceidle_manifest.json").read_text(encoding="utf-8"))
    cells = "\n".join(
        f'<div class="cell"><div class="num">{it["file"].replace("_danceidle", "").replace(".webm", "")}</div>'
        f'<div class="conf {it["confidence"].split("-")[0]}">{it["confidence"]}</div>'
        f'<img loading="lazy" src="../danceidle/{it["poster"]}">'
        f'<div class="src">{it["staging"]} · {it["evidence"]}</div></div>'
        for it in man["items"])
    html = f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<title>舞蹈待机命名核对</title><style>
body{{background:#111;color:#eee;font-family:sans-serif;margin:0;padding:16px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}}
.cell{{background:#222;border-radius:8px;padding:6px;text-align:center}}
.cell img{{width:100%;border-radius:6px}}.num{{font-weight:bold;color:#ffd76a;font-size:20px}}
.conf{{font-size:12px;padding:2px 8px;border-radius:10px;display:inline-block;margin:4px}}
.HIGH{{background:#1d4d1d}}.MED{{background:#4d4517}}.LOW{{background:#4d1d1d}}
.src{{font-size:11px;color:#aaa}}.tip{{background:#243024;padding:10px;border-radius:8px}}</style></head><body>
<h2>舞蹈待机命名核对（13 个）</h2>
<p class="tip">绿色 HIGH 可直接过；黄色 MED 建议看一眼；红色 LOW 必须看。错的回我如 <code>D4=SR02_1</code>（D序号=暂存 clip 号，见每张下标注），我来改。_b 表示同角色第二 take。</p>
<div class="grid">{cells}</div></body></html>"""
    out = FINAL / "new" / "verify_sheet.html"
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    raise SystemExit(main())
