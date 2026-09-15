# -*- coding: utf-8 -*-
import json
import time
import urllib.error
import urllib.request

KEY = "sk-4cbf0e9372624a2d90a07b725cfd6a57"
H = {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"}

print("=== quota/billing probes ===")
urls = [
    "https://dashscope.aliyuncs.com/api/v1/quotas",
    "https://dashscope.aliyuncs.com/api/v1/quota",
    "https://dashscope.aliyuncs.com/api/v1/usage",
    "https://dashscope.aliyuncs.com/api/v1/usages",
    "https://dashscope.aliyuncs.com/api/v1/metering/usage",
    "https://dashscope.aliyuncs.com/api/v1/fees/available",
]
for url in urls:
    try:
        req = urllib.request.Request(url, headers=H, method="GET")
        with urllib.request.urlopen(req, timeout=12) as r:
            body = r.read().decode("utf-8", "replace")
            print("OK", r.status, url)
            print(body[:1000])
            print("---")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:400]
        print("HTTP", e.code, url, body)
    except Exception as e:
        print("ERR", url, type(e).__name__, e)


def call(model: str):
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是苍羽澪。只输出JSON对象，字段："
                    "dialogue,inner_thought,emotion,action,type,affection_change,"
                    "status_changes,trigger_jealousy,end_conversation,skin_change"
                ),
            },
            {"role": "user", "content": "东门沙尘大了，一起去？"},
        ],
        "max_tokens": 300,
        "temperature": 0.9,
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        data=body,
        headers=H,
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode("utf-8"))
        ms = int((time.perf_counter() - t0) * 1000)
        usage = data.get("usage", {})
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
        ok_json = False
        try:
            j = json.loads(content.strip())
            ok_json = "dialogue" in j
        except Exception:
            pass
        return {
            "ok": True,
            "ms": ms,
            "jsonOk": ok_json,
            "usage": usage,
            "sample": content[:140].replace("\n", " "),
        }
    except urllib.error.HTTPError as e:
        return {
            "ok": False,
            "ms": int((time.perf_counter() - t0) * 1000),
            "err": e.read().decode("utf-8", "replace")[:500],
        }


print("\n=== live calls ===")
for m in ["qwen-plus-character", "qwen-flash-character-2026-02-26"]:
    print(m, json.dumps(call(m), ensure_ascii=False))
