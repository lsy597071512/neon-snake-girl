# AI 人生目标系统

> **源文件**：`src/ai/lifeGoals.ts`  
> **最新更新**：2026-09-06

---

## 概述

**人生目标系统（Phase E）** 是让角色有"中期愿景"的机制——不是当下的欲望，而是更长远的需求（战斗章节/送礼/武器库/商店/皮肤/承诺/休息）。

**核心设计原则**：
- 人生目标是**中期目标**（不是当下议程）
- 每次游戏日重评一次（不是每次心跳）
- 目标写记忆，让角色能"记得自己有什么想要"
- 目标完成时写里程碑记忆（重要节点）

---

## 目标类型（LifeGoalKind）

| 类型 | 中文名 | 示例文案 | 触发条件 |
|---|---|---|---|
| `combat_chapter` | 想打章节 | "想跟指挥官再闯一趟「熔炉城废墟」，把那股味道从装甲缝里洗掉" | 人设含战斗词 |
| `gift_bond` | 想收礼 | "想让指挥官再记得送自己一件合心意的小东西（不是任务奖励）" | 人设含陪伴/共情词 |
| `armory` | 想看武器库 | "想把武器库点检做扎实，让军械箱再为小队吐出靠谱的东西" | 通用 |
| `shop` | 想逛商店 | "想在商店里翻翻有什么新鲜货，哪怕不买东西" | 通用 |
| `skin` | 想换皮肤 | "想试试新皮肤的手感，想知道指挥官觉得哪个更好看" | 拥有多个皮肤 |
| `promise` | 想履行承诺 | "想找机会把上次答应指挥官的事情做完" | 有未履行承诺 |
| `rest` | 想休息 | "想找个时间好好睡一觉，让齿轮歇一歇" | 疲劳高 |
| `nothing` | 没有特别想要的 | "暂时没有特别想做的事，就这样待着也挺好" | fallback |

---

## 目标生成逻辑

```typescript
pickLifeGoal(characterId, living)
  ↓
1. hash01(characterId, salt) 掷骰 → 决定目标类型
2. 根据人设（coreNeeds / fears）调整权重
   e.g. 人设含"战" → combat_chapter 权重 28（否则 16）
       人设含"陪伴/共情" → gift_bond 权重 26（否则 14）
  ↓
3. 选权重最高的类型 → 生成文案
4. 返回 LifeGoalState
```

### 权重表

| 目标类型 | 基础权重 | 人设加成 |
|---|---|---|
| `combat_chapter` | 16 | +12（人设含"战/守/护/路/清扫"） |
| `gift_bond` | 14 | +12（人设含"陪伴/热/共情/喜欢"） |
| `armory` | 16 | — |
| `shop` | 16 | — |
| `skin` | 16 | —（拥有多个皮肤时提升） |
| `promise` | 20 | +10（有未履行承诺时） |
| `rest` | 16 | +10（疲劳高时） |
| `nothing` | 12 | — |

---

## 存档字段（LifeGoalState）

```typescript
type LifeGoalState = {
  kind: LifeGoalKind;
  text: string;              // 目标描述文案
  meta?: number;             // 附加数据（如章节号）
  startedAt?: number;        // 目标生成时间（游戏分钟）
  updatedAt?: number;        // 上次更新（游戏分钟）
};
```

**存档位置**：`AiLivingSave.lifeGoals[characterId]`

---

## 目标在 Prompt 中的使用

目标通过 `promptAssembler` 注入 Prompt 的「深场」块：

```typescript
const goal = getLifeGoal(living, charId);
// → "想跟指挥官再闯一趟「熔炉城废墟」，把那股味道从装甲缝里洗掉"
```

角色 LLM 会参考目标，决定对话方向（不会直接提"我的目标是想送礼"，但会影响语气和话题偏好）。

---

## 目标完成与更新

| 事件 | 行为 |
|---|---|
| 战斗章节完成 | `completeLifeGoal(charId, 'combat_chapter')` → 写里程碑记忆 |
| 收到礼物 | `completeLifeGoal(charId, 'gift_bond')` → 写里程碑记忆 |
| 逛商店 | 目标重评（可能更新为其他类型） |
| 游戏日切换 | 所有角色目标重评（`reassessLifeGoals()`） |

---

## 与其他系统的关系

| 系统 | 关系 |
|---|---|
| **议程系统** | 人生目标不直接驱动议程，但影响角色话题偏好 |
| **记忆系统** | 目标完成写 milestones 记忆（高优先级） |
| **欲望系统** | 目标与欲望独立；但 `rest` 目标与 `rest` 欲望关联 |
| **关系弧线** | 高关系阶段解锁更深层目标（promise / skin） |

---

## 代码入口

| 函数 | 作用 |
|---|---|
| `pickLifeGoal()` | 生成角色的人生目标 |
| `getLifeGoal()` | 读取角色当前目标 |
| `ensureLifeGoal()` | 确保存档有目标字段 |
| `completeLifeGoal()` | 标记目标完成 |
| `lifeGoalProgressLine()` | 生成目标进度描述（进 Prompt） |
| `reassessLifeGoals()` | 游戏日切换时重评所有目标 |

---

## 设计意图

人生目标系统的设计意图是**让角色不只是"当下想要什么"，还有"中期想要什么"**。

- 不会每句话都提目标（太刻意）
- 但玩家能感受到角色的"成长感"——今天说想打章节，过几天真的打了
- 里程碑记忆让角色能"引用"自己的人生目标

---

## 同步检查清单

- [ ] 新增目标类型 → 更新 `LifeGoalKind` 类型 + `pickLifeGoal()` 权重表 + 本文档
- [ ] 修改目标文案 → 同步 `pickLifeGoal()` 中的 cands 数组
- [ ] 新增完成条件 → 同步 `completeLifeGoal()` 调用点 + 本文档完成表
- [ ] 修改人设加成 → 同步正则表达式 + 本文档权重表
