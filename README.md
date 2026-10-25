# 锈带纪元 · Rust Belt Era

末日废土机械少女跑酷战斗 + 精简养成网页游戏。

---

## ⚠️ 第一宗旨（最高优先级）

**让游戏中的角色，真实地生活在游戏的世界里。**

- 玩家只在**在线时**存在：在线＝扮演指挥官在场；离线＝指挥官离开或睡觉，世界照常运转，角色继续过自己的日子。
- 所有 AI 相关的新增 / 修改 / 优化**必须**围绕这条宗旨执行：角色可以拒绝、有作息与身体、做事要花时间、换衣有过程、打扰有代价、没有任何不可恢复的死锁。
- 浴室 / 安抚 / 舞蹈 / 调教等硬性玩法事件同样适用：**玩法外壳可以确定，角色内核必须真实**。
- 需求若违背现实生活逻辑，**先指出冲突并给替代方案**，不得默默执行。

完整纲领与自检清单：**[docs/ai-first-principle.md](./docs/ai-first-principle.md)**（文档索引见 [docs/00-index.md](./docs/00-index.md)）。

---

## 玩家 / 你自己游玩（无需 node_modules）

**玩家永远不需要 `node_modules`。** 那是开发者工具，不是游戏本体。

游戏已经打包在 `dist/` 文件夹里（约 1.5MB），双击即可玩：

```
双击 start-play.bat  →  自动打开浏览器  →  http://localhost:8080
```

也可以把 **`dist/` 整个文件夹** 上传到任意网站（Cloudflare Pages、GitHub Pages、自己的服务器），玩家访问网址即可游玩，无需安装任何东西。

---

## 开发者改代码（才需要 Node.js）

Node.js 装在系统目录 `C:\Program Files\nodejs\`，不在项目里。

只有你要**修改代码并重新打包**时才需要：

```bash
cd rust-belt-era
npm install          # 仅开发时执行一次，会生成 node_modules
npm run dev          # 改代码时的热更新预览
npm run build        # 打包到 dist/，给玩家用
```

改完并 `npm run build` 后，可以删除 `node_modules` 节省空间，不影响 `dist/` 游玩。

### 美术进包（强制，所有机器）

打包 / 打 APK **必须**走标准 ship 流程（源 `tex/` 不覆盖；已优化不二次压）：

- 文档：**[docs/asset-ship-pipeline.md](./docs/asset-ship-pipeline.md)**
- 命令：`npm run build` / `npm run build:apk`（内含 build-ship + 门禁）

### 发版打 APK（签名 release）

**必读：[docs/apk-release-build.md](./docs/apk-release-build.md)** —— 签名指纹真源、四步可靠链路、安全软件实时扫描导致打包卡死的诊断与绕行。

- 一条命令（安全软件已加信任区时）：`npm run build:apk:release`
- 产物：`C:\Users\admin\Desktop\rust-belt-era-apk\rust-belt-era-release.apk`
- AI Agent 可直接加载同内容的 Skill：[`skills/rust-belt-apk-release/SKILL.md`](./skills/rust-belt-apk-release/SKILL.md)
- ⚠️ `npm run build:apk` 出的是 **debug 包**，签名不同，**禁止发给玩家**（覆盖安装失败、存档丢失）

| 文件/目录 | 谁需要 | 说明 |
|-----------|--------|------|
| `dist/` | **玩家** | 打包好的游戏，直接打开/部署 |
| `src/` | 开发者 | 源代码 |
| `tex/` | 开发者 | 源美术（只读进包） |
| `tex-ship/` | 本机生成 | 压缩进包产物（可不提交） |
| `node_modules/` | 开发者（可选） | 开发依赖，**可删**，需要时用 `npm install` 恢复 |
| `start-play.bat` | **玩家/你** | 本地打开游戏 |
| `start-dev.bat` | 开发者 | 开发模式 |

---

## 游戏系统

| 模块 | 说明 |
|------|------|
| 地图 | 5 章 40 关，首通/扫荡，自动战斗（通关第 8 关后） |
| 战斗 | 三车道、数字门、打桶、Boss、TCP 战力判定 |
| 商店 | 抽卡、军械箱、武器礼包、广告激励 |
| 编队 | 1~3 人出战，武器装备 |
| 家园 | 角色详情、礼物、成就、排行积分 |

## 核心数值

- 角色：仅稀有度 + 基础战力 + SSR/UR 专属技能
- 武器：军械箱产出，战力 = 唯一成长
- 货币：锈币 + 抽卡券
- 广告：每日 15 次（模拟，可替换 AdSense）

## 目录结构

```
src/
  data/          # 角色、武器、关卡、成就配置
  core/          # 存档、战力公式
  systems/       # 军械箱、广告、成就
  game/          # Phaser 战斗场景
  ui/            # 主界面 App
```

## 替换美术

- 角色 emoji → `src/data/characters.ts` 的 `icon` 字段换为图片 URL
- 武器 emoji → `src/data/weapons.ts`
- 战斗场景 → `src/game/CombatScene.ts` 中 Sprite 替换

## 接入真实广告

修改 `src/systems/AdSystem.ts`，将模拟 overlay 替换为 Google H5 Games Ads 或 AdSense。

## 重置存档

家园页 → 「重置存档」，或清除浏览器 localStorage 键 `rust-belt-era-save-v1`。
