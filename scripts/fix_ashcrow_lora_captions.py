"""重写 ashcrow LoRA 训练集 caption：修正身份描述错误 + 补服装区分标签。

旧 caption 致命错误：
- "short messy silver-lavender hair" ← 角色实际是灰金色高马尾长发
- "cybernetic mechanical right leg" ← 实际是双臂双腿全机械
- 全部图片 caption 几乎相同，服装没有从触发词里解耦
"""
from __future__ import annotations

import json
import re
from pathlib import Path

DS = Path(r"E:\MiniMaxH3\ComfyUI\input\ashcrow_sr012_train")
DESKTOP_DS = Path.home() / "Desktop" / "ashcrow_sr012_lora_dataset"

# 身份块（与原立绘逐项核对：灰金高马尾、长侧发、平刘海、白色角状机械头饰、蓝瞳、苍白肌、细瘦体型、四肢全义体）
IDENTITY = (
    "ashcrow_sr012, 1girl, solo, character Ashcrow Mio, "
    "long ash-blonde hair, high ponytail, long side locks, blunt bangs, "
    "white horn-shaped mechanical hair ornaments, ice-blue eyes, "
    "pale fair skin, slim petite body, "
    "cybernetic prosthetic arms and legs, mechanical elbow and knee joints"
)

OUTFIT_HINTS = [
    (re.compile(r"pifu01|swim", re.I), "black swimsuit, poolside swimwear"),
    (re.compile(r"pifu02|shuiyi|sleep", re.I), "loose pajamas, sleepwear"),
    (re.compile(r"pifu03|chongzao|shower|towel", re.I), "bath towel wrapped around body, post-bath look"),
    (re.compile(r"pifu04|shizhuang|urban|casual", re.I), "urban casual street fashion, jacket and skirt"),
    (re.compile(r"pifu05|teshu|tease|special", re.I), "black special outfit, lingerie-style accent clothing"),
    (re.compile(r"pifu00|lifewear|homeland", re.I), "casual daily lifewear, simple home clothes"),
    (re.compile(r"huanzhuang|transition", re.I), "mid outfit-change pose"),
    (re.compile(r"tiaojiao|discipline|catsuit", re.I), "white tight full-body discipline catsuit"),
    (re.compile(r"emo_|emotion", re.I), "expressive pose, upper body focus"),
    (re.compile(r"avatar", re.I), "bust portrait, face close-up"),
]

DEFAULT_OUTFIT = (
    "white armored crop top, white shorts, white and grey mech armor plates, "
    "holding huge white railgun rifle"
)


def outfit_from_name(name: str) -> str:
    for rx, hint in OUTFIT_HINTS:
        if rx.search(name):
            return hint
    return DEFAULT_OUTFIT


def caption_for(stem: str) -> str:
    return (
        f"best quality, score_9, score_7, very aesthetic, "
        f"{IDENTITY}, {outfit_from_name(stem)}, "
        f"chroma key flat green background"
    )


def main() -> None:
    txts = sorted(DS.glob("*.txt"))
    changed = 0
    manifest = []
    for txt in txts:
        stem = txt.stem
        cap = caption_for(stem)
        txt.write_text(cap, encoding="utf-8")
        mirror = DESKTOP_DS / txt.name
        if mirror.exists():
            mirror.write_text(cap, encoding="utf-8")
        manifest.append({"file": stem + ".png", "caption": cap})
        changed += 1
    (DS / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"rewritten {changed} captions")
    # 抽查三张
    for probe in ["001_SR01_2.txt", "002_SR01_2_pifu01.txt"]:
        p = DS / probe
        if p.exists():
            print(f"--- {probe}\n{p.read_text(encoding='utf-8')}")


if __name__ == "__main__":
    main()
