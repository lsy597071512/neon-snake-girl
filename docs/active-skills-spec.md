# 主动技能系统规范（13 正式技能 · 落地方案 v2）

**日期**：2026-09-19（v1 初版，能量制）→ **2026-10-10（v2 落地版，时间 CD 制）**
**范围**：`src/data/characters.ts`、`src/core/skillEffects.ts`、`src/core/formulas.ts`、`src/game/Combat3D.ts`、`src/game/SkillFx3D.ts`、`src/game/VfxPool.ts`、`src/game/combatBalance.ts`、`src/systems/CyberHealthSystem.ts`、`src/ui/App.ts`、`src/style.css`、`src/sub-ui.css`
**姊妹文档**：
- 特效原语与性能预算：[combat-vfx-spec.md](./combat-vfx-spec.md)
- 系统总览与流程：[combat-system.md](./combat-system.md)
- 技能表现验收清单：[skill-acceptance.md](./skill-acceptance.md)

> **v1 → v2 变更总览**：v1 的能量系统（100 能量、+6/秒、击杀 +6）**已废弃**，改为**纯时间 CD + 左侧头像按钮**；v1 的 13 张技能卡数值保留，但全部接入 CD 分档、健康值=血量、Boss 控制免疫、技能税曲线。读档时以 v2 为准，v1 章节（第二、三节旧文）仅保留作设计考古。

---

## 一、触发方式（v2，替代 v1 能量系统）

| 项目 | 值 | 说明 |
|------|-----|------|
| 按钮 | 战斗 HUD 底部 38px 头像方块，跟随对应角色正下方，换道一起平移 | 按上场人数 1~3 个，稀有度边框色 |
| 冷却 | 6 / 7 / 8 秒三档，见 §二 | 无能量，纯时间；开局半 CD（3~4 秒可放第一发） |
| 倒下 | 健康 0 即禁技能 | 按钮虚线灰，点按无反应，全员倒下才判负 |
| 自动战斗 | 不自动放 | 技能永远手动专属决策 |

**CD 分档原则**（单发价值按"等效团队火力秒数"折算，团队 1 秒 ≈ 单发弹伤 ×8.6；目标技能贡献占团队输出 25~35%）：

- **8 秒档**：单发价值约 2~3.5 秒火力或带长效增益 —— 终审之光、熔城一炮、弹道织网、频谱齐鸣、楯影庇护
- **7 秒档**：约 1.5~3 秒火力或强控 —— 白夜处刑、绯雨三连爪、星种爱心弹、极寒静域、荧惑干扰
- **6 秒档**：约 1~2 秒火力、速转节奏 —— 破风突贯、无痕三连斩、热平衡释放
- **下限 6 秒的原因**：增益类（织网/齐鸣 5 秒、庇护 6 秒）CD 压到 4 秒即 100% 全程覆盖，等于写成被动；核弹类 4 秒一轮 DPS 翻倍，敌人曲线作废。

实现：`Combat3D.activeSkillCooldown(charId)` 三档 switch；`consumeSkill(charId)` 写入 `manualSkillCooldowns`；开局预置半 CD；`releaseManualSkill(charId)` 按 charId 分派 13 个 `exec*()`。

---

## 二、13 技能卡（数值 + 表现 + 结算）

> 伤害均以"释放者单发弹伤"为基准（公式见 `src/core/formulas.ts`：战力/8 × 稀有度 × 职业 × 武装）；**只加表现、不改数值**是铁律。
> 每个技能 = **施法者标记**（脚下双环 + 光晕 + 7 米光柱 + 技能名飘字，`casterBurstFx`）+ **落点统一重型反馈**（光晕 8 / 环 5 / 柱 10 / 8 粒火花，`skillImpactFx`，高频落点可缩 0.7）+ 专属模型。

### SR（6 名，首次拥有技能；`characters.ts` 补 `skillName/skillDesc` 仅做显示）

#### 2.1 苍羽·澪 —— 破风突贯（6 秒）
- **数值**：本道 8×，存活者击退 -26（约 4 身位）+ 后仰 `topple` 拉满
- **表现**：施法标记 → 8 米弧线 + **8×0.8 米 3D 细刃**（0.6 透明，3 秒寿命）以 34 米/秒笔直劈穿整道 → 逻辑体 `bladeSweeps` 同速推进，撞谁砍谁（2.5 倍大光晕 20/12.5/25 米 + "击退"飘字 + 后仰旋转）
- **结算**：`processSkillQueues` 每帧推进，`hitIds` 防重砍，`|Δz|<2.5` 命中；目标死亡自动跳过（伤害已结算）

#### 2.2 白楯·芹奈 —— 楯影庇护（8 秒）
- **数值**：6 秒全队受击 ×50%（与被动护盾乘算）+ 全队义体 +15（上限 100，写回存档）
- **表现**：施法标记 → **3 名上场角色每人一个跟随半球护罩**（`spawnAegisDome`，跟换道走，6 秒与减伤等长）+ 铜色落点反馈
- **结算**：`shieldGuardUntilMs`；`applyLaneSquadHits` 伤害公式追加 `×(now<until?0.5:1)`；`healSquad` 写 `setCyberHealth` + 复活还原外观

#### 2.3 银绯·玲 —— 弹道织网（8 秒）
- **数值**：5 秒全队弹伤 +35%，命中火花变金 + 小击退 -8
- **表现**：施法标记 → **三层金环穹顶**（半径 2.2/3.3/4.4，0.75 缩放）+ 0.9 倍施法反馈 + 开场全场敌人各一个金晕 → 持续期枪口变金、命中变金
- **结算**：`weaveHuntUntilMs`；`checkHits` 伤害 `×1.35` + 击退；横幅写人话"5 秒全队子弹伤害+35%"

#### 2.4 苍斩·凛 —— 无痕三连斩（6 秒）
- **数值**：锁最高血，0.12 秒间隔 3 段各 6×，目标死亡转火次高血
- **表现**：施法标记 → 每段**牵引光束**（枪口直连目标 0.35 粗）+ 11 米闪电 + 0.7 落点 + 三连震
- **结算**：`pendingStrikes` 队列；`pickHighestHpTarget` 每段重选；`dealSkillDamage(quiet)`

#### 2.5 焰甲·朱里 —— 熔城一炮（8 秒）
- **数值**：0.6 秒后敌阵最密集点爆炸，z 半径 4 内 20×，存活者灼烧 2 秒（2×/秒）
- **表现**：施法标记 + 5 米蓄力晕 → **1.4 倍巨型火球**按"距离÷0.6 秒"速度笔直轰过去（0.08 秒一粒尾迹）→ 1.8 倍落点组 + 8 碎片 + 灼烧橙环
- **结算**：`pendingBlasts`；飞行=蓄力，落点帧结算；灼烧走 `burnDps/burnUntilMs`，0.5 秒一跳

#### 2.6 黄狐·萤 —— 荧惑干扰（7 秒）
- **数值**：全场定身 3 秒，无伤害（价值=3 秒无伤输出窗 ≈ 25×弹伤）
- **表现**：施法标记 + 0.9 黄色反馈 → **全场敌人金环 + 5.5 米光柱**（3.9 米半径，呼吸缩放）+ 逐敌"定身"飘字（8 个内）+ "干扰中"
- **结算**：`globalStunUntilMs`；approach 速度 `×0`；Boss 免疫（见 §五）

### SSR（5 名，被动保留 + 主动新增）

#### 2.7 夜爪·黑织 —— 白夜处刑（7 秒）
- **数值**：8 段各 3×，间隔 0.09 秒；打 Boss 每段继承 Boss 暴击加成
- **表现**：施法标记 + 暗角 → 每段牵引线 + 冰蓝闪电 + 冰晶 + 0.7 落点 + 8 连密震
- **结算**：`pendingStrikes`；`bossCritInherit` 分支 `mult *= 1+bossCritBonus`

#### 2.8 翠翼·铃 —— 频谱齐鸣（8 秒）/ 被动翠翼连闪
- **主动数值**：5 秒全队攻速 +40%，三连发门槛 3 杀→2 杀
- **主动表现**：施法标记 + 1.0 绿爆 → 持续期枪口绿 + 每发 1 粒绿星 + 命中变绿
- **被动连闪**（3 杀自动三连射）：**小规格**包装（0.7 爆点 + 0.3 细线 + 4 光晕，无十字，震屏减半），横幅写"被动触发 · 连击 3 杀自动三连射"——**与手动齐鸣大小规格区分，不抢风头**
- **结算**：`riftChorusUntilMs`；开火间隔公式加 `chorusBonus`；三连发阈值动态 3→2

#### 2.9 绯尾·椿 —— 绯雨三连爪（7 秒）/ 被动绯尾贯穿
- **主动数值**：三道各 3 枚共 9 枚利爪炮（0.09 秒列阵），每枚 3×并继承穿透
- **主动表现**：施法标记 + 0.7 粉爆 → 9 枚真弹道（可暴击）+ 粉色枪口闪
- **被动贯穿**：子弹穿透 +1；**绯尾子弹全程粉色**（枪口粉 + 命中粉火花，按 `sourceCharId==='dustblade'` 判）；穿透瞬间粉色穿刺线（0.5 粗 5 米 0.45 秒）+ 3.5 米粉环 + 2.6×0.8 米粉尾（关键优先级，250ms 解说降频）
- **结算**：`remainingHits = skillMods.projectilePierce`；穿透分支 `piercedThrough` 播特效

#### 2.10 橙铠·琥珀 —— 热平衡释放（6 秒）/ 被动锻渣雨幕
- **主动数值**：立即 200% 强化雨幕（本道最近 5 个）+ 5 秒被动雨幕间隔 10 秒→4 秒
- **主动表现**：施法标记 + 1.0 橙爆 + 每目标 6 粒金属碎片
- **被动雨幕**：每 10 秒本道最近 3 个 120% → **改成三发熔渣尖刺 3D 模型依次砸落**（0.15/0.3/0.45 秒，spike 落点=结算帧，1.2 倍落点 + "锻渣雨幕 N 中"）；开场伤害数字改"锁定"预告
- **结算**：`ironRainTimer` + `ironHasteUntilMs` 切 4000；倒下停雨；`PendingBlast.targetIds` 点名制

#### 2.11 冰华·雫 —— 极寒静域（7 秒）
- **数值**：全场减速 50% 4 秒；期间击杀冰爆（z 2.5 内 4×，可连锁 1 层）
- **表现**：施法标记 + 0.8 蓝反馈 + **8 锥冰刺环**（半径 3.5）+ 16 处飘雪 + 逐敌"冻结" → 冰爆 0.7 反馈 + 8 粒白冰晶
- **结算**：`globalSlowUntilMs/frostDomainUntilMs`；`dealSkillDamage` 死亡分支递归（`noShatter` 限 1 层）；Boss 免疫减速（见 §五）

### UR（2 名，压轴）

#### 2.12 光轮·天音 —— 终审之光（8 秒）
- **数值**：最高血敌人 30×，对 Boss 45×（真伤害，被动攻速 +25%/Boss 暴击 +15% 保留）
- **表现**：施法标记 → 13.6 米主闪电 + 副闪电 + 双环 6.8/4.4 + 10.4 光晕（0.84）+ 12 米光柱 + 8 火花 + 1.44 倍 3D 审判壳（0.7 不透明，跟随目标 1.4 秒）+ 飘字 + 横幅 + 重震；**打 Boss 追加 2.0 倍金爆 + 专属重震**（83 米外可见，火花 14 粒/光晕 ×1.8）
- **结算**：`triggerStellarJudgment` 自写 CD（`execFinalLight` 不得提前消费，否则守卫吞视觉——血泪教训见 §七）；`dealSkillDamage(quiet)`

#### 2.13 橙兔·美羽 —— 星种爱心弹（7 秒）
- **数值**：粉球 10 米/秒推进到敌阵 70% 处爆炸，z 半径 5 内 15× + 全队义体 +8
- **表现**：施法标记 → 2.6 米粉球（自转 2rad/s + 0.08 秒一粒尾迹）→ 1.1 倍爆炸组 + 4.5 副环 + 8 碎片 + 全队回血飘字
- **结算**：`skillShots` 飞行队列；落点 `gy=roadY(targetZ)`；`healSquad(8)`

---

## 三、战斗数值：技能税曲线（替代一刀切 ×1.5）

**结论**：撤销 Combat3D 全场 ×1.5；压力只从"技能税"一个口子进。

| 项目 | 公式 | 说明 |
|------|------|------|
| 小怪血 | `(38 + 10×tier + tier²×0.22) × hellMul × (1 + min(0.5, tier×0.008))` | 税率 0→50% 渐进；tier≤12 几乎无感，保新手/SR 开荒 |
| 章节 Boss | 小怪 ×8，`isBoss && !raid` 再 ×1.25 | 站住 2~3 轮技能 |
| Raid Boss | `tcp × 5.2`（地狱 8.0） | 推荐 TCP 下 12~18 秒击杀，20 秒限时留 1 轮技能 |
| 承伤 | 不动（碰撞 1~4/次随章节） | 庇护/双奶正好是解法；养成超线性跑赢 50% 税封顶 |

推导：团队秒伤 ≈ 0.45×TCP；Raid 铁律 20 秒；单发价值 6~8 秒 CD 对 25~35% 输出占比。详见 §一 CD 分档。

---

## 四、健康值 = 血量（义体系统战斗侧）

- 每人独立 100（`characterCyberHealth` 存档，`CYBER_HEALTH_MAX=100`），受击实时 `setCyberHealth` 写回
- 0 点=倒下：停火 + 禁技能 + 外观（僚机隐藏整机 / 队长压暗 70%，材质备份，回血还原）+ "XX倒下"飘字；**全员倒下才判负**（旧逻辑一人倒下即判负已废）
- 受击闪红跳过已倒下单位（`flashSquadHurt(aliveOnly)`），不冲掉压暗
- 回血：庇护 +15 / 爱心 +8，上限 100，复活即 `restoreDownVisual` + 按钮解禁
- 门禁：备选区"义体 N"标签 + 0 点禁用 + 拖拽/点击拦截弹窗；一键上阵跳过重伤；进战斗全员体检（沿用旧 `App.ts` 拦截）

---

## 五、Boss 控制规则（普通 Boss + Raid 通用）

| 控制 | 对 Boss | 说明 |
|------|---------|------|
| 定身（干扰/单体 stun） | **免疫**：行为不停、环不挂，只飘"免疫"（1.2 秒一次） | `approach` 与 `syncStatusRings` 双处 `!e.boss` 守卫 |
| 减速（静域/globalSlow/单体 slow） | **免疫**：`applyEnemySlow` 直接 return + 飘免疫 | |
| 击退 | 只吃 15% | 风刃 -26 打 Boss ≈ -4，小幅晃动 |
| 后仰 topple | 封顶 0.25 + 3.5 倍速回正（Raid） | 栽一下即回，不许翻倒、不许卡住 |
| 灼烧 / 冰爆溅射 / 直伤 | **全额有效** | 控制免、伤害不免 |

---

## 六、Raid Boss 关技能系统补齐（必读，4 个坑）

Raid 走独立 `updateRaidBoss`，主路 `update()` 提前 return，以下系统在 Raid 里**必须手动推进**（`tickRaidSkillSystems`，补丁位在 `updatePlayerBullets/checkHits` 之后）：

1. 按钮 CD（否则按一次灰到结束）
2. `processSkillQueues`（多段斩/炮弹/爱心/风刃/雨幕——只播施法不结算就是这里漏了）
3. 灼烧跳伤 + Boss 后仰衰减（`decayBossControl`：后仰 3.5 倍速回正，knockbackV 清零）
4. `syncStatusRings`（环更新）

---

## 七、历史教训（新人必读，避免重蹈）

1. **冷却守卫吞视觉**：`triggerStellarJudgment` 第一行"冷却中 return"且自己写 CD；`execFinalLight` 曾提前 `consumeSkill` 导致整套视觉被跳过、只剩伤害。规则：**自带守卫的函数，调用方不得提前写 CD**。
2. **实例化敌人的 root 不在场景图**：手机端敌人走 `InstancedMesh` 矩阵渲染，`e.root` 从未 `scene.add`。状态环曾挂 `e.root` 下导致全灭。规则：**跟随敌人的 3D 物件挂 `scene`、每帧用 `root.position` 同步**。
3. **对象池非关键 sprite 会被静默丢掉**：关键落点/穿刺线/尾迹必须 `acquire(tpl, true)`，并给技能预留 12 格（`SKILL_RESERVE`），满池顶替"顶最新"不顶"最早"。
4. **伤害结算时机 = 特效落点帧**：风刃/雨幕/炮弹都曾"开场瞬间结算 + 模型事后飞"，看起来像"飘过半路"。规则：**逻辑体与模型同速同命，`hitIds` 防重，落点帧 `dealSkillDamage`**。
5. **被动与手动大小规格区分**：连闪被动曾做得跟大招一样大，导致"没点也在放技能"的误会。规则：**被动小规格 + 横幅写"被动触发"，手动大规格 + 施法者标记**。
6. **Boss 距离 83 米**：Raid Boss 在 `SPAWN_Z-16` 静止，通用尺寸缩成点。规则：**打 Boss 的落点 ×1.5~1.8，终审追加专属金爆**。

---

## 八、落地清单

1. `src/data/characters.ts`：6 SR 补 `skillName/skillDesc`（显示用）；SSR/UR 被动保留
2. `src/game/Combat3D.ts`：`activeSkillCooldown` 三档 + 13 `exec*` + `casterBurstFx` + `skillImpactFx` + `dealSkillDamage` + 队列（strikes/blasts/shots/sweeps）+ 状态环 + topple + Boss 免疫 + `tickRaidSkillSystems`
3. `src/game/SkillFx3D.ts`：`spawnBladeSweep/spawnSlashLine/spawnCannonShell/spawnWeaveDome/spawnAegisDome/spawnShardRing/spawnRainSpike` + `vel` 位移 + `maxOpacity` 分档
4. `src/game/VfxPool.ts`：`SKILL_RESERVE=12` + 满池顶最新 + 关键落点 `critical`
5. `src/game/combatBalance.ts`：技能税 + Raid 5.2/8.0
6. `src/systems/CyberHealthSystem.ts`：沿用（战斗侧 `applyCombatCyberHit`）
7. `src/ui/App.ts` + `src/sub-ui.css`：编队义体标签/0 点禁用/拦截/一键跳过
8. 验证：`npx tsc --noEmit` + `npm run build` 全绿；实机按 [skill-acceptance.md](./skill-acceptance.md) 逐项验收
