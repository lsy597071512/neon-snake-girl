# 战斗系统

> **源文件**：`src/game/Combat3D.ts`、`src/data/stages.ts`、`src/data/weapons.ts`  
> **最新更新**：2026-09-06

---

## 概述

**战斗系统**是 Three.js 3D 三车道跑酷战斗。玩家指挥少女小队击败敌人，支持普通关卡、Boss、Raid 等模式。

**核心设计**：
- 3D 跑酷 + 射击（Three.js）
- 三车道（左侧/中间/右侧）
- 战力判定（TCP 公式）
- 数值驱动（关卡/敌人/武器参数化生成）

---

## 战斗模式

| 模式 | 说明 | 解锁条件 |
|---|---|---|
| **普通关卡** | 5 章 × 12 关 × 普通/地狱双难度（共 120 关，程序化生成，数值递增） | 默认 |
| **Boss 关卡** | 大型 Boss 敌人，有特殊机制 | 特定章节 |
| **Raid 模式** | 多波次高难度战斗 | 通关后解锁 |
| **Wave 模式** | 单波次战斗，快速刷图 | 扫荡系统 |

---

## 战斗流程

```
进入战斗 → 加载资源（分阶段：核心→装饰）→ 战斗开始
  ↓
玩家射击 → 子弹命中 → 伤害计算 → 敌人扣血/死亡
  ↓
消灭当前波次 → 下一波次（难度递增）
  ↓
通关 → 结算（奖励/碎片/锈币）
  ↓
失败 → 返回（不扣体力）
```

---

## 核心参数

### 关卡参数（`stages.ts`）

```typescript
// 公式驱动，非手编
combatParams(n) = {
  timer: baseTimer + n * 3,      // 战斗时长（秒）
  waves: 2 + floor(n / 5),       // 波次
  enemyHp: baseHp * (1 + n * 0.1), // 敌人血量
  enemyCount: 1 + floor(n / 10),  // 同屏敌人数
  bossEvery: 5,                   // 每 5 关一个 Boss
}
```

### 战力公式（TCP）

```typescript
calculateTCP(characterId, weaponId, level) = {
  charBase: 角色基础战力,
  weaponAtk: 武器攻击力,
  levelBonus: 等级 * 0.5,
  synergy: 羁绊加成（未来功能）,
}
```

---

## 战斗 UI 组件

| 组件 | 说明 |
|---|---|
| 角色立绘 | 左侧少女立绘（受伤时闪烁） |
| 血条 | 角色血量 / 敌人血条 |
| 弹道 | 子弹飞向敌人轨迹 |
| 得分 | 当前分数 / combo |
| 暂停按钮 | 暂停战斗 |
| 自动按钮 | 第 8 关解锁自动战斗 |

---

## 自动战斗

**解锁条件**：第 8 关后解锁  
**胜率**：~95%（vs 手动 ~82%）

| 操作 | 手动 | 自动 |
|---|---|---|
| 射击 | ✅ | ✅ |
| 移动 | ✅ | ❌（固定中间） |
| 闪避 | ❌ | ❌ |
| 技能 | ❌ | ❌ |
| 胜率 | ~82% | ~95% |

**说明**：手动操作收益不高（差距仅 13%），操作深度不足是设计问题。

---

## 移动端优化

| 优化 | 说明 |
|---|---|
| **Bloom 关闭** | 移动端默认关闭，减少 8+ 渲染 pass |
| **渐进式加载** | 核心资源先加载，装饰资源后台异步 |
| **Billboard 优化** | AlphaTest 替代透明混合，减少 overdraw |
| **画质档位** | low（移动默认）/ medium / high |

详见 `docs/performance-optimization-2026-08-29.md`

---

## 敌人类型

| 类型 | 特点 |
|---|---|
| 普通敌人 | 标准血量/攻击 |
| 精英敌人 | 高血量/高攻击，击败给碎片 |
| Boss | 超高血量，多阶段，有特殊攻击模式 |
| 运输车 | 移动目标，击败给额外奖励 |

---

## 战斗资源

| 资源类型 | 路径 |
|---|---|
| 敌人模型 | `tex/diren/*.fbx` |
| 战斗场景 | `tex/beijing01*.png` |
| 子弹纹理 | `tex/` 内置 |
| 特效 | `src/game/vfx/` |

---

## 代码入口

| 文件 | 作用 |
|---|---|
| `src/game/Combat3D.ts` | 主战斗场景（~1600 行） |
| `src/game/CombatScene.ts` | Phaser 场景封装 |
| `src/data/stages.ts` | 关卡配置 |
| `src/data/weapons.ts` | 武器数据 |
| `src/data/enemies.ts` | 敌人数据 |
| `src/systems/CombatSystem.ts` | 战斗逻辑封装 |

---

## 待改进项（见 market-standard-gap-analysis.md）

- 无震屏/命中停顿/战斗 SFX
- 无连击结算爽点
- 关卡无机制差异（5 章 120 关全公式堆数值）
- 战斗操作无成长（无技能树/走位收益）

---

## 附：2026-10-10 落地修订（v2，以此为准）

> 旧正文（TCP 公式、文件入口行数等）多处过期，仅保留作考古；实现细节以 [active-skills-spec.md](./active-skills-spec.md) 为准。

### 技能系统入口
- 13 主动技能：`Combat3D.releaseManualSkill(charId)` → 13 个 `exec*()`（CD 6/7/8 三档，`activeSkillCooldown`），左侧头像按钮触发，开局半 CD
- 7 被动：`src/core/skillEffects.ts`（攻速/穿透/护盾/连闪/雨幕/裁决加成/同调），`getSkillModifiers(squadIds)` 全队聚合
- 被动与手动大小规格区分：被动小包装 + "被动触发"横幅；手动大包装 + 施法者标记（`casterBurstFx`）

### 健康值 = 血量
- `characterCyberHealth`（0~100，存档持久化）即战斗血量；`applyHitCyberWear` 实时写回
- 0 点倒下：停火 + 禁技能 + 外观（僚机隐藏/队长压暗）；全员倒下才判负；庇护 +15 / 爱心 +8 可复活
- 编队门禁：义体标签 + 0 点禁用/拦截 + 一键跳过；进战斗全员体检

### Boss 规则
- 控制免疫：定身/减速对 Boss 无效（飘"免疫"）；击退 15%；后仰封顶 0.25；灼烧/直伤全额
- Raid Boss（`SPAWN_Z-16` 静止，83 米外）：落点特效 ×1.5~1.8，终审追加专属金爆

### Raid 分支补齐（`tickRaidSkillSystems`）
Raid 走独立 update，主路技能系统需手动推进：按钮 CD、多段/炮弹/爱心/风刃/雨幕队列、灼烧跳伤、Boss 后仰衰减、状态环同步。漏任何一项都会出现"只播施法不结算"。

### 数值曲线（`combatBalance.ts`）
- 小怪血 ×(1 + min(0.5, tier×0.008)) 技能税；章节 Boss ×8 再 ×1.25；Raid `tcp×5.2`（地狱 8.0）
- 承伤/波次/计时器不动；团队秒伤 ≈ 0.45×TCP；Raid 铁律 20 秒

### 代码入口勘误
- `Combat3D.ts` 已超 3000 行；`CombatScene.ts`/`enemies.ts`/`CombatSystem.ts` 三个旧引用名已不存在；敌人实例化走 `InstancedMesh`（**root 不在场景图**——跟随型 3D 物件必须挂 `scene` 逐帧同步，见 active-skills-spec §七-2）
