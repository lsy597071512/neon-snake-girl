---
name: shuiyi-luoti-pipeline
description: >-
  Generates nude idle transparent PNG plates from starry sleepwear (pifu02)
  for neon-snake-girl. Use when user asks for 睡衣裸体/shuiyi luoti/脱掉睡衣待机图,
  batch or single-stem regen under tex/juese/pifu/shuiyi/luoti, or full-body
  cloth/cyber QA for sleepwear-locked nudes.
---

# 星夜睡衣 → 裸体待机 (shuiyi-luoti)

Project doc（全文）: `tex/juese/pifu/shuiyi/luoti/PIPELINE.md`  
Script: `scripts/run_minimax_h3_shuiyi_luoti_batch.py`

## Rule sync（强制）

改固定规则时，同步更新：

1. `tex/juese/pifu/shuiyi/luoti/PIPELINE.md`
2. 本 Skill（`.cursor/skills/shuiyi-luoti-pipeline/`）
3. 个人副本 `~/.cursor/skills/shuiyi-luoti-pipeline/`（保持一致）
4. `scripts/run_minimax_h3_shuiyi_luoti_batch.py`

## When to use

- 「按睡衣皮生成裸体」「shuiyi luoti」「脱掉睡衣待机」
- 重做某个 / 全部 `*_pifu02` 对应裸体 2K 透明图
- 用户强调：全身完整、有衣服打回、脸/身体跟睡衣一致

## Non-negotiables

1. **参考只认睡衣皮**：`tex/juese/pifu/shuiyi/{stem}_pifu02.png`（脸/身/义体/画风 1:1）
2. **只脱布料**：吊带背心 + 短裤 / 蕾丝；**义体/耳机/耳饰是身体，禁止删**
3. **全身完整**：头顶到脚底都在画内，留边；半身/缺脚/贴边 → **REJECT 重生成**
4. **有衣服裤子 → REJECT**（camisole / shorts / underwear / lace）
5. **透明 PNG**：柔边 chroma `#00b140`；成品 1440×2560 RGBA
6. **清晰 2K**：RealESRGAN anime 超分 + **contain_fit**（禁止 cover 裁切手脚；禁止纯 LANCZOS 糊拉）
7. **三围**：跟 `characters.ts` / 脚本 `CHARS[].measure`
8. **发货前必须看图**，不要只信 cloth/cyber 分数

## 一键命令

```powershell
# 需 ComfyUI MiniMax H3 在 127.0.0.1:8188
& 'E:\MiniMaxH3\venv\Scripts\python.exe' -u `
  'D:\neon-snake-girl\neon-snake-girl\scripts\run_minimax_h3_shuiyi_luoti_batch.py' `
  --stem all --force `
  2>&1 | Tee-Object -FilePath 'D:\neon-snake-girl\neon-snake-girl\tex\juese\pifu\shuiyi\luoti\_batch.log'

# 单角色
& 'E:\MiniMaxH3\venv\Scripts\python.exe' -u `
  '...\scripts\run_minimax_h3_shuiyi_luoti_batch.py' --stem SR01_2 --force
```

## Pipeline checklist

```
- [ ] ComfyUI 8188 空闲；MiniMaxH3 venv 可用
- [ ] 确认 pifu02 存在；需要时更新脚本 CHARS lock/measure
- [ ] 跑 batch（--stem / --force）
- [ ] 读 _batch.log：PASS / REJECT fullbody|cloth|cyber
- [ ] 目视 {stem}_luoti.png：全身、无衣、脸/义体贴睡衣、边缘柔、够清晰
- [ ] 不合格只重跑该 stem，勿混用 chongzao/luoti_daiji 旧资产
```

## 输出

| 路径 | 内容 |
|---|---|
| `shuiyi/luoti/{stem}_luoti.png` | 成品 |
| `shuiyi/luoti/_first/` | 绿幕首帧 |
| `shuiyi/luoti/_qa/` | mp4 / 抽帧 / keyed |
| `shuiyi/luoti/_batch.log` | 跑批日志 |

## QA reject（regen）

- 头顶/脚底裁切或贴边；半身；缺脚
- 躯干仍有睡衣布料/短裤
- 参考有机械腿 → 结果变肉腿
- 脸/发/瞳与 pifu02 漂移
- 模糊（未走 ESRGAN / 被 cover 切坏）

## 勿与旧线混淆

- **现行**：`tex/juese/pifu/shuiyi/luoti/`（睡衣同源）
- **旧实验**：`tex/juese/pifu/chongzao/luoti_daiji/`（冲澡线）— 默认不要当睡衣裸体成品
