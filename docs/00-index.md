# 文档索引

> **第一宗旨（最高优先级，先读这个）：让角色真实地生活在游戏的世界里。**
> 任何 AI 相关的新增/修改/优化，都必须先过 [ai-first-principle.md](./ai-first-principle.md)（活人定律 · 在线/离线模型 · 硬性玩法事件的现实内核 · 冲突指认流程）。
> 与宗旨冲突的需求，**先指出冲突并给现实可行的替代方案**，不得默认执行。

> **用途**：让开发者/AI Agent 快速找到所需的文档。  
> **更新**：2026-10-25（新增 ai-mood-continuum.md「AI 心情系统/情绪连续体」并登记索引）；2026-10-24（新增 apk-release-build.md「APK 打包规范与故障手册」并登记 Skill 镜像）；2026-10-21（首屏立「第一宗旨」并新增 ai-first-principle.md；2026-09-16 save-system 与源码逐项核对重写；combat-system/ai-desires/README-dev/adult-events 同步源码现状；模型选型历史文档加过时标注；补收 project-analysis、low-latency-deployment 等缺失条目）

---

## 入门必读

| 文档 | 用途 |
|---|---|
| **[ai-first-principle.md](./ai-first-principle.md)** | **第一宗旨 · 活人定律（最高优先级，AI 改动必读）** |
| [README-dev.md](./README-dev.md) | **项目全貌 + 目录结构 + 技术栈**（新 Agent 第一份） |
| **[apk-release-build.md](./apk-release-build.md)** | **APK 打包规范与故障手册**（发版/打签名包前必读，含卡死诊断） |
| [onboarding.md](./onboarding.md) | **新 Agent 快速上手指南**（30 分钟上手） |

## AI 系统（核心）

> 本区所有模块都必须服从 [ai-first-principle.md](./ai-first-principle.md)：角色可以拒绝、有作息与身体、有时间与空间守恒、事件有过程与代价；禁止把角色写成只会响应的开关。

| 文档 | 用途 |
|---|---|
| [ai-dialogue-pipeline.md](./ai-dialogue-pipeline.md) | **对话管线硬规则**（千问主路径 / Fable Q4 仅测试旁路） |
| [ai-memory-layers.md](./ai-memory-layers.md) | **四层记忆系统**（Archive / digests / memories / recent） |
| [ai-life-archive.md](./ai-life-archive.md) | 本地生活档案（0 Token 压缩） |
| [ai-corpus-pipeline.md](./ai-corpus-pipeline.md) | 场景/角色卡语料流水线 |
| [ai-sleep-system.md](./ai-sleep-system.md) | **睡眠系统**（清醒→准备→深度→醒） |
| [ai-heartbeat.md](./ai-heartbeat.md) | **心跳调度与 NPC 主动沟通**（8 分钟一次） |
| [ai-desires.md](./ai-desires.md) | **欲望/议程系统**（角色自主行为驱动） |
| [ai-mood-continuum.md](./ai-mood-continuum.md) | **心情系统**（情绪连续体：事件→心情→议程/好感/主动消息，含重复活动厌倦） |
| [ai-life-goals.md](./ai-life-goals.md) | **人生目标系统**（中期愿景） |
| [ai-structured-facts.md](./ai-structured-facts.md) | **结构化事实与关系弧线**（承诺/称呼强注入） |
| [bath-assist-events.md](./bath-assist-events.md) | **硬性玩法事件的现实逻辑规范**（浴室/安抚/舞蹈/调教 · 活人内核） |
| [ai-realism-audit.md](./ai-realism-audit.md) | **AI 现实逻辑审计**（已修复清单 + 仍违规项与优先级） |

## 美术资源

| 文档 | 用途 |
|---|---|
| [character-skins.md](./character-skins.md) | **皮肤资源同步清单**（13 人 × 多套皮） |
| [camp-layout.md](./camp-layout.md) | **营地平面地图**（1F/2F/户外） |
| [camp-shopkeeper.md](./camp-shopkeeper.md) | 营地商店老板娘 |
| [chroma-key-to-webm.md](./chroma-key-to-webm.md) | **安全抠像 → 透明 WebM 流程** |
| [asset-ship-pipeline.md](./asset-ship-pipeline.md) | **美术进包强制标准**（P2 v3.1） |

> **Skill 镜像**：打包流程同时以可执行 Skill 形式存在于 [`skills/rust-belt-apk-release/SKILL.md`](../skills/rust-belt-apk-release/SKILL.md)，供 AI Agent 直接加载。**两份内容必须同步**，改动任一份都要同步另一份。

## 游戏系统

| 文档 | 用途 |
|---|---|
| [combat-system.md](./combat-system.md) | **战斗系统**（Three.js 3D） |
| [combat-vfx-spec.md](./combat-vfx-spec.md) | **战斗特效与打击感规范**（P2 升级） |
| [story-system.md](./story-system.md) | **剧情系统**（新手引导 + 关卡气泡文案/表情） |
| [cg-system-plan.md](./cg-system-plan.md) | **章节 CG + 剧情语音（P3）实施方案**（代码级交接文档，待执行） |
| [save-system.md](./save-system.md) | **存档与持久化系统** |
| [ui-system.md](./ui-system.md) | **UI 系统文档** |

## 商业/运营

| 文档 | 用途 |
|---|---|
| [激活与账号系统.md](./激活与账号系统.md) | **激活/账号/网关技术文档** |
| [运营手册.md](./运营手册.md) | **运营操作手册**（美术背景的开发者） |
| [local-model-support.md](./local-model-support.md) | **本地模型支持**（Ollama / OpenRouter · 方案层 · ⚠️ 推荐表为历史选型） |
| [local-model-deployment-plan.md](./local-model-deployment-plan.md) | **本地模型部署完整方案**（2026-09-06 · ⚠️ 结论已被 Fable Q4 决策取代） |
| [low-latency-deployment.md](./low-latency-deployment.md) | 本机低延迟/异地隧道部署（⚠️ 历史 Violet 叙述过时，以 local-ai/README 为准） |
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
| [world-characters-ai-report.md](./world-characters-ai-report.md) | **世界观/角色/AI 权重全量分析**（id 笔误待修，13 人锚表以 prompt-slim-split-review 为准） |
| [performance-optimization-2026-08-29.md](./performance-optimization-2026-08-29.md) | 移动端性能优化记录 |
| [project-analysis-2026-09-14.md](./project-analysis-2026-09-14.md) | **项目全面分析报告**（09-14 快照：规模指标/P0 风险/仓库卫生） |
| [backlog-deferred-p0.md](./backlog-deferred-p0.md) | **待办：市场版基线提交 / 包体瘦身 / 工程纪律**（10-19 记录，已确认但推迟，当前优先修流程 BUG） |

---

## 文档维护规约

任何对源代码的改动，请检查是否有相关文档需要同步更新：

| 改动类型 | 同步文档 |
|---|---|
| **任何 AI 相关改动（新增/修改/优化）** | **先过 [ai-first-principle.md](./ai-first-principle.md) 的自检清单；事件协议/活人语义变更同步对应 `ai-*.md`** |
| AI 系统 | `ai-*.md`（对应模块的文档） |
| UI 改动 | `ui-system.md` |
| 美术资源 | `character-skins.md` / `camp-layout.md` |
| **打包/发版流程（签名、链路、APK）** | **`apk-release-build.md` + 同步 `skills/rust-belt-apk-release/SKILL.md`** |
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
| `apk-release-build.md` | 2026-10-24（首版：签名真源 + 四步链路 + 扫描卡死绕行 + 耗时复盘） |
| `ai-first-principle.md` | 2026-10-21（第一宗旨/活人定律立项） |
| `ai-realism-audit.md` | 2026-10-21（首轮现实逻辑审计：8 项修复 + 遗留清单） |
| `bath-assist-events.md` | 2026-10-21（硬性事件的现实逻辑规范 + 修复状态） |
| `cg-system-plan.md` | 2026-09-16（P3 实施方案定稿，待执行） |
| `story-system.md` | 2026-09-16（P0-P2 表现层修复 + P1/P2 落地记录） |
| `save-system.md` | 2026-09-16（与源码逐项核对重写） |
| `combat-system.md` | 2026-09-16（关卡数 40→120 同步源码） |
| `ai-desires.md` | 2026-09-16（泳装概率 28%→18% 同步源码） |
| `local-model-support.md` | 2026-09-16（历史选型加标注） |
| `local-model-deployment-plan.md` | 2026-09-16（结论标注：已被 Fable Q4 取代） |
| `roleplay-model-analysis-v2.md` | 2026-09-16（排名结论加标注） |
| `local-ai/README.md` | 2026-09-16（maxTokens/Prompt 拆分同步源码） |
| `local-ai/prompt-slim-split-review.md` | 2026-09-10 |
| `story-system.md` | 2026-09-15 |
| `project-analysis-2026-09-14.md` | 2026-09-14 |
| `README-dev.md` | 2026-09-16（引擎口径/App.ts 规模同步源码） |
| `onboarding.md` | 2026-09-06 |
| `local-model-support.md` | 2026-09-06（内容） |
| `ai-sleep-system.md` | 2026-09-06 |
| `ai-heartbeat.md` | 2026-09-06 |
| `ai-desires.md` | 2026-09-06（内容） |
| `ai-life-goals.md` | 2026-09-06 |
| `ai-structured-facts.md` | 2026-09-06 |
| `combat-system.md` | 2026-09-06（内容） |
| `ui-system.md` | 2026-09-06 |
| `save-system.md` | 2026-09-06（内容） |
| `low-latency-deployment.md` | 2026-09-06（⚠️ 自标过时） |
| `market-standard-gap-analysis.md` | 2026-09-06（同步） |
| `world-characters-ai-report.md` | 2026-09-06（同步） |
| `asset-ship-pipeline.md` | 2026-09-06 |
| `character-skins.md` | 2026-08-29（泳装 18% 为最新口径） |
| `performance-optimization-2026-08-29.md` | 2026-08-29 |
| `激活与账号系统.md` | 2026-08-26 |
| `运营手册.md` | 2026-08-16 |
| `camp-shopkeeper.md` | 2026-08-16 |
| `camp-layout.md` | — |
| `ai-memory-layers.md` | — |
| `ai-life-archive.md` | — |
| `ai-corpus-pipeline.md` | — |
| `chroma-key-to-webm.md` | — |
