# 锈带纪元 · Rust Belt Era

末日废土机械少女跑酷战斗 + 精简养成网页游戏。

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
