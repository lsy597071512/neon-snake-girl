#!/usr/bin/env python3
"""Build a contact-sheet HTML for labeling 安抚 clips (user opens in browser)."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANFU2 = ROOT / "tex" / "juese" / "pifu" / "anfu2"
ANFU1 = ROOT / "tex" / "juese" / "pifu" / "anfu" / "new" / "_webm_out"

SIGS = [
    ("SR01_2 苍羽·澪", "亚麻金高马尾＋白翼头饰＋青蓝装甲义肢腿"),
    ("SR01_3 苍斩·凛", "短乱银发＋红头带＋黑角械耳＋白械臂腿"),
    ("SR02_1 白楯·芹奈", "灰金长发青绿梢＋科技耳机"),
    ("SR03_1 银绯·玲", "灰白双色长发＋红眼黄线发光＋黑耳机金翼天线"),
    ("SR04_1 焰甲·朱里", "黑高马尾＋橙鳍发夹＋橙灰黑MB-02械臂"),
    ("SR05_1 黄狐·萤", "银白长发＋白机械狐耳＋半面呼吸面罩"),
    ("SSR01_1 夜爪·黑织", "漆黑超长直发＋颈腕青绿义体线"),
    ("SSR02_1 翠翼·铃", "银灰长发＋荧光绿机械翼板＋白义体肢"),
    ("SSR03_1 冰华·雫", "浅紫蓝波浪长发＋白金机械腿"),
    ("SSR04_1 绯尾·椿", "粉红长发＋红绳发带＋黑红义肢＋蝎尾"),
    ("SSR05_1 橙铠·琥珀", "炽橙双马尾＋白铠义肢＋大腿警戒条"),
    ("UR03_1 光轮·天音", "黑长发粉紫内层＋头顶双环光轮＋透明义肢"),
    ("UR04_1 橙兔·美羽", "浅蓝短波波头＋白兔耳＋机甲兔伴宠"),
]
TENT1 = {1: "SSR05_1", 2: "UR04_1", 3: "UR03_1", 4: "SR03_1", 5: "SR01_2",
         6: "SR05_1", 7: "SR04_1", 8: "SSR03_1", 9: "SSR01_1", 10: "SSR02_1",
         11: "SSR04_1", 12: "SR01_3", 13: "SR02_1"}


def main() -> None:
    man = json.loads((ANFU2 / "anfu2_series_manifest.json").read_text(encoding="utf-8"))
    n = len(man["items"])
    cells = "\n".join(
        f'<div class="cell"><div class="num">{i:03d}</div>'
        f'<img loading="lazy" src="anfu_series_{i:03d}.png">'
        f'<div class="src">{man["items"][i-1]["source"][:34]}</div></div>'
        for i in range(1, n + 1))
    b1 = "\n".join(
        f'<div class="cell"><div class="num">idle{i:02d}（暂定{TENT1[i]}）</div>'
        f'<img loading="lazy" src="contact_idle/idle{i:02d}.png"></div>'
        for i in range(1, 14))
    sigs = "\n".join(f"<li><b>{k}</b>：{v}</li>" for k, v in SIGS)
    html = f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<title>安抚系列命名对照</title><style>
body{{background:#111;color:#eee;font-family:sans-serif;margin:0;padding:16px}}
h2{{margin:24px 0 8px}}.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}}
.cell{{background:#222;border-radius:8px;padding:6px;text-align:center}}
.cell img{{width:100%;border-radius:6px}}.num{{font-weight:bold;color:#ffd76a;font-size:18px}}
.src{{font-size:10px;color:#888;word-break:break-all}}ul{{columns:2;line-height:1.9}}
.tip{{background:#243024;padding:10px;border-radius:8px}}</style></head><body>
<h2>一、99 个调教片段（anfu2）——请给出 序号=角色</h2>
<p class="tip">回复格式示例：<code>001=SSR04_1, 002=SSR04_1, …</code>（同角色多个按动作顺排即可，我来编 _1/_2…）。下面是13角色外形速查：</p>
<ul>{sigs}</ul>
<div class="grid">{cells}</div>
<h2>二、13 个待机片段（anfu第一批）——只标“对/错”</h2>
<p class="tip">暂定映射：01琥珀 02美羽 03天音 04玲 05澪 06萤 07朱里 08雫 09黑织 10铃 11椿 12凛 13芹奈。错的告诉我如 <code>idle05=SSR03_1</code>。</p>
<div class="grid">{b1}</div></body></html>"""
    out = ANFU2 / "contact_sheet.html"
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out} ({n} series + 13 idle)")


if __name__ == "__main__":
    raise SystemExit(main())
