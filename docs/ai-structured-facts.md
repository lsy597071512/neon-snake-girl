# AI 结构化事实与关系弧线

> **结构化事实**：`src/ai/structuredFacts.ts`  
> **关系弧线**：`src/ai/relationshipArc.ts`  
> **最新更新**：2026-09-06

---

## 结构化事实（Structured Facts）

### 概念

**结构化事实**是独立于自由文本记忆的"铁事实"——承诺、称呼、约定、偏好等。每次对话强约束注入，确保模型不会"昨天答应今天忘"。

**核心设计原则**：
- 承诺/称呼/约定 **高于** 自由文本记忆
- 每轮 Prompt 注入，不依赖关键词召回
- 有独立的重要性权重（重要事实优先）

---

### 事实类型（StructuredFactKind）

| 类型 | 中文名 | 示例 | 注入优先级 |
|---|---|---|---|
| `promise` | 承诺 | "答应指挥官明天一起去泳池" | 极高 |
| `nickname` | 称呼 | "指挥官叫我『小奈』" | 高 |
| `preference` | 偏好 | "喜欢指挥官送的那个发饰" | 中 |
| `agreement` | 约定 | "和指挥官的暗号是轻敲两下" | 高 |
| `identity` | 身份认同 | "我是指挥官最信任的队员" | 中 |
| `milestone` | 里程碑 | "第一次和指挥官去泳池派对" | 极高 |

---

### 存档字段

```typescript
type StructuredFact = {
  id: string;                    // 唯一 ID（sf_时间戳_随机）
  kind: StructuredFactKind;      // 事实类型
  text: string;                  // 短中文事实句
  createdGameMin: number;        // 创建时的游戏分钟
  dayIndex: number;              // 创建时的游戏日
  source: 'memory_write' | 'dialogue' | 'gift' | 'arc' | 'system';  // 来源
  importance: number;            // 重要性（排序用）
};
```

**存档位置**：`AiLivingSave.structuredFacts[characterId][]`  
**上限**：每角色最多 **28 条**（超出时按重要性 + 时间裁剪）

---

### 写入时机

| 时机 | 类型 | 来源 | 重要性 |
|---|---|---|---|
| 对话中角色许下承诺 | `promise` | `dialogue` | 高 |
| 对话中角色给玩家起绰号 | `nickname` | `dialogue` | 高 |
| 收到礼物 | `preference` | `gift` | 中 |
| 对话中达成约定 | `agreement` | `dialogue` | 高 |
| 重要事件完成 | `milestone` | `arc` / `system` | 极高 |
| 关系弧线升级 | `identity` | `arc` | 中 |

---

### 读取与注入

```typescript
listStructuredFacts(living, characterId)
  ↓
过滤 + 排序（按 importance DESC, createdGameMin DESC）
  ↓
取前 28 条注入 Prompt
  ↓
格式：
【已知事实】
- 称呼：指挥官叫我「小奈」
- 承诺：答应了明天一起去泳池
- 偏好：喜欢指挥官送的那个发饰
```

---

## 关系弧线（Relationship Arc）

### 概念

**关系弧线**是基于好感度的**阶段状态机**。每个阶段有专属称呼、话题自由度、行为约束。阶段升级后解锁更深层的互动。

**核心设计原则**：
- 阶段由好感度自动决定（`minAffinity` 阈值）
- 每个阶段的行为约束不同（警惕期不能表白）
- 阶段升级时写里程碑记忆

---

### 阶段定义

| 阶段 ID | 中文名 | 好感要求 | 称呼 | 话题自由度 | 行为约束 |
|---|---|---|---|---|---|
| `wary` | 警惕 | 0+ | 冷淡/职衔 | 只谈任务/安全 | 可防备、可试探 |
| `cool` | 冷淡 | 20+ | 礼貌疏离 | 可闲聊日常 | 可短答、可打发 |
| `familiar` | 熟悉 | 40+ | 名字/惯称 | 可聊喜好/作息 | 记得已打过交道 |
| `friendly` | 友好 | 60+ | 惯称/昵称 | 可聊感情/玩笑 | 像朋友一样 |
| `trust` | 信赖 | 80+ | 昵称/亲昵 | 几乎无限制 | 可托付重要事 |
| `intimate` | 亲密 | 95+ | 亲昵/爱称 | 无限制 | 深层情感交流 |

---

### 阶段行为约束

每个阶段在 Prompt 中注入约束：

```typescript
// 警惕阶段
"保持距离，少用亲昵称呼，可用职衔或冷淡直呼"
"只谈任务/安全/当面事；拒绝对私人生活刨根问底"
"勿突然表白或过度亲昵；可防备、可试探"

// 冷淡阶段
"礼貌但疏离，偶尔露出一点在意仍嘴硬"
"可闲聊营地日常，仍回避过深感情戏"
"不要装成已经很熟；可短答、可打发"

// 熟悉阶段
"开始像队友熟人，可用名字或惯用称呼"
"可聊喜好、作息、吐槽同伴；仍克制告白"
"记得你们已经打过交道，禁止「第一次见面」式开场"

// 信赖阶段
// ...（以此类推）
```

---

### 弧线升级触发

```typescript
resolveRelationshipArcStage(affinity: number): RelationshipArcStage
  ↓
遍历 RELATIONSHIP_ARC_STAGES
  ↓
找到第一个 minAffinity <= affinity 的阶段
  ↓
返回阶段定义（id / labelZh / addressHint / topicFreedom / constraint）
```

---

### 弧线在 Prompt 中的使用

通过 `promptAssembler` 注入：

```typescript
const arc = resolveRelationshipArcStage(peekAffinity(charId));
// → { id: 'familiar', labelZh: '熟悉', addressHint: '...', ... }

// 注入 Prompt：
【关系阶段】
当前关系：熟悉
称呼建议：开始像队友熟人，可用名字或惯用称呼
话题自由度：可聊喜好、作息、吐槽同伴；仍克制告白
行为约束：记得你们已经打过交道，禁止「第一次见面」式开场
```

---

## 结构化事实 vs 自由文本记忆

| 维度 | 结构化事实 | 自由文本记忆 |
|---|---|---|
| 存储位置 | `structuredFacts` | `memories` |
| 注入方式 | 每轮强注入 | 关键词召回 |
| 优先级 | 极高 | 中 |
| 容量 | 每角色 28 条 | 更多（按时间裁剪） |
| 适用场景 | 承诺/称呼/约定/里程碑 | 一般对话内容 |
| 遗忘风险 | 极低 | 中（依赖召回质量） |

---

## 代码入口

### 结构化事实

| 函数 | 作用 |
|---|---|
| `addStructuredFact()` | 添加结构化事实 |
| `listStructuredFacts()` | 列出角色的结构化事实 |
| `removeStructuredFact()` | 删除结构化事实 |
| `updateFactImportance()` | 更新重要性 |
| `structuredFactsToPromptBlock()` | 转为 Prompt 块 |

### 关系弧线

| 函数 | 作用 |
|---|---|
| `resolveRelationshipArcStage()` | 根据好感度返回当前阶段 |
| `RELATIONSHIP_ARC_STAGES` | 阶段定义常量表 |
| `arcStageToPromptBlock()` | 转为 Prompt 块 |

---

## 同步检查清单

- [ ] 新增事实类型 → 更新 `StructuredFactKind` + `addStructuredFact()` 来源 + 本文档
- [ ] 修改阶段定义 → 同步 `RELATIONSHIP_ARC_STAGES` + 本文档阶段表
- [ ] 修改好感阈值 → 同步 `resolveRelationshipArcStage()` + 本文档好感要求列
- [ ] 新增弧线升级触发条件 → 同步 `relationshipArc.ts` + 本文档触发条件
