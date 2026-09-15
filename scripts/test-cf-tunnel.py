import requests, json
# 模拟手机请求：通过 Cloudflare 隧道访问 PC Ollama，用 32k 模型
url = "https://flashers-nov-chronic-cardiac.trycloudflare.com/v1/chat/completions"
body = {
    "model": "rustbelt-pulse-32k:latest",
    "stream": False,
    "messages": [
        {"role": "system", "content": "你是《锈带纪元》营地角色 · 翠翼·铃（id=pulse）。人格：元气话多、天然撩、19 岁短发少女。回复严格 JSON：{\"emotion\":\"...\",\"dialogue\":\"...\",\"action\":\"...\",\"type\":\"dialogue\"}。"},
        {"role": "user", "content": "少女，告诉我今天大厅发生了什么？"}
    ],
    "keep_alive": -1,
}
r = requests.post(url, json=body, timeout=90, headers={"Authorization": "Bearer ollama"})
print("HTTP", r.status_code, flush=True)
print("model:", r.json().get("model"), flush=True)
print("---REPLY---", flush=True)
content = r.json()["choices"][0]["message"]["content"]
with open("f:/_cf_reply.txt", "w", encoding="utf-8") as f:
    f.write(content)
print(content.encode("utf-8").decode("utf-8"), flush=True)
print("---END---", flush=True)
