---
title: 安全抠像与透明 WebM 流程
created: 2026-08-05
author: AI-assisted
last_updated: 2026-10-18
updated_by: AI-assisted
status: active
---

# 安全抠像 → 透明 WebM 流程

> 适用于：绿幕 / 蓝幕 / 品红幕等**纯色背景**实拍或 AI 生成视频，输出 **VP9 + Alpha** 透明 `.webm`。  
> 核心原则：**宁可少抠边缘，绝不损伤角色主体**。

---

## 何时使用

- 已有 **MP4/MOV** 纯色背景角色视频，需要透明 WebM 进游戏
- 发丝/裙摆边缘有溢色，需要比 ffmpeg `colorkey` 更稳的抠像
- 背景色不固定（绿 / 蓝 / 自定义 RGB）

## 硬规则（角色 / 道具 / 绿幕）

1. **只抠绿色背景**，不得抠穿角色、半透明布、衣柜等道具。
2. **宁可少抠边缘，绝不损伤主体**（与文首原则一致）。
3. 默认 H3 绿幕目标色为 `#00b140`（RGB `0,177,64`）；若生成片色偏（偏暗绿 / 薄荷绿），**禁止**盲目加大全局 `colorkey` similarity 硬抠——会吃进主体；改用下方「色偏绿幕」策略。
4. 透明区必须 **RGB 清零**（premultiply），再以 `libvpx-vp9` + `yuva420p` 编码。

## 与简易 colorkey 的区别

| 方式 | 脚本 | 优点 | 缺点 |
|------|------|------|------|
| 快速 colorkey（默认偏狠） | `scripts/chroma_key_gs_video_webm.py`（`0.35/0.08`） | 快、一条 ffmpeg | **易吃发丝/布/道具**；仅适合粗测 |
| **软 colorkey（纯 `#00b140`）** | 同库，自定义 vf `0.16/0.04` | 快；保角色与道具 | 色偏绿幕会残留 |
| **色相域解析抠像（渐变绿幕）** | `scripts/chroma_key_lib.py::edge_matte_green_alpha()` | 幕色在画面内漂移也能抠净；主体内绿色配件不受影响 | 每帧 numpy（比 ffmpeg 慢一点） |
| **绿通道占优抠像** | `key_huanzhuang_h3_to_webm.py --mode green_dom` | 吃掉暗绿/薄荷绿幕；保白衣柜 | 每帧 numpy；略慢 |
| **安全抠像（rembg）** | `scripts/chroma_key_safe_to_webm.py` | rembg 保护主体 + 阶梯 QA | 慢（每帧 rembg） |

### 选路决策

| 源片情况 | 选用 |
|----------|------|
| 标准 H3 纯绿 `#00b140`，无大面积同色道具被误伤 | **软 colorkey** `similarity=0.16` `blend=0.04` |
| **幕色在画面内漂移**（四角实测互不相同，例如 `(0,120,48)` ↔ `(80,196,146)`） | **`edge_matte_green_alpha()`** 色相域解析抠像 |
| 四角实测远不是 `#00b140`（偏暗 / 薄荷），或软抠后四角仍不透 | **green_dom**（绿通道占优 + 低饱和强制保留） |
| 发丝溢色严重、主体易被切、需要 QA 阶梯 | **安全 rembg** `chroma_key_safe_to_webm.py` |
| 仅冒烟看一眼 | 默认可先软 colorkey；验收不过再升档 |

### 色相域解析抠像（`edge_matte_green_alpha`）

给「幕色不纯」的 H3 片用（实测 `tex/juese/pifu/wuziqi/` 13 条片：幕色在画面内
从 `(0,120,48)` 漂到 `(48,146,104)`、`(80,196,146)`）。固定色 colorkey 在这种片上
要么留绿边、要么吃进身体，必须换成色相域判定：

1. **幕色似然** = 绿色色相带（中心 150°，半宽 70°）× 饱和度 × 明度。
   皮肤（色相 ≈25°）、紫/蓝发（≈220~280°）得分 0，天然不被误伤。
2. **只删与画面边缘连通的幕布**（`scipy.ndimage.label` 连通域 + 边框取样），
   主体内部的绿色配件（发梢、瞳色、机械饰件）不会被当成幕布抠掉。
3. **强制保留**：`R ≥ G` 的像素（皮肤高光/绿光下的肤色）与低饱和像素（白/银发）
   一律 alpha=1。
4. **边界 ramp + 去溢色**：`despill_green()` 把半透明边缘的绿通道压到 `max(R,B)`。

参考实现：`scripts/key_wuziqi_h3_to_webm.py`（13 条片全通过 QA）。


---

## 流水线概览

```
输入 MP4（纯色背景）
    ↓
1. 采样 key 色（四角 auto / 预设 / 手动 RGB）
2. rembg 每帧 → 腐蚀得「核心区」force-keep
3. 软 chroma + 边缘收紧 + 主色道 despill
4. 完整性 QA（keep≥98.5%）+ 溢色 QA（边缘无残留）
    ↓ 失败则换更软 sim 重试
5. VP9 yuva420p 编码（CRF 20）
6. 输出 webm + QA 预览 PNG
```

### 完整性（不可妥协）

- rembg **核心区** alpha 强制 = 1，**绝不裁切**
- 只在核心区外做更激进的 key / despill
- 任一步抠到主体 → 该阶梯 **REJECT**，自动换更软参数

### 溢色清理

- 按 key 色**主通道**计算溢色（绿幕看 G，蓝幕看 B）
- 发丝等半透明边缘：降 alpha + 去主色道溢色
- 核心区仅做轻微颜色修正，不削轮廓

---

## 依赖

```text
Python 3.10+
E:\MiniMaxH3\venv  (或项目内已装 rembg / scipy / pillow / numpy / imageio-ffmpeg)
ffmpeg（由 imageio-ffmpeg 提供）
rembg u2net
```

---

## 通用命令

### 1. 自动采样背景色（推荐）

```powershell
& 'E:\MiniMaxH3\venv\Scripts\python.exe' -u `
  'D:\ruanjian\neon-snake-girl\neon-snake-girl\scripts\chroma_key_safe_to_webm.py' `
  --input-dir  'path\to\clips' `
  --output-dir 'path\to\clips\_webm_out' `
  --qa-dir     'path\to\clips\_key_qa' `
  --glob '*.mp4' `
  --output-template '{stem}.webm' `
  --force
```

### 2. 蓝幕预设

```powershell
... chroma_key_safe_to_webm.py `
  --input clip.mp4 --output out.webm `
  --key-color blue
```

预设：`green` `#00b140` · `blue` `#0066ff` · `magenta` `#ff00ff`

### 3. 手动 key RGB

```powershell
... --key-rgb 73,152,85
```

### 4. 带角色映射 + 同步到正式目录

`config/chroma_key_name_map.example.json`:

```json
{
  "Asset-d9v3ye7cj6i": { "stem": "SR01_2", "name": "苍羽·澪" },
  "Asset-99ndra67667": { "stem": "SR01_3", "name": "苍斩·凛" }
}
```

```powershell
... --name-map config/chroma_key_name_map.json `
    --output-template '{stem}_pifu04.webm' `
    --ship-dir tex/juese/pifu/shenghuoshizhuang01 `
    --only SR01_2,SR03_1
```

---

## 项目专用：都市私服 pifu04

```powershell
& 'E:\MiniMaxH3\venv\Scripts\python.exe' -u `
  'scripts/key_pifu04_new_to_webm.py' `
  --force
```

| 路径 | 说明 |
|------|------|
| `tex/juese/pifu/shenghuoshizhuang01/new/*.mp4` | 源视频 |
| `new/_webm_out/{stem}_pifu04.webm` | 输出 |
| `new/_key_qa/{stem}/{stem}_preview_rgba.png` | 首帧 QA |
| `shenghuoshizhuang01/{stem}_pifu04.webm` | 正式目录（自动 ship） |

---

## 项目专用：换装动态 huanzhuang（H3 绿幕 → WebM）

MiniMax H3 竖屏换装片（角色 + 衣柜道具 + 绿幕）进游戏前，必须抠成透明 WebM。  
封装脚本：`scripts/key_huanzhuang_h3_to_webm.py`。

### 路径约定

| 路径 | 说明 |
|------|------|
| `tex/juese/pifu/huanzhuang/_h3_out/{Stem}_huanzhuang_gs_h3.mp4` | H3 绿幕源 |
| `tex/juese/pifu/huanzhuang/{Stem}_huanzhuang.webm` | 正式透明 WebM |
| `tex/juese/pifu/huanzhuang/_webm_qa/` | 预览 PNG + `summary.json` |

### 两种抠像模式（本批沉淀）

#### A. 软 colorkey（`--mode safe`，默认给标准绿幕）

- 目标色：`#00b140`
- ffmpeg：`colorkey=0x00B140:0.16:0.04` + RGBA 清零 + `yuva420p`
- **禁止**再用库默认 `0.35/0.08` 批处理换装片（会抠穿角色/半透明布/衣柜）
- 验收：四角 `alpha≈0`；角色与衣柜轮廓完整

#### B. 绿通道占优（`--mode green_dom`，色偏绿幕）

适用：四角实测 RGB 距 `#00b140` 很远（例：暗绿 `~ (40,110,50)`、薄荷绿残留），软 colorkey 抠不干净。

算法要点（写进脚本，勿口头改参硬抠）：

1. **硬抠**：`G` 明显高于 `R/B` 且饱和度足够 → 视为幕布  
2. **软边**：略放宽阈值，半透明过渡  
3. **强制保留**：低饱和像素（白/米衣柜、肤色高光）`alpha` 抬回  
4. **底边细绿线**：对背景 mask 做 1–2px dilation 再压透明  
5. 透明像素 RGB 清零 → VP9 `yuva420p`

已知需 `green_dom` 的 stem（脚本 `DEFAULT_GREEN_DOM`）：`SSR03_1`、`UR04_1`。新片若四角不透，先测色再决定升档，不要全局加大 similarity。

### 命令

```powershell
# 全员：标准绿幕走 soft；SSR03/UR04 自动 green_dom
& 'E:\MiniMaxH3\venv\Scripts\python.exe' -u scripts/key_huanzhuang_h3_to_webm.py --stem all --force

# 单独重抠色偏片
& 'E:\MiniMaxH3\venv\Scripts\python.exe' -u scripts/key_huanzhuang_h3_to_webm.py `
  --stem SSR03_1,UR04_1 --force --mode green_dom
```

`--mode`：`auto`（默认）| `safe` | `dual`（四角采样双 colorkey）| `green_dom`

### 换装片 QA 增量检查

```
- [ ] 角色肢体 / 发丝 / 半透明换装布无破洞
- [ ] 衣柜整柜保留（门、抽屉、内部衣服）
- [ ] 四角与底边无残留绿幕（含暗绿、薄荷绿）
- [ ] libvpx-vp9 解码预览：TL/TR/BL/BR alpha=0
- [ ] leftover_green%（G 占优且仍不透明）≈ 0
```

---

## 透明 VP9 的 alpha 是「分离流」：ffprobe 看不见（2026-10 事故沉淀）

**结论先行：永远不要用 `ffprobe` 的 `pix_fmt` 判断文件有没有 alpha。**
透明 VP9 webm 的 alpha 存在独立附属流里，`ffprobe` 只报主流的 `yuv420p`，
看起来和不透明文件一模一样。唯一可靠的判据是**用 `-c:v libvpx-vp9`
解码器真实解一帧**：输出 `RGBA` 且存在 `alpha < 250` 的像素 → 带透明。

实测对照（`tex/juese/pifu/chongzao/SR01_2_pifu03.webm` 等）：

| 检测方式 | 结果 |
|----------|------|
| `ffprobe pix_fmt` | `yuv420p`（看不见 alpha，误判为不透明） |
| 原生解码器解码 → PNG | `mode=RGB`，alpha 全 255（alpha 被直接丢弃） |
| `-c:v libvpx-vp9` 解码 → PNG | `mode=RGBA`，透明像素约 30%（真身） |

**事故经过**：`tools/WebmStickerEditor.exe` 重编码时沿用了 `ffprobe` 的
`pix_fmt=yuv420p`，且解码端没指定 libvpx，alpha 在解码/编码两个环节被
静默丢弃。输出文件在手机上显示为「黑底不透明」（黑色遮罩），而项目原版
资源全部透明。修法见 `scripts/webm_sticker_editor.py` 的 `_detect_alpha()`、
`VideoSpec.enc_pix_fmt`（`yuva420p`）与解码端 `-c:v libvpx-vp9`。

**从此以后的铁律**：

1. 判断 alpha 必须 libvpx 真实解码（`_detect_alpha()` 那种做法），
   **禁止**用 `pix_fmt` / `ALPHA_MODE` 标签做结论（后者时有时无，不可靠）。
2. 凡是「读入 webm → 输出 webm」的工具，编码必须用源 alpha 探测结果
   决定 `yuva420p / yuv420p`，**禁止**沿用 probe 来的 pix_fmt。
3. 导出 QA 必须包含 libvpx 解码回读：输出 `mode=RGBA` 且透明占比与源接近，
   并检查容器 `TAG:alpha_mode=1`。

---

## 输出规格

| 项 | 值 |
|----|-----|
| 编码 | libvpx-vp9 |
| 像素格式 | yuva420p（带 alpha） |
| CRF | 20（默认，可用 `--crf` 调整） |
| 帧率 | 24（默认） |
| Alpha | 直通道；透明区 RGB 清零 |

---

## QA 检查清单

```
- [ ] summary.json 中 fail 为空
- [ ] 预览 PNG：发丝/裙摆无背景色溢色
- [ ] 预览 PNG：角色无缺口（头发、手指、机械件）
- [ ] WebM 在 libvpx 解码下四角透明（TL alpha ≈ 0）
- [ ] 游戏内叠加到营地背景再目视确认
```

### 指标含义（日志）

| 日志 | 含义 |
|------|------|
| `keep=1.0000` | 核心区 100% 保留 |
| `iou≥0.90` | 抠像轮廓与保护 mask 一致 |
| `rim_bad%` | 边缘强溢色像素占比（越低越好） |
| `mean_spill` | 边缘平均溢色（越低越好） |

---

## 背景色选择指南

| 场景 | 建议 |
|------|------|
| 普通角色 | 绿 `#00b140` 或 `--key-color green` |
| 蓝/青发色（SSR03_1、UR04_1） | 蓝幕 `#0066ff` |
| 大面积同色系服装 | 用**对比色**幕 + 对应 `--key-color` |
| 不确定 | `--key-color auto`（四角采样） |
| 采样不准 | `--key-rgb R,G,B` 手动指定 |

---

## 故障排查

| 现象 | 处理 |
|------|------|
| 发丝仍有绿/蓝边 | 加 `--force` 重跑；检查 `_key_qa` 预览；必要时 `--key-rgb` 微调 |
| 角色被抠缺 | **禁止**手动加大 sim；检查源视频是否缺肢体；换更软阶梯 / 软 colorkey `0.16` |
| 衣柜/道具被抠穿 | 立刻改软 colorkey 或 `green_dom`；**禁止**用默认 `0.35/0.08` |
| 四角仍不透明、底边细绿线 | 源幕色偏 → `--mode green_dom` 或 `--mode dual`；先 `ffprobe`/抽帧测四角 RGB |
| 底部大块背景残留 | auto key 不准 → 手动 `--key-rgb` 或 green_dom |
| 角色服装同色被吃 | 换对比色重拍/重生成；或 `--key-rgb` 精确到实际背景 |
| 全阶梯 FAIL | 源片主体不完整或 rembg 失败；检查 integrity plate `bbox_h` |
| 手机上黑底不透明（黑色遮罩），但 `ffprobe` 显示 `yuv420p` | 见上文「分离流」一节。先用 `-c:v libvpx-vp9` 解一帧确认 alpha 是否存在；若存在，检查工具是否丢了 alpha（解码缺 libvpx / 编码没用 `yuva420p`）。**先验文件，再怪渲染** |

---

## 相关文件

| 文件 | 角色 |
|------|------|
| `scripts/chroma_key_lib.py` | 核心库（key / rembg / QA / 编码 / 色相域解析抠像） |
| `scripts/chroma_key_safe_to_webm.py` | 通用安全 rembg CLI |
| `scripts/chroma_key_gs_video_webm.py` | 简易 ffmpeg colorkey（默认偏狠，换装慎用） |
| `scripts/key_pifu04_new_to_webm.py` | pifu04 项目封装 |
| `scripts/key_huanzhuang_h3_to_webm.py` | 换装 H3 → WebM（soft / green_dom） |
| `scripts/key_pifu02_new_to_webm.py` | 睡衣安全抠像封装 |
| `scripts/key_wuziqi_h3_to_webm.py` | 象棋主题皮：H3 渐变绿幕 → `{Stem}_wuziqi.webm` |
| `.cursor/skills/chroma-key-to-webm/SKILL.md` | Agent Skill |

---

## 桌面批处理 GUI

项目提供 Windows 下的 Tkinter 操作界面：

```powershell
python scripts/webm_batch_gui.py
```

界面支持：

- 输入目录、输出目录、QA 目录选择
- 批量筛选 `*.mp4`（也可改为 `*.mov` 或其它 ffmpeg 支持的模式）
- 背景色 `auto / green / blue / magenta`
- 主体保护优先、覆盖已有文件
- VP9 无损模式（默认开启）与 CRF 模式
- 实时显示每个文件的完整性 QA、边缘溢色 QA、WebM Alpha 验证结果
- 一键打开 `_key_qa/summary.json` 和预览目录

GUI 只是 CLI 的操作外壳，实际处理仍使用 `chroma_key_lib.py` 的保护核心、软抠像、去溢色和 QA 阶梯；因此不会因为界面操作而退化成简单的全局 `colorkey`。

## 画质与透明通道说明

项目目标格式是 `libvpx-vp9 + yuva420p`，这是当前游戏运行时的兼容规范。GUI 默认启用 VP9 lossless，避免 VP9 量化继续损失 RGB 细节；但 `yuva420p` 本身仍有 4:2:0 色度采样，这是透明 WebM 兼容格式的技术限制，并非真正意义上的逐像素 RGB 无损。若必须保留每个 RGB 色度样本，需改用中间 RGBA PNG 序列或支持 `yuva444p` 的完整播放链路，不能保证当前浏览器/游戏运行时兼容。因此本项目优先保证：主体与道具不被误抠、发丝边缘不出现硬锯齿、Alpha 正确、游戏可播放。

## 清理

批处理完成后可删（源 MP4 按需保留）：

- `_key_qa/*/raw/`、`_key_qa/*/keyed/`（体积大）
- 保留：`*_preview_rgba.png`、`summary.json`、最终 `.webm`
