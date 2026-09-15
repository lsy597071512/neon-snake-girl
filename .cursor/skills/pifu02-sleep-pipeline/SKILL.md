---
name: pifu02-sleep-pipeline
description: >-
  Generates 4s transparent sleeping-loop WebMs from finished static sleep pose plates
  for neon-snake-girl via MiniMax H3 breath loop + blue chroma key. Use when user asks for
  睡衣睡眠/睡觉动态/pifu02_sleep/sleeping live portrait.
---

# 星夜睡衣 → 睡眠循环动态 (pifu02_sleep)

Primary script (preferred when static sleep plates exist):  
`scripts/run_minimax_h3_pifu02_sleep_from_pose_batch.py`  

Legacy 2-pass morph script:  
`scripts/run_minimax_h3_pifu02_sleep_batch.py`  

Output: `tex/juese/pifu/shuiyi/{stem}_pifu02_sleep.webm`

## 内容硬规则（最高优先级）

- **服装锁定**：与静态睡眠图第一帧完全一致；禁止脱衣、移动肩带/下摆、额外露肤
- **提示词禁止**：不要写 nipples/areola/breasts/cleavage/sheer/see-through/translucent/undress/bare；只用正向「thick matte opaque / flat cloth panel」
- **透点打回**：姿态板先 `harden_sleepwear_opacity`；呼吸视频每帧跑 `opacity[t]` 门控，失败整段作废重生成
- 漏点板子：`_qa_sleep/{stem}/{stem}_nipple_reject_pose_gs.png`；失败帧：`bN_reject_*.png`

## Pipeline (from-pose, preferred)

1. Normalize user static sleep plate → `*_pifu02_sleep_pose_gs.png` on blue #0066FF
2. **Breath loop only** (4.0s / 96f, with `last_frame`): soft breathing, camera locked
3. Encode VP9 alpha with blue colorkey
4. Over-key QA vs static silhouette — if character body eaten, softer key or regen

## Legacy 2-pass (only if no static sleep plate)

1. Morph standing → sleep mid-frame
2. Soft chroma + nipple/cover gate → sleep key plate
3. Breath loop + blue colorkey

## Other non-negotiables

1. Fabric lock must match each `{stem}_pifu02.png` / sleep plate (SR01_2 = white ivory, NOT mint)
2. Vertical 768×1344, whole body complete
3. Keep pure chroma void every frame:
   - default **blue #0066FF**
   - **blue/cyan hair** characters (`SSR03_1`, `UR04_1`) use **green #00B140** then green colorkey (avoid eating hair)
4. After batch: keep `{stem}_pifu02.png`, `{stem}_pifu02.webm`, `{stem}_pifu02_sleep.webm`

## Runtime

Camp channel + `activity === 'sleeping'` → `portraitLiveSleep`.

## Command

```powershell
& 'E:\MiniMaxH3\venv\Scripts\python.exe' -u `
  'D:\ruanjian\neon-snake-girl\neon-snake-girl\scripts\run_minimax_h3_pifu02_sleep_from_pose_batch.py' `
  --stem all --force
```
