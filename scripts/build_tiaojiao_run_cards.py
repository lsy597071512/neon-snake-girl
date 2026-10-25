"""Generate Stage-A copy-paste prompt cards for one character from PROMPTS.json v3.

Usage: python scripts/build_tiaojiao_run_cards.py SSR05_1
Output: tex/.../tiaojiao_multipose_v2/RUN_CARDS_{CHAR}.md
"""
import json
import os
import sys

CHAR = sys.argv[1] if len(sys.argv) > 1 else "SSR05_1"
BASE = os.path.join(
    "tex", "juese", "pifu", "pifu_weizhi", "tiaojiao_multipose_v2"
)
PROMPTS = json.load(open(os.path.join(BASE, "PROMPTS.json"), encoding="utf-8"))

TAIL = " EXPRESSION shy: soft blush, hesitant half-lidded eyes, lips softly parted. Not smug. BACKGROUND pure flat #00b140 green only. No floor, bed, sofa, beach, cave, room."

lines = [
    f"# {CHAR} 阶段 A 内置生图卡（7 姿势 · 即贴即用）",
    "",
    f"参考顺序（每次都一样）：Image1 身份 `v2/_refs/chars/{CHAR}.png` → Image2 姿势 `v2/_refs/pose_*.jpg|png` → Image3 触手 `v2/_refs/tentacle.png`，比例 9:16。",
    f"产出：`v2/_locks/{CHAR}/p{{N}}_{{id}}.png`。失败进 `v2/_reject/` 换措辞重跑。",
    "",
    "---",
    "",
]
for pose in PROMPTS["poses"]:
    ref = pose["ref"].split("/")[-1]
    full = (
        PROMPTS["lock_prefix"]
        + " "
        + PROMPTS["tentacle_map"]
        + " "
        + PROMPTS["anatomy_protocol"]
        + " "
        + pose["pose_camera"]
        + TAIL
    )
    lines += [
        f"## p{pose['idx']}_{pose['id']}（Image2 = {ref}）",
        "",
        "```text",
        full,
        "```",
        "",
    ]

out = os.path.join(BASE, f"RUN_CARDS_{CHAR}.md")
open(out, "w", encoding="utf-8").write("\n".join(lines))
print("wrote", out)
