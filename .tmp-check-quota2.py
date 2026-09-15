# -*- coding: utf-8 -*-
import json
import urllib.error
import urllib.request

KEY = "sk-4cbf0e9372624a2d90a07b725cfd6a57"
H = {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"}

# Try free-quota style endpoints
extra = [
    "https://dashscope.aliyuncs.com/compatible-mode/v1/models/quota",
    "https://dashscope.aliyuncs.com/api/v1/free-quota",
    "https://dashscope.aliyuncs.com/api/v1/free_quota",
    "https://dashscope.aliyuncs.com/api/v1/billing/balance",
]
for url in extra:
    try:
        req = urllib.request.Request(url, headers=H, method="GET")
        with urllib.request.urlopen(req, timeout=12) as r:
            print("OK", r.status, url)
            print(r.read().decode("utf-8", "replace")[:800])
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, url, e.read().decode("utf-8", "replace")[:250])
    except Exception as e:
        print("ERR", url, e)

# Paginate quotas for character / plus related
print("\n=== quotas filter character/plus/flash ===")
page = 1
hits = []
while page <= 30:
    url = f"https://dashscope.aliyuncs.com/api/v1/quotas?page_no={page}&page_size=50"
    req = urllib.request.Request(url, headers=H, method="GET")
    with urllib.request.urlopen(req, timeout=15) as r:
        data = json.loads(r.read().decode("utf-8"))
    out = data.get("output") or {}
    quotas = out.get("quotas") or []
    total = out.get("total") or 0
    for q in quotas:
        mid = (q.get("model") or "").lower()
        if any(k in mid for k in ("character", "plus", "flash", "qwen-max", "qwen-plus")):
            hits.append(q)
    if page * 50 >= total or not quotas:
        break
    page += 1

print("pages scanned", page, "total", total if "total" in dir() else "?")
# de-dupe print character-related first
for q in hits:
    mid = q.get("model")
    if "character" in (mid or "").lower() or mid in (
        "qwen-plus",
        "qwen-plus-character",
        "qwen-flash",
        "qwen-flash-character",
        "qwen-flash-character-2026-02-26",
        "qwen-max",
    ):
        print(json.dumps(q, ensure_ascii=False))

print("\n=== all character* ===")
for q in hits:
    if "character" in (q.get("model") or "").lower():
        print(json.dumps(q, ensure_ascii=False))

print("\nhit count", len(hits))
