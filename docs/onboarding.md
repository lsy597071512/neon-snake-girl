# 新 Agent 快速上手指南

> **第一步先读 [ai-first-principle.md](./ai-first-principle.md)：第一宗旨 = 让角色真实地生活在游戏的世界里。**
> 玩家离线＝指挥官离开/睡觉，世界继续走；角色可拒绝、有作息、有代价、无死锁。任何 AI 改动先过它的自检清单。

> **目标**：让下一个接手本项目的 AI Agent 能在 30 分钟内开始有效工作。  
> **前置要求**：有代码编辑能力，能读写 TypeScript，了解基本的游戏开发概念。  
> **最新更新**：2026-10-21（首段固定为第一宗旨）

---

## 第一步：了解项目（15 分钟）

### 必读文档（按顺序）

1. **[ai-first-principle.md](./ai-first-principle.md)** — 第一宗旨 / 活人定律（最高优先级）
2. **[README-dev.md](./README-dev.md)** — 项目全貌，10 分钟
3. **[ai-memory-layers.md](./ai-memory-layers.md)** — AI 记忆如何工作
4. **[激活与账号系统.md](./激活与账号系统.md)** — 账号/激活/爱发电接入

### 理解项目结构

```
src/
├── ai/           ← AI 生活系统（核心，~40 个文件）
├── game/         ← Three.js 战斗
├── systems/      ← 游戏系统（抽卡/仓库/成就）
├── core/         ← 存档/公式
├── data/         ← 静态配置
└── ui/           ← UI 组件
```

### 关键概念

| 概念 | 解释 |
|---|---|
| **AiLivingSave** | AI 生活存档结构，包含所有角色的状态/记忆/关系 |
| **议程（Agenda）** | 角色的"待办清单"（想去哪/做什么） |
| **欲望（Desire）** | 角色想去某地的欲望分（0-100） |
| **心跳（Heartbeat）** | 稀疏事件调度（8 分钟间隔） |
| **Prompt Assembler** | 组装对话 Prompt 的模块 |

---

## 第二步：搭建开发环境（5 分钟）

```bash
# 克隆项目
git clone <repo-url>
cd neon-snake-girl

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

**注意**：需要一个有效的千问 API Key 才能完整测试 AI 功能。

---

## 第三步：找到你要改的地方（5 分钟）

### AI 系统修改

```typescript
// 对话行为 → src/ai/promptAssembler.ts 或 src/ai/aiProfiles.ts
// 记忆逻辑 → src/ai/memory.ts
// 换装规则 → src/ai/emotionOutfit.ts
// 睡眠系统 → src/ai/sleepSystem.ts
// 欲望/议程 → src/ai/characterDesires.ts / characterAgenda.ts
```

### 游戏系统修改

```typescript
// 战斗 → src/game/Combat3D.ts
// 抽卡 → src/systems/CharacterGachaSystem.ts
// 皮肤 → src/systems/CharacterSkinSystem.ts
// 成就 → src/systems/AchievementSystem.ts
```

### UI 修改

```typescript
// 主页/营地 → src/ui/App.ts
// 对话界面 → src/ui/aiDialogueOverlay.ts
// 样式 → src/ui/aiLiving.css / cc-ui.css
```

---

## 第四步：验证修改（5 分钟）

```bash
# TypeScript 类型检查
npx tsc --noEmit

# 构建（如果改了打包相关）
npm run build

# 测试激活网关（如果改了账号系统）
node scripts/test-license-gateway.mjs
```

---

## 常见任务模板

### 任务 1：添加新角色

1. `src/data/characters.ts` — 注册角色
2. `src/data/lore/ai_profiles.json` — 补充人设
3. `src/data/characterSkins.ts` — 注册皮肤
4. `tex/juese/` — 放入立绘
5. 打包测试

### 任务 2：修改对话 Prompt

1. `src/ai/promptAssembler.ts` — 找到对应块
2. 改 Prompt 文本
3. 测试对话

### 任务 3：添加新皮肤

见 `docs/character-skins.md` 的皮肤集成指南。

### 任务 4：修改营地事件

1. `src/ai/campEvents/` — 查看现有事件
2. 参考 `trySpawnCampEvent()` 添加新事件
3. 测试触发

---

## 代码风格

- **TypeScript 严格模式**
- **中文注释**（方便 AI Agent 理解）
- **避免 magic number**（用常量替代）
- **错误处理**（try/catch + 错误码）

---

## 遇到问题怎么办

### 1. 不知道某个函数在哪里

```bash
# 搜索函数名
grep -r "functionName" src/
```

### 2. 不知道某个类型定义

```bash
# 搜索类型
grep -r "type GameSave" src/
```

### 3. 不知道某个常量值

```bash
# 搜索常量
grep -r "SLEEP_REAL_DURATION_MS" src/
```

### 4. 测试时 AI 不回复

1. 检查千问 API Key 是否有效
2. 检查 `hasDialogueApiKey()` 返回 true
3. 查看浏览器控制台错误

### 5. 打包失败

> **⚠️ 打包前必读：`docs/apk-release-build.md`**（签名规范 / 四步可靠链路 / 安全软件扫描卡死的绕行方案）。
> 若 `vite build` 或 `cap sync` 无报错地卡死、进程 CPU 冻结，**不是代码问题**，直接跳到该文档第 3、4 节，不要重试。

1. 运行 `npm run assets:build-ship` 先构建资源
2. 检查 `tex-ship/` 是否生成
3. 查看 `verify-ship-gate` 错误信息

---

## 快速参考

### 常用命令

```bash
npm run dev          # 开发服务器
npm run build        # 构建 Web
npm run build:apk    # 构建 Android（debug，仅供测试）
npm run assets:build-ship  # 打包资源
```

> **发版打包（签名 release）** 见 [`apk-release-build.md`](./apk-release-build.md)。不要把 debug 包发给玩家（签名不同，覆盖安装会失败并导致存档丢失）。

### 调试端点

```javascript
// 浏览器控制台
getAiLiving()          // 获取 AI 生活存档
getOwnedCharacterIds() // 获取拥有的角色 ID
console.log(getAiLiving().agendas)  // 查看议程
```

### 文件搜索

```bash
# 找包含 "heartbeat" 的文件
grep -r "heartbeat" src/

# 找包含 "sleep" 的文件
grep -r "sleep" src/ai/
```

---

## 重要文件索引

| 你想改... | 去哪里找 |
|---|---|
| 对话 Prompt | `src/ai/promptAssembler.ts` |
| 角色人设 | `src/data/lore/ai_profiles.json` |
| 皮肤资源 | `src/data/characterSkins.ts` |
| 营地房间 | `src/data/campLayout.ts` |
| 战斗逻辑 | `src/game/Combat3D.ts` |
| UI 布局 | `src/ui/App.ts` |
| 对话界面 | `src/ui/aiDialogueOverlay.ts` |
| 存档 | `src/core/SaveManager.ts` |

---

## 下一步

读完本指南后，建议深入阅读：
- **[AI 系统文档群](./ai-sleep-system.md)** — 了解 AI 生活核心
- **[character-skins.md](./character-skins.md)** — 皮肤资源规范
- **[camp-layout.md](./camp-layout.md)** — 营地房间结构
- **[discipline-event.md](./discipline-event.md)** — 小黑屋系统
