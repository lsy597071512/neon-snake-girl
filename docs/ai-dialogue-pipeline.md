# 锈带纪元 · 对话 AI 管线规范

> 本文是**对话 / 生活 LLM 管线**的约束文档。语料入库见 [`ai-corpus-pipeline.md`](./ai-corpus-pipeline.md)；记忆分层见 [`ai-memory-layers.md`](./ai-memory-layers.md)。

---

## 0. 硬规则（必须遵守）

### 本机 Fable Q4 仅个人测试，不得污染千问主路径

| 项 | 规定 |
|----|------|
| **线上默认** | `provider = dashscope`，对话模型 **`qwen-plus-character`**（及既有 life / summary / TTS / ASR 千问链路） |
| **本机 / 家里 GPU** | `provider = openai_compatible` + llama.cpp **`fable-q4:latest`**（`:8080`，推荐 MTP）——**仅个人 A/B、本机/外地自测** |
| **禁止** | 把默认 Provider 改成本机；为本地旁路去改千问默认温度、maxTokens、System Prompt、JSON 协议、营地逻辑 |
| **禁止** | 在发版说明/玩家可见文案中把本机 Fable Q4 写成正式推荐方案 |
| **禁止** | 再启用 MN-Violet-Lotus / rustbelt-* / Remnant-glm4 作为主测试基座（已废弃） |
| **允许** | 在 `isLocalHomeGpuDialoguePath() === true` **分支内**做适配（短协议锁、消息 normalize、Prompt 拆分缓存等） |
| **共享层** | 世界同步、记忆、好感、议程、JSON 字段 schema 仍共用；**不得**为迁就本机删减或改写千问依赖的规则正文 |

**一句话：千问是产品主路径；Fable Q4（llama.cpp ± MTP）是旁路实验开关，坏了只能坏在兼容口上。**

代码闸门：

- `src/ai/providerConfig.ts` → `getChatProvider()` 默认 `dashscope`；`DEFAULT_LOCAL_MODEL = fable-q4:latest`；`isLocalHomeGpuDialoguePath()`
- `src/ai/localHomeGpuPrompt.ts` → **仅**兼容口叠加短协议锁
- `src/ai/promptAssembler.ts` / `dialogueEngine.ts` / `llmClient.ts` → 本机专用逻辑必须包在兼容口判断里（含 static/dynamic 拆分、`reasoning_effort: none`、本地请求 maxTokens clamp 560 = `Math.min(LOCAL_HOME_GPU_MAX_TOKENS, 560)`）
- `src/ai/llmRouter.ts` → `life` / 非 dialogue 通道继续走 DashScope（有 Key 时）

本机方案：[`local-ai/README.md`](./local-ai/README.md)。Prompt 瘦身勾选：[`local-ai/prompt-slim-split-review.md`](./local-ai/prompt-slim-split-review.md)。

本地低延迟 / 异地隧道：`docs/low-latency-deployment.md`（历史 Violet 叙述已过时，后端以 `local-ai/README.md` 为准）。

---

## 1. 通道一览

| 通道 | 默认后端 | 可否切本机 Fable Q4 |
|------|----------|----------------|
| 角色对话 `channel=dialogue` | DashScope 千问 | 可（玩家/开发者在营地生活手动切） |
| 生活 / 摘要 / 营地后台 | DashScope | **否**（设计如此） |
| TTS / ASR | DashScope | **否** |

---

## 2. Prompt 组装（以代码为准）

| 层 | 千问路径 | 本机 Fable Q4 测试路径 |
|----|----------|-----------------|
| 人设 + JSON 协议 | `buildSystemPrompt` | 同左 + `localHomeGpuPrompt` 短锁；一比一去重/场景门控已落地 |
| 运行时上下文 | **与千问同布局**：`system = static+dynamic`（世界快照在 system） | **同左**（禁止再把快照拆进 user） |
| 用户轮 | 回答锁 + 指挥官原话 + 短 footer | 同左 |
| 消息交替 | 原样发送 | `normalizeChatMessagesForStrictTemplate`（仅兼容口） |
| 采样 / 长度 | 千问既有 | temp 1.0 · maxTokens **720**（llama.cpp 服务端，think 占额度）· **think low**；游戏端请求 clamp 到 **560**（`dialogueEngine.ts`）；千问对话通道默认 maxTokens 500 |

> **结构硬规则（2026-09-12）**：千问与 Fable 的 message 布局必须一致——恢复优化前的「整包 system + 短 user」。瘦身成果（去重、场景门控、成人事件/敏感点）保留在 `promptAssembler` 内容层，不得再以「KV 拆分」把动态快照塞进 user。

训练百科 `docs/ai-training-system-prompt.md` **不得**整段塞进运行时（过长且与 schema 漂移）。

---

## 2.1 成人向 Prompt 语气（单源 + 发出时软化）

> **现状备注（2026-09-23）**：先记录行为与风险，**暂不改架构**；不代表以后不改。日后若换本地基座、换云端、或千问策略变松/变严，应评估改为显式 `promptTone`（见文末「可选演进」）。

### 机制（当前）

- **只有一份源提示词**（`promptAssembler` / 各协议块 / 世界同步块等）。改普通文案一次，两边都吃到。
- 发出前经 `applyProviderPromptTone`（`src/ai/promptProviderTone.ts`）：
  - `isLocalHomeGpuDialoguePath() === true`（即 `provider === openai_compatible`）→ **原文**（成人向完整措辞）
  - 否则（当前产品主路径 `dashscope`）→ `softenAdultPromptForCloud`：**只弱化易审敏感词**，不删玩法、不改字段名（`bath_intimate_consent` / `skin_clip` / `bath_assist_action` 等仍在）
- 游戏仍是成人向；千问侧是「措辞软化」，不是「去成人化阉割」。

### 闸门粒度（风险）

软化与否**不是**按「模型是否开放 / 是否本地」细判，而是粗绑 **Provider id**：

| 实际部署 | 当前会拿到 |
|----------|------------|
| `dashscope`（千问） | 软化版 |
| `openai_compatible`（本机 Fable，或任意兼容口） | **未软化**成人原文 |

因此可能出现：

1. **本机已切模型，但 Provider 仍停在 `dashscope`** → 误用软化版（少见，但配置错会中）。
2. **云端审核变松，仍走 `dashscope`** → 会一直软化，不会自动改回成人原文。
3. **把新的审核严云端挂在 `openai_compatible`** → 会误发**未软化**成人 Prompt，易触发对方内容安全。
4. **新增成人敏感词却未写入 `softenAdultPromptForCloud` 替换表** → 千问侧仍可能带原文敏感词。

### 改 Prompt 时怎么做（当前约定）

| 改动类型 | 做法 |
|----------|------|
| 普通、非敏感文案 | 只改源文即可；两边自动一致 |
| 成人向 / 擦边措辞 | 改源文（本地完整版）；若含新敏感词，**同步补** `softenAdultPromptForCloud` 替换规则，避免千问漏软化 |
| 玩法字段 / JSON 协议 | 两边共用，禁止只给一侧删字段 |

### 可选演进（未做，备忘）

日后可改为显式策略，例如按 provider/模型配置 `promptTone: 'full' | 'soft'`，默认千问 `soft`、本机 Fable `full`，新云端必须手选——避免再靠「是不是 openai_compatible」猜。

相关：浴室互动 [`bath-assist-events.md`](./bath-assist-events.md) §双通道提示词。

---

## 3. 改动检查清单（PR / 自测）

改 AI 相关代码前自问：

1. 默认 Provider 是否仍是 `dashscope`？  
2. 千问路径的 system / temperature / maxTokens / 深场规则是否被改动？若被改 → **必须有产品理由，与本机无关**。  
3. 本机专用改动是否全部在 `isLocalHomeGpuDialoguePath()` / `openai_compatible` 分支内？  
4. 生活 / TTS 是否仍只认 DashScope Key？  
5. 若改了成人向措辞：源文是否仍完整？`softenAdultPromptForCloud` 是否覆盖新敏感词？（见 §2.1）

---

## 4. 相关文档

- 本机方案：[`local-ai/README.md`](./local-ai/README.md)  
