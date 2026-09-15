# 本地模型支持（Ollama / OpenRouter）

> **最新更新**：2026-09-10  
> **硬规则**：产品默认仍是阿里云千问；本地 **Fable Q4** 为个人测试旁路。见 [`ai-dialogue-pipeline.md`](./ai-dialogue-pipeline.md) §0。

---

## 概述

游戏支持通过**营地生活 → 模型/API**切换：

| Provider | 用途 |
|----------|------|
| **阿里云千问（默认）** | 对话 / 生活 / TTS / ASR · 玩家 BYOK |
| **家里云端 / llama.cpp（Fable Q4·仅测试）** | 仅角色对话可切；生活/语音仍要千问 Key |

**工程实现入口**：`src/ai/providerConfig.ts`、现行操作手册 [`local-ai/README.md`](./local-ai/README.md)。  
**选型与硬件方案**仍可参考本文与 [`local-model-deployment-plan.md`](./local-model-deployment-plan.md)；推荐表里的其它模型也可填进兼容口。

本文件保留原「方案对比 / 模型推荐」；**日常启动以 `scripts/start-fable-llamacpp.ps1` + 营地「一键启用本机」为准**。

---

## 接入方案对比

| 方案 | 内容限制 | 成本 | 难度 | 推荐度 |
|---|---|---|---|---|
| **Qwen Cloud（默认）** | 🚫 阿里云强制过滤 | 💰 按 token 计费 | ⭐ 填 Key 即用 | ⭐⭐⭐ |
| **Ollama 本地** | ✅ 零过滤 | ✅ 免费 | ⭐⭐⭐ 需安装 | ⭐⭐⭐⭐⭐ |
| **OpenRouter** | ⚠️ 部分模型有限制 | 💰 按量计费 | ⭐⭐ 中等 | ⭐⭐⭐ |
| **自部署服务器** | ✅ 零过滤 | 💰💰 约 ¥12,000/年 | ⭐⭐⭐⭐ 复杂 | ⭐⭐⭐ |

---

## Ollama 接入（推荐）

### 1. 安装 Ollama

**Windows**：
```powershell
# PowerShell（管理员）
powershell -Command "irm https://ollama.com/install.ps1 | iex"
```

**macOS**：
```bash
brew install ollama
```

### 2. 下载模型

#### 推荐模型（按硬件选择）

| 你的显卡 | 推荐模型 | 命令 | 显存需求 |
|---|---|---|---|
| RTX 4090 24GB | Qwen3-30B-A3B Uncensored | `ollama run huihui_ai/qwen3-abliterated:30b-a3b-instruct-2507-q4_K_M` | ~20.7 GB |
| RTX 4080 16GB | Qwen3-30B-A3B Uncensored (IQ4_XS) | `ollama run VladimirGav/Qwen3.6-27B-16GB-VRAM-Uncensored:iq4_xs` | ~15 GB |
| RTX 3060 8GB | Qwen3-8B Abliterated | `ollama run richardyoung/qwen3-8b-abliterated:q4_k_m` | ~5 GB |

#### 无独显

```bash
# 最低要求：Llama 3.3 8B Nymphaea RP
ollama run 0xA50C1A1/Llama-3.3-8B-Nymphaea-RP
```

### 3. 验证 Ollama 运行

```bash
curl http://localhost:11434/api/tags
# 应返回已下载的模型列表
```

### 4. 在游戏中配置

```
设置 → AI 模型 → 自定义
├── Base URL: http://localhost:11434/v1
├── 模型: huihui_ai/qwen3-abliterated:30b-a3b-instruct-2507-q4_k_m
└── API Key:（留空）
```

---

## OpenRouter 接入

### 1. 注册 OpenRouter

访问 https://openrouter.ai 注册并获取 API Key。

### 2. 选择模型

支持 adult 内容的模型推荐：

| 模型 | 说明 | 价格 |
|---|---|---|
| anthropic/claude-3.5-sonnet | 高质量，限制较少 | ~$3/1M tokens |
| google/gemini-2.0-flash-exp | 速度快，限制适中 | ~$0/1M tokens |
| meta-llama/llama-3.3-70b-instruct | 开源，无过滤 | ~$0.65/1M tokens |

### 3. 在游戏中配置

```
设置 → AI 模型 → 自定义
├── Base URL: https://openrouter.ai/api/v1
├── 模型: anthropic/claude-3.5-sonnet
└── API Key: sk-or-v1-xxxxx
```

---

## 自部署服务器（高级）

### 成本估算

| 配置 | 年成本（人民币） | 适合场景 |
|---|---|---|
| RTX 4090 24GB（Vast.ai 按量） | ¥5,000-13,000 | 低并发试水 |
| RTX 4090 24GB（国内年付） | ¥12,000-15,000 | 稳定运营 |
| RTX 4090 8×（集群） | ¥80,000+ | 高并发 |

### 推荐配置

```bash
# Ollama 服务端（Linux）
apt update && apt install -y ollama

# 启动 Ollama
ollama serve

# 后台运行
nohup ollama serve > ollama.log 2>&1 &
```

### 端口暴露（安全注意）

⚠️ **生产环境必须加认证**：

```bash
# 使用 nginx 反向代理 + Basic Auth
# 或使用 Cloudflare Tunnel 暴露本地服务
cloudflared tunnel --url http://localhost:11434
```

### 在游戏中配置

```
设置 → AI 模型 → 自定义
├── Base URL: https://your-server.com/v1
├── 模型: huihui_ai/qwen3-abliterated:30b-a3b-instruct-2507-q4_k_m
└── API Key: your-api-key
```

---

## 技术实现

游戏已支持自定义 Base URL：

```typescript
// src/ai/llmClient.ts
const baseUrl = opts.baseUrl || DEFAULT_BASE;  // DEFAULT_BASE = dashscope

// 自定义 baseUrl 时使用该 URL
const url = `${baseUrl}/chat/completions`;
```

### 模型配置界面

设置面板中需要添加：
1. Base URL 输入框
2. 模型选择/输入框
3. API Key 输入框

---

## 成人向模型推荐（2026年）

### Qwen 系列

| 模型 | 量化 | 显存 | Ollama 命令 |
|---|---|---|---|
| huihui-ai/qwen3-30B-A3B-Instruct-2507-abliterated | Q4_K_M | ~20.7 GB | `ollama run huihui_ai/qwen3-abliterated:30b-a3b-instruct-2507-q4_K_M` |
| Zynerji/Ektome-Qwen3-30B-A3B-PristinelyUncensored | Q4_K_M | ~20.7 GB | （需 GGUF + llama.cpp）|
| VladimirGav/Qwen3.6-27B-16GB-VRAM-Uncensored | IQ4_XS | ~15 GB | `ollama run VladimirGav/Qwen3.6-27B-16GB-VRAM-Uncensored:iq4_xs` |
| richardyoung/qwen3-8b-abliterated | Q4_K_M | ~5 GB | `ollama run richardyoung/qwen3-8b-abliterated:q4_k_m` |

### Llama 系列

| 模型 | 显存 | Ollama 命令 |
|---|---|---|
| 0xA50C1A1/Llama-3.3-8B-Nymphaea-RP | ~6 GB | `ollama run 0xA50C1A1/Llama-3.3-8B-Nymphaea-RP` |
| L3-Stheno 3.3 8B | ~6 GB | `ollama run sao10k/l3-stheno-3.3-8b` |

---

## 已知问题

| 问题 | 解决方案 |
|---|---|
| Ollama 响应慢 | 使用 Q4 量化，降低上下文长度 |
| 显存不足 | 使用更小的模型（8B）或更高量化（Q2） |
| 本地模型质量差 | 使用更大的模型（30B）或 Q8 量化 |
| API 不兼容 | 确保使用 OpenAI 兼容端点（`/v1/chat/completions`）|

---

## 下一步

如需在游戏中添加完整的本地模型配置界面（检测 Ollama 状态、列模型列表），请告知，我来编写相关代码。
