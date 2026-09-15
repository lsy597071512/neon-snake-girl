# 锈带纪元 · 项目全面分析报告

> 分析日期：2026-09-14
> 分析范围：源码、构建管线、美术资产流水线、激活网关、Android 打包、仓库卫生
> 结论摘要：**一个完成度相当高的单人（+AI 辅助）独立游戏项目，架构分层清晰、文档体系罕见地完整；主要风险不在代码质量，而在包体体积、密钥安全与仓库卫生三件事。**

---

## 一、项目定位

| 项 | 内容 |
|---|---|
| 项目名 | 锈带纪元 / Rust Belt Era（包名 `rust-belt-era`） |
| 目录痕迹 | 目录名 `neon-snake-girl`，git 唯一提交信息为 "Neon Snake Girl source" → 项目经历过改名/转型，现名与目录名不一致 |
| 类型 | 末日废土机械少女题材：Three.js 3D 三车道跑酷战斗 + AI 陪伴养成 |
| 目标用户 | 成人向 / 二次元 / AI 陪伴爱好者 |
| 发布形态 | Web（静态站点，可部署 Cloudflare Pages / GitHub Pages）+ Android APK（Capacitor） |
| 商业模式 | 爱发电订单号 / 兑换码激活（Cloudflare Workers 网关）+ 玩家 BYOK 自备大模型 Key |
| 团队规模 | 从代码风格与提交记录推断：**1 人主导 + AI Agent 大量协同**（文档、脚本、资源 pipeline 高度自动化） |

---

## 二、规模与关键指标

| 指标 | 数值 |
|---|---|
| 源码文件 / 行数 | 204 文件 / **147,417 行**（含 82,029 行自动生成代码） |
| 实际手写代码 | 约 **6.5 万行** |
| 最大的生成物 | `src/data/campRouteGraph.generated.ts`（82,029 行 / 1.0 MB，占全部源码 56%） |
| 模块行数分布 | `data/` 86,544（含生成图）· `ai/` 22,560 · `ui/` 13,821 · `game/` 8,683 · `systems/` 3,066 · `core/` 625 |
| 游戏内容量 | 13 名角色（SR×6 / SSR×5 / UR×2）、5 章 120 关（5×12×2 普通/地狱）、80 抽保底（SR 86% / SSR 12.5% / UR 1.5%） |
| 美术源资产 | `tex/` 8,201 文件 / **8.6 GB**（唯一真源，只读） |
| 压缩产物 | `tex-ship/` 1,496 文件 / 1.28 GB |
| Web 构建产物 | `dist/` 2,140 文件 / **1.32 GB** |
| Android 产物 | `android/app/build/outputs/apk/debug/app-debug.apk` **1.38 GB**（versionCode 1） |
| 文档 | `docs/` 44 篇 Markdown，含 AI 系统、美术管线、运营手册、产品差距分析 |
| 辅助脚本 | `scripts/` **186 项**（含 59 个 Python 美术生成脚本、37 个 `.log`） |
| Git 历史 | **仅 1 次提交**（Initial commit），105 个未跟踪文件，单分支 main |
| 类型检查 | `npx tsc --noEmit` **通过，0 错误**（2026-09-14 实测，13s） |

---

## 三、技术栈

| 层 | 选型 | 评价 |
|---|---|---|
| 构建 | Vite 5 + TypeScript 5.6（`strict: true`） | 合理；但无代码分割配置，产物为单 bundle |
| 3D 渲染 | Three.js 0.184（GLTF/FBX Loader、EffectComposer + UnrealBloom、InstancedMesh） | 选型正确，用法专业 |
| 2D 引擎 | Phaser 3.80 —— **已无引用，是死依赖** | 迁移遗留，应删除（省 ~1MB） |
| UI | 原生 DOM + 字符串模板，无框架 / 无路由库 / 无状态管理 | 简单可控，代价是 `App.ts` 膨胀到 2,803 行 |
| 移动端 | Capacitor 8（Android、SplashScreen、StatusBar、Http、语音插件） | 配置完整，APK 已成功构建 |
| AI | 阿里云 DashScope（qwen-plus-character / qwen-plus / qwen-flash），OpenAI 兼容协议；本地旁路 llama.cpp + Fable Q4 | 分层合理，云地双路 |
| 后端 | Cloudflare Workers + D1（`rust-belt-license`）+ wrangler 4 | 无服务器、零运维，选型优秀 |
| 资产处理 | sharp（WebP 压缩）、ffmpeg（VP9 透明 WebM / H.264）、rembg（安全抠像）、@gltf-transform（GLB meshopt） | 工业化程度高 |
| 测试 | **无**（无单测、无 E2E、无 ESLint/Prettier、无 CI） | 最大工程短板 |

---

## 四、架构总览

```
index.html
  └─ src/main.ts           启动编排：视口 → ship manifest → 远端 GPU 配置
                            → 原生平台 → hubBoot → ensureLicensed（激活门禁）
                            → 恢复小黑屋会话 → new App() → bootAiLivingSync()
      ├─ src/ui/App.ts (2,803)        UI 壳：if 链路由 + innerHTML 全量重建
      │    ├─ 战斗    → src/game/Combat3D.ts (2,803)  Three.js 三车道
      │    ├─ AI 生活 → src/ai/livingService.ts       对话/心跳/事件总线
      │    ├─ 营地    → campLivingPanel / campFloorMap / campWarehousePanel
      │    └─ 商店·编队·家园（费率常量散落在 data/characters.ts）
      ├─ src/systems/  (11)  无状态纯函数 fn(save, ...)：军械箱/扫荡/成就/皮肤/仓库…
      ├─ src/core/     (3)   SaveManager（localStorage，v7 tolerant merge）
      ├─ src/data/     (23)  配置驱动：角色/武器/关卡/营地/皮肤/生成路由图
      └─ src/platform/ (4)   license.ts（激活码 → HMAC token）、移动端适配
```

**分层评价**：`src/systems/` 全部是无状态纯函数、无 class、横向依赖极少 —— 这是本项目架构最漂亮的部分。`src/ai/` 虽然文件多（85 个），但聚类清晰（传输层 / Prompt 层 / 记忆层 / 生活模拟 / 事件 / 语音），职责边界明确。

---

## 五、核心子系统剖析

### 5.1 战斗系统（已迁移到 3D，Phaser 为遗留壳）

- `src/game/Game.ts` 的 `USE_3D_COMBAT = true`，`startCombat()` 直接转调 `startCombat3D()`；`CombatScene.ts`（Phaser，406 行）**无任何 import 方**，全项目 `from 'phaser'` 仅此一处。
- `Combat3D.ts` 2,803 行 / ~80 方法：三车道 `moveLane()`、数字门 `spawnDoors()`（+20%/+35% 攻速）、油桶、Boss（hp×8）、Raid Boss 组、波次逻辑下沉到 `combatWaveLogic.ts`。
- 渲染：EffectComposer + UnrealBloomPass（支持半分辨率）、`combatQuality.ts` 三档画质、`VfxPool.ts` 精灵池、敌人 InstancedMesh（上限 40）。
- 胜负与数值：`combatBalance.ts` + `combatWaveLogic.ts`。

### 5.2 AI 生活系统（本项目真正的壁垒）

- **对话管线**：`livingService.talkToCharacter()` → `dialogueEngine.runPlayerDialogue()` → `promptAssembler.assemblePlayerDialogueMessages()` → `llmRouter.chatDialogueStreamJson()` → SSE 流式 → 现实守卫（`detectDialogueRealityIssues`，最多重试 3 次）→ 落记忆 + 结构化事实抽取 → 存档。
- **四层记忆**：

  | 层 | 载体 | 上限 |
  |---|---|---|
  | recentChats | localStorage | 20 条缓冲 / Prompt 注入 8 轮 |
  | chatDigests | localStorage | 64（溢出自动滚压） |
  | memories | localStorage | 分槽 talk 24 / event 16 / other 8 |
  | dialogueArchive + lifeArchive + lifeTimeline | **IndexedDB** | 全文永久；life 超 2,500 条按日压缩 |

- **生活模拟**：世界时钟（现实 1 分钟 = 游戏 5 分钟）、睡眠系统（6 小时深睡）、欲望/议程、人生目标、关系弧线（警惕→冷淡→熟悉→信赖→亲密）、心跳（8 分钟一次稀疏事件）、NPC 主动触达、营地随机事件引擎（`campEvents/catalog.ts` 1,003 行事件表）。
- **语音**：TTS 走 qwen3-tts-flash（原生端 CapacitorHttp），ASR 优先级 Capacitor 插件 → 浏览器 SpeechRecognition → MediaRecorder + 百炼 ASR，另有 Web Speech 兜底。

### 5.3 存档系统

- `SAVE_KEY = 'rust-belt-era-save-v1'`，`SAVE_VERSION = 7`。
- 迁移不是版本递增链，而是 `migrateSave()` 的"默认值 + 展开 + 逐字段兜底 + 类型 filter"容错合并 —— 对频繁改字段的个人项目是务实的做法，但历史上限低（字段删除无法清理）。
- 另有 4 个 key：`rb-license-token` / `rb-device-id` / `rb-license-validated-at` / `rb-gateway-urls`。

### 5.4 激活与账号网关

- Cloudflare Worker `rust-belt-license` + D1，两表：`codes`（max_devices=3、revoke、自解绑冷却 30 天）、`devices`（code + device_id 联合主键）。
- API：`/api/ping`、`/api/login`（兑换码或 ≥12 位爱发电订单号 → 绑设备 + HMAC token，TTL 30 天）、`/api/validate`（24h 在线校验）、`/api/self-unbind`、管理端 `X-Admin-Key` 保护。
- 客户端双地址容错：`license.youziligames.com` 主 + `*.workers.dev` 备。
- 密钥：HMAC secret / admin key 存于 `wrangler secret`，本地副本 `gateway/.secrets.local.json` 已被 gitignore 且确认未入库 —— **处理正确**。

### 5.5 美术资产流水线（成熟度最高的一块）

`tex/`（8.6GB 源，只读）→ `tex-ship/`（1.28GB 压缩产物）→ `dist/tex/`，由 `npm run prebuild` 强制串联 5 个脚本，并有门禁（`verify-ship-gate` / `verify-ship-p2`，缺产物直接构建失败）。

- 缓存去重：`.ship-cache.json` 按 SHA1 + 策略版本命中跳过。
- 硬规则：源文件永不覆盖；无静态路径模板命中的资源标 `no-runtime-reference` 强制排除。
- 透明 WebM：rembg 主体保护 + 软色度键控 + 边缘溢色清理 + ffmpeg VP9 yuva420p CRF20，三档脚本（快速 / green_dom / 安全档）。
- 营地路线图由 `scripts/extract-camp-routes.mjs` 用 sharp 读平面图、按 8px 网格采样白色路径生成 → 2 层 5,989 节点 / 约 1.45 万条边。

---

## 六、做得好的地方

1. **文档体系**：44 篇文档、有索引、有维护规约（"改代码要同步哪篇文档"），并明确写给 AI Agent 看 —— 在个人项目里极其罕见，也是本项目能被 AI 高效协同的原因。
2. **架构分层**：`systems/` 纯函数层几乎零耦合；`ai/` 传输 / Prompt / 记忆 / 生活模拟边界清晰。
3. **类型质量**：`tsc --noEmit` 零错误通过；全项目仅 8 处 `any`（4 处还在死文件里）；注释掉的代码块仅 1 处、TODO 为 0 —— 代码洁净度高于多数同规模项目。
4. **资产工业化**：源产分离、缓存去重、强制门禁、抠像三档工具链，这套 pipeline 是专业级的。
5. **零服务器 AI 成本**：玩家 BYOK 直连 DashScope，商业模型上非常聪明。
6. **网关设计**：Workers + D1、设备绑定、HMAC token、管理端分离、密钥隔离，做法标准。

---

## 七、风险与债务清单

### P0 · 必须尽快处理

| # | 问题 | 影响 | 证据 |
|---|---|---|---|
| 1 | **包体 1.32 GB / APK 1.38 GB** | 玩家无法下载、应用商店拒收、CDN 成本高 | `dist/` 1.32GB；`app-debug.apk` 1.38GB |
| 2 | **`codes.txt` 50 个真实激活码已入库** | 激活码明文进 git，任何人拿到仓库即可白嫖 | 已被 git 跟踪（其余密钥均未入库） |
| 3 | **前端直连 LLM，Key 存 localStorage** | 玩家 Key 可被任意脚本读取；`VITE_*` 变量会被内联进打包产物 | `llmClient.ts:41` `rust-belt-ai-api-key`；TTS/ASR 复用同一 Key |
| 4 | **无测试、无 lint、无 CI** | 14.7 万行代码零回归保护，改动核心 AI 逻辑全靠手测 | `docs/README-dev.md` §九 自承 |

### P1 · 影响体验与迭代速度

| # | 问题 | 证据 |
|---|---|---|
| 5 | `App.ts`(2,803) / `Combat3D.ts`(2,803) 双巨型文件 | 上帝文件，改一处牵全身 |
| 6 | 每轮对话全档 `JSON.parse(JSON.stringify())` 深拷贝 + IndexedDB 全表 `getAll()` 后逐条字符串匹配 | `dialogueEngine`；`searchDialogueArchive()` O(n) 主线程阻塞 |
| 7 | `runPlayerDialogue()` 内 `saveManager.mutate()` 调用两次，每次全档 `JSON.stringify` 写 localStorage | 对话时有可感知卡顿风险 |
| 8 | 1.0 MB 生成路由图进主 bundle，启动即解析 | `campRouteGraph.generated.ts` |
| 9 | 静默吞错 100+ 处，`void promise` 丢弃写入失败 | 数据丢失无告警 |
| 10 | `App.render()` 全量 `innerHTML` 重建 + 重绑事件，叠加 4 个 setInterval（30s/120s/40s/5s） | 移动端发热、掉帧 |
| 11 | `llmClient.cascadeModels()` 恒返回单模型 ——「级联备用」是空壳，主模型失败即抛 | 无降级能力 |

### P2 · 卫生与一致性

| # | 问题 | 建议 |
|---|---|---|
| 12 | Phaser 死依赖 + `CombatScene.ts`（406 行） | 删除，省 ~1MB |
| 13 | `scripts/` 186 项平铺，含 37 个 `.log`、`__pycache__`、`_tmp_*.py` | 拆 `scripts/build` / `art` / `ops` / `tmp`，清理日志 |
| 14 | 根目录 9 个 `.log`、7 个 `.tmp-*`、`tmp/`(1.4GB)、`tmp-bug6/`(已入库)、`_count.mjs`、`_tmp_doc_snip*.txt` | 清理并 `git rm --cached` |
| 15 | 文档漂移：`README-dev.md` 提到的 `CharacterGachaSystem.ts`、`WeaponForgeSystem.ts`、`WarehouseSystem.ts`、`formulas.ts` 在 `src/systems/` 中并不存在 | 实际是 `ArmorySystem` / `CampWarehouseSystem` / `weaponInventory`，抽卡逻辑在 `App.ts` 的 `gacha()` |
| 16 | git 仅 1 次提交，105 个未跟踪文件 | 无回滚能力，等于没有版本管理 |
| 17 | `gateway-deploy.log` 显示部署未完成（database_id 未自动填入） | 部署流程需复核 |
| 18 | 成人向内容模块（`disciplineSession`、`adultEvents` 等） | **分发合规风险**：应用商店、支付渠道、CDN 托管方均有内容审核，需提前规划渠道与年龄分级 |

---

## 八、建议的行动计划

**第一阶段 · 止血（1～2 天）**
1. 把 `codes.txt` 移出仓库（`git rm --cached`），改由网关后台/环境变量管理，历史提交中的码全部作废重发。
2. 建立 git 提交纪律：先做一次包含全部源码的基线提交，`.gitignore` 补 `tmp/`、`*.log`、`dist/`、`android/app/build/`。
3. 清理 `scripts/*.log`、`__pycache__`、根目录临时文件。

**第二阶段 · 包体（3～5 天，最高性价比）**
4. 按章节/角色拆分资源：首包只含第 1 章 + 默认皮肤，其余走运行时按需加载（CDN）。目标 Web 首屏 < 30 MB。
5. Android 改走 **AAB + Play Asset Delivery** 或 OBB 分包，否则 1.38 GB 的 APK 无法上架。
6. 非 P1 保护区（营地大图、背景）进一步降分辨率 / 降帧率；WebM 检查 CRF 与分辨率是否可再降一档。

**第三阶段 · 工程质量（持续）**
7. 引入 vitest，先给 `systems/`（纯函数层，最容易测）和 `SaveManager.migrateSave()` 补测试；再补 3～5 条 Playwright 冒烟（启动 → 激活 → 进入战斗 → 打完一波）。
8. 接 ESLint + Prettier + GitHub Actions（`tsc --noEmit` + `npm run build` + 冒烟）。
9. 拆 `App.ts`：抽 `BattleView` / `CampView` / `ShopView` / `GachaView`；把 `gacha()` 等业务逻辑下沉到 `src/systems/GachaSystem.ts`。
10. 修复对话热路径性能：增量写入替代全档深拷贝；IndexedDB 加索引 + 连接池；`mutate()` 合并为一次。

**第四阶段 · 安全与商业化**
11. LLM 调用改为经自研网关代理（复用 Cloudflare Worker），玩家 Key 不出浏览器→改为服务端持有或一次性换取短期 token。
12. 补齐 `.env.example` 缺失的 4 个键：`VITE_AI_CHAT_PROVIDER`、`VITE_AI_COMPAT_BASE_URL`、`VITE_AI_COMPAT_API_KEY`、`VITE_AI_COMPAT_MODEL`。
13. 明确成人内容的发行渠道与年龄分级策略。

---

## 九、总体评价

| 维度 | 评分 | 说明 |
|---|---|---|
| 产品完成度 | ★★★★☆ | 战斗 + 养成 + AI 生活 + 语音 + 账号，闭环完整，内容量可观 |
| 架构设计 | ★★★★☆ | 分层清晰，纯函数系统层优秀，类型严谨 |
| 代码质量 | ★★★☆☆ | 类型好、注释干净，但巨型文件与静默吞错拉低分数 |
| 工程化 / 流水线 | ★★★★☆ | 美术 ship 流水线专业，但缺测试与 CI |
| 文档 | ★★★★★ | 44 篇，罕见的完整，且面向 AI 协同优化 |
| 安全 | ★★☆☆☆ | 激活码入库、前端 Key 明文、无代理层 |
| 可分发性 | ★☆☆☆☆ | 1.3 GB 包体是硬伤，目前不具备大规模分发条件 |
| 仓库卫生 | ★★☆☆☆ | 1 次提交、186 项脚本平铺、大量临时文件 |

**一句话结论**：这是一个"内容与技术都做得很扎实，但卡在最后一公里（包体 / 安全 / 工程纪律）"的项目。前三项 P0 里，**包体**决定能不能发出去，**codes.txt 与 Key 暴露**决定发出去会不会亏钱，**测试与 CI** 决定后续还能不能改得动。建议按上述顺序推进，其中第二阶段的包体优化是投入产出比最高的一项。
