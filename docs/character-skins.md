# 特别皮肤同步清单

资源目录：`tex/juese/pifu/`  
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
