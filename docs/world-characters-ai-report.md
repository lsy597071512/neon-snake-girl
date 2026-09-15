# 锈带纪元 · 世界观 / 角色 / AI 权重 全量分析报告

> 用途：为角色制作换装皮肤 / 扩写剧情 / 调教 AI 对话时的依据底稿。
>
> 数据源：`src/data/characters.ts`、`sr-bios.ts`、`ssr-ur-bios.ts`、`characterSkins.ts`、`characterPosters.ts`、
> `characterLore.ts`、`lore/ai_profiles.json`、`worldIntro.ts`；`src/ai/*`
> （aiProfiles / characterLiveSnapshot / characterDesires / characterPersona / emotionOutfit / promptAssembler /
> modelConfig / poolPartySkinRollout / aiSkinChange）；`src/systems/CharacterSkinSystem.ts`；`docs/character-skins.md`。
> 生成日期：2026-08-09（初版）；**2026-09-06 同步更新**（角色表已与源码对齐）

---

## 一、世界观（大崩解 · 锈带纪元）

大崩解后人类在辐射与连锁毁灭里几乎消亡。旧世依赖**少女构型机械/义体**续命。大崩解后，成人级外骨骼与重型机兵在能源协议下集体停摆(72 小时内)，只有这些**被设计成无害幼态外观**的少女形机体还能用旧式微堆续命。锈带走廊成为文明灰烬的金属长廊。

- **玩家身世**：被拆掉战斗模块、矮小近废料的**小机器人**,在**零号月台**边缘营地召集伙伴。
- **核心地基（旧世遗产）**：旧世研究者把少女形构装体当作「军事与科研的定居安抚方案」——名义上是社区协调员/巡检员/研究员助手，真骨架里却塞满突击单元、承重盾墙、重炮、机理。这与「无害外表 = 存活理由」互相映照。
- **营地生活**：营地是室内双层（一楼大厅枢纽 + 二楼回廊），妹子住在里面生活。玩家是「指挥官」；营地生活核心是**相濡以沫过日子**，与同伴围绕指挥官形成后宫向情感羁绊。
- **锈带意象**：记忆会锈，小队还在则走廊未死。

**专有名词**：**大崩裂时**（能量协议停摆、成人机全体失能）、**锈带走廊 / 白棺谷 / 熔炉城 / 旧城防空网遗迹 / 星核禁区**（地域轴）、**零号月台**（营地）、**锈币**（金币/皮肤价）、**外覆盖**（皮肤资源统称，`pifu` 命名空间）。

---

## 二、角色总表（13 人）

| id | 名称 | 稀有 | 基础战力 | icon | 定位 | 年龄 | 身高 | 三围 | 性格 | 礼物偏好 | 归属地 |
|----|------|------|----------|------|------|------|------|------|------|----------|--------|
| ashcrow | 苍羽·澪 | SR | 120 | 🪽 | 均衡/突袭 | 18 | 168cm | B88/W59/H86 | 冷静克制/责任偏执 | 翼形饰品、冰蓝能量芯 | 零号月台 |
| heartforge | 白楯·芹奈 | SR | 115 | 🛡️ | 近距/高容错 | 19 | 166cm | B90/W60/H88 | 温柔贤惠/护心极强 | 打磨盾蜡、热可可罐头 | 熔炉城废 |
| mirror | 银绯·玲 | SR | 118 | 👁 | 闪避/侦察 | 18 | 167cm | B87/W57/H85 | 疏离理性/洞察锐利 | 金黄透镜、赤晶发饰 | 锈带走廊光学哨站 |
| neoncoil | 苍斩·凛 | SR | 122 | 🗡 | 机动/渗透 | 18 | 162cm | B84/W56/H82 | 寡言冷淡/精准执着 | 刃油、冰蓝发胶 | 东区走私网旧域 |
| prismrift | 焰甲·朱里 | SR | 116 | 🔥 | 远程/重炮 | 20 | 170cm | B92/W61/H90 | 沉默务实/火力至上 | 冷却液、橙漆 | 熔炉城废墟 |
| wireguard | 黄狐·萤 | SR | 119 | 🦊 | 支援/警戒 | 18 | 165cm | B85/W57/H84 | 毒舌妙语/高度警戒 | 滤芯滤片、荧光黄贴纸 | 毒区裤号22 |
| frostline | 夜爪·黑织 | SSR | 180 | 🖤 | 高速单体 | 21 | 169cm | B89/W59/H87 | 孤僻冷漠/克制杀意 | 青蓝能量带、哑光黑甲油 | 白棺谷 |
| pulse | 翠翼·玲 | SSR | 175 | 💚 | 清场/连击 | 18 | 165cm | B85/W57/H84 | 明朗健谈/节奏偏执 | 荧光绿滤片、轻量翼钉 | 旧城防空网遗迹 |
| dustblade | 绯尾·椿 | SSR | 178 | 🦂 | 穿透/追猎 | 19 | 163cm | B88/W58/H86 | 温柔危险/猎手本能 | 红绳发带、尾节润滑剂 | 锈带走廊 |
| ironrain | 橙铠·琥珀 | SSR | 182 | 🧡 | 过热/清场 | 19 | 166cm | B86/W58/H85 | 沉静工序/过热偏执 | 青蓝束发环、防撞条 | 熔炉城工坊 |
| skyshard | 冰华·雫 | SSR | 176 | ❄ | 防护/反击 | 18 | 158cm | B82/W55/H80 | 温软内敛/共情过载 | 冰晶发夹、白色机油布 | 白棺谷极寒废墟 |
| stellar | 光轮·天音 | UR | 260 | 😇 | Boss 特化 | 外表19 | 170cm | B86/W56/H84 | 疏离空灵/决断 | 耳机垫片、光环校准片 | 零号月台封存舱 |
| outercore | 橙兔·美羽 | UR | 258 | 🐰 | 爆发/续航 | 18 | 160cm | B84/W56/H83 | 俏皮狡黠/反差狠厉 | 胡萝卜徽章、兔耳头带 | 星核禁区轨道残骸 |

### 抽卡池（`characters.ts`）

- SR 86%｜SSR 12.5%｜UR 1.5%；80 抽保底；重复给碎片（150）。

---

## 三、角色形象与美术资源（做皮肤前必读）

### 资源路径约定

| 类型 | 默认（`tex/juese/`） | 泳池派对外覆盖 `pifu01` | 睡衣 `pifu02` |
|------|----------|----------|---------|
| 正面静态 | `{Stem}_{idx}.png` | `tex/juese/pifu/{Stem}_pifu01.png` | `tex/juese/pifu/shuiyi/{Stem}_pifu02.png` |
| 背面静态 | 同左 | 同左 | 同左 |
| 动态 Live | `{Stem}_{idx}.webm` | `{Stem}_pifu01.webm` |（UR 才偶有）|
| 互动次动态 | `{Stem}_{idx}_{n}.webm` | `{Stem}_pifu01_{n}.webm` | — |
| 战斗 glb | `{Stem}_{idx}.glb` | `{Stem}_pifu01.glb`（部分有） | null |

**Stem 映射**：`SR01_1/2`=澪、`SR01_3`=凜、`SR02_1`=芹奈、`SR03_1`=雫白？…… 确切对照以 `characterSkins.ts` 为准。

### 当前皮肤完成度（重点缺口）

- 泳池派对（pifu01）：全员至少 1 张静态。**有互动 webm 的**：SR02_1、SR01_3、SR03_1、SR04、SR05、SSR01、SSR02、SSR03、SSR04、SSR05、UR03、UR04……但**睡衣（pifu02）只有静态 1 张，只有 UR 有 webm**。
- **焰甲·朱里泳装只有静态 `SRsd04_1.png`（无 webm/glb）**。
- 每套皮必含 `aiLookNote`（会注入对话「当前外观」）；默认 glow 给潜意识。

---

## 四、AI 角色权重信息

各人的感情增益/变化区间见 `aiProfiles.ts -> VOICE_BY_ID`：

| id | voice 关键词 | affMin ~ affMax | 涨 | 跌 |
|----|--------------|-----------------|----|----|
| ashcrow | 冷静、先问路与风 | -2 ~ +3 | 被信任带路/被跟随 | 被无视安全 |
| heartforge | 温柔、能干、护心极强 | -3 ~ +4 | 被托付、共同料理 | 被逼丢队友/吹英雄 |
| mirror | 光学观测疏离 | -2 ~ +2 | 建议被采纳 | 被强行亲热/抱 |
| neoncoil | 刃女、字极少 | -3 ~ +2 | 不被追问 | 逼她复盘铁事 |
| prismrift | 数字距离、几乎不闲聊 | -2 ~ +2 | 目标清晰 | 逼闲聊 |
| wireframe | 表层贫嘴底下警 | -4 ~ +4 | Cover 接梗/换滤芯 | 玩笑当真 |
| frostline | 极短低鸣、距离即礼貌 | -5 ~ +2 | 给距离 | 逼往事 |
| pulse | 明朗话多上扬 | -4 ~ +5 | 有回应/一起吵 | 被嫌吵 |
| dustblade | 温柔与致命并存 | -4 ~ +4 | 接受张力 | 利用温柔 |
| ironrain | 工序词、温度预 | -3 ~ +3 | 尊重工序/冷却 | 突触过热/打乱 |
| skyshard | 温声、常见问句 | -4 ~ +5 | 被温柔对待 | 无视担心 |
| lovelycore | 俏皮反差 | -3 ~ +5 | 被当人、接梗 | 被当怪/拆兔 |
| stellar | 空灵宣判 | -3 ~ +2 | 目标清晰不神化 | 被膜拜/骚扰裁决 |

**全局：所有角色重复拿礼不烂扣；aff 表现 0-100，clamp 每轮。**

### 欲望权重（`characterDesires.ts`）

{% include notes %} 欲望（0-100，8 种 `thirst/stuffy/shop/swim/armory/tower/social/rest`）

- 基础线 {8,6,10,8,10,6,10,8}
- 状态 `thirst+35`、`fatigue→rest+28/stuffy+12`、`hunger→shop+8`、`inspired→tower+15`、`anxiety→swim+10`、`injured→rest+20/armory-8`
- 时/模式叠加：午后闷 +16、夜 plus rest、泳装拥有 → swim+14、睡衣拥有 → rest+10、任一皮 → social+6
- 强劲 ≥55 被 `pushDesireForcedCandidates` 抬 agenda 权重（权重 3.8-4.2+）

---

## 五、Prompt 组装（`promptAssembler`）

输入顺序（高度依赖，别删过半）：
1. 世界观同步块
2. 指挥官羁绊
3. 营地布局 + 地标
4. 角色实时快照（外形/好感/衣柜/当前外观）
5. 伙伴档案
6. 深场（desire / current look / 好感 / 未了 / life goal → scene_beat / desire_next）
7. 时间，8. 议程/今日 persona，9. 闲聊 seed，10. 时间张力，11. 场景卡，12. 关系/打断规则

---

## 六、皮肤系统（如何为新套装集成）

### 新增皮肤要改的文件

| 文件 | 作用 |
|------|------|
| `src/data/characterSkins.ts` | 新 skinId（`pifu03`…）工厂函数 + 各角色 `CHARACTER_SKINS[id]` 新增条目 |
| `src/systems/CharacterSkinSystem.ts` | 解锁/应用/清除逻辑（价格、memory、lifeNote） |
| `src/data/` `tex/juese/pifu/{stem}_{skinId}*` | 美术资源 |
| `src/ai/emotionExpress.ts` | 情绪选装规则（何时切新皮） |
| `src/ai/poolSkinRollout.ts` |（若需全员免费投放 + 主动通知）|

**新 skin 定义字段**：`id/name/price/preview/portraits[]/portraitLive/portraitLiveSecondary[]/combatModel/aiLookNote`。

**注意**：
- 每个皮肤写一句 `aiLookNote`（AI 肉眼描述这身），会在对话里出现。
- 出征强制回默认甲（`prepareSquadDefaultArmor`）：穿上皮不会带进战场。
- 睡衣半价 5000，泳池 20000；免费投放走 `rollout`。

---

## 七、下一步建议（做皮肤）

1. **优先补齐缺口（成本打新）**
   - 朱里泳装补互动 webm（现有只有静态 `SRsd04_1.png`）。
   - 睡衣动态只有 UR 有，可加一版.
2. **若有新套装（如礼服/军装）**
   - 沿用 `poolParty`/`sleepwear` 工厂函数，新 skinId + aiLookNote。
   - 把条目推到想要的角色名下（不做全 13 人也可，页面会按角色有才显示）。
3. 新皮接入便服逻辑：夜更 → 睡衣；泳池 → 泳装；出征 → 默认。

---

_（最终以实际源码为准；本文归档用于皮肤/剧情/AI 权重工作底稿。）_