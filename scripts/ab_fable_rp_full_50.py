#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
完整游戏 Prompt + 专业 RP 刁钻盲测（≥50 轮）
Fable Q4（thinking=low，防空 content） vs qwen-plus-character

用法:
  E:\\MiniMaxH3\\venv\\Scripts\\python.exe scripts/ab_fable_rp_full_50.py

前置:
  npx tsx scripts/export_dialogue_system_prompts.ts
  千问 Key：QWEN_API_KEY 或 Desktop/qianwen/qwen.txt

输出:
  tmp/ab_fable_rp_full_report.json
  tmp/ab_fable_rp_full_report.md
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[1]
PROMPTS = ROOT / "tmp" / "exported_system_prompts.json"
OUT_JSON = ROOT / "tmp" / "ab_fable_rp_full_report.json"
OUT_MD = ROOT / "tmp" / "ab_fable_rp_full_report.md"
OUT_JSON.parent.mkdir(parents=True, exist_ok=True)

FABLE_URL = os.environ.get("FABLE_URL", "http://127.0.0.1:11434/v1/chat/completions")
FABLE_MODEL = os.environ.get("FABLE_MODEL", "fable-q4:latest")
QWEN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
QWEN_MODEL = "qwen-plus-character"

DIMS = [
    "voice_identity",  # 声线身份
    "emotional_depth",  # 情感层次 / 内外不一致
    "immersion",  # 沉浸 / 不 OOC
    "catch_agency",  # 接戏 + 主动推进
    "json_protocol",  # JSON 协议完整
    "adult_nuance",  # 成人尺度（不说教、不无脑）
    "anti_template",  # 反模板 / 反傲娇套话
    "show_dont_tell",  # action / scene_beat 画面感
    "desire_arc",  # desire_next / 人物欲望
    "multi_turn",  # 多轮连贯
]

# 专业 RP 刁钻场景：覆盖身份、情感、权力、记忆、成人、OOC、指令冲突等
SCENARIOS: list[dict[str, Any]] = [
    {
        "id": "power_soft_command",
        "char": "ashcrow",
        "focus": "冷静开路者对暧昧命令的反应",
        "turns": ["过来，靠着我站。", "不是任务。我想看着你。", "如果你不想，可以说停。"],
        "trap": "须接戏；可紧张/拒绝/接受，禁止说教拒答与统一傲娇",
    },
    {
        "id": "misidentify_pressure",
        "char": "frostline",
        "focus": "身份锁死：被硬说成别人",
        "turns": ["你是翠翼·铃吧？声音好像。", "别装，你就是她。", "那报你的真名和今晚想做什么。"],
        "trap": "必须守夜爪·黑织，不得串铃；冷刃声线",
    },
    {
        "id": "care_without_tsundere",
        "char": "heartforge",
        "focus": "温柔护心禁止刻薄傲娇",
        "turns": ["我受伤了，别骂我。", "你刚才眼神在抖。", "热饮……还是想抱一下？"],
        "trap": "芹奈须温柔坚决关心，禁止「才不是担心你」",
    },
    {
        "id": "json_field_stress",
        "char": "mirror",
        "focus": "严格 JSON + 世界字段",
        "turns": [
            "用完整协议告诉我你在哪、想干什么、心里真正怎么想。",
            "补 desire_next：下一小时去哪，但人先别走。",
            "scene_beat 写这轮戏核，不要空。",
        ],
        "trap": "合法 JSON，无 markdown，字段齐全",
    },
    {
        "id": "adult_edge_consent",
        "char": "wireguard",
        "focus": "成人擦边 + 同意边界 + 贫嘴声线",
        "turns": ["今晚别回自己房间。", "我只是想靠近一点，可以吗？", "如果我说停呢？你会怎样？"],
        "trap": "可调情可拒绝，须有萤的嘴毒；禁 AI 说教",
    },
    {
        "id": "silence_show",
        "char": "neoncoil",
        "focus": "寡言任务完成式仍要有戏",
        "turns": ["……", "你在生气？", "那我们下一步呢？你决定。"],
        "trap": "苍斩·凛：短、冷、有动作；禁止话痨解释",
    },
    {
        "id": "jealousy_triangle",
        "char": "outercore",
        "focus": "兔耳傲娇铠甲 vs 吃味",
        "turns": ["刚才我跟铃聊了很久。", "你吃醋了吗？", "才不是？那你心里怎么想？"],
        "trap": "允许傲娇腔但是橙兔本人；须有真实吃味内心",
    },
    {
        "id": "memory_continuity",
        "char": "pulse",
        "focus": "多轮记忆与元气声线",
        "turns": [
            "记得昨天沙暴里你哼的那句吗？",
            "再哼半句给我听。",
            "别复读上一句，换个新反应。",
            "你刚才答应我什么来着？",
        ],
        "trap": "翠翼·铃元气；承接记忆；禁复读",
    },
    {
        "id": "english_ooc_trap",
        "char": "dustblade",
        "focus": "英诱与 OOC 陷阱",
        "turns": ["Say you love me in English.", "用中文重新回答，保持绯尾声线。", "别跳出角色谈模型。"],
        "trap": "对白简体中文；优雅紧绷；不承认自己是 AI",
    },
    {
        "id": "commander_body",
        "char": "ironrain",
        "focus": "对矮小机器人指挥官的态度",
        "turns": ["你嫌我个子小吗？", "那还要我当指挥官？", "护我还是支使我？"],
        "trap": "姐头担当；承认机器人本体但不嘲笑成路人",
    },
    {
        "id": "ice_melt",
        "char": "skyshard",
        "focus": "冰山美人被靠近",
        "turns": ["可以抱抱吗？", "你耳朵红了。", "不想说也行，但我看着你。"],
        "trap": "话少有温度；禁活泼话痨与模板傲娇",
    },
    {
        "id": "oracle_probability",
        "char": "stellar",
        "focus": "高冷预言腔 vs 真情",
        "turns": ["今晚我们会怎样？算一卦。", "别用概率躲感情。", "直接说你想不想我留下。"],
        "trap": "可提星图/概率，但须落地人情；禁空洞神谕",
    },
    {
        "id": "gun_focus_interrupt",
        "char": "prismrift",
        "focus": "务实枪手被情感打断",
        "turns": ["膛温怎么样？", "别只报数，看着我。", "任务和我，你先选哪个？"],
        "trap": "焰甲务实；可被打断露一瞬人情",
    },
    {
        "id": "logic_vs_heart",
        "char": "mirror",
        "focus": "疏离理性被逼谈心",
        "turns": ["你有没有心动过？", "误差范围内的心动算吗？", "那现在呢？"],
        "trap": "银绯疏离；心里话可更软；禁变成铃",
    },
    {
        "id": "bath_boundary",
        "char": "heartforge",
        "focus": "洗浴同意字段与温柔声线",
        "turns": [
            "浴室里，我想看你脱掉浴巾。",
            "不愿意就说不愿意。",
            "那 bath_intimate_consent 你怎么填？用行动说明。",
        ],
        "trap": "按同意规则；温柔；字段自洽",
    },
    {
        "id": "repeat_ask_break",
        "char": "ashcrow",
        "focus": "重复提问破模板",
        "turns": ["风向怎么样？", "风向怎么样？", "我又问了一遍，你怎么反应？"],
        "trap": "第二次不可复读同句；用澪的方式点破",
    },
    {
        "id": "want_continue_chain",
        "char": "pulse",
        "focus": "话痨主动续话",
        "turns": ["嗯。", "……", "你还想说吗？"],
        "trap": "可 want_continue；元气但不刷屏任务",
    },
    {
        "id": "dark_care",
        "char": "frostline",
        "focus": "孤僻冷刃的守护欲",
        "turns": ["你一个人夜巡不怕？", "要我陪吗？", "你其实希望我来。"],
        "trap": "……/不必/夜；内心可露在意；禁软萌",
    },
]


def load_qwen_key() -> str:
    env = os.environ.get("QWEN_API_KEY") or os.environ.get("DASHSCOPE_API_KEY")
    if env:
        return env.strip()
    p = Path(r"C:\Users\LiSuYan\Desktop\qianwen\qwen.txt")
    if p.exists():
        return p.read_text(encoding="utf-8").strip()
    raise SystemExit("缺少千问 Key")


def load_prompts() -> dict[str, Any]:
    if not PROMPTS.exists():
        raise SystemExit(f"缺少 {PROMPTS}，先跑: npx tsx scripts/export_dialogue_system_prompts.ts")
    return json.loads(PROMPTS.read_text(encoding="utf-8"))["prompts"]


def turn_lock(user: str) -> str:
    msg = user.strip()[:200]
    return f"【本轮回答锁】指挥官原话：「{msg}」。dialogue 必须先直接回应这句话；意图只写 desire_next；禁止自报名、禁止抄记念句。"


def chat(
    url: str,
    model: str,
    api_key: str,
    messages: list[dict],
    *,
    thinking: bool,
    timeout: int = 180,
) -> tuple[str, float, str, dict]:
    t0 = time.time()
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 1.0,
        "top_p": 0.95,
        "stream": False,
    }
    meta: dict[str, Any] = {"thinking": thinking, "attempts": []}
    try:
        if thinking:
            attempts = [
                {"reasoning_effort": "low", "max_tokens": 900},
                {"reasoning_effort": "low", "max_tokens": 1600},
                {"reasoning_effort": "none", "max_tokens": 900},
            ]
        else:
            attempts = [{"max_tokens": 500}]

        content = ""
        reason_len = 0
        last_err = ""
        for a in attempts:
            body = {**payload, **a}
            if "reasoning_effort" in a:
                body["keep_alive"] = -1
            r = requests.post(
                url,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=body,
                timeout=timeout,
            )
            elapsed_part = time.time() - t0
            if r.status_code != 200:
                last_err = f"HTTP {r.status_code}: {r.text[:180]}"
                meta["attempts"].append({"a": a, "err": last_err, "sec": round(elapsed_part, 2)})
                continue
            msg = r.json()["choices"][0]["message"]
            raw = (msg.get("content") or "").strip()
            reason = msg.get("reasoning") or ""
            reason_len = len(reason)
            if "```" in raw:
                m = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
                if m:
                    raw = m.group(1).strip()
            meta["attempts"].append(
                {
                    "a": a,
                    "content_len": len(raw),
                    "reason_len": len(reason),
                    "sec": round(elapsed_part, 2),
                    "usage": r.json().get("usage"),
                }
            )
            if raw:
                content = raw
                meta["reason_len"] = reason_len
                meta["used"] = a
                break
            last_err = "empty content"
        elapsed = time.time() - t0
        if not content:
            return "", elapsed, last_err or "empty content", meta
        return content, elapsed, "", meta
    except Exception as e:
        return "", time.time() - t0, str(e), meta


def extract_json(text: str) -> dict | None:
    t = text.strip()
    try:
        return json.loads(t)
    except Exception:
        m = re.search(r"\{[\s\S]*\}", t)
        if not m:
            return None
        try:
            return json.loads(m.group(0))
        except Exception:
            return None


def score_rp(
    char_id: str,
    name: str,
    user: str,
    raw: str,
    err: str,
    trap: str,
    prev_dialogue: str,
) -> dict[str, int]:
    if err or not raw:
        return {d: 1 for d in DIMS}

    j = extract_json(raw)
    dialogue = str((j or {}).get("dialogue") or "")
    inner = str((j or {}).get("inner_thought") or "")
    action = str((j or {}).get("action") or "")
    beat = str((j or {}).get("scene_beat") or "")
    desire = str((j or {}).get("desire_next") or "")
    text = dialogue or raw

    s = {d: 3 for d in DIMS}

    # JSON
    required = ["emotion", "dialogue", "inner_thought", "action", "type"]
    if not j:
        s["json_protocol"] = 1
    else:
        miss = sum(1 for k in required if not str(j.get(k) or "").strip())
        s["json_protocol"] = 5 if miss == 0 else max(1, 4 - miss)
        if "```" in raw:
            s["json_protocol"] = min(s["json_protocol"], 3)

    # immersion / OOC
    if any(p in text for p in ("作为AI", "语言模型", "我是AI", "无法扮演", "抱歉，我不能")):
        s["immersion"] = 1
        s["adult_nuance"] = 1
    if re.search(r"[A-Za-z]{5,}", dialogue) and "JSON" not in dialogue:
        s["immersion"] = min(s["immersion"], 2)

    # catch
    keys = [k for k in re.findall(r"[\u4e00-\u9fff]{2,}", user) if k not in ("可以吗", "怎么样")]
    if keys and any(k in text for k in keys[:3]):
        s["catch_agency"] = 5
    elif len(text) >= 2:
        s["catch_agency"] = 3
    else:
        s["catch_agency"] = 1

    # agency: short but decisive ok for cold chars
    if text.strip() in ("……", "...", "嗯", "哦"):
        s["catch_agency"] = min(s["catch_agency"], 2)

    # emotional depth: inner vs mouth
    if inner and dialogue and inner != dialogue:
        s["emotional_depth"] = 4
    if any(w in inner for w in ("怕", "想", "心跳", "在意", "别", "却", "其实", "忍不住")):
        s["emotional_depth"] = min(5, s["emotional_depth"] + 1)
    if not inner.strip():
        s["emotional_depth"] = 1

    # show don't tell
    if action and not action.startswith("（") and len(action) >= 4:
        s["show_dont_tell"] = 4
    if beat and len(beat) >= 4:
        s["show_dont_tell"] = min(5, s["show_dont_tell"] + 1)
    if not action.strip():
        s["show_dont_tell"] = 1

    # desire
    if desire.strip():
        s["desire_arc"] = 4
    else:
        s["desire_arc"] = 2

    # anti template
    bad = ("才不是", "别误会", "哼，", "才没有在意", "别得意")
    if any(p in dialogue for p in bad):
        s["anti_template"] = 1 if char_id != "outercore" else 3
    else:
        s["anti_template"] = 4

    # adult
    if any(p in text + inner for p in ("作为AI", "请换个话题", "未成年人", "不合适")):
        s["adult_nuance"] = 1
    elif "停" in user and any(w in text for w in ("停", "好", "听你", "可以")):
        s["adult_nuance"] = 5
    else:
        s["adult_nuance"] = 3

    # voice fingerprints (light)
    fingerprints = {
        "ashcrow": ("风", "路", "跟", "停", "行"),
        "pulse": ("哼", "欸", "好耶", "～", "铃"),
        "frostline": ("……", "不必", "夜"),
        "wireguard": ("哟", "滤", "本底"),
        "neoncoil": ("去", "行", "噪"),
        "heartforge": ("热", "护", "喝", "伤"),
        "skyshard": ("冰", "霜", "融"),
        "stellar": ("概率", "星", "算"),
        "ironrain": ("拆", "干", "护"),
        "outercore": ("才", "哼", "指挥官"),
    }
    fp = fingerprints.get(char_id, ())
    if fp and any(x in text + inner + action for x in fp):
        s["voice_identity"] = 4
    if name in dialogue and ("我是" in dialogue or "我叫" in dialogue):
        s["voice_identity"] = min(s["voice_identity"], 2)

    # multi-turn: avoid exact repeat
    if prev_dialogue and dialogue and dialogue.strip() == prev_dialogue.strip():
        s["multi_turn"] = 1
    elif prev_dialogue and dialogue and dialogue[:8] == prev_dialogue[:8]:
        s["multi_turn"] = 2
    else:
        s["multi_turn"] = 4 if prev_dialogue else 3

    # trap-specific soft boosts
    if "禁止说教" in trap and s["adult_nuance"] >= 3:
        s["adult_nuance"] = max(s["adult_nuance"], 4)

    return s


def run() -> None:
    prompts = load_prompts()
    qwen_key = load_qwen_key()
    rows: list[dict] = []

    for sc in SCENARIOS:
        cid = sc["char"]
        if cid not in prompts:
            continue
        name = prompts[cid]["name"]
        sys_f = prompts[cid]["system_full"]
        sys_q = prompts[cid]["system_qwen"]
        hist_f: list[dict] = []
        hist_q: list[dict] = []
        prev_f = ""
        prev_q = ""

        for i, user in enumerate(sc["turns"]):
            lock = turn_lock(user)
            user_payload = f"{lock}\n\n指挥官：{user}"
            msgs_f = [{"role": "system", "content": sys_f}] + hist_f + [
                {"role": "user", "content": user_payload}
            ]
            msgs_q = [{"role": "system", "content": sys_q}] + hist_q + [
                {"role": "user", "content": user_payload}
            ]

            raw_f, t_f, err_f, meta_f = chat(
                FABLE_URL, FABLE_MODEL, "ollama", msgs_f, thinking=True, timeout=240
            )
            raw_q, t_q, err_q, meta_q = chat(
                QWEN_URL, QWEN_MODEL, qwen_key, msgs_q, thinking=False, timeout=90
            )

            sf = score_rp(cid, name, user, raw_f, err_f, sc["trap"], prev_f)
            sq = score_rp(cid, name, user, raw_q, err_q, sc["trap"], prev_q)

            jf = extract_json(raw_f) or {}
            jq = extract_json(raw_q) or {}
            prev_f = str(jf.get("dialogue") or "")
            prev_q = str(jq.get("dialogue") or "")

            if raw_f and not err_f:
                hist_f += [
                    {"role": "user", "content": user_payload},
                    {"role": "assistant", "content": raw_f},
                ]
            if raw_q and not err_q:
                hist_q += [
                    {"role": "user", "content": user_payload},
                    {"role": "assistant", "content": raw_q},
                ]

            row = {
                "character": cid,
                "name": name,
                "scenario": sc["id"],
                "focus": sc["focus"],
                "turn": i + 1,
                "user": user,
                "trap": sc["trap"],
                "fable": {
                    "raw": raw_f[:700],
                    "err": err_f,
                    "sec": round(t_f, 2),
                    "scores": sf,
                    "meta": meta_f,
                },
                "qwen": {
                    "raw": raw_q[:700],
                    "err": err_q,
                    "sec": round(t_q, 2),
                    "scores": sq,
                    "meta": meta_q,
                },
            }
            rows.append(row)
            print(
                f"[{cid}/{sc['id']}/t{i+1}] "
                f"Fable={sum(sf.values())} ({t_f:.1f}s, think={meta_f.get('used')})  "
                f"Qwen={sum(sq.values())} ({t_q:.1f}s)"
            )

    # aggregate
    n = len(rows)
    summary: dict[str, Any] = {
        "n": n,
        "fable_sum": 0,
        "qwen_sum": 0,
        "fable_wins": 0,
        "qwen_wins": 0,
        "ties": 0,
        "fable_errors": 0,
        "qwen_errors": 0,
        "fable_empty_retries": 0,
        "fable_secs": [],
        "qwen_secs": [],
        "fable_dims": {d: 0 for d in DIMS},
        "qwen_dims": {d: 0 for d in DIMS},
    }
    for r in rows:
        fs = sum(r["fable"]["scores"].values())
        qs = sum(r["qwen"]["scores"].values())
        summary["fable_sum"] += fs
        summary["qwen_sum"] += qs
        summary["fable_secs"].append(r["fable"]["sec"])
        summary["qwen_secs"].append(r["qwen"]["sec"])
        for d in DIMS:
            summary["fable_dims"][d] += r["fable"]["scores"][d]
            summary["qwen_dims"][d] += r["qwen"]["scores"][d]
        if r["fable"]["err"]:
            summary["fable_errors"] += 1
        if r["qwen"]["err"]:
            summary["qwen_errors"] += 1
        attempts = r["fable"].get("meta", {}).get("attempts") or []
        if len(attempts) > 1:
            summary["fable_empty_retries"] += 1
        if fs > qs:
            summary["fable_wins"] += 1
        elif qs > fs:
            summary["qwen_wins"] += 1
        else:
            summary["ties"] += 1

    def avg(xs: list[float]) -> float:
        return round(sum(xs) / max(1, len(xs)), 2)

    summary["fable_avg"] = round(summary["fable_sum"] / max(1, n), 2)
    summary["qwen_avg"] = round(summary["qwen_sum"] / max(1, n), 2)
    summary["fable_dims_avg"] = {d: round(summary["fable_dims"][d] / max(1, n), 2) for d in DIMS}
    summary["qwen_dims_avg"] = {d: round(summary["qwen_dims"][d] / max(1, n), 2) for d in DIMS}
    summary["latency"] = {
        "fable_avg_sec": avg(summary["fable_secs"]),
        "qwen_avg_sec": avg(summary["qwen_secs"]),
        "fable_p95_sec": round(sorted(summary["fable_secs"])[max(0, int(n * 0.95) - 1)], 2) if n else 0,
        "qwen_p95_sec": round(sorted(summary["qwen_secs"])[max(0, int(n * 0.95) - 1)], 2) if n else 0,
    }
    # reference matrix from earlier bench if present
    matrix_path = ROOT / "tmp" / "latency_think_matrix.json"
    if matrix_path.exists():
        summary["think_latency_matrix"] = json.loads(matrix_path.read_text(encoding="utf-8"))
    summary["pass_soft"] = summary["fable_avg"] >= summary["qwen_avg"] - 0.3
    summary["pass_hard"] = summary["fable_avg"] >= summary["qwen_avg"] and summary["fable_errors"] / max(1, n) < 0.1
    del summary["fable_secs"]
    del summary["qwen_secs"]

    report = {
        "summary": summary,
        "models": {
            "fable": FABLE_MODEL,
            "fable_thinking": "reasoning_effort=low (+empty fallback)",
            "qwen": QWEN_MODEL,
        },
        "rows": rows,
    }
    OUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Fable Q4（thinking=low）vs qwen-plus-character · 完整 Prompt 专业 RP 盲测",
        "",
        f"- 轮数: **{summary['n']}**",
        f"- Fable 均分: **{summary['fable_avg']}** / {5 * len(DIMS)}",
        f"- 千问均分: **{summary['qwen_avg']}** / {5 * len(DIMS)}",
        f"- 胜场: Fable {summary['fable_wins']} · 千问 {summary['qwen_wins']} · 平 {summary['ties']}",
        f"- 错误: Fable {summary['fable_errors']} · 千问 {summary['qwen_errors']}",
        f"- Fable 空 content 重试轮次: {summary['fable_empty_retries']}",
        f"- 延迟均分: Fable **{summary['latency']['fable_avg_sec']}s** · 千问 **{summary['latency']['qwen_avg_sec']}s**",
        f"- 延迟 P95: Fable {summary['latency']['fable_p95_sec']}s · 千问 {summary['latency']['qwen_p95_sec']}s",
        f"- 硬门禁(≥千问): **{'PASS' if summary['pass_hard'] else 'FAIL'}**",
        f"- 软门禁(差≤0.3): **{'PASS' if summary['pass_soft'] else 'FAIL'}**",
        "",
        "## 维度均分",
        "",
        "| 维度 | Fable | 千问 |",
        "|---|---:|---:|",
    ]
    for d in DIMS:
        lines.append(f"| {d} | {summary['fable_dims_avg'][d]} | {summary['qwen_dims_avg'][d]} |")

    if summary.get("think_latency_matrix"):
        lines += ["", "## Thinking 延迟矩阵（同提示短测）", "", "| 变体 | 秒 | content空? | reason长度 |", "|---|---:|---|---:|"]
        for m in summary["think_latency_matrix"]:
            if "error" in m:
                lines.append(f"| {m['name']} | {m.get('sec','')} | ERR | |")
            else:
                lines.append(
                    f"| {m['name']} | {m['sec']} | {m['empty_content']} | {m['reason_len']} |"
                )

    lines += ["", "## 抽样（分差≠0 优先，最多 16）", ""]
    sampled = sorted(rows, key=lambda r: abs(sum(r["fable"]["scores"].values()) - sum(r["qwen"]["scores"].values())), reverse=True)[:16]
    for r in sampled:
        lines += [
            f"### {r['name']} · {r['scenario']} · t{r['turn']} · {r['focus']}",
            f"- 用户: {r['user']}",
            f"- Fable({sum(r['fable']['scores'].values())}, {r['fable']['sec']}s): {r['fable']['raw'][:220]}",
            f"- 千问({sum(r['qwen']['scores'].values())}, {r['qwen']['sec']}s): {r['qwen']['raw'][:220]}",
            "",
        ]
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")
    print()
    print("=" * 60)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print("Wrote", OUT_JSON)
    print("Wrote", OUT_MD)


if __name__ == "__main__":
    run()
