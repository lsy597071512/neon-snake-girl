# 文档索引

> **用途**：让开发者/AI Agent 快速找到所需的文档。  
> **更新**：2026-09-10（本机旁路改为 Fable Q4 + llama.cpp ± MTP；Prompt 一比一瘦身已落地；千问仍为默认）

---

## 入门必读

| 文档 | 用途 |
|---|---|
| [README-dev.md](./README-dev.md) | **项目全貌 + 目录结构 + 技术栈**（新 Agent 第一份） |
| [onboarding.md](./onboarding.md) | **新 Agent 快速上手指南**（30 分钟上手） |

## AI 系统（核心）

| 文档 | 用途 |
|---|---|
| [ai-dialogue-pipeline.md](./ai-dialogue-pipeline.md) | **对话管线硬规则**（千问主路径 / Fable Q4 仅测试旁路） |
| [ai-memory-layers.md](./ai-memory-layers.md) | **四层记忆系统**（Archive / digests / memories / recent） |
| [ai-life-archive.md](./ai-life-archive.md) | 本地生活档案（0 Token 压缩） |
| [ai-corpus-pipeline.md](./ai-corpus-pipeline.md) | 场景/角色卡语料流水线 |
| [ai-sleep-system.md](./ai-sleep-system.md) | **睡眠系统**（清醒→准备→深度→醒） |
| [ai-heartbeat.md](./ai-heartbeat.md) | **心跳调度与 NPC 主动沟通**（8 分钟一次） |
| [ai-desires.md](./ai-desires.md) | **欲望/议程系统**（角色自主行为驱动） |
| [ai-life-goals.md](./ai-life-goals.md) | **人生目标系统**（中期愿景） |
| [ai-structured-facts.md](./ai-structured-facts.md) | **结构化事实与关系弧线**（承诺/称呼强注入） |
| [discipline-event.md](./discipline-event.md) | **小黑屋调教系统**（v0.6.1 · 触手模式） |
| [discipline-commander-direct.md](./discipline-commander-direct.md) | **指挥官亲自调教**（五阶段成人玩法 · 草案，未进游戏） |
| [discipline-commander-direct-prompts.md](./discipline-commander-direct-prompts.md) | **亲自调教 · Seedream 生图提示词**（P1 沉淀 + 阶段进度） |
| [adult-events.md](./adult-events.md) | **成人事件总层**（脱浴巾+小黑屋包装 + 身体敏感点/机油） |
| [ai-training-system-prompt.md](./ai-training-system-prompt.md) | **训练/总装超长汇总**（勿整段塞运行时） |

## 美术资源

| 文档 | 用途 |
|---|---|
| [character-skins.md](./character-skins.md) | **皮肤资源同步清单**（13 人 × 多套皮） |
| [camp-layout.md](./camp-layout.md) | **营地平面地图**（1F/2F/户外） |
| [camp-shopkeeper.md](./camp-shopkeeper.md) | 营地商店老板娘 |
| [chroma-key-to-webm.md](./chroma-key-to-webm.md) | **安全抠像 → 透明 WebM 流程** |
| [asset-ship-pipeline.md](./asset-ship-pipeline.md) | **美术进包强制标准**（P2 v3.1） |

## 游戏系统

| 文档 | 用途 |
|---|---|
| [combat-system.md](./combat-system.md) | **战斗系统**（Three.js 3D） |
| [combat-vfx-spec.md](./combat-vfx-spec.md) | **战斗特效与打击感规范**（P2 升级） |
| [story-system.md](./story-system.md) | **剧情系统**（新手引导 + 关卡气泡文案/表情） |
| [save-system.md](./save-system.md) | **存档与持久化系统** |
| [ui-system.md](./ui-system.md) | **UI 系统文档** |

## 商业/运营

| 文档 | 用途 |
|---|---|
| [激活与账号系统.md](./激活与账号系统.md) | **激活/账号/网关技术文档** |
| [运营手册.md](./运营手册.md) | **运营操作手册**（美术背景的开发者） |
| [local-model-support.md](./local-model-support.md) | **本地模型支持**（Ollama / OpenRouter · 方案层） |
| [local-model-deployment-plan.md](./local-model-deployment-plan.md) | **本地模型部署完整方案**（2026-09-06） |
| [local-ai/README.md](./local-ai/README.md) | **本机 Fable Q4 旁路**（llama.cpp · MTP 推荐 · 无 LoRA；非产品默认） |
| [local-ai/prompt-slim-split-review.md](./local-ai/prompt-slim-split-review.md) | Prompt 一比一瘦身/拆分勾选与落地状态 |
| [local-ai/完整方案-单文件版-参考.md](./local-ai/完整方案-单文件版-参考.md) | Fable 选型原文备份（SillyTavern 向，需按游戏管线改） |
| [roleplay-model-analysis.md](./roleplay-model-analysis.md) | **角色扮演模型能力分析 & 综合评分**（v1.0） |
| [roleplay-model-analysis-v2.md](./roleplay-model-analysis-v2.md) | **情感优先模型综合评分**（v2.0 · 共情+感情+像真人） |

## 路线/产品决策

| 文档 | 用途 |
|---|---|
| [market-standard-gap-analysis.md](./market-standard-gap-analysis.md) | **市场标准差距分析**（2026-08-11 + 09-06 同步） |
| [optimization-plan.md](./optimization-plan.md) | **综合优化方案（工程实施层）**（2026-09-06） |
| [world-characters-ai-report.md](./world-characters-ai-report.md) | **世界观/角色/AI 权重全量分析** |
| [performance-optimization-2026-08-29.md](./performance-optimization-2026-08-29.md) | 移动端性能优化记录 |

---

## 文档维护规约

任何对源代码的改动，请检查是否有相关文档需要同步更新：

| 改动类型 | 同步文档 |
|---|---|
| AI 系统 | `ai-*.md`（对应模块的文档） |
| UI 改动 | `ui-system.md` |
| 美术资源 | `character-skins.md` / `camp-layout.md` |
| 战斗改动 | `combat-system.md` |
| 剧情/引导 | `story-system.md` |
| 账号/网关 | `激活与账号系统.md` / `运营手册.md` |
| 路线/产品决策 | `market-standard-gap-analysis.md` / `optimization-plan.md` |
| 性能优化 | `performance-optimization-*.md` |
| 新模型/AI 集成 | `local-ai/README.md` / `ai-dialogue-pipeline.md` |

---

## 文档总览（按更新时间倒序）

| 文档 | 最后更新 |
|---|---|
| `story-system.md` | 2026-09-15 |
| `README-dev.md` | 2026-09-06 |
| `onboarding.md` | 2026-09-06 |
| `local-model-support.md` | 2026-09-06 |
| `ai-sleep-system.md` | 2026-09-06 |
| `ai-heartbeat.md` | 2026-09-06 |
| `ai-desires.md` | 2026-09-06 |
| `ai-life-goals.md` | 2026-09-06 |
| `ai-structured-facts.md` | 2026-09-06 |
| `combat-system.md` | 2026-09-06 |
| `ui-system.md` | 2026-09-06 |
| `save-system.md` | 2026-09-06 |
| `market-standard-gap-analysis.md` | 2026-09-06（同步） |
| `world-characters-ai-report.md` | 2026-09-06（同步） |
| `discipline-event.md` | 2026-09-04 |
| `asset-ship-pipeline.md` | 2026-09-06 |
| `character-skins.md` | 2026-08-29 |
| `performance-optimization-2026-08-29.md` | 2026-08-29 |
| `激活与账号系统.md` | 2026-08-26 |
| `运营手册.md` | 2026-08-16 |
| `camp-shopkeeper.md` | 2026-08-16 |
| `camp-layout.md` | — |
| `ai-memory-layers.md` | — |
| `ai-life-archive.md` | — |
| `ai-corpus-pipeline.md` | — |
| `chroma-key-to-webm.md` | — |
