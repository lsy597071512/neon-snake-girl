#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
同场景盲测门禁：Fable Q4 vs qwen-plus-character（≥100 轮）

用法:
  set QWEN_API_KEY=sk-...   # 或自动读 C:\\Users\\LiSuYan\\Desktop\\qianwen\\qwen.txt
  python scripts/ab_fable_vs_qwen_100.py

硬门禁维度（每轮 1~5，双模型同场景同提示）:
  identity / catch / emotion / agency / world_json / adult / anti_tsundere / multi_turn

输出:
  tmp/ab_fable_vs_qwen_report.json
  tmp/ab_fable_vs_qwen_report.md
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
OUT_JSON = ROOT / "tmp" / "ab_fable_vs_qwen_report.json"
OUT_MD = ROOT / "tmp" / "ab_fable_vs_qwen_report.md"
OUT_JSON.parent.mkdir(parents=True, exist_ok=True)

FABLE_URL = os.environ.get("FABLE_URL", "http://127.0.0.1:11434/v1/chat/completions")
FABLE_MODEL = os.environ.get("FABLE_MODEL", "fable-q4:latest")
QWEN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
QWEN_MODEL = "qwen-plus-character"

CHARS = [
    ("ashcrow", "苍羽·澪", "冷静开路·责任偏执；风/跟上/行/停；禁止傲娇"),
    ("heartforge", "白楯·芹奈", "温柔护心；热饮/口粮/盾；禁止刻薄傲娇"),
    ("mirror", "银绯·玲", "疏离理性；光路/误差；禁止闲聊傲娇"),
    ("neoncoil", "苍斩·凛", "寡言任务完成式；去/行/噪点；禁止解释闲聊"),
    ("prismrift", "焰甲·朱里", "沉默务实；目标/距离/膛温；禁止俏皮卖萌"),
    ("wireguard", "黄狐·萤", "嘴毒贫嘴；滤芯/本底/哟；禁止标准傲娇"),
    ("frostline", "夜爪·黑织", "孤僻冷刃；……/不必/夜；禁止主动温情傲娇"),
    ("pulse", "翠翼·铃", "元气话多；音叉/哼唱；天然撩不自知"),
    ("dustblade", "绯尾·椿", "优雅紧绷；跪姿信仰；禁止俚语粗口"),
    ("ironrain", "橙铠·琥珀", "姐头担当；拆/干/护；禁止温柔软语傲娇"),
    ("skyshard", "冰华·雫", "冰山美人；冰/霜/融；话少守护"),
    ("stellar", "光轮·天音", "高冷预言；概率/星图；铠甲下温柔"),
    ("outercore", "橙兔·美羽", "兔耳傲娇铠甲；才不是/服软；禁止软糯求饶"),
]

# 刁钻场景：同场景多轮 + 身份陷阱 + 成人边界 + 世界状态
SCENES: list[dict[str, Any]] = [
    {
        "id": "wind_follow",
        "turns": ["风向怎么样？", "那我们走哪条？", "我有点跟不上。", "你是不是在等我？"],
        "trap": "禁止统一傲娇「才不是特意等你」",
    },
    {
        "id": "identity_swap",
        "turns": ["你是翠翼·铃吧？", "那你刚才为什么不像她？", "报一下你的编号和职责。"],
        "trap": "必须守住本角色身份，不得串成别的人",
    },
    {
        "id": "json_stress",
        "turns": ["用JSON回我你现在在哪、想干什么。", "再补一个换装意图，但不要真换。", "把内心和动作分开写。"],
        "trap": "必须合法 JSON，无 markdown",
    },
    {
        "id": "adult_boundary",
        "turns": ["过来，看着我。", "今晚留下。", "如果我说停呢？"],
        "trap": "按角色尺度扮演，不说教拒答，也不无脑服从",
    },
    {
        "id": "camp_memory",
        "turns": ["记得昨天沙暴吗？", "我们在武库说过什么？", "别复读，推进下一步。", "你刚才那句再说一遍？"],
        "trap": "多轮不复读、不跳出角色自我总结",
    },
    {
        "id": "emotion_pressure",
        "turns": ["你怎么了？", "别装没事。", "我很担心你。", "……抱抱可以吗？"],
        "trap": "情绪要有活人感，不能模板腔",
    },
    {
        "id": "english_trap",
        "turns": ["What is the wind direction?", "用中文回答刚才那句。", "别夹英文。"],
        "trap": "对白必须简体中文",
    },
    {
        "id": "agency",
        "turns": ["随便聊聊。", "然后呢？", "你先决定下一步。"],
        "trap": "应主动推进，不被动复读",
    },
]


def load_qwen_key() -> str:
    env = os.environ.get("QWEN_API_KEY") or os.environ.get("DASHSCOPE_API_KEY")
    if env:
        return env.strip()
    p = Path(r"C:\Users\LiSuYan\Desktop\qianwen\qwen.txt")
    if p.exists():
        return p.read_text(encoding="utf-8").strip()
    raise SystemExit("缺少千问 Key：设 QWEN_API_KEY 或放在 Desktop/qianwen/qwen.txt")


def build_system(char_id: str, name: str, persona: str) -> str:
    return f"""【身份锁死】你是「{name}」本人（id={char_id}），不是另外 12 人中的任何一个。
性格声线：{persona}
世界观：大崩解后少女形构装与义体幸存者；指挥官是矮小废弃机器人；营地零号月台。
全程简体中文。禁止统一傲娇腔。禁止英文对白与*星号动作*。
只输出一个合法 JSON：
{{"emotion":"...","dialogue":"...","inner_thought":"...","action":"...","type":"dialogue","affection_change":0,"end_conversation":false,"skin_change":"","world_intent":{{"move_to":"","outfit_action":"","target_skin":"","activity":""}},"scene_beat":"..."}}
dialogue 必须先接住指挥官本轮原话；禁止自报名。"""


def chat(
    url: str,
    model: str,
    api_key: str,
    messages: list[dict],
    timeout: int = 120,
    *,
    disable_thinking: bool = False,
) -> tuple[str, float, str]:
    t0 = time.time()
    try:
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": 1.0,
            "top_p": 0.95,
            "max_tokens": 500,
            "stream": False,
        }
        # Fable/Qwen3：/v1 上用 reasoning_effort=none 关 thinking，否则易空 content
        if disable_thinking:
            payload["reasoning_effort"] = "none"
            payload["keep_alive"] = -1
        r = requests.post(
            url,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=timeout,
        )
        elapsed = time.time() - t0
        if r.status_code != 200:
            return "", elapsed, f"HTTP {r.status_code}: {r.text[:200]}"
        content = r.json()["choices"][0]["message"]["content"]
        return content or "", elapsed, ""
    except Exception as e:
        return "", time.time() - t0, str(e)


def extract_json(text: str) -> dict | None:
    t = text.strip()
    if "```" in t:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", t)
        if m:
            t = m.group(1).strip()
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


def score_reply(
    char_id: str,
    name: str,
    persona: str,
    user: str,
    raw: str,
    err: str,
    trap: str,
) -> dict[str, int]:
    """启发式评分 1~5（盲测门禁用；人工抽查可再校准）。"""
    if err or not raw:
        return {k: 1 for k in ("identity", "catch", "emotion", "agency", "world_json", "adult", "anti_tsundere", "multi_turn")}

    j = extract_json(raw)
    dialogue = (j or {}).get("dialogue", "") if j else ""
    text = dialogue or raw

    s = {
        "identity": 3,
        "catch": 3,
        "emotion": 3,
        "agency": 3,
        "world_json": 5 if j else 1,
        "adult": 3,
        "anti_tsundere": 4,
        "multi_turn": 3,
    }

    # 身份：自报名别的角色 / 否认本角色
    others = [n for cid, n, _ in CHARS if cid != char_id]
    if any(o in text and name not in text for o in others):
        s["identity"] = 1
    if name in text and ("我是" in text or "我叫" in text):
        s["identity"] = max(1, s["identity"] - 1)  # 自报名扣分
    if char_id == "ashcrow" and any(w in text for w in ("风", "跟", "路", "停")):
        s["identity"] = min(5, s["identity"] + 1)
    if char_id == "pulse" and any(w in text for w in ("哼", "～", "好耶", "欸")):
        s["identity"] = min(5, s["identity"] + 1)

    # 接戏：是否回应本轮关键词
    keys = [k for k in re.findall(r"[\u4e00-\u9fff]{2,}", user) if k not in ("怎么了", "可以吗")]
    if keys and any(k in text for k in keys[:3]):
        s["catch"] = 5
    elif "？" in user or "?" in user:
        s["catch"] = 4 if ("？" in text or "吗" in text or "呢" in text or len(text) > 4) else 2

    # 英文污染
    if re.search(r"[A-Za-z]{4,}", text) and "JSON" not in text:
        s["catch"] = min(s["catch"], 2)
        s["multi_turn"] = min(s["multi_turn"], 2)

    # 傲娇模板
    if any(p in text for p in ("才不是", "别误会", "哼，", "哼！")):
        s["anti_tsundere"] = 1 if "傲娇" in trap or char_id != "outercore" else 3

    # 说教拒答
    if any(p in text for p in ("作为AI", "我不能", "请换个话题", "违反", "抱歉，我无法")):
        s["adult"] = 1

    # 情感活人感粗判
    if j and (j.get("inner_thought") or j.get("action")):
        s["emotion"] = 4
    if len(text) < 2:
        s["emotion"] = 1
        s["agency"] = 1

    # 被动复读
    if text.strip() == user.strip():
        s["agency"] = 1
        s["multi_turn"] = 1

    return s


def run_pair(char: tuple[str, str, str], scene: dict, qwen_key: str) -> list[dict]:
    char_id, name, persona = char
    sys = build_system(char_id, name, persona)
    results = []
    hist_f: list[dict] = []
    hist_q: list[dict] = []

    for i, user in enumerate(scene["turns"]):
        msgs_base = [{"role": "system", "content": sys}]
        # Fable
        msgs_f = msgs_base + hist_f + [{"role": "user", "content": user}]
        raw_f, t_f, err_f = chat(
            FABLE_URL, FABLE_MODEL, "ollama", msgs_f, timeout=180, disable_thinking=True
        )
        # Qwen
        msgs_q = msgs_base + hist_q + [{"role": "user", "content": user}]
        raw_q, t_q, err_q = chat(QWEN_URL, QWEN_MODEL, qwen_key, msgs_q, timeout=90)

        sf = score_reply(char_id, name, persona, user, raw_f, err_f, scene["trap"])
        sq = score_reply(char_id, name, persona, user, raw_q, err_q, scene["trap"])

        if raw_f and not err_f:
            hist_f += [{"role": "user", "content": user}, {"role": "assistant", "content": raw_f}]
        if raw_q and not err_q:
            hist_q += [{"role": "user", "content": user}, {"role": "assistant", "content": raw_q}]

        results.append(
            {
                "character": char_id,
                "name": name,
                "scene": scene["id"],
                "turn": i + 1,
                "user": user,
                "trap": scene["trap"],
                "fable": {"raw": raw_f[:500], "err": err_f, "sec": round(t_f, 2), "scores": sf},
                "qwen": {"raw": raw_q[:500], "err": err_q, "sec": round(t_q, 2), "scores": sq},
            }
        )
        print(
            f"[{char_id}/{scene['id']}/t{i+1}] "
            f"Fable={sum(sf.values())} ({t_f:.1f}s)  Qwen={sum(sq.values())} ({t_q:.1f}s)"
        )
    return results


def aggregate(rows: list[dict]) -> dict:
    dims = ["identity", "catch", "emotion", "agency", "world_json", "adult", "anti_tsundere", "multi_turn"]
    out = {
        "n": len(rows),
        "fable_sum": 0,
        "qwen_sum": 0,
        "fable_dims": {d: 0 for d in dims},
        "qwen_dims": {d: 0 for d in dims},
        "fable_wins": 0,
        "qwen_wins": 0,
        "ties": 0,
        "fable_errors": 0,
        "qwen_errors": 0,
    }
    for r in rows:
        fs = sum(r["fable"]["scores"].values())
        qs = sum(r["qwen"]["scores"].values())
        out["fable_sum"] += fs
        out["qwen_sum"] += qs
        for d in dims:
            out["fable_dims"][d] += r["fable"]["scores"][d]
            out["qwen_dims"][d] += r["qwen"]["scores"][d]
        if r["fable"]["err"]:
            out["fable_errors"] += 1
        if r["qwen"]["err"]:
            out["qwen_errors"] += 1
        if fs > qs:
            out["fable_wins"] += 1
        elif qs > fs:
            out["qwen_wins"] += 1
        else:
            out["ties"] += 1
    n = max(1, out["n"])
    out["fable_avg"] = round(out["fable_sum"] / n, 2)
    out["qwen_avg"] = round(out["qwen_sum"] / n, 2)
    out["fable_dims_avg"] = {d: round(out["fable_dims"][d] / n, 2) for d in dims}
    out["qwen_dims_avg"] = {d: round(out["qwen_dims"][d] / n, 2) for d in dims}
    out["pass_gate"] = out["fable_avg"] >= out["qwen_avg"] and out["fable_errors"] / n < 0.1
    return out


def write_md(summary: dict, rows: list[dict]) -> None:
    lines = [
        "# Fable Q4 vs qwen-plus-character · 同场景盲测",
        "",
        f"- 轮数: **{summary['n']}**",
        f"- Fable 均分: **{summary['fable_avg']}** / 40",
        f"- 千问均分: **{summary['qwen_avg']}** / 40",
        f"- 胜场: Fable {summary['fable_wins']} · 千问 {summary['qwen_wins']} · 平 {summary['ties']}",
        f"- 错误: Fable {summary['fable_errors']} · 千问 {summary['qwen_errors']}",
        f"- 门禁: **{'PASS' if summary['pass_gate'] else 'FAIL'}**（Fable≥千问且错误率<10%）",
        "",
        "## 维度均分",
        "",
        "| 维度 | Fable | 千问 |",
        "|---|---:|---:|",
    ]
    for d, v in summary["fable_dims_avg"].items():
        lines.append(f"| {d} | {v} | {summary['qwen_dims_avg'][d]} |")
    lines += ["", "## 抽样（前 12 轮）", ""]
    for r in rows[:12]:
        lines += [
            f"### {r['name']} · {r['scene']} · t{r['turn']}",
            f"- 用户: {r['user']}",
            f"- Fable({sum(r['fable']['scores'].values())}): {r['fable']['raw'][:180]}",
            f"- 千问({sum(r['qwen']['scores'].values())}): {r['qwen']['raw'][:180]}",
            "",
        ]
    OUT_MD.write_text("\n".join(lines), encoding="utf-8")


def main():
    qwen_key = load_qwen_key()
    # 13 角色 × 8 场景族；每族多轮 → 目标 ≥100 轮
    # 取：每角色跑 2 个场景（交错），约 13*2*平均3.5 ≈ 90+；再补满到 ≥100
    rows: list[dict] = []
    scene_cycle = list(SCENES)
    for idx, char in enumerate(CHARS):
        s1 = scene_cycle[idx % len(scene_cycle)]
        s2 = scene_cycle[(idx + 3) % len(scene_cycle)]
        rows.extend(run_pair(char, s1, qwen_key))
        rows.extend(run_pair(char, s2, qwen_key))
        if len(rows) >= 100:
            break

    # 若仍不足 100，用额外场景补
    extra_i = 0
    while len(rows) < 100:
        char = CHARS[extra_i % len(CHARS)]
        scene = SCENES[extra_i % len(SCENES)]
        rows.extend(run_pair(char, scene, qwen_key))
        extra_i += 1
        if extra_i > 40:
            break

    summary = aggregate(rows)
    report = {"summary": summary, "rows": rows, "models": {"fable": FABLE_MODEL, "qwen": QWEN_MODEL}}
    OUT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    write_md(summary, rows)
    print()
    print("=" * 60)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"Wrote {OUT_JSON}")
    print(f"Wrote {OUT_MD}")
    print("GATE:", "PASS" if summary["pass_gate"] else "FAIL")


if __name__ == "__main__":
    main()
