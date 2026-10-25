#!/usr/bin/env python3
"""Contact sheet for wudao dance-idle batch (13 clips) for user verification."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NEW = ROOT / "tex" / "juese" / "pifu" / "danceidle" / "new"

FILES = [
    ("wd00.png", "00001_p80 qppnb · 绿幕", "D1"),
    ("wd01.png", "00001_p84 pkmzm · 绿幕", "D2"),
    ("wd02.png", "00001_p86 lbmln · 绿幕", "D3"),
    ("dark1_1.png", "00002_p81 ucuqn · 黑底已抠像（darkkey）", "D4"),
    ("wd04.png", "00002_p85 gecje · 绿幕", "D5"),
    ("wd05.png", "00002_p85 lnten · 绿幕", "D6"),
    ("wd06.png", "00002_p86 vmpto · 绿幕", "D7"),
    ("wd07.png", "00002_p87 cxcab(1) · 绿幕", "D8"),
    ("dark2_1.png", "00003_p84 nmcaq · 黑底已抠像（darkkey）", "D9"),
    ("wd09.png", "00004_p80 ppuxi · 绿幕", "D10"),
    ("wd10.png", "00004_p81 lxdqq · 绿幕", "D11"),
    ("wd11.png", "00005_p80 yufqa · 绿幕", "D12"),
    ("wd12.png", "00006_p87 fomup · 绿幕", "D13"),
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
        f'<div class="cell"><div class="num">{tag}</div>'
        f'<img loading="lazy" src="_probe/{png}"><div class="src">{desc}</div></div>'
        for png, desc, tag in FILES)
    sigs = "\n".join(f"<li><b>{k}</b>：{v}</li>" for k, v in SIGS)
    html = f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<title>舞蹈待机命名对照</title><style>
body{{background:#111;color:#eee;font-family:sans-serif;margin:0;padding:16px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}}
.cell{{background:#222;border-radius:8px;padding:6px;text-align:center}}
.cell img{{width:100%;border-radius:6px}}.num{{font-weight:bold;color:#ffd76a;font-size:20px}}
.src{{font-size:11px;color:#aaa}}ul{{columns:2;line-height:1.9}}
.tip{{background:#243024;padding:10px;border-radius:8px}}</style></head><body>
<h2>舞蹈待机 13 个片段（D1~D13 · 832×1504 · 5.17s）——请给出 D序号=角色</h2>
<p class="tip">回复如 <code>D1=SR01_2, D2=SSR04_1, …</code>。注意 D4/D9 是黑色平底（非绿幕），抠像方式不同。外形速查：</p>
<ul>{sigs}</ul>
<div class="grid">{cells}</div></body></html>"""
    out = NEW / "contact_sheet.html"
    out.write_text(html, encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    raise SystemExit(main())
