#!/usr/bin/env python3
"""Contact sheet for gongwu staging (13 clips + 14 posters) for user labeling."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NEW = ROOT / "tex" / "juese" / "pifu" / "gongwu" / "new"

FILES = [
    ("gw00.png", "10月11日 (1)(1)_gongwu.webm · 1080×1950 · 9.13s · 已抠像"),
    ("gw01.png", "10月11日 (1)(2)_gongwu.webm · 1080×1950 · 9.13s · 已抠像"),
    ("gw02.png", "10月11日 (1)(3)_gongwu.webm · 1080×1950 · 9.13s · 已抠像"),
    ("gw03.png", "10月11日 (1)(4)_gongwu.webm · 1080×1950 · 9.13s · 已抠像"),
    ("gw04.png", "10月11日 (1)(5)_gongwu.webm · 1080×1950 · 9.13s · 已抠像"),
    ("gw05.png", "10月11日 (1)(6)_gongwu.webm · 1080×1950 · 9.13s · 已抠像"),
    ("gw06.png", "10月11日 (1)(7)_gongwu.webm · 1080×1950 · 9.13s · 已抠像"),
    ("gw07.png", "10月11日 (1)(8)_gongwu.webm · 1080×1950 · 9.13s · 已抠像"),
    ("gw08.png", "10月11日 (1)(9)_gongwu.webm · 1080×1950 · 9.13s · ⚠疑似带深色舞台底，需处理"),
    ("gw09.png", "10月11日 (1)_gongwu.webm · 1080×1950 · 9.13s · 已抠像"),
    ("gw10.png", "1_gongwu.webm · 1080×1950 · 9.13s · 已抠像"),
    ("gw11.png", "YZ…00002_p87…_gongwu.webm · 832×1504 · 7.29s · 青绿幕待抠像"),
    ("gw12.png", "YZ…00003_p84…_gongwu.webm · 832×1504 · 7.29s · 青绿幕待抠像"),
]
SIGS = [
    ("SR01_2 澪", "亚麻金高马尾＋白翼头饰"),
    ("SR01_3 凛", "短乱银发＋红头带＋黑角械耳"),
    ("SR02_1 芹奈", "灰金长发青绿梢＋科技耳机"),
    ("SR03_1 玲", "灰白双色长发＋红眼"),
    ("SR04_1 朱里", "黑高马尾＋橙鳍发夹"),
    ("SR05_1 萤", "银白长发＋白机械狐耳＋半面罩"),
    ("SSR01_1 黑织", "漆黑超长直发＋青绿义体线"),
    ("SSR02_1 铃", "银灰长发＋荧光绿机械翼板"),
    ("SSR03_1 雫", "浅紫蓝波浪长发"),
    ("SSR04_1 椿", "粉红长发＋红绳发带＋蝎尾"),
    ("SSR05_1 琥珀", "炽橙双马尾＋大腿警戒条"),
    ("UR03_1 天音", "黑长发粉紫内层＋头顶双环光轮"),
    ("UR04_1 美羽", "浅蓝短波波头＋白兔耳＋机甲兔"),
]


def main() -> None:
    cells = "\n".join(
        f'<div class="cell"><div class="num">G{i:02d}</div>'
        f'<img loading="lazy" src="contact/{png}"><div class="src">{desc}</div></div>'
        for i, (png, desc) in enumerate(FILES))
    posters = "\n".join(
        f'<div class="cell"><div class="num">P{n}</div>'
        f'<img loading="lazy" src="poster_{n}.png"></div>'
        for n in [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    sigs = "\n".join(f"<li><b>{k}</b>：{v}</li>" for k, v in SIGS)
    html = f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<title>共舞命名对照</title><style>
body{{background:#111;color:#eee;font-family:sans-serif;margin:0;padding:16px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}}
.cell{{background:#222;border-radius:8px;padding:6px;text-align:center}}
.cell img{{width:100%;border-radius:6px}}.num{{font-weight:bold;color:#ffd76a;font-size:20px}}
.src{{font-size:11px;color:#aaa}}ul{{columns:2;line-height:1.9}}
.tip{{background:#243024;padding:10px;border-radius:8px}}</style></head><body>
<h2>共舞 13 个片段（G00~G12）——请给出 G序号=角色</h2>
<p class="tip">回复如 <code>G00=SSR04_1, G01=SR01_2, …</code>。注册要求每人恰好 1 个主循环（secondaryCount 全 0），所以 13 个文件应正好覆盖 13 角色。外形速查：</p>
<ul>{sigs}</ul>
<div class="grid">{cells}</div>
<h2>附：14 张 poster（P1~P14）——多出一张，请指出哪张多余 / 对应关系</h2>
<div class="grid">{posters}</div></body></html>"""
    out = NEW / "contact_sheet.html"
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    raise SystemExit(main())
