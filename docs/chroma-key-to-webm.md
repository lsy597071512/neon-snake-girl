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
| **绿通道占优抠像** | `key_huanzhuang_h3_to_webm.py --mode green_dom` | 吃掉暗绿/薄荷绿幕；保白衣柜 | 每帧 numpy；略慢 |
| **安全抠像（rembg）** | `scripts/chroma_key_safe_to_webm.py` | rembg 保护主体 + 阶梯 QA | 慢（每帧 rembg） |

### 选路决策

| 源片情况 | 选用 |
|----------|------|
| 标准 H3 纯绿 `#00b140`，无大面积同色道具被误伤 | **软 colorkey** `similarity=0.16` `blend=0.04` |
| 四角实测远不是 `#00b140`（偏暗 / 薄荷），或软抠后四角仍不透 | **green_dom**（绿通道占优 + 低饱和强制保留） |
| 发丝溢色严重、主体易被切、需要 QA 阶梯 | **安全 rembg** `chroma_key_safe_to_webm.py` |
| 仅冒烟看一眼 | 默认可先软 colorkey；验收不过再升档 |

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

---

## 相关文件

| 文件 | 角色 |
|------|------|
| `scripts/chroma_key_lib.py` | 核心库（key / rembg / QA / 编码） |
| `scripts/chroma_key_safe_to_webm.py` | 通用安全 rembg CLI |
| `scripts/chroma_key_gs_video_webm.py` | 简易 ffmpeg colorkey（默认偏狠，换装慎用） |
| `scripts/key_pifu04_new_to_webm.py` | pifu04 项目封装 |
| `scripts/key_huanzhuang_h3_to_webm.py` | 换装 H3 → WebM（soft / green_dom） |
| `scripts/key_pifu02_new_to_webm.py` | 睡衣安全抠像封装 |
| `.cursor/skills/chroma-key-to-webm/SKILL.md` | Agent Skill |

---

## 清理

批处理完成后可删（源 MP4 按需保留）：

- `_key_qa/*/raw/`、`_key_qa/*/keyed/`（体积大）
- 保留：`*_preview_rgba.png`、`summary.json`、最终 `.webm`
