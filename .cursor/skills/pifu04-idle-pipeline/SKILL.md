---
name: pifu04-idle-pipeline
description: >-
  Generates 5s transparent idle WebM live portraits from urban casual pifu04 PNGs
  (shenghuoshizhuang01) for neon-snake-girl via MiniMax H3 + #00b140 chroma key.
  Use when user asks for 都市私服动态/待机/pifu04 webm/shenghuoshizhuang01 动图.
---

# 都市私服 pifu04 → 动态待机

Script: `scripts/run_minimax_h3_pifu04_idle_batch.py`  
Asset folder `tex/juese/pifu/shenghuoshizhuang01/` **只保留** `{stem}_pifu04.png` + `{stem}_pifu04.webm`（绿幕/mp4/_qa/_first 生成后应删）。

## When to use

- 「按动图 SKILL / 之动图标准」生成 **都市私服** 待机循环
- `shenghuoshizhuang01` 目录下 `*_pifu04.png` → `*_pifu04.webm`
- 用户指定 **5 秒** idle、绿幕 H3、透明 WebM

## Non-negotiables

1. **参考只认 pifu04 静帧**：`{stem}_pifu04.png`（脸/身/义体/私服 1:1）
2. **仅 idle**：轻呼吸/微摆/眨眼；禁止换衣、走路、镜头推拉
3. **5.0s @ 24fps**：`LENGTH=120`；首尾帧一致便于循环
4. **绿幕 `#00b140`** → VP9 透明 WebM（与 pifu02/pifu03_idle 同类）
5. **中间件 mp4/绿幕首帧** 可进 `_qa`，打包 filter 排除 `*_idle_gs*` / `greenscreen`

## 一键命令

```powershell
# ComfyUI http://127.0.0.1:8188
& 'E:\MiniMaxH3\venv\Scripts\python.exe' -u `
  'D:\ruanjian\neon-snake-girl\neon-snake-girl\scripts\run_minimax_h3_pifu04_idle_batch.py' `
  --stem all
```

## Checklist

```
- [ ] ComfyUI 8188 在线
- [ ] 12 张 pifu04.png 齐全
- [ ] 跑 batch（--stem / --force）
- [ ] 目视 webm：透明底、循环自然、私服/义体不漂移
- [ ] 清理中间件：删 *_greenscreen* / *_idle_gs* / _qa / _first，目录只留 png+webm
- [ ] npm run build 或 cap:sync 进包（tex-ship 管线）
```

## 输出（目录最终态）

| 路径 | 内容 |
|---|---|
| `{stem}_pifu04.png` | 原图静帧（保留） |
| `{stem}_pifu04.webm` | 成品动态待机（保留） |
| `*_idle_gs*` / `*greenscreen*` / `_qa` / `_first` | 中间件，跑完即删 |