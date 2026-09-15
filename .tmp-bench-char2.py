import json
import time
import urllib.request
import re

KEY = "sk-4cbf0e9372624a2d90a07b725cfd6a57"
URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
SYSTEM = """你是锈带纪元构装体「苍羽·澪」。世界观：大崩解后的锈带废土，玩家是指挥官机器人。
身份卡：冷静克制、责任偏执、短句、少感叹。当前营地：零号月台·夜间巡检。天气：沙尘。好感：42。穿搭：默认装甲。
近期记忆：昨晚检修了东门传感器；指挥官常熬夜。
只输出一个 JSON，不要 markdown：
{"emotion":"joy|anger|sadness|surprise|fear|disgust|neutral|thinking","dialogue":"对白1～3句","inner_thought":"心里话一句","action":"短动作神态","type":"dialogue","affection_change":0,"status_changes":[],"trigger_jealousy":[],"end_conversation":false,"skin_change":""}"""
USER = "指挥官说：沙尘又起来了，东门那边要不要一起去看？"
body = json.dumps(
    {
        "model": "qwen-flash-character-2026-02-26",
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": USER},
        ],
        "temperature": 1.0,
        "max_tokens": 520,
    },
    ensure_ascii=False,
).encode("utf-8")


def once():
    req = urllib.request.Request(
        URL,
        data=body,
        headers={"Authorization": "Bearer " + KEY, "Content-Type": "application/json"},
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read().decode("utf-8"))
    ms = int((time.perf_counter() - t0) * 1000)
    content = data["choices"][0]["message"]["content"]
    ok = False
    try:
        j = json.loads(content.strip())
        ok = "dialogue" in j and "inner_thought" in j
    except Exception:
        m = re.search(r"\{[\s\S]*\}", content)
        if m:
            try:
                j = json.loads(m.group(0))
                ok = "dialogue" in j
            except Exception:
                pass
    return ms, ok, content[:160].replace("\n", " ")


for i in range(3):
    ms, ok, s = once()
    print(f"run{i+1}: {ms}ms jsonOk={ok}")
    print(" sample:", s)
