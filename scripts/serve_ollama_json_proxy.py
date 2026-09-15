#!/usr/bin/env python3
"""Fast OpenAI-compatible proxy → local Ollama with JSON schema.

Transformers PEFT path was ~10–20 tok/s. Ollama GGUF on RTX PRO 4500 is ~1–2s/turn.
This proxy keeps phone/Cloudflare on :11435 while forcing structured JSON for the game.
"""

from __future__ import annotations

import argparse
import json
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OLLAMA = "http://127.0.0.1:11434"
DEFAULT_MODEL = "remnant-glm4-32b:latest"

JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "dialogue": {"type": "string"},
        "action": {"type": "string"},
        "inner_thought": {"type": "string"},
        "emotion": {"type": "string"},
        "emotion_pose": {"type": "string"},
        "want_continue": {"type": "boolean"},
        "end_conversation": {"type": "boolean"},
        "end_reason": {"type": "string"},
        "interrupt_reaction": {"type": "string"},
        "scene_beat": {"type": "string"},
        "desire_next": {"type": "string"},
        "memory_write": {"type": "string"},
        "world_intent": {"type": "string"},
        "camp_item_action": {"type": "string"},
        "skin_change": {"type": "string"},
    },
    "required": ["dialogue", "action", "inner_thought", "emotion", "want_continue"],
}


def normalize_model(name: str | None) -> str:
    if not name:
        return DEFAULT_MODEL
    n = name.strip().lower()
    if n.startswith("qwen") or "plus-character" in n:
        return DEFAULT_MODEL
    if "remnant" in n or "glm4-32b" in n or "glm-4-32b" in n:
        return DEFAULT_MODEL
    # legacy violet / rustbelt names → Remnant
    if "violet" in n or n.startswith("rustbelt-") or "ashcrow" in n:
        return DEFAULT_MODEL
    return DEFAULT_MODEL


def extract_dialogue_field(text: str) -> str:
    m = re.search(r'"dialogue"\s*:\s*"((?:\\.|[^"\\])*)"', text or "")
    if not m:
        return ""
    try:
        return json.loads(f'"{m.group(1)}"')
    except Exception:
        return m.group(1).replace('\\"', '"').replace("\\n", "\n")


def wrap_plain(text: str) -> dict:
    """模型没吐出合法 JSON 时：整段原文当 dialogue（仍是模型自己的话，不写死台词）。"""
    spoken = re.sub(r"\s+", " ", (text or "").strip())[:400]
    return {
        "dialogue": spoken,
        "action": "",
        "inner_thought": "",
        "emotion": "",
        "emotion_pose": "",
        "want_continue": False,
        "end_conversation": False,
        "end_reason": "",
        "interrupt_reaction": "",
        "scene_beat": "",
        "desire_next": "",
        "memory_write": "",
        "world_intent": "",
        "camp_item_action": "",
        "skin_change": "",
    }


def coerce_game_json(raw: str, user_text: str = "") -> str:
    """只解析/抽取模型输出，绝不注入程序台词。"""
    del user_text  # 保留签名兼容
    raw = (raw or "").strip()

    def finalize(obj: dict) -> str:
        dlg = str(obj.get("dialogue") or "").strip()
        if dlg.startswith("{") and "dialogue" in dlg:
            nested = extract_dialogue_field(dlg)
            if nested:
                dlg = nested
        # 原样保留；空就空，让上层重试/报错，不用死句填
        obj["dialogue"] = dlg
        if "action" in obj and obj["action"] is None:
            obj["action"] = ""
        if "inner_thought" in obj and obj["inner_thought"] is None:
            obj["inner_thought"] = ""
        return json.dumps(obj, ensure_ascii=False)

    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            return finalize(obj)
    except Exception:
        pass
    pulled = extract_dialogue_field(raw)
    if pulled:
        return finalize({"dialogue": pulled, "action": "", "inner_thought": "", "emotion": "", "want_continue": False})
    m = re.search(r"\{[\s\S]*\}", raw)
    if m:
        try:
            obj = json.loads(m.group(0))
            if isinstance(obj, dict):
                return finalize(obj)
        except Exception:
            pass
    return json.dumps(wrap_plain(raw), ensure_ascii=False)


def approx_tokens(messages: list) -> int:
    n = 0
    for m in messages:
        c = m.get("content") or ""
        if isinstance(c, list):
            c = "".join((x.get("text") or "") for x in c if isinstance(x, dict))
        # 中英混合粗估
        n += max(1, len(str(c)) // 2)
    return n


def trim_messages(messages: list, max_tokens_budget: int = 8192) -> list:
    """保留 system + 最后若干轮，避免游戏长人设把 ctx 撑爆。"""
    if approx_tokens(messages) <= max_tokens_budget:
        return messages
    system = [m for m in messages if m.get("role") == "system"]
    rest = [m for m in messages if m.get("role") != "system"]
    while rest and approx_tokens(system + rest) > max_tokens_budget:
        rest.pop(0)
    if approx_tokens(system + rest) > max_tokens_budget and system:
        keep = max_tokens_budget - approx_tokens(rest) - 200
        keep_chars = max(1200, keep * 2)
        s0 = dict(system[0])
        content = str(s0.get("content") or "")
        if len(content) > keep_chars:
            head = content[: keep_chars // 3]
            tail = content[-(keep_chars - len(head)) :]
            s0["content"] = head + "\n…\n" + tail
            system = [s0] + system[1:]
    out = system + rest
    print(f"[PROXY] trimmed messages ~{approx_tokens(messages)} -> ~{approx_tokens(out)} tok")
    return out


def _has_ngram_loop(s: str, n: int = 2, min_repeats: int = 6) -> bool:
    """短 n-gram 连续刷屏（意向意向… / ####）。"""
    if len(s) < n * min_repeats:
        return False
    # 连续重复：aaaa / 意向意向意向…
    if re.search(rf"(.{{{n}}})\1{{{min_repeats - 1},}}", s):
        return True
    # 同字连刷
    if re.search(r"(.)\1{7,}", s):
        return True
    return False


def looks_like_garbage(text: str) -> bool:
    """检测 # 刷屏 / JSON套娃 / 中文词循环崩坏（不替换成死句，只用于触发重试）。"""
    t = text or ""
    if t.count("#") >= 8 or re.search(r"#{4,}", t):
        return True
    if "```" in t and t.count("#") >= 3:
        return True
    # 控制符 / 替换符
    if sum(1 for ch in t if ord(ch) < 32 and ch not in "\n\r\t") >= 3:
        return True
    if "\ufffd" in t or t.count("\u0000") > 0:
        return True
    # 原文级词循环（JSON 解析失败也能抓）
    if _has_ngram_loop(t, 2, 8) or _has_ngram_loop(t, 3, 6):
        return True
    dlg = ""
    try:
        obj = json.loads(t) if t.strip().startswith("{") else None
        if isinstance(obj, dict):
            dlg = str(obj.get("dialogue") or "")
            blob = " ".join(str(obj.get(k) or "") for k in ("dialogue", "action", "inner_thought", "emotion"))
            if _has_ngram_loop(blob, 2, 6) or _has_ngram_loop(blob, 3, 5):
                return True
    except Exception:
        dlg = extract_dialogue_field(t) or t
    if not dlg.strip():
        return bool(re.search(r"[#*]{5,}", t))
    # dialogue 里又嵌一整段 JSON → 模型跑飞
    ds = dlg.strip()
    if ds.startswith("{") and ("dialogue" in ds or "action" in ds):
        return True
    if _has_ngram_loop(ds, 2, 6) or _has_ngram_loop(ds, 3, 5) or _has_ngram_loop(ds, 4, 4):
        return True
    cjk = sum(1 for ch in dlg if "\u4e00" <= ch <= "\u9fff")
    sym = sum(1 for ch in dlg if ch in "#*`~^|\\")
    if sym >= 5:
        return True
    if len(dlg) >= 12 and cjk == 0 and re.search(r"[A-Za-z]{20,}", dlg):
        return True
    if len(dlg) >= 8 and cjk / max(len(dlg), 1) < 0.15 and sym > 0:
        return True
    return False


def ollama_chat(
    messages: list,
    model: str,
    max_tokens: int,
    temperature: float,
    *,
    use_format: bool = True,
    repeat_penalty: float = 1.15,
) -> tuple[str, int]:
    messages = trim_messages(messages, max_tokens_budget=8192)
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "keep_alive": -1,
        "options": {
            "num_predict": max(48, min(int(max_tokens or 100), 140)),
            "temperature": float(temperature if temperature is not None else 0.55),
            "top_p": 0.85,
            "top_k": 40,
            "repeat_penalty": float(repeat_penalty),
            "num_ctx": 8192,
        },
    }
    if use_format:
        # JSON 约束降低 # 崩坏率；内容仍全是模型生成
        payload["format"] = JSON_SCHEMA
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA}/api/chat",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    content = data.get("message", {}).get("content") or ""
    total_ms = int((data.get("total_duration") or 0) / 1e6)
    return content, total_ms


def dialogue_of(content: str) -> str:
    try:
        o = json.loads(content) if (content or "").strip().startswith("{") else None
        if isinstance(o, dict):
            return str(o.get("dialogue") or "").strip()
    except Exception:
        pass
    return extract_dialogue_field(content or "").strip()


def is_usable_reply(content: str) -> bool:
    if looks_like_garbage(content):
        return False
    return bool(dialogue_of(content))


def ollama_chat_stable(messages: list, model: str, max_tokens: int, temperature: float) -> tuple[str, int]:
    """崩坏则缩短上下文并降温度重试（仍用模型输出，不写死台词）。"""
    content, ms = ollama_chat(messages, model, max_tokens, temperature)
    if is_usable_reply(content):
        return content, ms
    print(f"[PROXY] bad reply, retry… sample={content[:80]!r}")
    system = [m for m in messages if m.get("role") == "system"][-1:]
    user = [m for m in messages if m.get("role") == "user"][-1:]
    slim = system + user
    if system:
        s = dict(system[0])
        c = str(s.get("content") or "")
        if len(c) > 2500:
            s["content"] = c[:1200] + "\n…\n" + c[-1200:]
            slim = [s] + user
    content2, ms2 = ollama_chat(
        slim,
        model,
        max_tokens,
        min(0.4, float(temperature or 0.55)),
        use_format=True,
        repeat_penalty=1.28,
    )
    if is_usable_reply(content2):
        return content2, ms + ms2
    print(f"[PROXY] still bad, slim2… sample={content2[:80]!r}")
    # 二次仍保留角色 system 尾部（不换通用壳），只再砍短，避免毁掉「活在世界里」的上下文
    slim2 = slim
    if slim and slim[0].get("role") == "system":
        s = dict(slim[0])
        c = str(s.get("content") or "")
        if len(c) > 1400:
            s["content"] = c[:700] + "\n…\n" + c[-700:]
            slim2 = [s] + user
    content3, ms3 = ollama_chat(
        slim2,
        model,
        max_tokens,
        0.35,
        use_format=True,
        repeat_penalty=1.32,
    )
    if not is_usable_reply(content3):
        print(f"[PROXY] final bad: {content3[:80]!r}")
        raise RuntimeError("model_garble: output collapsed into symbols; please resend")
    return content3, ms + ms2 + ms3


class Handler(BaseHTTPRequestHandler):
    def _json(self, code: int, obj: dict) -> None:
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt: str, *args) -> None:
        print("[PROXY]", fmt % args)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/health"):
            self._json(200, {"ok": True, "backend": "ollama", "model": DEFAULT_MODEL})
            return
        if self.path in ("/v1/models", "/api/tags"):
            self._json(
                200,
                {
                    "object": "list",
                    "data": [{"id": DEFAULT_MODEL, "object": "model"}],
                    "models": [{"name": DEFAULT_MODEL, "model": DEFAULT_MODEL}],
                },
            )
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            req = json.loads(raw.decode("utf-8"))
        except Exception:
            self._json(400, {"error": "bad json"})
            return

        path = self.path.split("?")[0]
        if path not in ("/v1/chat/completions", "/api/chat"):
            self._json(404, {"error": f"unsupported {path}"})
            return

        model = normalize_model(req.get("model"))
        messages = req.get("messages") or []
        max_tokens = req.get("max_tokens") or 100
        temperature = req.get("temperature")
        if temperature is None:
            temperature = 0.55
        user_text = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                user_text = str(m.get("content") or "")
                break

        try:
            content, ollama_ms = ollama_chat_stable(messages, model, int(max_tokens), float(temperature))
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8", "replace")
            self._json(e.code, {"error": err[:500]})
            return
        except Exception as e:
            msg = str(e)
            if msg.startswith("model_garble:"):
                self._json(503, {"error": "模型输出异常（符号崩坏），请再发一句。这不是角色台词。"})
                return
            self._json(502, {"error": msg})
            return

        fixed = coerce_game_json(content, user_text)
        # coerce 后再检一次（嵌套 JSON / 词循环常出现在 dialogue 字段里）
        try:
            fixed_obj = json.loads(fixed)
        except Exception:
            fixed_obj = {}
        if looks_like_garbage(fixed) or not str((fixed_obj or {}).get("dialogue") or "").strip():
            print(f"[PROXY] garbage/empty after coerce, refuse: {fixed[:100]!r}")
            self._json(503, {"error": "模型输出异常（符号崩坏），请再发一句。这不是角色台词。"})
            return
        print(f"[PROXY] model={model} ollama_ms={ollama_ms} out={fixed[:120]!r}")

        if path == "/api/chat":
            self._json(200, {"model": model, "message": {"role": "assistant", "content": fixed}, "done": True})
            return

        # OpenAI shape (non-stream; game uses non-stream for compat)
        payload = {
            "id": "chatcmpl-proxy",
            "object": "chat.completion",
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": fixed},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            "proxy_ms": ollama_ms,
        }
        if req.get("stream"):
            # Fake one-shot SSE for old clients
            chunk = {
                "id": "chatcmpl-proxy",
                "object": "chat.completion.chunk",
                "model": model,
                "choices": [{"index": 0, "delta": {"role": "assistant", "content": fixed}, "finish_reason": None}],
            }
            done = {
                "id": "chatcmpl-proxy",
                "object": "chat.completion.chunk",
                "model": model,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            body = (
                f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                f"data: {json.dumps(done, ensure_ascii=False)}\n\n"
                "data: [DONE]\n\n"
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        self._json(200, payload)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=11435)
    args = ap.parse_args()
    # warmup
    try:
        c, ms = ollama_chat([{"role": "user", "content": "ping，回短JSON"}], DEFAULT_MODEL, 48, 0.2)
        print(f"[OK] warmup {ms}ms -> {c[:80]!r}")
    except Exception as e:
        print(f"[WARN] warmup failed (Ollama up?): {e}")
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[OK] proxy http://{args.host}:{args.port} → {OLLAMA} model={DEFAULT_MODEL}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
