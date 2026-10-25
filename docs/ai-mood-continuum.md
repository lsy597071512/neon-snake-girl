# AI 心情系统（情绪连续体 · 活人定律核心回路）

> **定位**：活人定律的第一条实现回路——「角色性格带来心情变化，心情变化对应行为，行为对应言语」。
> 心情与好感**相关但独立**：完全可能好感 100 但心情很差；也可能心情好时玩家做不好的事，好感几乎不动。
> 建立：2026-10-25（v12 版本落地，由玩家明确立项）
> 上游纲领：[ai-first-principle.md](./ai-first-principle.md)

---

## 0. 一句话模型

```
事件（玩家行为/世界事件/重复活动） → 心情脉冲（valence/arousal）
    → 心情调制一切：议程去哪、好感怎么算、主动消息说什么、语气如何
    → 时间衰减缓慢拉回基线（强情绪可跨大半天存续）
```

---

## 1. 情绪连续体（量表）

**文件**：`src/ai/moodContinuum.ts`

| 字段 | 范围 | 含义 |
|---|---|---|
| `moodValence` | -100..100 | 愉悦度（负=难受，正=开心） |
| `moodArousal` | 0..100 | 唤醒度（低=懒洋洋，高=坐不住/烦躁） |

- 基线：valence=8，arousal=38；由性格特质（warmth/play/caution）+ 当日 dayMode 播种。
- 标签：`moodLabelZh()` 按 VA 象限给中文短标签（如「开心得有点蹦」「低落发闷」「烦躁紧绷」）。
- **衰减**（活人定律关键参数）：每游戏分钟向基线漂移，`VALENCE_DECAY_PER_MIN = 0.09`、`AROUSAL = 0.10`（v12 从 0.22/0.18 放缓——强情绪要能跨大半天存续，她不会五分钟就「想开了」）。
- `describeMoodContinuumForPrompt()`：只给 AI 定性描述（偏积极/偏消极 + 语气要求），**不暴露精确数值**。

## 2. 事件 → 心情脉冲

`applyMoodImpulse(living, characterId, impulse)`（moodContinuum.ts），脉冲前先补算时间衰减：

| kind | 来源 | valence | arousal |
|---|---|---|---|
| `talk` | 对话好感变化 | affection×2.2 | \|affection\|×1.5+2（坏事再+4） |
| `gift` | 送礼（0/1/2 档） | +6/11/16 | +4/6/8 |
| `combat` | 战斗胜负 | +10 / -14 | +8 / +16 |
| `event` | 玩法收尾事件 tone up/down/spike | +8 / -10 / 0 | +6 / +8 / +18 |
| `ignored` | 被无视/放鸽子 | -12 | +6 |
| `promise` | 承诺兑现/食言 | +8 / -16 | +3 / +10 |
| `asr_hint` | 系统内部脉冲（如重复厌倦） | 自定 | 自定 |

## 3. 重复活动厌倦（活人定律：真实的人会腻）

**文件**：`src/ai/activityFatigue.ts`（v12 新增）

- 玩家每发起一次活动（小游戏/跳舞/共浴/换装）→ `recordPlayerActivityRequest()` 按天计数（`AiLivingSave.activityRequests`，跨天清零）。
- **耐心阈值** = 3 + play 特质/10（爱玩的更耐玩，约 3~8 次）。
- 超阈值：心情脉冲 `valenceDelta = -min(18, 超次数×2)` + arousal+4；首次越界写 `activity_fatigue` 记忆。
- `describeActivityFatigueForPrompt()` 注入 Prompt（promptAssembler L335）：明显超限时要求 AI 表现出不情愿/敷衍/吐槽，接近上限可调侃「又来」，未超限也不能表现成第一次那样新鲜。
- 已接入：miniGameSession / danceSession / bathAssistSession / dialogueWorldSync(换装)。

## 4. 心情 → 议程/行为桥

**文件**：`src/ai/characterAgenda.ts`（`pickNewAgenda` 内 moodBoost）

| 心情 | 行为倾向 |
|---|---|
| valence ≤ -35 | 休息/发呆/睡觉 +8 权重；玩乐/大厅聊天/泡澡/跳舞 -8 |
| valence ≥ 40 | 玩乐社交类 +6 |
| valence ≤ -50 | 注入高权重（11）「独处消化」候选——回自己房间，不见人 |

表现：她不高兴可能一整天窝在房间里不出去；高兴则主动凑热闹。

## 5. 心情 → 好感调制

**文件**：`src/ai/relationship.ts`（`modulateAffinityDeltaByMood`）

| 情形 | 调制 |
|---|---|
| 坏事 × 心情差 | 好感降幅 ×1.5（雪上加霜，摔门而去） |
| 坏事 × 心情好 | 好感降幅 ×0.5（心情好不计较） |
| 好事 × 心情差 | 好感增幅 ×1.25（雪中送炭更珍贵） |
| 好事 × 心情好 | 正常（锦上添花） |

## 6. 心情 → 主动消息

**文件**：`src/ai/playerOutreach.ts`

- valence ≤ -40：主动消息走 vent（倾诉/发泄）池，而不是邀约。
- 评分：valence ≥ 40 → +0.9（更愿意 invite）；≤ -40 → +0.3。
- `buildContextBlock()` 注入 `describeMoodContinuumForPrompt` 行，让主动来信语气贴合心情。

## 7. 玩法回灌心情（事件收尾脉冲）

- 小游戏：`quitMiniGameByPlayer`（中途退出）→ event tone down；`settleGame` 输赢脉冲已有。
- 跳舞：`completeCoDance`（共舞完成）→ event tone up。
- 共浴：`leaveBathAssistSession`（正常离开）→ event tone up。

## 8. UI 呈现

- 营地卡片心情 chip（`campLivingPanel.ts` L263 `cl-mood`）：`is-low`（valence ≤ -35 暖红）/ `is-high`（≥40 翠绿）着色（CSS：`src/ui/aiLiving.css` L1113 后）。
- 聊天页 Prompt 侧仅注入定性描述，不显示数值（角色不能读自己的数值）。

## 9. 代码锚点（改动时先读）

| 关注点 | 文件 |
|---|---|
| 连续体量表/衰减/脉冲 | `src/ai/moodContinuum.ts` |
| 重复活动厌倦 | `src/ai/activityFatigue.ts`（存档字段 `activityRequests`） |
| 心情→议程桥 | `src/ai/characterAgenda.ts`（pickNewAgenda / moodBoost） |
| 心情→好感调制 | `src/ai/relationship.ts`（modulateAffinityDeltaByMood） |
| 心情→主动消息 | `src/ai/playerOutreach.ts` |
| Prompt 注入 | `src/ai/promptAssembler.ts`（L335 重复活动感受） |
| 营地 UI 心情颜色 | `src/ui/campLivingPanel.ts` + `src/ui/aiLiving.css` |

## 10. 提交前自检（心情相关改动必过）

- [ ] 新增事件是否打了脉冲（up/down/spike）？只改文案不打脉冲 = 白改。
- [ ] 精确数值是否泄露给 Prompt/UI 之外？（AI 只能看定性描述）
- [ ] 衰减参数改动是否有理由？（强情绪存续是活人感的核心）
- [ ] 重复活动的耐心阈值是否按角色 play 特质浮动？
- [ ] 心情差时她会不会「仍然笑着答应一切」？（那是复读机，不是活人）
