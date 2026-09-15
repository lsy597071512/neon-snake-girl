# -*- coding: utf-8 -*-
"""Generate frostline voice audition samples (system voices unused by others)."""
from __future__ import annotations

import base64
import json
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEY = (ROOT / ".dashscope_key").read_text(encoding="utf-8").strip()
URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
OUT = ROOT / "tex/audio/_voice_audition/frostline_20260905"
OUT.mkdir(parents=True, exist_ok=True)

TEXT = "指挥官，我好热，我想脱掉衣服，拥抱你"

# 其他角色已占用：Cherry Serena Maia Katerina Vivian Chelsie Mia Seren Momo + 3×VC
# 夜爪人设：孤僻冷漠 / 夜袭刺客 / 可略御姐厚声线、青年女声
CANDIDATES = [
    {
        "id": "A_Bellona",
        "voice": "Bellona",
        "label": "Bellona · 冷锐御姐感",
        "instruction": (
            "请用二十一岁夜袭女刺客的嗓音：偏厚、柔韧有质感，沉稳克制带御姐感；"
            "即使说害羞的话也压着气息、低声、不甜不嗲；青年女声，禁止童声尖亮或沧桑老气。"
        ),
    },
    {
        "id": "B_Stella",
        "voice": "Stella",
        "label": "Stella · 低回疏离",
        "instruction": (
            "请用二十一岁孤僻夜爪少女的嗓音：低回、疏离、句尾不扬；"
            "说亲密话时仍像压抑杀意后的轻声，冷而软，不要撒娇，不要播音腔。"
        ),
    },
    {
        "id": "C_Bella",
        "voice": "Bella",
        "label": "Bella · 柔韧冷感",
        "instruction": (
            "请用明确的青年女性嗓音，带一点御姐柔韧：声线略厚、语速自然偏慢；"
            "像夜里贴耳低语，热意里仍克制，不要甜美卖萌，不要童声。"
        ),
    },
    {
        "id": "D_Nini",
        "voice": "Nini",
        "label": "Nini · 清冷女声",
        "instruction": (
            "请用二十一岁清冷女刺客嗓音：清晰、克制、少起伏；"
            "亲密内容用压低的气声说完，不要娇喘夸张，不要小孩声或尖亮。"
        ),
    },
    {
        "id": "E_Bunny",
        "voice": "Bunny",
        "label": "Bunny · 反差软声（备选）",
        "instruction": (
            "请用青年女声，尽量压低甜度：少上扬、少卖萌，偏安静贴耳；"
            "像危险的人突然示弱，软但不幼，禁止童声和夸张娇喘。"
        ),
    },
    {
        "id": "Z_current_VC",
        "voice": "qwen-tts-vc-yinse_frostline-voice-20260814110226257-292d",
        "label": "当前 yinse 复刻（对照）",
        "instruction": "",
        "model": "qwen3-tts-vc-2026-01-22",
    },
]


def synth(c: dict) -> Path:
    voice = c["voice"]
    instr = c.get("instruction") or ""
    if c.get("model"):
        model = c["model"]
        body = {
            "model": model,
            "input": {
                "text": TEXT,
                "voice": voice,
                "language_type": "Chinese",
            },
        }
    elif instr:
        body = {
            "model": "qwen3-tts-instruct-flash",
            "input": {
                "text": TEXT,
                "voice": voice,
                "language_type": "Chinese",
                "instructions": instr,
                "optimize_instructions": False,
            },
        }
    else:
        body = {
            "model": "qwen3-tts-flash",
            "input": {
                "text": TEXT,
                "voice": voice,
                "language_type": "Chinese",
            },
        }

    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    if data.get("code"):
        raise RuntimeError(f"{c['id']}: {data.get('message') or data}")

    audio = (data.get("output") or {}).get("audio") or {}
    out = OUT / f"{c['id']}_{voice}.wav"
    if audio.get("data"):
        out.write_bytes(base64.b64decode(audio["data"]))
    elif audio.get("url"):
        url = audio["url"]
        if url.startswith("http://"):
            url = "https://" + url[len("http://") :]
        with urllib.request.urlopen(url, timeout=60) as ar:
            out.write_bytes(ar.read())
    else:
        raise RuntimeError(f"{c['id']}: no audio in response")
    return out


results = []
for c in CANDIDATES:
    try:
        path = synth(c)
        print("OK", c["id"], path.name, path.stat().st_size)
        results.append({**c, "file": path.name, "ok": True, "err": ""})
    except Exception as e:
        print("FAIL", c["id"], e)
        results.append({**c, "file": "", "ok": False, "err": str(e)})

cards = []
for r in results:
    if not r["ok"]:
        cards.append(
            f'<article class="card fail"><h2>{r["label"]}</h2>'
            f'<p class="meta">{r["id"]} · {r["voice"]}</p>'
            f'<p class="err">失败：{r["err"]}</p></article>'
        )
        continue
    cards.append(
        f"""
<article class="card">
  <h2>{r['label']}</h2>
  <p class="meta">{r['id']} · voice=<code>{r['voice']}</code></p>
  <audio controls src="{r['file']}"></audio>
  <p class="line">「{TEXT}」</p>
</article>"""
    )

html = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>夜爪·黑织 音色试听</title>
<style>
body {{ margin:0; font-family:"Segoe UI","Microsoft YaHei",sans-serif;
  background:#0b0c10; color:#e8e6e3; padding:20px; }}
h1 {{ font-size:20px; margin:0 0 6px; }}
.sub {{ color:#9a958c; margin:0 0 18px; font-size:13px; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:14px; }}
.card {{ background:#14161d; border:1px solid #2a2e3a; border-radius:12px; padding:14px; }}
.card.fail {{ border-color:#663; }}
.card h2 {{ margin:0 0 6px; font-size:15px; }}
.meta {{ margin:0 0 10px; color:#7ec8e3; font-size:12px; }}
.line {{ margin:10px 0 0; color:#9a958c; font-size:12px; }}
.err {{ color:#e88; font-size:12px; }}
audio {{ width:100%; }}
code {{ color:#e8a87c; }}
</style>
</head>
<body>
<h1>夜爪·黑织 · 换音色试听</h1>
<p class="sub">避开其他角色已用系统音色；含当前 yinse 复刻对照。选中后告诉我编号即可写入 characterVoices。</p>
<div class="grid">
{''.join(cards)}
</div>
</body>
</html>
"""
preview = OUT / "preview.html"
preview.write_text(html, encoding="utf-8")
webbrowser.open(preview.as_uri())
print("preview", preview.as_uri())
print("ok", sum(1 for r in results if r["ok"]), "/", len(results))
