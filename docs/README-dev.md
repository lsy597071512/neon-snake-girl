# 锈带纪元 · 开发者文档索引

> **目的**：让下一个接手本项目的 AI Agent 或开发者，能在 30 分钟内读懂项目全貌并开始工作。  
> **入口**：本文档 + `docs/ai-sleep-system.md` 等专项文档。  
> **最新更新**：2026-09-06

---

## 一、项目定位

**锈带纪元（Rust Belt Era）** —— 末日废土机械少女养成游戏。

- **核心玩法**：战斗（Three.js 3D 跑酷）+ AI 营地生活（角色自主行动、记忆、关系演化）
- **目标用户**：成人向 / 二次元 / AI 陪伴爱好者
- **技术路线**：前端直连阿里云 DashScope（玩家自备 Key），零服务器 AI 成本
- **发布形态**：Web + Android APK（Capacitor）

---

## 二、目录结构

| 目录 | 用途 |
|---|---|
| `src/` | 全部 TypeScript 源码 |
| `src/ai/` | AI 生活系统核心 |
| `src/ai/campEvents/` | 营地随机事件引擎 |
| `src/ai/voice/` | 语音系统（ASR/TTS） |
| `src/game/` | Phaser 3D 战斗场景 |
| `src/systems/` | 游戏系统（成就、军械箱、扫荡等） |
| `src/core/` | 存档管理、数值公式 |
| `src/data/` | 静态配置（角色、武器、关卡等） |
| `src/data/lore/` | AI Prompt 用数据（角色卡、场景卡） |
| `src/ui/` | UI 组件 |
| `src/platform/` | 平台适配（许可证、移动端） |
| `src/bridge/` | 跨模块通信 |
| `src/audio/` | 音频（BGM、战斗音效） |
| `gateway/` | Cloudflare Workers 后端（激活/账号） |
| `tex/` | 源美术资源（只读） |
| `tex-ship/` | 打包用压缩资源（自动生成） |
| `dist/` | 构建产物 |
| `scripts/` | 构建脚本（ship 流程、验证） |
| `docs/` | 本文档目录 |
| `public/` | 静态资源 |

---

## 三、核心系统速查

### AI 系统（`src/ai/`）

| 模块 | 文件 | 功能 |
|---|---|---|
| 营地自主生活 | `livingState.ts` | 角色按人设作息自驱活动（发呆/巡逻/玩乐） |
| 游戏时钟 | `worldClock.ts` | 现实 1 分钟 = 游戏 5 分钟；昼夜/天气解析 |
| 好感系统 | `relationship.ts` | 玩家好感 0-100、角色间关系；送礼加成 |
| 记忆系统 | `memory.ts` | recentChats / chatDigests / memories / campLog 四层 |
| 对话引擎 | `dialogueEngine.ts` | 流式对话、情绪表情、好感变更、换装处理 |
| LLM 客户端 | `llmClient.ts` | 阿里云 DashScope OpenAI 兼容接口 |
| 换装协议 | `outfitChangeProcess.ts` | 对话换装排队（答应→7.2秒延时→穿上） |
| 睡眠系统 | `sleepSystem.ts` | 准备入睡→深度睡眠（现实 6 小时）→被打扰/惊醒 |
| 欲望系统 | `characterDesires.ts` | 基于状态/时段/皮肤计算想去某地的欲望分（0-100） |
| 人生目标 | `lifeGoals.ts` | 战斗章节/送礼/武器库/商店/皮肤/承诺/休息 6 类 |
| 心跳调度 | `heartbeat.ts` | 稀疏事件（8 分钟间隔），驱动营地事件/NPC 主动沟通 |
| 结构化事实 | `structuredFacts.ts` | 承诺/称呼/约定独立于自由文本记忆，强约束注入 |
| 关系弧线 | `relationshipArc.ts` | 好感驱动的阶段状态机（警惕→冷淡→熟悉→信赖→亲密） |
| 情绪换装 | `emotionOutfit.ts` | 情绪/欲望/时段→外覆选装（泳装/睡衣/都市私服/特殊服装） |
| 对话档案 | `dialogueArchive.ts` | IndexedDB 永久存储，支持关键词检索 |
| Prompt 组装 | `promptAssembler.ts` | 组装系统提示词（世界观/角色/营地/时间/记忆等） |
| AI 人设 | `aiProfiles.ts` | 从 JSON 加载详细人设（coreNeeds/fears/speechStyle 等） |
| 调教系统 | `disciplineSession.ts` | 小黑屋会话状态机、姿势系统、约束皮状态 |
| 成人事件 | `adultEvents.ts` / `bodySensitivity.ts` | 脱浴巾+小黑屋总层；身体敏感点与机油 |

### 游戏系统（`src/systems/`、`src/core/`）

| 系统 | 文件 | 功能 |
|---|---|---|
| 战斗 | `src/game/Combat3D.ts` | Three.js 3D 三车道跑酷；Boss/Raid/Wave 模式 |
| 抽卡 | `CharacterGachaSystem.ts` | SR 86% / SSR 12.5% / UR 1.5%；80 抽保底 |
| 军械箱 | `WeaponForgeSystem.ts` | 武器获取与强化；碎片合成 |
| 扫荡 | `SweepSystem.ts` | 每日 15 次扫荡 |
| 成就 | `AchievementSystem.ts` | 战斗/收集/社交成就 |
| 皮肤系统 | `CharacterSkinSystem.ts` | 多套皮肤（泳装/睡衣/都市私服/特殊服装） |
| 仓库 | `WarehouseSystem.ts` | 道具存储；日更 30 槽 |
| 义体健康 | `CyberHealthSystem.ts` | 战斗命中磨损 + 时间老化；告警事件 |
| 存档管理 | `SaveManager.ts` | localStorage + companionSync 桥 |
| 数值公式 | `formulas.ts` | 战力/伤害/抽卡概率等计算 |

### UI 系统（`src/ui/`）

| 组件 | 文件 | 功能 |
|---|---|---|
| 主应用 | `App.ts` | 路由管理；主页/营地/战斗/仓库等页面 |
| 主页立绘 | `hubPortraitStage.ts` | 动态立绘 WebM 舞台 |
| 营地生活 | `campLivingPanel.ts` | 营地生活面板（AI 对话） |
| 营地地图 | `campFloorMap.ts` | 营地平面地图（1F/2F） |
| 对话界面 | `aiDialogueOverlay.ts` | 沉浸式对话 Overlay |
| 登录门禁 | `loginGate.ts` | 兑换码/订单号 + 千问 Key 登录 |
| 图鉴 | `galleryPage.ts` | 角色图鉴 |
| 样式 | `aiLiving.css` / `cc-ui.css` | 全局样式 |

---

## 四、关键配置

### 环境变量（`.env.example`）

```bash
# 对话/情感模型（默认 qwen-plus-character）
VITE_QWEN_MODEL=

# 生活路径/行为调度（默认 qwen-plus）
VITE_QWEN_LIFE_MODEL=

# 离线摘要（默认 qwen-flash）
VITE_QWEN_SUMMARY_MODEL=
```

### AI 模型体系

| 用途 | 默认模型 | 特点 |
|---|---|---|
| 对话/情感 | `qwen-plus-character` | 角色扮演特调，质量优先 |
| 生活路径/行为调度 | `qwen-plus` | JSON 稳、中文强 |
| 离线摘要 | `qwen-flash` | 压缩型任务，性价比最高 |

### 角色数据（`src/data/characters.ts`）

- **SR 角色**（6 个）：苍羽·澪、白楯·芹奈、银绯·玲、苍斩·凛、焰甲·朱里、黄狐·萤
- **SSR 角色**（5 个）：夜爪·黑织、翠翼·铃、绯尾·椿、橙铠·琥珀、冰华·雫
- **UR 角色**（2 个）：光轮·天音、橙兔·美羽

---

## 五、技术栈

| 依赖 | 版本 | 用途 |
|---|---|---|
| **phaser** | ^3.80.1 | 3D 战斗引擎 |
| **three** | ^0.184.0 | 3D 渲染 |
| **@capacitor/core** | ^8.4.1 | 移动端框架 |
| **@fontsource/noto-sans-sc** | ^5.2.9 | 中文字体 |
| **typescript** | ^5.6.3 | 类型系统 |
| **vite** | ^5.4.11 | 构建工具 |
| **sharp** | ^0.35.2 | 图片处理（ship 流程） |
| **wrangler** | ^4.125.0 | Cloudflare Workers |

---

## 六、必读文档

> 📚 **完整文档索引**：[docs/00-index.md](./00-index.md)（按类别 + 更新时间倒序排列）

| 文档 | 读给谁 | 何时读 |
|---|---|---|
| **[00-index.md](./00-index.md)** | 所有人 | **新 Agent 第一份**，找文档从这里开始 |
| **[onboarding.md](./onboarding.md)** | 新 Agent | 30 分钟上手指南 |
| **[ai-memory-layers.md](./ai-memory-layers.md)** | AI 系统开发者 | 对话/记忆逻辑 |
| **[ai-sleep-system.md](./ai-sleep-system.md)** | AI 系统开发者 | 睡眠系统 |
| **[ai-heartbeat.md](./ai-heartbeat.md)** | AI 系统开发者 | 心跳/NPC主动沟通 |
| **[ai-desires.md](./ai-desires.md)** | AI 系统开发者 | 欲望/议程系统 |
| **[ai-life-goals.md](./ai-life-goals.md)** | AI 系统开发者 | 人生目标系统 |
| **[ai-structured-facts.md](./ai-structured-facts.md)** | AI 系统开发者 | 结构化事实/关系弧线 |
| **[discipline-event.md](./discipline-event.md)** | AI + 美术 | 小黑屋调教 |
| **[character-skins.md](./character-skins.md)** | 美术 + 程序 | 皮肤资源规范 |
| **[camp-layout.md](./camp-layout.md)** | AI + 策划 | 营地房间/地标 |
| **[asset-ship-pipeline.md](./asset-ship-pipeline.md)** | 所有人 | 打包/资源管理 |
| **[combat-system.md](./combat-system.md)** | 战斗开发者 | Three.js 战斗 |
| **[combat-vfx-spec.md](./combat-vfx-spec.md)** | 战斗开发者 | 战斗特效/打击感 |
| **[ui-system.md](./ui-system.md)** | UI 开发者 | UI 布局/CSS |
| **[save-system.md](./save-system.md)** | 全栈 | 存档持久化 |
| **[激活与账号系统.md](./激活与账号系统.md)** | 所有人 | 激活/账号/爱发电接入手 |
| **[local-model-support.md](./local-model-support.md)** | AI 配置 | Ollama/OpenRouter 接入 |
| **[运营手册.md](./运营手册.md)** | 运营者 | 爱发电/码池操作 |
| **[chroma-key-to-webm.md](./chroma-key-to-webm.md)** | 美术管线 | 透明 WebM 制作 |
| **[performance-optimization.md](./performance-optimization-2026-08-29.md)** | 性能优化 | 移动端战斗优化 |
| **[market-standard-gap-analysis.md](./market-standard-gap-analysis.md)** | 策划/产品 | 产品路线图参考 |

---

## 七、常见开发任务

### 添加新角色

1. `src/data/characters.ts` — 注册角色 ID / 名字 / 稀有度 / 战力 / 立绘路径
2. `src/data/lore/ai_profiles.json` — 补充人设（coreNeeds / fears / speechStyle）
3. `src/data/characterSkins.ts` — 注册皮肤（默认/泳装/睡衣等）
4. `tex/juese/` — 放入立绘（PNG/WebM）
5. `src/data/lore/scene_cards.json` — 补充该角色的专属场景描述
6. 重新打包

### 添加新皮肤

见 `docs/character-skins.md` §皮肤系统集成。

### 修改 AI Prompt 行为

主要入口：`src/ai/promptAssembler.ts`（Prompt 组装）、`src/ai/aiProfiles.ts`（人设数据）。

### 修改营地布局

`src/data/campLayout.ts`（房间/邻接）、`src/data/campNav.ts`（锚点/门洞/墙）。

---

## 八、代码风格与规范

- **TypeScript 严格模式**：`tsconfig.json` 开启 `strict: true`
- **无 ESLint / Prettier**（目前缺失，建议补）
- **无单元测试**（建议补 vitest）
- **中文注释**：核心逻辑用中文注释，方便 AI Agent 理解
- **错误处理**：`catch {}` 静默吞错 100+ 处，待整治

---

## 九、已知的工程债务

| 问题 | 严重度 | 备注 |
|---|---|---|
| 无单元测试 | 高 | `dialogueEngine` / `memory` 等核心无回归保护 |
| 无 ESLint/Prettier | 中 | 代码风格不一致 |
| `App.ts` 上帝文件（~2000 行） | 中 | 建议按"对话域/营地域/皮肤域"拆模块 |
| 无 i18n | 中 | 中文硬编码，海外市场需重构 |
| 静默吞错 100+ 处 | 中 | 建议统一错误处理 |
| AdMob 测试 ID | 高 | 正式发布前需替换 |
| 包体约 2GB | 高 | 需 OBB 分包或云资源 |

---

## 十、快速验证命令

```bash
# 本地开发
npm run dev

# 构建 Web
npm run build

# 构建 Android APK
npm run build:apk

# 打包 ship 资源（必须）
npm run assets:build-ship

# 强制重压 ship
npm run assets:build-ship:force

# 测试激活网关（本地 mock）
node scripts/test-license-gateway.mjs

# 测试 AI 模型可用性
node scripts/smoke-qwen.mjs sk-你的Key
```
