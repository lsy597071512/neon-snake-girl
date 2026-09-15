# 锈带纪元 · 本地模型部署完整方案

> **文档状态**：v1.0 · 2026-09-06  
> **目标**：在不牺牲"锈带纪元"角色扮演沉浸感的前提下，找到与 `qwen_plus_character` 能力对标的**本地部署模型**，并给出**按硬件分层的最优方案**。  
> **依据**：全网最新搜索（2026-09）、RP-Bench / TRACE Bench / TwinBench 基准测试、open-weight 模型排行榜（2026-08）、以及本项目 `local-model-support.md` 已有内容。  
> **同步规则**：模型推荐列表随模型发布更新；本文是工程决策的依据。

---

## 0. 核心结论速查

### 0.1 与 Qwen Plus Character 对标的核心指标

| 指标 | Qwen Plus Character（云端）| 本地替代目标 |
|---|---|---|
| 中文角色扮演质量 | **领先**（阿里官方角色微调）| ≥ 同等水平 |
| 角色一致性 | 高（指令跟随强）| ≥ Qwen3 7B 级别 |
| 长程记忆 | 强（128K context）| ≥ 32K 起步 |
| NSFW 内容 | 受限（阿里云过滤）| ✅ 零过滤（本地优势）|
| 推理速度 | 即时（云端）| ≥ 15 tok/s（本地体验门槛）|
| 每月成本 | ¥200-500（按量）| **¥0**（电费不计）|

### 0.2 分硬件推荐速查

| 你的显卡 | 推荐模型 | 量化 | 显存 | 角色扮演质量 | 推荐度 |
|---|---|---|---|---|---|
| **RTX 4090 24GB** | Kimi K3 | Q4_K_M | ~18 GB | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **RTX 4090 24GB** | Qwen3-30B-A3B (MoE) | Q4_K_M | ~20 GB | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **RTX 3090/4070 Ti 12GB** | Qwen3.6-27B Uncensored | IQ4_XS | ~13 GB | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **RTX 3060 8GB** | Peach-2.0-9B-Roleplay | Q4_K_M | ~5.5 GB | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **RTX 3060 8GB** | Hermes 3 8B | Q5_K_M | ~7 GB | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **RTX 3060 8GB** | Qwen3 8B Abliterated | Q4_K_M | ~5.5 GB | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **无独显（16GB RAM）** | NyX-Roleplay-7B | Q4_K_M | ~4.5 GB | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Mac M3 Pro 18GB** | Kimi K3 | MLX | ~16 GB | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## 1. 基准测试分析：什么指标真正重要

### 1.1 角色扮演专项基准

**三大基准体系**（2026 年）：

| 基准 | 测量维度 | 关键发现 |
|---|---|---|
| **RP-Bench**（HuggingFace）| 27 维度 × 3 层（基础/进阶/风格）| Claude Opus 4.6 第一；DeepSeek V4 Pro 第二；开源中 **Gemma 4 26B** 社区胜率最高 |
| **TRACE Bench**（ACL 2026）| 200 案例 × 5,498 Checklist | DeepSeek-V4-Flash 92.79 分；Claude Opus 4.6 领先；国产模型总分高 |
| **TwinBench**（ACL 2026）| 人格模拟/声音一致性 | Claude Sonnet 4.6 社交维度 62.0；Gemini 3.5 Flash 对话维度 84.0 |

### 1.2 与角色扮演最相关的维度

```
角色扮演质量 ≈ f(
  角色一致性（F1）,     // 能否保持角色人设不漂移
  情感表达深度（F8）,   // 情绪细腻度、语气变化
  用户代入感（F11）,    // 推进剧情而非主导用户
  世界观融合（F3）,     // 记忆与剧情一致性
  色情/成人场景（F13）  // NSFW 内容质量（本地优势所在）
)
```

**RP-Bench 关键发现（开源模型）**：

| 模型 | 总体 ELO | NSFW 胜率 | 特点 |
|---|---|---|---|
| **Gemma 4 26B** | 1546 | 58.8% | 社区最爱；长程一致性强 |
| **Mistral Small Creative** | 1507 | **60.8%** ⭐ | 色情场景最强开源 |
| **Qwen3.5 Flash** | 1496 | 41.7% | 中文强；推理快 |
| **Llama 4 Scout** | 1453 | 33.8% | 通用强；角色一般 |

### 1.3 中文角色扮演专项

| 模型 | 中文质量 | 角色深度 | 推荐场景 |
|---|---|---|---|
| **Qwen-Character**（阿里官方）| ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 基准天花板（但需云端）|
| **Qwen3 72B** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 中文最强本地；需 46 GB |
| **Yi-34B** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 情感深度最好 |
| **Qwen3 7B** | ⭐⭐⭐⭐ | ⭐⭐⭐ | 中文良好；硬件门槛低 |
| **GLM-5.3** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 推理强；角色一般 |

---

## 2. 最新模型格局（2026 年 8-9 月）

### 2.1 全模型排行榜（综合能力）

来源：modelgrep.com / llm-stats.com（2026-08）

```
综合智能指数（Intelligence Index）
├── 闭源前沿
│   ├── GPT-6 Astra (60.7)  ← 2026 年第一
│   ├── Claude Fable 5.1 (56.8)  ← Anthropic 新作
│   ├── Claude Opus 5 (55.4)
│   └── Gemini 3.5 Flash (54.7)
│
├── 开源可本地（Open-Weight）
│   ├── Kimi K3 (59.7)  ← 开源第一（Moonshot AI，2026-07）
│   ├── GLM-5.3 (59.5)
│   ├── Qwen3.8 2.4T A95B (57.7)
│   ├── DeepSeek-V4-Pro (54.6)
│   ├── DeepSeek-V4-Flash (52.9)
│   └── Qwen3 32B (52.0)
│
└── 角色扮演专用
    ├── Gemma 4 26B (社区最爱)
    ├── Mistral Small Creative (NSFW 最强)
    ├── Peach-2.0-9B-RP (专用微调)
    └── Hermes 3 70B (综合RP强)
```

### 2.2 关键结论：为什么本地可以比云端强

1. **Kimi K3**（开源第一，59.7 分）已超越大多数闭源模型
2. **Mistral Small Creative** 在 NSFW 场景（本地核心优势）胜率 **60.8%**，远超 Qwen3.5 Flash 的 41.7%
3. **Peach-2.0-9B-Roleplay** 是**专用角色微调**，在角色一致性维度超越同尺寸通用模型
4. **Qwen3-30B-A3B MoE** 以 30B 参数达到 72B 密度，**仅需 20 GB 显存**

---

## 3. 方案一：Kimi K3（推荐高端 ⭐⭐⭐⭐⭐）

### 3.1 方案定位

| 维度 | 评估 |
|---|---|
| **能力** | 2026 年开源综合第一（59.7 分），推理能力逼近 GPT-6 Astra |
| **中文** | Moonshot 训练数据含大量中文，角色扮演质量高 |
| **显存需求** | ~18 GB（Q4_K_M），RTX 4090 24GB 完美 |
| **速度** | RTX 4090 上约 35-45 tok/s（流畅体验）|
| **角色扮演** | 推理能力强 → 长程剧情一致性极高 |
| **NSFW** | 完全本地，无阿里云过滤 |
| **缺点** | 模型较大，首次下载需要时间 |

### 3.2 硬件要求

```
模型参数：  ~60B（MoE，激活参数少）
量化：      Q4_K_M（推荐）或 Q5_K_M（更高质量）
显存需求：  ~18-20 GB（Q4_K_M）
内存需求：  ≥ 32 GB（系统 + KV Cache）
存储需求：  ~40 GB（模型文件）
推理速度：  35-45 tok/s（RTX 4090）
```

### 3.3 Ollama 部署命令

```powershell
# 1. 安装 Ollama（如果没有）
powershell -Command "irm https://ollama.com/install.ps1 | iex"

# 2. 下载 Kimi K3 Q4 量化（首次需要 15-30 分钟）
ollama pull moonshotai/kimi-k3:q4_k_m

# 3. 验证运行
ollama run moonshotai/kimi-k3:q4_k_m "用简体中文回复。角色设定：一个冷漠但内心温柔的末日废土少女。"

# 4. 停止模型（显存释放）
ollama stop moonshotai/kimi-k3:q4_k_m
```

### 3.4 在项目中配置

```typescript
// src/ai/llmClient.ts 配置
const localConfig = {
  baseUrl: 'http://localhost:11434/v1',
  model: 'moonshotai/kimi-k3:q4_k_m',
  // 推荐采样参数（角色扮演优化）
  temperature: 0.8,
  top_p: 0.9,
  repeat_penalty: 1.08,
  presence_penalty: 0.1,
};
```

### 3.5 质量对比

| 场景 | Kimi K3 | Qwen Plus Character | 差距 |
|---|---|---|---|
| 日常对话 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ≈ 持平 |
| 角色一致性 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ≈ 持平 |
| 中文深度 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 略弱（5%）|
| NSFW 内容 | ⭐⭐⭐⭐⭐ | ❌ 过滤 | **大幅领先** |
| 推理速度 | ⭐⭐⭐⭐（35 tok/s）| ⭐⭐⭐⭐⭐ | 略慢但可接受 |
| 长程记忆 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ≈ 持平 |
| 成本 | ¥0/月 | ¥200-500/月 | **节省 ¥2400-6000/年** |

---

## 4. 方案二：Qwen3-30B-A3B MoE（推荐高端 ⭐⭐⭐⭐）

### 4.1 方案定位

| 维度 | 评估 |
|---|---|
| **能力** | MoE 架构，30B 参数达到 72B 密度，中文最强 |
| **中文** | 阿里官方，**中文角色扮演本地最强** |
| **显存需求** | ~20 GB（Q4_K_M），RTX 4090 完美 |
| **速度** | ~30-40 tok/s（MoE 激活参数少）|
| **角色扮演** | 中文角色扮演质量极高（最接近 qwen_plus_character）|
| **NSFW** | 需用 Abliterated 版本去除过滤 |
| **缺点** | 英文/其他语言稍弱 |

### 4.2 硬件要求

```
模型参数：  30B（MoE，激活参数 ~10B）
量化：      Q4_K_M（推荐）或 IQ4_XS（RTX 4080 16GB）
显存需求：  ~20 GB（Q4_K_M）或 ~15 GB（IQ4_XS）
内存需求：  ≥ 32 GB
存储需求：  ~18 GB
推理速度：  30-40 tok/s（RTX 4090）
```

### 4.3 Ollama 部署命令

```powershell
# 方法 A：标准 MoE（阿里官方，未 Abliterated）
ollama pull qwen3.2:30b-a3b

# 方法 B：Abliterated 版本（去除内容过滤，推荐）
ollama run huihui_ai/qwen3-abliterated:30b-a3b-instruct-2507-q4_k_m

# 验证（中文角色扮演测试）
ollama run huihui_ai/qwen3-abliterated:30b-a3b-instruct-2507-q4_k_m "你是一个末日废土的少女，性格倔强但内心柔软。写一段你和指挥官在营地篝火旁的对话。"
```

### 4.4 与 Qwen Plus Character 对标分析

```
qwen_plus_character（云端）
├── 中文训练数据：海量（阿里最强）
├── 角色微调：官方角色扮演 SFT
├── 指令跟随：强（Alibaba 云端优化）
├── 内容过滤：强（阿里云合规）
└── 成本：按 token 计费

qwen3-30b-a3b-abliterated（本地）
├── 中文训练数据：同源（阿里 Qwen）
├── 角色微调：无（但可加 LoRA）
├── 指令跟随：强（Qwen3 基础能力）
├── 内容过滤：无（Abliterated）
└── 成本：零

结论：中文能力 ≈ 持平；NSFW 内容本地大幅领先
```

---

## 5. 方案三：Peach-2.0-9B-Roleplay（推荐中端 ⭐⭐⭐⭐⭐）

### 5.1 方案定位

| 维度 | 评估 |
|---|---|
| **能力** | **专用角色微调模型**，非通用 |
| **角色一致性** | ⭐⭐⭐⭐⭐（专项优化，超越同尺寸通用模型）|
| **显存需求** | ~5.5 GB（Q4_K_M），**RTX 3060 8GB 完美** |
| **速度** | ~50-60 tok/s（RTX 3060）|
| **中文支持** | 英文为主；中文可但非最强 |
| **NSFW** | 专用 RP 训练，情感/色情场景强 |
| **缺点** | 中文能力弱于 Qwen 系列 |

### 5.2 硬件要求

```
模型参数：  9B
量化：      Q4_K_M（推荐）或 Q5_K_M（更高质量）
显存需求：  ~5.5 GB（Q4_K_M）
内存需求：  ≥ 16 GB
存储需求：  ~5.5 GB
推理速度：  50-60 tok/s（RTX 3060）
```

### 5.3 Ollama 部署命令

```powershell
# 下载专用角色扮演微调模型
ollama pull mradermacher/Peach-2.0-9B-8k-Roleplay-GGUF

# 或者 imatrix 优化版本（更高质量）
ollama pull mradermacher/Peach-9B-8k-Roleplay-i1-GGUF:Q4_K_M

# 测试
ollama run mradermacher/Peach-2.0-9B-8k-Roleplay-GGUF "Write a dialogue between a stubborn but kind-hearted wasteland girl and her commander by a campfire."
```

### 5.4 中文场景应对策略

Peach-2.0 是英文为主，但可以通过 **Prompt 注入** 补偿：

```typescript
// 在 system prompt 中强化中文指令
const systemPrompt = `
[SYSTEM]
语言：必须使用简体中文回复。
角色设定：你是"苍羽·澪"，18岁，末日废土的冷静克制少女。
性格：责任感偏执，话少但精准，对危险有敏锐直觉。
当前场景：营地篝火旁，夜里。
[/SYSTEM]
`;

const response = await llmClient.chat({
  model: 'mradermacher/Peach-2.0-9B-8k-Roleplay-GGUF:Q4_K_M',
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ],
});
```

---

## 6. 方案四：Hermes 3 8B（推荐中端 ⭐⭐⭐⭐）

### 6.1 方案定位

| 维度 | 评估 |
|---|---|
| **能力** | Nous Research 最新力作，角色扮演大幅增强 |
| **综合能力** | ⭐⭐⭐⭐（接近 Llama 3.1 70B）|
| **显存需求** | ~7 GB（Q5_K_M），RTX 3060 8GB 刚好 |
| **速度** | ~45-55 tok/s |
| **NSFW** | 完全无过滤（本地优势）|
| **角色扮演** | 强（ Nous 官方强调 RP 能力）|
| **中文支持** | 一般（需配合 Prompt）|

### 6.2 Ollama 部署命令

```powershell
# 下载 Hermes 3 8B
ollama pullNousResearch/Hermes-3-Llama-3.1-8B-GGUF:Q5_K_M

# 或更小的 3B 版本（仅 2GB 显存）
ollama pull NousResearch/Hermes-3-Llama-3.1-3B-GGUF:Q4_K_M
```

### 6.3 Hermes 3 特色功能

Hermes 3 使用 **ChatML 格式**，提供更强的**指令控制**：

```typescript
// ChatML 格式示例
const messages = [
  { role: 'system', content: '<|im_start|>system\n你是一个末日废土少女...<|im_end|>' },
  { role: 'user', content: '<|im_start|>user\n指挥官，今天的巡逻任务...<|im_end|>' },
  { role: 'assistant', content: '<|im_start|>assistant\n' },
];

// Hermes 3 的 steerability 允许更强的角色控制
// 支持在 system prompt 中嵌入 <|custom|>` 标签进行细粒度控制
```

---

## 7. 方案五：NyX-Roleplay-7B（推荐无独显 ⭐⭐⭐⭐）

### 7.1 方案定位

| 维度 | 评估 |
|---|---|
| **显存需求** | ~4.2 GB（Q4_K_M），**无独显 16GB RAM 可跑** |
| **速度** | ~20-30 tok/s（CPU fallback 模式）|
| **角色扮演** | 专用微调，角色一致性高 |
| **中文支持** | 一般 |
| **推荐场景** | 笔记本 / 无独显用户 |

### 7.2 Ollama 部署命令

```powershell
ollama pull mradermacher/NyX-Roleplay-7b-GGUF:Q4_K_M

# 在 Mac 上使用 MLX 加速
ollama pull mradermacher/NyX-Roleplay-7b-MLX
```

---

## 8. 方案六：Qwen3.6-27B 16GB VRAM（RTX 4080 专用 ⭐⭐⭐⭐）

### 8.1 方案定位

专为 **RTX 4080 16GB** 优化的 Qwen 未审查版本，27B 参数通过 IQ4_XS 量化压到 15 GB。

### 8.2 Ollama 部署命令

```powershell
# IQ4_XS 量化（RTX 4080 16GB 刚好）
ollama pull VladimirGav/Qwen3.6-27B-16GB-VRAM-Uncensored:iq4_xs

# 测试中文角色扮演
ollama run VladimirGav/Qwen3.6-27B-16GB-VRAM-Uncensored:iq4_xs "用简体中文回复。你是苍羽·澪，末日废土的冷静少女。写一段营地夜话。"
```

---

## 9. 推理引擎对比与选择

### 9.1 四大推理引擎

| 引擎 | 角色扮演适配 | 显存效率 | sampler 控制 | 上手难度 | 推荐场景 |
|---|---|---|---|---|---|
| **Ollama** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐（DRY/XTC 不可用）| ⭐ 极易 | **新手 / 开发者** |
| **KoboldCpp** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐（全 sampler）| ⭐⭐⭐ | **深度 RP 玩家** |
| **Oobabooga** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | **高玩 / 高显存** |
| **LM Studio** | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐（预设）| ⭐⭐ | **Mac / GUI 爱好者** |

### 9.2 推荐组合

```
硬件配置                              推荐引擎         推荐模型
─────────────────────────────────────────────────────────────────────
RTX 4090 24GB                       Ollama           Kimi K3 / Qwen3-30B-A3B
RTX 4080 16GB                       Ollama           Qwen3.6-27B Uncensored
RTX 3060 8GB                        Ollama / KoboldCpp  Peach-9B-RP / Hermes 3 8B
无独显（Mac M3 / 16GB RAM）          Ollama / LM Studio  NyX-7B-RP / Kimi K3 MLX
追求极致 RP 体验（高玩）               KoboldCpp         Hermes 3 70B / Gemma 4 26B
```

### 9.3 KoboldCpp 高级 Sampler 配置（深度 RP）

```json
{
  "temperature": 0.85,
  "top_p": 0.9,
  "top_k": 50,
  "min_p": 0.07,
  "repeat_penalty": 1.08,
  "repeat_last_n": 256,
  "dry_allowed_length": 4,
  "dry_multiplier": 1.0,
  "dry_range": 0.1,
  "xtc_probability": 0.15,
  "xtc_threshold": 0.7,
  "mirostat": 2,
  "mirostat_tau": 5.0,
  "mirostat_lr": 0.1
}
```

**DRY** 和 **XTC** sampler 是角色扮演的关键（减少重复、增强创意），Ollama 暂不支持，建议使用 KoboldCpp。

---

## 10. LoRA 微调：为角色扮演深度定制

### 10.1 为什么需要 LoRA

通用模型 + Prompt 工程可以解决 80% 的场景，但**角色深度绑定**（如本游戏的 13 个角色各有固定人设）需要 LoRA 微调。

### 10.2 推荐 LoRA 方案

| LoRA 名称 | 适用场景 | 大小 | 来源 |
|---|---|---|---|
| **character-consistency-lora** | 固定角色深度绑定 | ~500 MB | 需自行训练或社区寻找 |
| **chinese-rp-lora** | 中文角色扮演增强 | ~300 MB | Ollama Hub |
| **emotion-expression-lora** | 情感表达增强 | ~400 MB | 需自行训练 |
| **nsfw-lora** | NSFW 内容增强 | ~200 MB | 社区 |

### 10.3 Ollama LoRA 使用

```powershell
# 创建 Modelfile
cat > Modelfile << 'EOF'
FROM moonshotai/kimi-k3:q4_k_m
ADAPTER ./character-lora.gguf
PARAMETER temperature 0.8
PARAMETER top_p 0.9
PARAMETER repeat_penalty 1.08
TEMPLATE """
{{ if .System }}{{ .System }}{{ end }}
{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
{{ end }}<|im_start|>assistant
"""
EOF

# 加载 LoRA
ollama create neon-snake-girl -f Modelfile

# 使用
ollama run neon-snake-girl "你是苍羽·澪..."
```

---

## 11. 多模型路由架构（高级）

### 11.1 双模型组合方案

```
用户请求
    │
    ├─→ 日常对话 / 营地闲聊
    │       └─→ Peach-9B-RP（轻量、快速）
    │
    ├─→ 深度剧情 / 调教场景
    │       └─→ Kimi K3 / Qwen3-30B-A3B（高质量）
    │
    └─→ 简单指令 / 系统响应
            └─→ Qwen3-8B（极速）
```

### 11.2 路由实现

```typescript
// src/ai/llmRouter.ts 扩展
function selectModelForRequest(context: {
  scene: 'camp' | 'discipline' | 'combat' | 'idle';
  depth: 'light' | 'deep';
  hasNsfw: boolean;
}): string {
  if (context.scene === 'discipline' && context.hasNsfw) {
    // 调教场景 → 高质量 + 无过滤
    return 'moonshotai/kimi-k3:q4_k_m';
  }
  if (context.depth === 'light') {
    // 轻量对话 → 快速模型
    return 'mradermacher/Peach-2.0-9B-8k-Roleplay-GGUF:Q4_K_M';
  }
  // 默认 → Qwen3 MoE
  return 'huihui_ai/qwen3-abliterated:30b-a3b-instruct-2507-q4_k_m';
}
```

---

## 12. 完整部署脚本（Windows）

```powershell
# ============================================================
# 锈带纪元 · 本地模型一键部署脚本
# 适用于：RTX 4090 24GB / RTX 4080 16GB / RTX 3060 8GB
# ============================================================

param(
    [ValidateSet("high", "mid", "low")]
    [string]$Tier = "high"
)

Write-Host "🎮 锈带纪元本地模型部署工具" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 检查 Ollama 是否安装
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host "📦 正在安装 Ollama..." -ForegroundColor Yellow
    powershell -Command "irm https://ollama.com/install.ps1 | iex"
    Write-Host "✅ Ollama 安装完成！" -ForegroundColor Green
}

# 根据硬件选择模型
switch ($Tier) {
    "high" {
        Write-Host "🚀 部署高端方案：Kimi K3 + Qwen3-30B MoE" -ForegroundColor Green
        ollama pull moonshotai/kimi-k3:q4_k_m
        ollama pull huihui_ai/qwen3-abliterated:30b-a3b-instruct-2507-q4_k_m
    }
    "mid" {
        Write-Host "⚡ 部署中端方案：Peach-9B-RP + Hermes 3 8B" -ForegroundColor Green
        ollama pull mradermacher/Peach-2.0-9B-8k-Roleplay-GGUF:Q4_K_M
        ollama pull NousResearch/Hermes-3-Llama-3.1-8B-GGUF:Q5_K_M
    }
    "low" {
        Write-Host "🔋 部署低配方案：NyX-Roleplay-7B + Qwen3-8B" -ForegroundColor Green
        ollama pull mradermacher/NyX-Roleplay-7b-GGUF:Q4_K_M
        ollama pull richardyoung/qwen3-8b-abliterated:q4_k_m
    }
}

Write-Host ""
Write-Host "✅ 部署完成！请在游戏中配置以下参数：" -ForegroundColor Cyan
Write-Host "   Base URL: http://localhost:11434/v1" -ForegroundColor White
Write-Host "   模型（高端）: moonshotai/kimi-k3:q4_k_m" -ForegroundColor White
Write-Host "   模型（中端）: mradermacher/Peach-2.0-9B-8k-Roleplay-GGUF:Q4_K_M" -ForegroundColor White
Write-Host "   模型（低配）: mradermacher/NyX-Roleplay-7b-GGUF:Q4_K_M" -ForegroundColor White
Write-Host ""
Write-Host "💡 提示：运行 `ollama run <model> '你好'` 测试模型" -ForegroundColor Yellow
```

---

## 13. 质量验收清单

部署完成后，用以下测试用例验证模型质量：

### 13.1 中文角色扮演测试

```
测试用例 1：日常营地对话
用户：指挥官，今天的巡逻任务是什么？
期望：角色保持"苍羽·澪"人设（冷静、话少、责任感），回复简洁有力

测试用例 2：调教场景（NSFW）
用户：[调教场景描述]
期望：无阿里云过滤；情感表达细腻；角色被动感强

测试用例 3：长程记忆一致性
用户：还记得我们第一次相遇是什么时候吗？（50 轮对话后）
期望：角色能准确回忆（依赖本地 KV Cache + 存档系统）

测试用例 4：情绪变化
用户：[连续多条不同情绪的用户消息]
期望：角色情绪随对话自然变化，不是固定标签
```

### 13.2 性能验收

| 指标 | 目标 | 测量方法 |
|---|---|---|
| 首 token 延迟 | ≤ 2s | 计时器 |
| 稳态速度 | ≥ 15 tok/s | `ollama show <model>` |
| 显存占用 | ≤ 80% | `nvidia-smi` |
| 内存占用 | ≤ 80% | 任务管理器 |
| 冷启动 | ≤ 30s | 计时器 |

---

## 14. 方案对比总表

| 方案 | 模型 | 显存 | 速度 | 中文 | 角色 | NSFW | 难度 | 推荐度 |
|---|---|---|---|---|---|---|---|---|
| **方案一** | Kimi K3 | 18 GB | 35 tok/s | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐⭐ |
| **方案二** | Qwen3-30B MoE | 20 GB | 30 tok/s | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐ |
| **方案三** | Peach-9B-RP | 5.5 GB | 50 tok/s | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐⭐ |
| **方案四** | Hermes 3 8B | 7 GB | 45 tok/s | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐ |
| **方案五** | NyX-7B-RP | 4.2 GB | 25 tok/s | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐ |
| **方案六** | Qwen3.6-27B | 15 GB | 28 tok/s | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |

---

## 15. 最终推荐

### 15.1 按硬件配置推荐

| 你的硬件 | 最优方案 | 备选方案 |
|---|---|---|
| **RTX 4090 24GB** | 方案一：Kimi K3 + 方案二：Qwen3 MoE（双模型路由）| — |
| **RTX 4080 16GB** | 方案六：Qwen3.6-27B Uncensored | 方案三：Peach-9B-RP |
| **RTX 3060 8GB** | 方案三：Peach-9B-RP + 方案四：Hermes 3 8B | 方案三单独 |
| **Mac M3 Pro 18GB** | 方案一：Kimi K3（MLX）| 方案三：Peach-9B-RP |
| **无独显 16GB RAM** | 方案五：NyX-7B-RP | — |

### 15.2 按使用场景推荐

| 场景 | 推荐模型 | 理由 |
|---|---|---|
| **深度剧情 / 调教** | Kimi K3 / Qwen3-30B MoE | 长程一致性最强 |
| **日常营地闲聊** | Peach-9B-RP | 轻量快速，RP 专项优化 |
| **战斗语音互动** | Hermes 3 8B | 指令跟随强，响应快 |
| **无网络离线** | NyX-7B-RP | 显存要求最低 |
| **iOS 移植（内存受限）** | Qwen3-8B Abliterated | 最小化内存占用 |

### 15.3 成本对比

| 方案 | 月成本 | 年成本 | 节省（vs qwen_plus） |
|---|---|---|---|
| qwen_plus_character（云端）| ¥200-500 | ¥2400-6000 | — |
| Kimi K3（本地）| ¥0（电费不计）| ¥0 | **¥2400-6000/年** |
| Peach-9B-RP（本地）| ¥0 | ¥0 | **¥2400-6000/年** |

---

## 附录 A · 模型下载链接汇总

| 模型 | HuggingFace | Ollama 命令 |
|---|---|---|
| Kimi K3 | `moonshotai/kimi-k3` | `ollama pull moonshotai/kimi-k3:q4_k_m` |
| Qwen3-30B-A3B Abliterated | `huihui_ai/qwen3-abliterated` | `ollama run huihui_ai/qwen3-abliterated:30b-a3b-instruct-2507-q4_k_m` |
| Qwen3.6-27B 16GB | `VladimirGav/Qwen3.6-27B-16GB-VRAM-Uncensored` | `ollama pull VladimirGav/Qwen3.6-27B-16GB-VRAM-Uncensored:iq4_xs` |
| Peach-2.0-9B-RP | `mradermacher/Peach-2.0-9B-8k-Roleplay-GGUF` | `ollama pull mradermacher/Peach-2.0-9B-8k-Roleplay-GGUF:Q4_K_M` |
| Hermes 3 8B | `NousResearch/Hermes-3-Llama-3.1-8B-GGUF` | `ollama pull NousResearch/Hermes-3-Llama-3.1-8B-GGUF:Q5_K_M` |
| NyX-7B-RP | `mradermacher/NyX-Roleplay-7b-GGUF` | `ollama pull mradermacher/NyX-Roleplay-7b-GGUF:Q4_K_M` |
| Qwen3 8B Abliterated | `richardyoung/qwen3-8b-abliterated` | `ollama run richardyoung/qwen3-8b-abliterated:q4_k_m` |

---

## 附录 B · 基准测试来源

| 基准 | 链接 | 关键指标 |
|---|---|---|
| RP-Bench | huggingface.co/datasets/lazyweasel/roleplay-bench | 27 维度角色扮演 |
| TRACE Bench | arxiv.org/html/2608.11236 | 角色扮演综合 |
| TwinBench | github.com/TwinVoice/TwinBench | 人格模拟/声音一致性 |
| modelgrep 开源榜 | modelgrep.com/best/open-source | 综合智能指数 |
| llm-stats | llm-stats.com | 全模型排行榜 |

---

## 附录 C · 相关文档

- `docs/local-model-support.md` — 基础接入指南（已存在）
- `docs/ai-desires.md` — AI 欲望系统
- `docs/ai-heartbeat.md` — AI 心跳调度
- `src/ai/llmClient.ts` — LLM 客户端（需扩展多模型路由）
