# 待办：三件已确认但暂缓的 P0（2026-10-19 记录）

> 来源：2026-10-19 项目分析结论。这三件事**已确认存在且必须做**，但当前阶段优先修"影响游戏流程的 BUG"。
> 状态：**推迟（非取消）**。修完流程 BUG 后立即回到本清单。
> 恢复方式：本文件是唯一进度源，改状态时同步更新 [00-index.md](./00-index.md) 的入口说明。

---

## D-1 市场版基线提交 + 双轨锁死

**优先级**：P0 · **状态**：推迟 · 目标：流程 BUG 修完当天做

**问题**
- 仓库仅 1 次提交，**237 项变更未入库**；`HEAD` 仍是**成人版源码**（`disciplineSession` 为完整实现、且无 `cloudSafety.ts`），工作区才是市场合规版。
- 误 `git push` 会把成人版推上去；误 `git checkout` 会丢市场版改造。
- 成人版快照分散在 `_adult-local/`（334 文件，gitignore）与 `docs/adult-baseline/*.bak`（未跟踪），来源不唯一。

**待办**
- [ ] 当前工作区（市场合规版）完整提交，打 tag `market-baseline-2026-10-19`
- [ ] `main` 仅保留市场版；成人版迁独立私有仓库/分支，禁止混推
- [ ] 清理 `docs/adult-baseline/*.bak` 与 `*(1)` 重复文件，成人版快照只保留 `_adult-local/` 一份
- [ ] `.gitignore` 补 `docs/adult-baseline/` 等
- [ ] 确认 `codes.txt` / `.env.local` / `.dashscope_key` / `*.jks` 均未入库（当前已正确，需长期保持）

**验收**：新克隆仓库 `git log` 只有市场版历史；`git grep -i "调教" src/` 无成人实现残留。

---

## D-2 包体瘦身：3.33 GB → 可分发量级

**优先级**：P0 · **状态**：推迟 · 目标：流程 BUG 修完后立刻启动

**问题**
- `dist/` 2,444 文件 / **3.33 GB**；577 个 WebM 占 **2.98 GB**；`tex-ship` 直通体积 3,180.5 MB。
- `tex-ship/ship-manifest.json`（2026-10-19）：扫描 2,719、P0 排除 939、进包 1,780、缓存命中 1,778、位图节省 1,395.6 MB —— 位图压缩有效，**视频/WebM 基本直通**，直接把包体推到 3 GB。
- 09-14 时为 1.32 GB，一个月内翻 2.5 倍。
- Web 首屏与 APK 均无法大规模分发，应用商店基本拒收。

**待办**
- [ ] 首包与资源包分离：首包 = 第 1 章 + 默认皮肤 + UI，目标 < 50 MB（Web 首屏 < 30 MB）
- [ ] 角色/章节/动态皮按需加载，走 CDN
- [ ] WebM 重压：按用途分档（立绘/动态皮/事件），限分辨率、帧率、时长；透明通道仅必要资源保留；裁静音段
- [ ] 去重 `*(1)` 资源，复核 `no-runtime-reference` 白名单无漏网
- [ ] Android 改 AAB + Play Asset Delivery / OBB，否则单 APK 无法上架

**验收**：`dist/` ≤ 300 MB；首屏加载 ≤ 30 MB；APK/AAB 可过商店大小限制。

---

## D-3 工程纪律：测试 / lint / CI / 监控

**优先级**：P0 · **状态**：推迟（测试与 CI 建议在 D-2 之前先补最小集）· 目标：流程 BUG 修完后启动

**问题**
- 15 万行代码、**0 单元测试 / 0 E2E / 0 CI**（无 `.github/`、无 ESLint/Prettier 配置）。
- `systems/` 纯函数层最适合补测试，却完全没覆盖。
- **216 处静默吞错**（`catch` 总 234）+ **180 处 `void promise`**，存档/IndexedDB 写入失败无告警，存在数据丢失风险。
- 无崩溃上报、无漏斗埋点。

**待办**
- [ ] `vitest`：先覆盖 `src/systems/` 纯函数 + `SaveManager.migrateSave()`
- [ ] Playwright 冒烟 3–5 条（启动 → 激活 → 战斗一波 → 营地 → 对话）
- [ ] ESLint + Prettier + GitHub Actions（`tsc --noEmit` + `vite build` + 冒烟）
- [ ] 关键路径禁止空 `catch`，统一 `console.warn` + 上报钩子
- [ ] 接入崩溃上报（Sentry 或等价）

**验收**：`npm test` / `npm run lint` / CI 三绿；关键路径失败可观测。

---

## 恢复顺序（流程 BUG 修完后）

1. **D-1**（半天，风险最高，先锁版本）
2. **D-3 最小集**（vitest + CI 冒烟，防回归）
3. **D-2**（体量最大，需要美术/程序协作）
4. D-3 剩余项
