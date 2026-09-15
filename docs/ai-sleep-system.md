# AI 睡眠系统

> **源文件**：`src/ai/sleepSystem.ts`  
> **最新更新**：2026-09-06

---

## 概述

角色需要睡眠来恢复**电力（CyberHealth）**。睡眠是角色自发驱动的行为，不是强制系统。

**核心设计原则**：
- 睡眠由欲望/议程系统驱动（角色自己决定何时睡）
- 玩家无法强制角色睡觉（只能旁观或打扰）
- 睡眠期间立绘播放睡姿循环 webm（`pifu02_sleep.webm`）
- 醒来时强制换回**星夜睡衣站立 idle**（`pifu02.webm`），不得裸回装甲

---

## 睡眠阶段（SleepPhase）

```
awake（清醒）
  ↓ [角色议程决定睡]
preparing（准备入睡，换睡衣站立）
  ↓ [现实约 6 分钟后]
asleep（深度睡眠，播放睡姿循环）
  ↓ [现实约 6 小时后]
awake（自然醒来）
  ↑ [被打扰/惊醒/做梦]
disturbed（被干扰醒来）
```

| 阶段 | 立绘 | 皮肤 | 备注 |
|---|---|---|---|
| `awake` | 当前营地皮 | 当前 | 正常状态 |
| `preparing` | 星夜睡衣站立 idle | `pifu02` | 换睡衣中 |
| `asleep` | 睡姿循环 webm | `pifu02_sleep` | 不可对话 |
| `disturbed` | 星夜睡衣站立 idle | `pifu02` | 被打扰，次日可能"睡不好" |

---

## 时间参数

| 常量 | 值 | 说明 |
|---|---|---|
| `SLEEP_REAL_DURATION_MS` | **6 小时** | 一次完整睡眠的现实时长 |
| `SLEEP_PREPARE_REAL_MS` | **6 分钟** | 从清醒到完全入睡的准备窗口 |
| `SLEEP_EVAL_GAP_MS` | **12 分钟** | 两次"是否该睡"评估的最短间隔 |
| `DREAM_WAKE_EVAL_GAP_MS` | **25 分钟** | 睡眠中做梦惊醒的低概率评估间隔 |

---

## 存档字段（CharacterSleepState）

```typescript
type CharacterSleepState = {
  phase: SleepPhase;              // 当前阶段
  lastCompletedDayIndex?: number;  // 上次完成一整觉的游戏日
  prepareStartedAtMs?: number;    // 开始准备入睡的时间
  asleepStartedAtMs?: number;     // 完全入睡的时间
  sleepUntilMs?: number;          // 计划醒来的时间
  disturbedAtMs?: number;         // 被打扰的时间
  disturbCount?: number;          // 被打扰次数
  lastWakeReason?: string;         // 醒来原因（字符串描述）
  lastEvalAtMs?: number;          // 上次评估时间
  lastDreamEvalAtMs?: number;     // 上次做梦评估时间
};
```

**存档位置**：`AiLivingSave.characterSleep[characterId]`

---

## 关键流程

### 入睡流程

```
1. characterAgenda 决定去 bedroom/bedroom2 睡觉
2. → startSleepPreparation(living, charId)
   - phase = 'preparing'
   - campWornSkin = 'pifu02'（星夜睡衣）
   - 立绘播放 pifu02.webm（睡衣站立 idle）
3. [现实 6 分钟后] → enterDeepSleep(living, charId)
   - phase = 'asleep'
   - 立绘切换到 pifu02_sleep.webm（睡姿循环）
   - sleepUntilMs = now + 6h
4. [现实中 6 小时内]
   - 可能做梦惊醒（DREAM_WAKE_EVAL_GAP_MS 间隔，低概率）
   - 可能被玩家对话打扰（玩家点开对话）
5. [到期或被唤醒] → wakeUp(living, charId, reason)
   - phase = 'awake'
   - campWornSkin = 'pifu02'（保持睡衣站立）
   - 恢复电力 +CYBER_HEALTH_MAX
   - 写营地日志 + 记忆
```

### 被打扰流程（disturbed）

```
玩家在角色 sleeping 时点开对话
  → 检测到 phase = 'asleep'
  → 立即触发 disturbed
  - phase = 'disturbed'
  - disturbCount++
  - 立绘切回睡衣站立 idle
  - 玩家看到角色"被吵醒"的对话
  - 次日状态可能受影响（玩家感知到"睡不好"）
```

---

## 与其他系统的关系

| 系统 | 关系 |
|---|---|
| **欲望系统**（`characterDesires.ts`） | `rest` 欲望高时推高睡眠议程权重 |
| **议程系统**（`characterAgenda.ts`） | 角色自主决定去 bedroom 睡觉 |
| **皮肤系统** | 睡觉强制穿睡衣（pifu02），醒来保持睡衣站立 |
| **CyberHealth** | 自然醒后恢复全部电力；被打扰可能少恢复 |
| **记忆系统** | 入睡/醒来写营地日志；被打扰写特殊记忆 |
| **调教系统** | 调教中角色不睡觉（`isDisciplineActiveFor` 屏蔽睡眠） |

---

## 玩家感知

- 角色去卧室睡觉 → 营地地图显示角色在 bedroom
- 角色睡着 → 营地地图立绘变成睡姿 webm
- 角色被吵醒 → 对话里角色"很困/生气/委屈"
- 角色自然醒 → 营地地图立绘恢复睡衣站立

**玩家无法直接看到电力数值，但能从角色的"精神状态"间接感知（通过对话语气）**

---

## 代码入口

| 函数 | 作用 |
|---|---|
| `startSleepPreparation()` | 开始准备入睡（换睡衣站立） |
| `enterDeepSleep()` | 进入深度睡眠（切换睡姿 webm） |
| `wakeUp()` | 醒来（恢复电力、写日志） |
| `getSleepState()` | 读取角色睡眠状态 |
| `ensureSleepFields()` | 确保存档有睡眠字段 |
| `isCharacterAsleep()` | 快速判断是否在睡 |
| `disturbSleep()` | 打扰睡眠（被玩家对话唤醒） |

---

## 同步检查清单

- [ ] 新增睡眠阶段 → 更新 `SleepPhase` 类型 + 本文档阶段表
- [ ] 修改时间参数 → 同步 `SLEEP_REAL_DURATION_MS` 等常量 + 本文档
- [ ] 新增立绘 → 确认 `pifu02.webm` / `pifu02_sleep.webm` 路径正确
- [ ] 修改电力恢复量 → 更新 `wakeUp()` + 本文档流程
