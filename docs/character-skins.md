---
title: 特别皮肤同步清单与透明 WebM 资产规范
created: 2026-08-05
author: AI-assisted
last_updated: 2026-09-26
updated_by: AI-assisted
status: active
---

# 特别皮肤同步清单

资源目录：`tex/juese/pifu/`

## 皮肤格式与属性分析

### 1. 皮肤注册表不是单一图片表，而是「外覆 + 场景播放策略」

`src/data/characterSkins.ts` 中的 `CharacterSkinDef` 同时描述外观、静态资源、动态资源、战斗模型和 AI 观感。关键字段如下：

| 字段 | 格式 | 用途与约束 |
|---|---|---|
| `id` | `pifu00`～`pifu09`、`huanzhuang` | 游戏状态和换装协议的稳定标识，不随文件名随意改动 |
| `name` / `price` | 字符串 / 数字 | UI 显示与看板娘商店；事件临时皮价格为 0 |
| `preview` | PNG 或 WebM 路径 | 商店/事件无静帧时可回退 WebM，但 PNG 仍建议保留作 poster |
| `portraits` | PNG 路径数组 | 主页正背面/多张静态立绘；无静帧的浴室事件为空数组 |
| `portraitLive` | 单个 WebM 路径或空字符串 | 日常 idle 主循环；空字符串表示只用静态图 |
| `portraitLiveSecondaries` | WebM 路径数组 | 点击互动动作，索引从 1 映射到 `_1.webm`，禁止跨皮肤播放 |
| `portraitLiveSecondaryLoops` | 可选数组 | 某条前奏播完后粘住的循环，例如 `pifu08_2.webm` → `pifu08_2_loop.webm` |
| `portraitLiveSleep` | 可选 WebM | 仅 `activity=sleeping` 使用，不能替代站立 idle |
| `portraitLiveIntimate` / `portraitLiveIntimateIntro` | 可选 WebM | 洗浴同意后的循环与一次性前奏，必须受 consent 状态控制 |
| `combatModel` | GLB 路径或 `null` | 皮肤战斗模型；没有独立模型时回退默认装甲 |
| `aiLookNote` / `ai*LiveNote` | 文本 | 把玩家实际看到的服装、动作和场景同步给 AI，不能描述成另一套资源 |

### 2. 当前资源命名族

所有动态素材均以角色 `ArtStem` 开头，例如 `SSR03_1`；扩展名必须是透明 VP9 WebM，而不是普通无 Alpha 的 WebM。

- `shenghuofuzhuang00/{Stem}_pifu00.webm`：营地日常默认生活服装。
- `{Stem}_pifu01.webm`、`_1.webm`…：泳池主循环与互动动作。
- `shuiyi/{Stem}_pifu02.webm`、`_sleep.webm`：睡衣站立 idle 与睡眠循环。
- `chongzao/{Stem}_pifu03_idle.webm`、`_full.webm`、`{Stem}_pifu03.webm`：浴室常态、脱巾前奏、同意后的循环。
- `shenghuoshizhuang01/{Stem}_pifu04.webm`：都市私服 idle。
- `teshufuzhuang01/{Stem}_pifu05.webm`、`_1.webm`…：特殊服装 idle 与互动动作。
- `tiaojiao/{Stem}_tiaojiao.webm`、`_1.webm`…：仅小黑屋事件。
- `huanzhuang/{Stem}_huanzhuang.webm`：换装过程皮，不是最终皮肤。
- `chongzao01/{Stem}_pifu07.webm`、`chongzao02/{Stem}_pifu08.webm`：浴室临时互动皮（帮洗/共浴）。
- `chongzao02/solo/{Stem}_solo.webm`、`_solo_1.webm`：独自泡澡（pifu09；裹巾/脱巾）。
- `wuziqi/{Stem}_wuziqi.webm`：象棋主题事件皮（2026-10-22 归档，H3 产出为失败稿，未接入注册表、未进包，见下方专章）。

#### 命名规范速查（目录 → 文件名 → 皮肤 id）

| 目录 | 文件名模板 | 皮肤 id | 语义 |
|---|---|---|---|
| `tex/juese/pifu/` 根 | `{Stem}_pifu01.webm` | `pifu01` | 编号型：可购买/功能性皮肤，id 与文件名后缀一致 |
| `shenghuofuzhuang00/` | `{Stem}_pifu00.webm` | `pifu00` | 同上 |
| `shuiyi/` | `{Stem}_pifu02.webm` | `pifu02` | 同上 |
| `chongzao/` | `{Stem}_pifu03*.webm` | `pifu03` | 同上 |
| `shenghuoshizhuang01/` | `{Stem}_pifu04.webm` | `pifu04` | 同上 |
| `teshufuzhuang01/` | `{Stem}_pifu05.webm` | `pifu05` | 同上 |
| `chongzao01/` `chongzao02/` | `{Stem}_pifu07/08.webm` | `pifu07` `pifu08` | 同上 |
| `chongzao02/solo/` | `{Stem}_solo.webm` | `pifu09` | 编号型但用词命名（唯一例外） |
| `gongwu/` `dandu/` `danceidle/` | `{Stem}_{tag}.webm` | `gongwu` `dandu` `danceidle` | 事件型：文件名后缀 = 皮肤 id = 目录名 |
| `anfu/` | `{Stem}_idle/_anfu/_anfu_done.webm` | `anfu_standby/active/done` | 事件型：同皮肤三态，id = 后缀 |
| `huanzhuang/` | `{Stem}_huanzhuang.webm` | `huanzhuang` | 过程皮 |
| `tiaojiao/` | `{Stem}_tiaojiao.webm` | （不进注册表） | 事件型 |
| `wuziqi/` | `{Stem}_wuziqi.webm` | `wuziqi`（待注册） | 事件型（本次失败稿） |

**结论：新皮肤若不是「编号型商店皮」，一律走事件型命名——目录名 = 皮肤 id = 文件名后缀，
且文件名前缀必须是角色的 `ArtStem`（`SR01_2`…`UR04_1`）。**


### 3. 对批量抠像工具的直接要求

这些 WebM 的正确输入不是「任意人物视频」，而是带纯色幕的角色动态立绘。画面中角色身体、机械义体、翅膀、尾巴、衣柜、浴巾、衣物半透明褶皱等都属于前景，必须完整保留；只有纯色背景区域变为 Alpha 0。

因此工具采用 `rembg` 生成主体保护核心，再在核心外做软色键和去溢色：主体完整性优先于把最后一圈绿边抠干净。对于发丝、薄布和道具，宁可留下少量背景色也不能制造洞和锯齿；最终必须通过 `keep / IoU / bbox height / rim spill / Alpha corners` QA 后再进入上述命名目录。

资源更新时，先按命名族批量生成 WebM，再同步 `CharacterSkinDef` 的数量字段和场景字段；不要只改路径，否则运行时可能播放不存在的互动条目或把前奏当循环。
  
注册表：`src/data/characterSkins.ts`

| 角色 | ArtStem | 静帧 | 互动 webm | 战斗 glb | 备注 |
|------|---------|------|-----------|----------|------|
| skyshard 冰华·雫 | SSR03_1 | 2 | 3 | 有 | |
| dustblade 绯尾·椿 | SSR04_1 | 1 | 2 | **暂无**（战斗用默认） | 2026-08-05 新增 |
| ironrain 橙铠·琥珀 | SSR05_1 | 1 | 4 | 有 | |
| stellar 光轮·天音 | UR03_1 | 2 | 4 | 有 | |
| outercore 橙兔·美羽 | UR04_1 | 1 | 3 | 有 | |

### 睡衣 / 冲澡动态（2026-08-15，idle 同步 2026-08-19；睡眠系统 2026-08-21）

- 睡衣：`tex/juese/pifu/shuiyi/{Stem}_pifu02.webm`（站立 idle，13 人）
- 睡衣睡眠：`tex/juese/pifu/shuiyi/{Stem}_pifu02_sleep.webm`（4s 睡姿循环；**睡眠系统**完全入睡时播放）
- **睡眠系统**（`src/ai/sleepSystem.ts`）：每日需睡以恢复电力；一整觉≈现实 6 小时；日/夜均可、夜间几率更大；准备入睡→睡衣站立；完全入睡→sleep webm；可被聊打扰（气愤/疲惫）；可梦醒/环境取消；脱离睡眠必须同步回睡衣站立
- 冲澡待机：`tex/juese/pifu/chongzao/{Stem}_pifu03_idle.webm`（13 人全员，**浴室常态**，替代静帧展示）
- 冲澡成人：`tex/juese/pifu/chongzao/{Stem}_pifu03.webm`（13 人全员）
- 冲澡动态仅营地；浴室常态 = 待机 idle；须 AI `bath_intimate_consent=true`（同意同浴/旁观）才切成人动态
- PNG 静帧仍作 preview / video poster，不删

### 生活服装 pifu00（2026-09-12）

- 路径：`tex/juese/pifu/shenghuofuzhuang00/{Stem}_pifu00.webm`（13 人全员）
- id：`pifu00`（显示名「生活服装」）
- **营地日常默认**：无特殊情境时穿本套；读档 rollout 把空穿着迁到 pifu00
- **默认战斗装甲**：仅 AI 主动 `skin_change=default`、室外干活、军械库/执勤/战斗相关
- 与 `pifu04` 都市私服区分：pifu00=居家/出门休闲基准；pifu04=街拍私服场合装
- AI 观感：`LIFEWEAR_AI_NOTES` / `aiLookNote` / `aiLiveNote`
- 代码：`campOutfit.ts` 基准回落、`lifewearCampDefaultRollout.ts`、`emotionOutfit.ts`、`dialogueWorldSync.ts`

### 换装过程皮 huanzhuang（2026-09-12）

- 路径：`tex/juese/pifu/huanzhuang/{Stem}_huanzhuang.webm`（13 人全员）
- id：`huanzhuang`（显示名「换装中」）
- **功能性过程皮**：不可购买、不可看板娘、不可 `skin_change` 点名穿着
- **触发**：换装协议 `pendingOutfitChanges.phase=changing` 时，立绘自动切本皮并循环；到点过渡到目标外覆
- **AI 同步**：每人 `aiLookNote` / `aiLiveNote` 描述遮布+衣柜更衣过程（见 `characterSkins.ts` 的 `HUANZHUANG_AI_NOTES`）
- 代码：`outfitChangeProcess.ts` / `campOutfit.getCampDisplaySkinId` / `characterSkinRuntime`

### 象棋主题皮 wuziqi（2026-10-22 · 失败稿归档，未接入注册表）

**结论先行：本批 H3 产出是「失败稿」——画面里没有任何棋盘 / 棋子 / 对弈元素，
只有绿幕裸身蹲姿循环。** 因此它**不进注册表、不进包**，仅作为可复用的透明素材归档。

#### 素材与命名

- 源：`tex/juese/pifu/wuziqi/YZ-H3-一采_*.mp4`（13 条，832×1504，24fps，124 帧≈5.17s，带 H3 音频）
- 成品：`tex/juese/pifu/wuziqi/{Stem}_wuziqi.webm`（13 人全员，透明 VP9 `yuva420p`，CRF 20，24fps，无音轨）
- 命名遵循**事件型命名族**：目录名 = 皮肤 id = 文件名后缀 = `wuziqi`，文件名前缀是角色 `ArtStem`
- 映射表与 QA 记录：`tex/juese/pifu/wuziqi/wuziqi_manifest.json`、`_key_qa/summary.json`

| ArtStem | 源文件 | ArtStem | 源文件 |
|---|---|---|---|
| SR01_2 | `00002_p81-audio_mrndb_1792678308` | SSR02_1 | `00002_p84-audio_rgxsx_1792676173` |
| SR01_3 | `00001_p83-audio_rofin_1792676282` | SSR03_1 | `00002_p80-audio_gptck_1792676694` |
| SR02_1 | `00001_p83-audio_xepmo_1792679235` | SSR04_1 | `00002_p85-audio_nddxr_1792675964` |
| SR03_1 | `00002_p85-audio_arfru_1792676670` | SSR05_1 | `00002_p87-audio_ubpuy_1792678852` |
| SR04_1 | `00002_p83-audio_vraqt_1792676127` | UR03_1 | `00002_p85-audio_omtav_1792677212` |
| SR05_1 | `00001_p82-audio_zamcp_1792678829` | UR04_1 | `00002_p86-audio_lsfmy_1792675316` |
| SSR01_1 | `00002_p83-audio_hczgm_1792677426` | | |

> 角色识别方法：头部区域（发型 / 发饰 / 瞳色 / 兽耳轮廓）与 `tex/juese/{Stem}.png`
> 正版立绘逐一对拍，辅以 HSV 头部直方图匈牙利匹配做 1-1 校验
> （`_key_qa/_verify_identity.py`）。三个长黑发角色（SSR01_1 / SSR04_1 / UR03_1）
> 直方图无法区分，靠发夹颜色与兽耳形状人工确认。

#### 抠像

这批**不是纯 `#00b140` 绿幕**：实测幕色在画面内漂移，从 `(0,120,48)` → `(48,146,104)` → `(80,196,146)`。
固定色 `colorkey` 要么留绿边要么吃进身体，故改用色相域解析抠像
`scripts/chroma_key_lib.py::edge_matte_green_alpha()`：

1. 幕色似然 = 绿色色相带 × 饱和度 × 明度（皮肤色相 ≈25°、紫蓝发 ≈220~280°，得分 0）；
2. 只删除**与画面边缘连通**的幕布区域 → 主体内的绿色配件（SR02_1 绿梢发、SSR05_1 绿穗）不会被误抠；
3. `R ≥ G` 的像素与低饱和像素强制保留 → 皮肤/高光永不被打穿；
4. 边界走连续 alpha ramp + 去溢色，发丝不留锯齿。

脚本：`scripts/key_wuziqi_h3_to_webm.py`（批量抠像 + 命名 + QA + manifest）。

#### 为什么现在不接进游戏

| 阻塞 | 说明 | 解法 |
|---|---|---|
| 主题失败 | 画面无任何棋盘/棋子元素，只剩通用裸身蹲姿 | 重跑 H3，prompt 里必须锁「棋盘 + 棋子 + 对弈姿态」并补参考图 |
| 成人向 | 裸身素材，市场版绝不打进 dist | 同 `tiaojiao` 处理：`scripts/asset-ship-filter.mjs` 已把 `juese/pifu/wuziqi/**` 标 `adult-asset-blocked` |
| 未接注册表 | 无 `CharacterSkinDef`，运行时不可达 | 主题重做后再补 `id=wuziqi` 的注册项（事件型：不可购买、不可 `skin_change` 点名穿着） |

重做后的标准动作：

1. 新片放入 `tex/juese/pifu/wuziqi/`（或新目录），跑 `scripts/key_wuziqi_h3_to_webm.py --force`；
2. 出 `dama/{Stem}_wuziqi_sticker.webm` 打码版（市场版用）；
3. 在 `src/data/characterSkins.ts` 增 `id=wuziqi` 的 `CharacterSkinDef`（`portraitLive` 指向 `{Stem}_wuziqi.webm`）；
4. 放开 `asset-ship-filter.mjs` 里的 `wuziqi` 拦截；
5. `npm run tex:sync` 让 `tex → tex-ship → dist` 三方一致。


### 特殊服装01 pifu05（2026-08-16；全量入库 2026-08-29）

- 路径：`tex/juese/pifu/teshufuzhuang01/{Stem}_pifu05.png` + `{Stem}_pifu05.webm`（待机）+ `{Stem}_pifu05_N.webm`（挑逗互动）
- 已接入（13 人全员）：

| 角色 | ArtStem | 待机 webm | 互动条数 |
|------|---------|-----------|----------|
| ashcrow 苍羽·澪 | SR01_2 | ✓ | 2 |
| neoncoil 苍斩·凛 | SR01_3 | ✓ | 2 |
| heartforge 白楯·芹奈 | SR02_1 | ✓ | 1 |
| mirror 银绯·玲 | SR03_1 | ✓ | 1 |
| prismrift 焰甲·朱里 | SR04_1 | ✓ | 1 |
| wireguard 黄狐·萤 | SR05_1 | ✓ | 2 |
| frostline 夜爪·黑织 | SSR01_1 | ✓ | 2 |
| pulse 翠翼·铃 | SSR02_1 | ✓ | 2 |
| skyshard 冰华·雫 | SSR03_1 | ✓ | 2 |
| dustblade 绯尾·椿 | SSR04_1 | ✓ | 2 |
| ironrain 橙铠·琥珀 | SSR05_1 | ✓ | 1 |
| stellar 光轮·天音 | UR03_1 | ✓ | 2 |
| outercore 橙兔·美羽 | UR04_1 | ✓ | 2 |

- 显示名：「特殊服装01」（id 仍为 `pifu05`）
- **玩家侧**：读档 `applySpecialOutfitSkinRollout` 免费解锁已拥有角色；新抽角色同步免费解锁；角色详情可切换看板娘
- **营地 AI**：有资源即可穿，不依赖商店购买；`skin_change=pifu05` / 情绪选装均可

#### 触发条件与几率（情绪选装 `emotionOutfit`）

**泳池派对事件（已下调）**

| 事件 | weight | minGap |
|------|--------|--------|
| pool_party | 7（原 13） | 280 |
| pool_water_play | 6（原 11） | 220 |
| pool_solo_swim | 5（原 9） | 200 |

偶发情绪泳装：玩闹白天约 **18%**（原 28%）。在泳池/强泳欲仍确定性换泳装。

**特殊服装01**

| 档位 | 条件 | 几率 | 冷却 |
|------|------|------|------|
| HOT 调情 | 记忆/议程含调情挑逗等线索；或好感≥48 + 玩闹/开心 + 社交欲 + 娱乐场所；或好感≥55 且玩闹社交高 | **68%～88%** | ~40 游戏分 |
| WARM | 白天 playful 且社交≥60 | **16%** | ~75 游戏分 |
| BASE | 白天玩闹/社交门槛 | **8%** | ~75 游戏分 |

HOT 优先于偶发泳装与都市私服。执勤强制脱下。对话侧：调情/情趣意图优先 `skin_change=pifu05`。

**都市私服（略下调）**：场合 26% / 好心情 18% / 其余 8%。

**成人向 Prompt**：全员满 18 岁；`aiProfiles` 注入【成人向】与每人【成人开放度】，禁止默认保守推脱，声线各自保留。

#### 代码入口

- 注册表：`src/data/characterSkins.ts` → `specialDare`
- 全量入库通知：`src/ai/specialOutfitSkinRollout.ts`（`SaveManager` 读档调用）
- 情绪选装：`src/ai/emotionOutfit.ts` 5c
- 对话换装：`src/ai/outfitChangeProcess.ts` / `aiSkinChange.ts` / `aiProfiles.ts`

每次更新美术后：

1. 把文件放进 `tex/juese/pifu/`（命名 `{Stem}_pifu01` / `_1`…）
2. 改 `CHARACTER_SKINS` 的 `staticCount` / `secondaryCount` / `hasCombatModel` / `hasLive`
3. 补 `aiLookNote` / `aiLiveNote` / `aiIntimateLiveNote`（会进对话 Prompt）
4. 重新打包 / `cap:sync`

### 对话实时同步硬规则

`dialogue`、`action` 与 `inner_thought` 必须来自同一份「此刻」场景快照，并与当前角色的地点、活动、皮肤一致；三者作为一轮原子结果提交。

- 对话请求排队时，必须在实际开始调用模型前重新读取场景和皮肤并组装 Prompt。
- 请求生成期间发生换房、换活动、换装或同角色新请求时，旧结果不得写入对白、心声、场景、皮肤、记忆、好感或其他世界状态。
- 同一角色新对话必须取消旧的在途请求；场景变化导致的过期结果最多按最新快照重试一次，仍变化则放弃本轮。
- 流式文本仅可用于展示，完整 JSON 返回并通过快照校验前不得用其改写世界状态。
