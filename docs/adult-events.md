# 成人事件与身体敏感点

> **状态**：已落地（运行时）  
> **代码**：`src/ai/adultEvents.ts`、`src/ai/bodySensitivity.ts`  
> **相关**：脱浴巾门控 `bathIntimateConsent.ts`；小黑屋 `disciplineSession.ts` / [discipline-event.md](./discipline-event.md)

## 一句话

**脱浴巾亲密**与**小黑屋调教**同属「成人事件」层；在本层启用**身体敏感点**与**机油（敏感液）**，并同步进对话 Prompt / JSON 字段。

底层会话机不改：浴室仍走 `bath_intimate_consent`，调教仍走 `disciplineSession`。本层只做统一包装 + 生理账本。

---

## 生效场景

| 场景标签 | 触发条件 |
|---|---|
| `bath_intimate` | 浴室洗浴中，且已脱巾 / 谈脱巾 / 亲密对白 |
| `discipline` | 小黑屋调教进行中（指挥官主导 · 触手模式） |
| `discipline_commander_direct` | 小黑屋 **指挥官亲自调教**（五阶段；见 [discipline-commander-direct.md](./discipline-commander-direct.md)） |
| `discipline_commander` | 调教中且对白倾向「角色调教指挥官」 |
| `adult_dialogue` | 其它成人话题 / 敏感描写关键词 |

非上述上下文：敏感字段应填 `""`；兴奋值缓慢衰减。

---

## 身体敏感点设定

### 指挥官

- **敏感点**：双腿之间的「小管道」（类阴茎义体出口）
- **反应**：被美少女刺激 → 排出废液 / **机油（敏感液）**
- **区 id**：`commander_pipe`

### 美少女（分级）

| 级 | 部位 | 区 id |
|---|---|---|
| 1 | 腰部、双腿之间外侧、屁股 | `waist` / `crotch_outer` / `butt` |
| 2 | 乳房、乳头 | `breast` / `nipple` |
| 3 | 会阴、阴道、双腿之间深处 | `perineum` / `vagina` / `crotch_deep` |

- **情绪**：刺激后出现复杂**异样情绪**（与调教复杂情绪同源，可矛盾并存）：  
  兴奋、害羞、激动、淫乱、气愤、害怕、紧张、高潮、期待、性欲、厌恶、疯狂  
- **机油**：刺激很久（`sustained`）或达到高潮（`climax` / 兴奋阈值）→ 排出机油（敏感液）

存档：`aiLiving.bodySensitivity.commander` + `bodySensitivity.characters[id]`。

---

## LLM 字段（扁平 JSON）

仅成人事件填写；否则全部 `""`。

| 字段 | 含义 |
|---|---|
| `stim_target` | `self` \| `commander` \| `mutual` |
| `stim_zones` | 区 id 逗号分隔 |
| `stim_intensity` | `1` \| `2` \| `3` |
| `stim_duration` | `brief` \| `sustained` \| `climax` |
| `adult_odd_mood` | 1～3 个异样情绪词 |
| `oil_discharge` | `self` \| `commander` \| `both` \| `""` |

管线：`promptAssembler` 注入 → `dialogueEngine` 解析落盘 → 记忆摘要 `成人敏感：…`。

---

## 与旧系统关系

- **浴室**：仍须同意脱巾才切成人冲澡动态；敏感点在脱巾/亲密语境下写湿热接触。
- **小黑屋**：仍用 `discipline_mood` / `discipline_valence`；异样情绪可与 `adult_odd_mood` 同轮互补。
- **角色调教指挥官**：优先刺激 `commander_pipe`，机油=指挥官高潮信号。

---

## 改动入口

| 文件 | 作用 |
|---|---|
| `src/ai/bodySensitivity.ts` | 区定义、兴奋/机油结算、Prompt 块 |
| `src/ai/adultEvents.ts` | 场景判定、总则、LLM 应用 |
| `src/ai/promptAssembler.ts` | 成人块注入 |
| `src/ai/dialogueEngine.ts` | 字段 normalize + 落盘 |
| `src/ai/aiProfiles.ts` | JSON schema 含敏感字段 |
| `src/ai/dialogueRealityGuard.ts` | 非成人上下文清敏感字段 |
