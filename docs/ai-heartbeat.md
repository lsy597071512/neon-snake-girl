# AI 心跳调度与 NPC 主动沟通

> **源文件**：`src/ai/heartbeat.ts`、`src/ai/npcOutreach.ts`、`src/ai/playerOutreach.ts`  
> **最新更新**：2026-09-06

---

## 概述

**心跳系统（Heartbeat）** 是营地生活的"节拍器"——稀疏事件驱动角色自主行动、NPC 主动找玩家聊天、以及营地随机事件。

**核心原则**：
- 稀疏调度：最小间隔 **8 分钟**现实时间
- 优先队列：营地事件 > NPC 主动沟通 > 同房高关系对谈 > 本地氛围日志
- 零 API 成本：大部分路径不调用 LLM，只写本地日志

---

## 心跳类型（tickHeartbeat 返回值）

| kind | 含义 | 是否耗 API | 说明 |
|---|---|---|---|
| `skip` | 本次跳过（距上次太近） | ❌ | 正常情况（最常见） |
| `local` | 本地氛围日志 | ❌ | 写一句角色行为日志到 campLog |
| `npc` | NPC 主动找玩家 | ✅ | 调用 LLM 生成主动消息 |
| `camp_event` | 营地随机事件 | ✅ | 调用 LLM 生成事件 |
| `npc_seek` | NPC 跨房找人 | ✅ | NPC 主动去另一房间找人聊天 |

---

## 调度优先级

```
tickHeartbeat()
  ↓
1. resolveReadyNpcSeeks()  ← 已抵达的跨房寻找可立即结算（不占 8 分钟配额）
  ↓
2. lastNpcEventAt 距上次 < 8 分钟 → skip
  ↓
3. tryRollCyberHealthEvents()  ← 义体健康告警（本地规则）
  ↓ 有事件 → return { kind: 'camp_event', detail: 'cyber:xxx' }
  ↓ 无事件
4. trySpawnCampEvent()  ← 营地随机事件（55% 概率）
  ↓ 有事件 → return { kind: 'camp_event', detail: 'pool_party' }
  ↓ 无事件
5. tryProactiveNpcOutreach()  ← NPC 主动找玩家聊天
  ↓ 有 → return { kind: 'npc', detail: 'charId:text' }
  ↓ 无
6. 随机同房对谈（本地规则）
  ↓ 有 → return { kind: 'npc' }
  ↓ 无
7. localAmbientLog()  ← 本地氛围日志（随机角色 + 行为）
  → return { kind: 'local' }
```

---

## NPC 主动沟通（npcOutreach.ts）

### 消息类型

| 类型 | 英文 key | 说明 | 触发条件 |
|---|---|---|---|
| 闲聊 | `chat` | 随便找玩家聊两句 | 欲望高 / 关系好 / 无聊 |
| 求帮忙 | `ask_help` | 请玩家帮忙做某事 | 某欲望强烈但自己搞不定 |
| 分享 | `share` | 分享一个发现/感受 | 营地事件 / 角色情绪波动 |
| 邀请 | `invite` | 邀请玩家去某地 | 想去某地且希望玩家陪同 |
| 倾诉 | `vent` | 情绪发泄/吐槽 | 疲劳高 / 心情差 / 关系紧张 |

### 调度逻辑

```typescript
tryProactiveNpcOutreach(living, ownedIds)
  ↓
1. 筛选候选角色（不在调教中 / 不在睡觉 / 非冷漠状态）
2. 按欲望分 + 关系分 + 冷却时间 计算各类型消息的出现概率
3. 选中最合适的角色 + 消息类型
4. 调用 LLM 生成具体文本
5. 写入未读消息队列（playerOutreach）
```

### 玩家外展（playerOutreach.ts）

当玩家长时间未响应 NPC 的主动消息时，触发追踪机制：
- 角色会发"跟进消息"（询问玩家怎么了）
- 多轮不回应后，角色写入"被冷落"记忆

---

## 营地随机事件（campEvents/）

### 事件类型

| 事件 | 场所 | 说明 |
|---|---|---|
| `pool_party` | 泳池 | 泳装派对，可换泳装外覆 |
| `pool_solo_swim` | 泳池 | 单独游泳 |
| `pool_water_play` | 泳池 | 玩水/打水仗 |
| `pool_cleaning` | 泳池 | 清洗泳池 |
| `tower_lookout` | 警卫塔 | 远眺/叙情 |
| `tower_quiet_chat` | 警卫塔 | 安静聊天 |
| `tower_weather_watch` | 警卫塔 | 看天气 |
| `shop_browse` | 商店 | 逛商店 |
| `shop_self_repair_buy` | 商店 | 自助买修理道具（-1 锈币） |
| `armory_inspect` | 武器库 | 查看武装 |
| `armory_war_talk` | 武器库 | 战争话题 |
| `gate_outing_thought` | 大门 | 外出思考（不离营） |
| `gate_repair` | 大门 | 修门 |
| `gate_hangout` | 大门 | 门口闲聊 |

### 事件调度

```typescript
trySpawnCampEvent(living, ownedIds, { chance: 0.55 })
  ↓
1. 按角色位置/欲望/时段/冷却 计算事件出现概率
2. 55% 基础概率（可调）
3. 选中事件 + 参与者
4. 写入 living.activeCampEvents
5. 生成事件日志（参与者在场 / 不在场 / 旁观）
```

---

## 冷却与限流

| 机制 | 间隔 | 说明 |
|---|---|---|
| 心跳最小间隔 | **8 分钟** | 两次心跳的最小现实时间差 |
| 义体健康事件 | 独立冷却 | 各健康事件独立计算 |
| 营地事件 | 事件级别冷却 | pool_party 约 280 游戏分钟冷却 |
| NPC 主动沟通 | 角色级别冷却 | 同一角色不会连续主动 |
| 玩家外展 | 会话级别冷却 | 已读消息后重置 |

---

## 与其他系统的关系

| 系统 | 关系 |
|---|---|
| **欲望系统** | 高欲望 → 提升对应事件的触发概率 |
| **议程系统** | 角色有议程时优先执行议程（议程优先于心跳事件） |
| **记忆系统** | 所有事件写 campLog；重要事件写 memories |
| **关系系统** | 高关系 → NPC 主动沟通概率提升 |
| **CyberHealth** | 低健康触发告警事件（不占 8 分钟配额） |
| **调教系统** | 调教中角色不参与心跳调度 |

---

## 调试命令

```javascript
// 强制触发营地事件
spawnCampEventNow('pool_party')

// 查看当前所有进行中的事件
console.log(getAiLiving().activeCampEvents)

// 强制触发 NPC 主动沟通（需有存档）
tryProactiveNpcOutreach(getAiLiving(), getOwnedCharacterIds())
```

---

## 代码入口

| 函数 | 所在文件 | 作用 |
|---|---|---|
| `tickHeartbeat()` | `heartbeat.ts` | 心跳主调度 |
| `tryProactiveNpcOutreach()` | `npcOutreach.ts` | NPC 主动找玩家 |
| `resolveReadyNpcSeeks()` | `npcOutreach.ts` | 结算已抵达的跨房寻找 |
| `trySpawnCampEvent()` | `campEvents/` | 尝试触发营地事件 |
| `localAmbientLog()` | `heartbeat.ts` | 写本地氛围日志 |

---

## 同步检查清单

- [ ] 新增心跳类型 → 更新 `tickHeartbeat` 返回值类型 + 本文档表格
- [ ] 新增营地事件 → 更新 `campEvents/` 目录 + 本文档表格
- [ ] 新增 NPC 消息类型 → 更新 `npcOutreach.ts` + 本文档表格
- [ ] 修改心跳间隔 → 同步 `MIN_INTERVAL_MS` 常量 + 本文档
