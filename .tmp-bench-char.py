import json
import re
import time
import urllib.request
from pathlib import Path

env = {}
for line in Path(r"d:/neon-snake-girl/neon-snake-girl/.env.local").read_text(encoding="utf-8").splitlines():
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip()

SYSTEM = (
    "你是锈带纪元角色「苍羽·澪」（冷静克制/责任偏执）。只输出一个 JSON，不要 markdown：\n"
    '{"emotion":"neutral","dialogue":"对白1～2句","inner_thought":"心里话一句","action":"短动作一句",'
    '"type":"dialogue","affection_change":0,"status_changes":[],"trigger_jealousy":[],'
    '"end_conversation":false,"end_reason":"","interrupt_reaction":"tolerate","skin_change":"",'
    '"scene_beat":"节拍","desire_next":"","memory_write":""}\n'
    "禁止统一傲娇口癖。"
)
USER = "澪，今天走廊沙尘大吗？我想和你一起去巡检。"

ALI = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
HS = (env.get("VITE_GPT_GATEWAY_1_BASE") or "https://huoshenai.net").rstrip("/") + "/v1/chat/completions"


def once(url, key, model, max_tokens=720):
    t0 = time.time()
    body = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": USER},
            ],
            "temperature": 0.95,
            "max_tokens": max_tokens,
            "stream": False,
        }
    ).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            raw = r.read().decode("utf-8", "replace")
        ms = int((time.time() - t0) * 1000)
        j = json.loads(raw)
        content = j.get("choices", [{}])[0].get("message", {}).get("content") or ""
        ok_json = False
        dialogue = ""
        thought = ""
        try:
            m = re.search(r"\{[\s\S]*\}", content)
            if m:
                o = json.loads(m.group(0))
                dialogue = str(o.get("dialogue") or "")
                thought = str(o.get("inner_thought") or "")
                ok_json = bool(dialogue and thought and o.get("action"))
        except Exception:
            ok_json = False
        return {
            "ok": True,
            "ms": ms,
            "jsonOk": ok_json,
            "dialogue": dialogue,
            "thought": thought,
            "preview": content.replace("\n", " ")[:180],
        }
    except Exception as e:
        err = getattr(e, "read", lambda: b"")()
        try:
            err = err.decode("utf-8", "replace")[:200]
        except Exception:
            err = str(e)
        return {"ok": False, "ms": int((time.time() - t0) * 1000), "err": err or str(e)}


# probe available character models
try:
    req = urllib.request.Request(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
        headers={"Authorization": "Bearer " + env["VITE_QWEN_API_KEY"]},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        ids = [m["id"] for m in json.loads(r.read().decode()).get("data", [])]
    chars = [i for i in ids if "character" in i.lower()]
    print("character models:", chars)
except Exception as e:
    print("list fail", e)
    chars = []

candidates = [
    ("阿里云", ALI, env["VITE_QWEN_API_KEY"], "qwen-flash"),
    ("阿里云", ALI, env["VITE_QWEN_API_KEY"], "qwen-flash-character"),
    ("阿里云", ALI, env["VITE_QWEN_API_KEY"], "qwen-flash-character-2026-02-26"),
    ("阿里云", ALI, env["VITE_QWEN_API_KEY"], "qwen-plus-character"),
    ("火神", HS, env["VITE_GPT_GATEWAY_1_KEY"], "gpt-5.4-mini"),
]

out = []
for label, url, key, model in candidates:
    print("RUN", label, model, flush=True)
    rows = [once(url, key, model) for _ in range(2)]
    ok = [x for x in rows if x.get("ok")]
    out.append(
        {
            "label": label,
            "model": model,
            "ok": f"{len(ok)}/2",
            "avgMs": int(sum(x["ms"] for x in ok) / len(ok)) if ok else None,
            "jsonOk": sum(1 for x in ok if x.get("jsonOk")),
            "dialogue": ok[0].get("dialogue") if ok else "",
            "thought": ok[0].get("thought") if ok else "",
            "sample": (ok[0].get("preview") if ok else rows[0].get("err")),
        }
    )

print(json.dumps(out, ensure_ascii=False, indent=2))
Path(r"C:/Users/LiSuYan/Desktop/AI中转/bench-flash-char-vs-mini.json").write_text(
    json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
)
