---
name: chroma-key-to-webm
description: >-
  Safe solid-background chroma key to transparent VP9 WebM for neon-snake-girl
  character videos. rembg core protection, soft #00b140 colorkey, green-dominance
  key for off-color H3 plates, spill QA. Use when user asks to key/remove background,
  export transparent webm, 抠图/抠像/去背景, 绿幕/蓝幕/chroma key, huanzhuang/换装 webm,
  or convert MP4 greenscreen/bluescreen to alpha video, black background not
  transparent, 黑色遮罩, 手机上黑底, 右键 inspect sees yuv420p.
---

# 安全抠像 → 透明 WebM

**Read first:** [docs/chroma-key-to-webm.md](../../../docs/chroma-key-to-webm.md)

> ⚠️ **铁律（2026-10 事故）：透明 VP9 的 alpha 是「分离流」，`ffprobe pix_fmt` 看不见。**
> 判断 webm 有没有 alpha，**必须**用 `-c:v libvpx-vp9` 真实解一帧看是否 RGBA，
> **禁止**用 `pix_fmt=yuv420p` 或 `ALPHA_MODE` 标签下结论。任何「读入 webm → 输出
> webm」的工具，编码都要按探测结果用 `yuva420p`（不能沿用 probe 的 pix_fmt），
> 否则 alpha 被静默丢弃 → 手机上黑底不透明（黑色遮罩）。详见文档「分离流」一节。

## When to use

- MP4/MOV with **solid color background** → transparent `.webm`
- User says: 抠图、抠像、去背景、透明 webm、绿幕/蓝幕、发丝溢色、换装 huanzhuang
- Quality bar: **never cut character or props (wardrobe)**; only remove green matte

## Hard rules

1. **Only key the green background** — do not eat character, sheer cloth, or wardrobe props
2. Prefer under-keying edges over cutting the subject
3. Default H3 matte is `#00b140`. If corners are dark/mint green, **do not** crank global `colorkey` similarity — use `green_dom` / `dual`
4. Encode `libvpx-vp9` + `yuva420p`; clear RGB where alpha≈0

## Scripts

| Script | Use |
|--------|-----|
| `scripts/chroma_key_safe_to_webm.py` | rembg-safe default for tricky spill / body holes |
| `scripts/key_huanzhuang_h3_to_webm.py` | H3 换装 `_h3_out` → `{Stem}_huanzhuang.webm` |
| `scripts/key_pifu04_new_to_webm.py` | `shenghuoshizhuang01/new` → `{stem}_pifu04.webm` |
| `scripts/chroma_key_gs_video_webm.py` | Fast ffmpeg colorkey — **default 0.35/0.08 too aggressive for huanzhuang** |
| `scripts/key_wuziqi_h3_to_webm.py` | 象棋主题皮：H3 渐变绿幕 → `{Stem}_wuziqi.webm`（色相域解析抠像） |

Core library: `scripts/chroma_key_lib.py`（`edge_matte_green_alpha()` / `despill_green()` 为色相域抠像与去溢色入口）

## Mode picker (H3 / greenscreen MP4)

| Situation | Mode |
|-----------|------|
| Pure `#00b140` plate | soft colorkey `0.16/0.04` (`--mode safe`) |
| **Plate colour drifts inside the frame** (corners differ: dark ↔ mint ↔ bright green) | `scripts/chroma_key_lib.py::edge_matte_green_alpha()` (hue-domain analytic matte) — see `scripts/key_wuziqi_h3_to_webm.py` |
| Off-color dark/mint green leftover | `--mode green_dom` (G-dominant + keep low-sat props) |
| Need rembg integrity ladder | `chroma_key_safe_to_webm.py` |

Known `green_dom` stems: `SSR03_1`, `UR04_1` (auto in huanzhuang script).

## Non-negotiables (rembg path)

1. **rembg core = force-keep** — eroded mask, alpha always 1 inside
2. Chroma + despill only **outside core** (rim / fringe)
3. **Integrity QA** before accept: `keep≥0.985`, `iou≥0.90`, `h≥0.97`
4. **Spill QA** on rim: reject if edge still has key-color spill
5. Ladder auto-retries softer `sim` if QA fails — **never ship a cut character**
6. Encode: `libvpx-vp9` + `yuva420p`, straight alpha, transparent RGB cleared
7. Visual check preview PNG before ship

## Key color (background not always green)

| Flag | When |
|------|------|
| `--key-color auto` | Default — sample corners of first frame |
| `--key-color green` | `#00b140` greenscreen |
| `--key-color blue` | `#0066ff` — blue/cyan hair characters |
| `--key-color magenta` | `#ff00ff` |
| `--key-rgb R,G,B` | Manual override when auto wrong |

**Rule:** pick background color that **contrasts** character costume/hair.

## Quick commands

```powershell
# rembg-safe generic batch
& 'E:\MiniMaxH3\venv\Scripts\python.exe' -u `
  scripts/chroma_key_safe_to_webm.py `
  --input-dir 'PATH\clips' `
  --output-dir 'PATH\clips\_webm_out' `
  --qa-dir 'PATH\clips\_key_qa' `
  --key-color auto `
  --force

# huanzhuang H3 → webm (soft + auto green_dom for SSR03/UR04)
& 'E:\MiniMaxH3\venv\Scripts\python.exe' -u `
  scripts/key_huanzhuang_h3_to_webm.py --stem all --force

# off-color greenscreen redo
& 'E:\MiniMaxH3\venv\Scripts\python.exe' -u `
  scripts/key_huanzhuang_h3_to_webm.py --stem SSR03_1,UR04_1 --force --mode green_dom
```

## Checklist

```
- [ ] Confirm background type → soft / green_dom / rembg
- [ ] Never use default 0.35/0.08 colorkey on wardrobe+character plates
- [ ] summary.json fail=[]
- [ ] Preview: body+props intact; corners alpha=0; no mint/dark green leftover
- [ ] Ship webm to target tex folder
```

## If user reports green leftover or cut body

1. Measure corner RGB vs `#00b140`
2. Leftover + off-color → `--mode green_dom` (or rembg safe)
3. Body/wardrobe holes → **lower** similarity / soft mode — never raise hard key
4. Spot-check `_webm_qa/{stem}_preview.png`

## If user reports black background / opaque on phone (黑色遮罩)

1. **先验文件，别先怪渲染**：用 `-c:v libvpx-vp9` 解一帧，看是否 `mode=RGBA`
   且有透明像素；对比原版透明资源。`ffprobe pix_fmt` 会骗人。
2. 若源有 alpha 而输出没有 → 工具丢了 alpha：解码端缺 `-c:v libvpx-vp9`，
   或编码端用了 `yuv420p` 而非 `yuva420p`。参考
   `scripts/webm_sticker_editor.py` 的 `_detect_alpha()` / `enc_pix_fmt`。
3. 若源和输出都没有 alpha → 那才是真抠像问题，回到上面的绿幕/chroma 流程。

## Output layout (huanzhuang)

| Path | Content |
|------|---------|
| `_h3_out/*_huanzhuang_gs_h3.mp4` | H3 greenscreen source |
| `{Stem}_huanzhuang.webm` | Final transparent video |
| `_webm_qa/{stem}_preview.png` | Mid-frame QA |
| `_webm_qa/summary.json` | Batch result |
