# AI 欲望与议程系统

> **源文件**：`src/ai/characterDesires.ts`、`src/ai/characterAgenda.ts`、`src/ai/desireNext.ts`  
> **最新更新**：2026-09-06

---

## 概述

**欲望系统**计算角色"想去哪里/做什么"的分数（0-100），驱动**议程系统**决定角色下一步行动。议程是角色的"待办清单"——想去某地、做某活动、持续多久。

**核心设计原则**：
- 欲望是分数量表（可叠加/可衰减）
- 议程是欲望驱动的行动序列
- 高欲望不一定立即兑现（受冷却/随机/冲突限制）

---

## 欲望类型（DesireId）

| ID | 中文名 | 基础分 | 高欲望触发地点/活动 |
|---|---|---|---|
| `thirst` | 渴望（社交/亲密） | 8 | 大厅/户外 |
| `stuffy` | 闷/想透透气 | 6 | 户外/泳池/警卫塔 |
| `shop` | 想逛商店 | 10 | 商店 |
| `swim` | 想游泳/玩水 | 8 | 泳池 |
| `armory` | 想看武器库 | 10 | 武器库 |
| `tower` | 想远眺 | 6 | 警卫塔 |
| `social` | 想社交/找伴 | 10 | 大厅/户外 |
| `rest` | 想休息/睡觉 | 8 | 卧室 |

---

## 欲望分计算

```typescript
computeDesireScores(living, characterId, now)
  ↓
基础分（BASE_SCORES） + 叠加项
  ↓
1. 状态叠加（characterStatus）
   - thirst+35
   - fatigue高 → rest+28, stuffy+12
   - hunger → shop+8
   - inspired → tower+15
   - anxious → swim+10
   - injured → rest+20, armory-8
  ↓
2. 时段叠加（worldClock）
   - 午后闷热 → stuffy+16
   - 夜间 → rest+10
   - 白天 → social+10
  ↓
3. 皮肤叠加
   - 拥有泳装 → swim+14
   - 拥有睡衣 → rest+10
   - 任一皮肤 → social+6
  ↓
4. 欲望分 × (0.7 ~ 1.3) 随机波动（hash01）
  ↓
返回 { scores: Record<DesireId, number>, topLine: string }
```

---

## 议程（CharacterAgenda）

```typescript
type CharacterAgenda = {
  goal: string;           // 目标描述（如"去泳池游泳"）
  targetRoomId: string;   // 目标房间 ID
  weight: number;         // 权重（欲望分 × 系数）
  startedAt?: number;     // 开始时间
  endsAt?: number;        // 结束时间（可选）
  source: 'desire' | 'schedule' | 'event' | 'llm';  // 来源
};
```

### 议程来源优先级

```
llm（LLM 自主决策）> event（营地事件）> schedule（作息表）> desire（欲望驱动）
```

### 议程生命周期

```
1. 生成议程（欲望高分 → 创建议程）
2. 执行议程（角色移动到 targetRoomId）
3. 议程中（角色在目标地点活动）
4. 议程结束（欲望满足/时间到期/被打断）
5. 重新评估（计算新一轮欲望分）
```

---

## 欲望 → 议程的映射

| 欲望 | 目标房间 | 权重系数 |
|---|---|---|
| `thirst` | 大厅/户外随机 | 1.0 |
| `stuffy` | 户外/泳池/警卫塔 | 1.2 |
| `shop` | 商店 | 1.5 |
| `swim` | 泳池 | 1.5 |
| `armory` | 武器库 | 1.5 |
| `tower` | 警卫塔 | 1.2 |
| `social` | 大厅/户外 | 1.0 |
| `rest` | 卧室 | 2.0（最高权重） |

### 欲望驱动的特殊行为

| 欲望 | 特殊行为 |
|---|---|
| `swim` ≥ 55 | **确定性**换泳装（即使概率低） |
| `rest` 高 | 推进睡眠议程 |
| `stuffy` + 夜间 | 倾向去警卫塔远眺 |
| `social` + 高关系 | 倾向找人聊天 |

---

## 欲望衰减

欲望分不是静态的——会随时间和行为衰减：

```typescript
// 每 30 游戏分钟，欲望分衰减约 5-10 分
decayDesire(living, characterId, desire: DesireId, amount: number)
  ↓
当前欲望分 - amount
  ↓
低于阈值 → 议程取消
```

---

## 泳装欲望的特殊规则

> **2026-09-16 同步源码**（`src/ai/emotionOutfit.ts`）：概率已从 28% 下调至 18%，与 [character-skins.md](./character-skins.md) 对齐。

```typescript
// ① 泳池意图/场景 或 欲望分 ≥ 55 → 确定性换泳装
if (hasPool && (room === 'room_1f_pool' || /pool|swim|浴后|洗后/.test(goal)
    || desireScores.swim >= 55)) {
  applyOutfit(POOL_PARTY_SKIN_ID);  // 泳池派对外覆
}

// ② 偶发泳装：白天心情 playful 且 swim ≥ 35 时，18% 概率
if (hasPool && !night && dayMode === 'playful'
    && desireScores.swim >= 35) {
  if (hash01(characterId, salt) < 0.18) {  // 18% 概率（原 28%，已下调）
    applyOutfit(POOL_PARTY_SKIN_ID);
  }
}
```

---

## 欲望在 Prompt 中的使用

欲望分通过 `promptAssembler` 注入 Prompt：

```typescript
// 欲望分 topLine 注入 Prompt 的「深场」块
const topLine = computeDesireScores(living, charId, now).topLine;
// e.g. "想去泳池游泳（欲望 72），想在商店逛逛（欲望 45）"
```

角色 LLM 会参考欲望分决定行为（在合理范围内）。

---

## 与其他系统的关系

| 系统 | 关系 |
|---|---|
| **睡眠系统** | `rest` 欲望高 → 推进睡眠议程 |
| **换装系统** | `swim` 欲望高 → 确定性换泳装 |
| **议程系统** | 欲望分 → 议程权重 |
| **事件系统** | 高欲望时更容易触发对应事件 |
| **议程** | 执行中议程会抑制新议程生成（避免冲突） |

---

## 代码入口

| 函数 | 所在文件 | 作用 |
|---|---|---|
| `computeDesireScores()` | `characterDesires.ts` | 计算欲望分 |
| `getAgenda()` | `characterAgenda.ts` | 读取角色议程 |
| `setAgenda()` | `characterAgenda.ts` | 设置议程 |
| `clearAgenda()` | `characterAgenda.ts` | 清除议程 |
| `snapAgentToRoom()` | `campAgents.ts` | 将角色锚定到某房间（议程执行） |
| `desireNext.ts` | — | 对话后欲望暂存，对话结束才落成议程 |

---

## 同步检查清单

- [ ] 新增欲望类型 → 更新 `DesireId` 类型 + `BASE_SCORES` + 本文档
- [ ] 修改欲望分计算 → 同步 `computeDesireScores()` + 本文档公式
- [ ] 新增欲望驱动行为 → 更新 `applyDesireDrivenBehavior()` + 本文档
- [ ] 修改议程来源优先级 → 同步 `characterAgenda.ts` + 本文档优先级表
