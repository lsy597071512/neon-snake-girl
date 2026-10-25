# 美术进包标准流程（强制）

> **状态：现行强制标准（2026-09-20 · P2 v3.4；2026-10-21 增补发行通道规范；2026-10-25 增补玩家端缓存生命周期）**  
> 适用于：**所有机器**上的 Web 打包与 **Android / Capacitor 移动端打包**。  
> 若要换平台或减弱优化，须产品明确通知后再改本文件与脚本。

---

# 第〇章 · 发行版本与发布通道总规范（2026-10-21 起强制）

> **所有 AI 智能体与人必读。** 任何「要不要打包 / 能不能装机测试」的判断，
> 必须先读本节，再执行 `npm run check:build`，以脚本输出为准，禁止凭记忆判断。

## 0.1 三个发行版本（产品线定义）

| 版本 | 定位 | 内容范围 | 分发方式 | 状态 |
|------|------|----------|----------|------|
| **个人版** | 开发者自用 | **全部**代码、玩法、美术资源 | 私域 | ✅ 当前唯一存在的版本 |
| **正式版** | 发售版，购买激活码激活 | 部分玩法 + 部分美术（**非全量**，范围发行前定） | 外网或私域（未定） | 📋 规划 |
| **测试版** | 免费拉新阉割版 | 正式版的子集（试玩内容） | 外网或私域（未定） | 📋 规划 |

- 三个版本均**不需要版号**；发售渠道（外网/私域）未定，打包规范按渠道无关设计。
- 版本差异开关（玩法/美术按版本裁剪）**尚未实现**，发行临近时按本章补机制；
  在新机制落地前，所有出包默认为**个人版**。
- 测试版/正式版的美术裁剪必须复用既有 `_sticker` 打码资产体系（见第 0.5 节）。

## 0.2 三条发布通道（改动如何到达玩家手机）

| 通道 | 覆盖改动 | 生效动作 | 不做的后果 |
|------|----------|----------|------------|
| ① **APK 打包** | `src/` 代码、CSS、P0 资源、`tex/` 源素材、`music/` | `npm run build:apk`（debug）/ `build:apk:release` | 手机上跑旧代码 |
| ② **Worker 部署** | `gateway/worker.js` | `cd gateway && npx wrangler deploy` | 版本门/激活/资源代理用旧逻辑 |
| ③ **B2 远端资源** | `tex/` 中 P1/P2 层美术（皮肤/画廊）——**含新增、修改与删除** | `npm run assets:sync-cloud`（自动上传 + 回写 assetHash） | 玩家永远拉旧美术；删除的资源在玩家手机上残留为孤儿文件 |

> **出包顺序铁律**：release 包**先跑通道③再打①**。`build:apk:release` 已内置
> `assets:check-cloud` 前置门禁——云端美术与本地不一致时**直接中止**，绝不允许
> 打出「APK 里是新代码、云端还是旧美术」的错位包。

**多智能体并行铁律**：任何智能体完成修改后，必须在交接说明里写明「动了哪条通道」；
接收测试前一律跑 `npm run check:build`（三通道新鲜度总检查，输出 ⚠ 项即为待办）。

## 0.3 强更与弱更（版本门规则）

| 类型 | 触发 | 玩家体验 | 判定标准 |
|------|------|----------|----------|
| **强更** | 系统逻辑 / 玩家流程变更 | 弹迭代告示 → 必须下载新 APK 装完重启才能进游戏；运行中绝不热替换代码 | `build < minBuild` |
| **弱更** | 仅美术资源变更（P1/P2） | 静默后台下载差异，sha256 校验通过才替换，不打断游戏 | `assetHash` 不一致 |

- **铁律**：凡涉及系统逻辑或玩家流程体验的修改，**打包前必须先告知产品（用户）确认**，
  确认后才可执行打包与 `minBuild` 提升。
- 美术-only 更新不需要重打 APK，走通道③即可。

## 0.4 P0/P1/P2 资源分层（云端分发架构）

| 层 | 内容 | 位置 | 规则 |
|----|------|------|------|
| **P0** | 代码壳 + UI + 登录/主页 + **新手引导全链路资源** | APK 内置 | 第一原则：引导链路（g_hello→…→g_camp）**零打断**；营地默认生活装 `shenghuofuzhuang00` 全角色在 P0 |
| **P1** | 角色皮肤（`juese/pifu/`，约 2.5GB） | 云端，登录后批量下载（面板可转后台） | 未下载时走 CDN 在线加载兜底，不黑图 |
| **P2** | 画廊（`gallery/`） | 云端，按需懒加载 | 同上 |

- 分层判定：`scripts/asset-tiers.config.mjs` 的 `tierForShipRel`；测试期 `MERGE_REMOTE_TIERS=true`（P1+P2 合并为一个远端包），发售再区分。
- 新资源默认落 P0；凡把路径加入 P1/P2 pattern，必须先审计引导链路是否引用。

## 0.5 不可违背的红线

1. **美术零压缩上云**：云端分发的美术保持产物原质量，禁止为省流量二次压缩。
2. **打码资产体系**：市场版只用 `dama/` 子目录的 `*_sticker.*` 打码版；原始未打码文件留在原位但**永不进包**（`asset-ship-filter.mjs` 自动排除）。
3. **P0 覆盖引导**：任何分层调整不得让新手引导链路出现网络等待。
4. **系统逻辑变更打包前必须告知产品确认**（见 0.3）。
5. **签名永不更换**（见后文「Android 签名」章）。
6. 每次发版递增 `android/app/build.gradle` 的 `versionCode`。

## 0.6 命令速查

| 场景 | 命令 |
|------|------|
| **测试/打包前三通道总检查（必跑）** | `npm run check:build` |
| **云端美术是否最新（不一致非零退出）** | `npm run assets:check-cloud` |
| **补齐云端美术（上传 + 回写 assetHash）** | `npm run assets:sync-cloud` |
| 打测试包（P0 瘦身，~450MB） | `npm run build:apk` |
| 打发售包（含云端一致性门禁） | `npm run build:apk:release` |
| 美术弱更发布 | `npm run assets:sync-cloud`（等价于 build-tex-ship → upload-tex-b2 → 改 assetHash 的合并命令） |
| 部署 Worker | `cd gateway && npx wrangler deploy` |
| 写发布配置（强更/弱更参数） | POST `/api/admin/release`（`x-admin-key`，含 `latestBuild`/`minBuild`/`assetHash`/`notes`） |

## 0.7 云端基础设施现状与迁移路径

- **现状**：Backblaze B2（私有桶 `rust-belt-assets`）+ Cloudflare Worker 代理
  （`license.youziligames.com/assets/tex/*`，Range 支持，资源边缘缓存 1h、清单不缓存）。
  免费，但国内速度仅 400KB/s~1MB/s。
- **迁移路径**（玩家量上来或发售前执行）：切国内 OSS 按量后付费（~0.5元/GB 流量，
  无预付），只改 Worker 回源地址，**客户端无感、无需重打包**；>5000 人再办 ICP 备案加 CDN（费用腰斩）。
- B2 凭证与备份：`gateway/.secrets.local.json`、`keybackup-xiudai-2026-10-18/`（均 gitignore）。

## 0.8 玩家端缓存生命周期（2026-10-25 起）

P1/P2 在玩家手机的缓存由 `src/platform/assetDownloader.ts` 三道机制保证一致（详细安全铁律见 `docs/apk-release-build.md` § 6.1）：

| 机制 | 作用 |
|------|------|
| **下载索引事务**（`withIndex`） | 并发 worker 索引读改写串行化，杜绝"下载 100% 但索引丢条目"导致的覆盖安装后全量重下 |
| **启动自愈**（`initAssetCache`） | 盘上有、索引无的成品按清单 size 采纳——换包/丢索引不重下 |
| **孤儿清理**（`pruneOrphanCacheFiles`） | 缓存里不在当前生效清单中的文件自动删除——**开发侧删资源经通道③发布后，玩家下次启动自动清理**；仅在版本门确认清单权威后触发，服务端不可达/清单拉取失败绝不清理 |

生命周期闭环：

```
开发侧新增/修改 P1/P2 → 通道③ sync-cloud → 玩家弱更自动下载
开发侧删除 P1/P2     → 通道③ sync-cloud → 玩家下次启动自动清理
```

---



## 硬性规定

1. **角色相关资源保持高品质（P1 保护区）**  
   - v3.1 收紧：仅对**运行时可达**的 juese/ 子树生效——
     `avatars/`、`combat-back/`、`emotion-poses/`、`pifu/`（含 6 个子目录）、顶层 `<Stem>.{png|webm|glb}`。
   - 非保护区资源（场景、UI、道具、分镜视频、战斗 FBX 等）可在打包时合理压缩。
   - **v3.1 硬规则**：任何 tex/ 资源，若 src/ 中没有任何静态路径模板能命中其相对路径（即运行时不可达），必须排除——不得进包。  
     判定由 `scripts/asset-ship-filter.mjs` 的 `no-runtime-reference` 兜底实现；模板清单见 `SRC_REF_PATTERNS`。
   - **v3.4**：`juese/**/*.mp4` 一律不进包（冲澡/帮洗/共浴等运行时只用透明 `.webm`；`.mp4` 为 H3/抠绿母带）。根目录仅保留 `pv_720p.mp4` / `beijing01.mp4` / `shop.mp4`。另排除 `beifen/`、`_h3_out/`、`_trim_qa/` 等作者目录。

2. **源文件永不覆盖**  
   - 唯一真源：`tex/`（及 `music/`）。  
   - 打包产物只写入：`tex-ship/` → 同步到 `dist/tex/`。  
   - **禁止**把优化结果写回 `tex/`。

3. **已优化产物不再二次优化**  
   - `tex-ship/.ship-cache.json` 按源文件 SHA1 + `SHIP_POLICY_VERSION` 命中则跳过重压。  
   - 仅当源文件变更、策略版本变更、或 `npm run assets:build-ship:force` 时才重编码。

4. **移动端打包必须走本流程**  
   - `npm run build` / `cap:sync` / `build:apk` / `build:apk:release` 均强制执行。  
   - 缺少合法 `tex-ship` 时 **直接失败**，禁止静默用未压缩源全量进包。
   - **P0 瘦身是唯一合法行为**：`vite.config.ts` 默认只拷 `tier=P0` 产物进 `dist/tex`；
     P1/P2 远端层走云端 CDN。全量拷贝需显式 `SHIP_FULL_TEX=1`（仅本地排障，release 包会直接拒绝）。
   - **双重体积闸门**：`build-apk.cjs` 在 gradle 前先校验 `dist/tex` 无 P1/P2 泄漏，
     gradle 后再校验产物 ≤ 700MB；任一不通过即中止且不拷贝产物到桌面。

5. **不得影响玩法逻辑**  
   - 仅改 `scripts/` 构建链路与 `tex-ship/` 产物；**禁止**为压缩而改 `src/` 资源路径或游戏系统逻辑。  
   - MP4 / FBX 等保持**原扩展名与原相对路径**，只替换文件内容。

---

## Android 签名与热更（强制 · 2026-10-18 起）

> 与美术流程同级别强制。**违反会导致所有玩家被迫卸载重装、存档全丢。**

### 为什么

Android 规定：**只有签名一致的 APK 才能覆盖安装**。签名一变，手机只能
「卸载重装」→ 应用私有目录被清空 → 存档丢失、热更永久失效。

历史事故：release 构建长期**未配置任何签名**，AGP 静默回退到
`android/app/debug.keystore`。该文件不入库、换机器就重新生成，
于是每台打包机产出的包签名都不同 → 线上「安装失败(-7) 与已安装应用签名不同」。

### 唯一合法签名

| 项 | 值 |
|---|---|
| keystore | `android/keystore/rust-belt-era.jks` |
| alias | `rustbelt` |
| 证书 SHA-256 | `A7AC65C2EE91698133034169C9A51F526D5045BE2C76468FFC60E6293E8AF240` |
| 离线备份 | 项目根 `keybackup-xiudai-2026-10-18/`（含密码，gitignore） |

**这把钥匙永不更换。** 换机器只搬运，不重建。

### 打包链路（已自动化，无需人工介入）

`npm run build:apk:release` 会自动完成：

1. `cloud:check`（云安全检查）+ `icons:apply`（图标）；
2. **`assets:check-cloud`：校验云端 B2 远端层美术与本地 `tex-ship` 一致**——
   不一致则**中止**（防止打出「新代码 + 旧云端美术」的错位包；修复用 `npm run assets:sync-cloud`）；
3. `cap:sync`：P0 瘦身打包（`dist/tex` 只含 P0）+ 资源门禁；
4. 校验 `android/key.properties` 存在，缺失则**中止构建**；
5. `key.properties` 指向的 keystore 参与签名；
6. 进包前校验 `dist/tex` 无 P1/P2 泄漏，gradle 后校验产物 ≤ 700MB；
7. 用 SDK `apksigner` 验签产物，SHA-256 与上表不符则**中止且不拷贝产物**；
8. 通过后才输出到桌面 `rust-belt-era-apk/rust-belt-era-release.apk`。

即：**只要带着同一把 keystore，无论在哪台电脑、哪个目录下打包，产物必然可覆盖安装。**

### 换电脑 / 换目录搬移步骤

```bash
# 1. 把 keystore 放回工程（路径固定）
#    <工程根>/android/keystore/rust-belt-era.jks
# 2. 重建本机密码配置（不会新建密钥）
npm run android:signing:init
# 3. 核对指纹
npm run android:signing:check
# 4. 正常打包
npm run build:apk:release
```

### 环境前置条件

| 项 | 要求 | 说明 |
|---|---|---|
| JDK | **21** | Capacitor/AGP 要求；`build-apk.cjs` 自动探测 Android Studio 自带 JBR |
| Android SDK | Platform 36 + Build-Tools | 首次打包自动生成 `android/local.properties`（**勿带 BOM**） |
| keystore | 必须携带 | 缺失即中止，不会静默产出换签名的包 |

### 红线

- 禁止删除 / 覆盖 / 重命名 `android/keystore/rust-belt-era.jks`。
- 禁止手工改 `EXPECTED_RELEASE_SHA256`（`scripts/build-apk.cjs`）。
- 禁止把 `*.jks`、`key.properties`、`keybackup-*/` 提交进 git。
- `debug` 包用另一把签名，**不能**发给玩家测覆盖安装。
- 每次发版递增 `android/app/build.gradle` 的 `versionCode`。

详见 `android/keystore/README.md`。

---

## 目录约定

| 路径 | 角色 |
|------|------|
| `tex/` | 源美术（只读进包视角） |
| `tex-ship/` | 本机生成的压缩进包集（可 gitignore） |
| `dist/tex/` | 最终进 Web / APK 的资源 |
| `tex-ship/ship-manifest.json` | `*.png`→`*.webp` 路径映射（运行时 `texUrl` 使用） |
| `scripts/lib/ui-edge-matte.mjs` | P2a：UI 灰底 edge-matte |
| `scripts/lib/ship-media.mjs` | P2c/d：视频转码、GLB meshopt |
| `scripts/assets-pipeline.config.mjs` | P2 质量档与角色保护区 |
| `scripts/build-tex-ship.mjs` | 生成 `tex-ship/` |
| `scripts/verify-ship-p2.mjs` | P2 质量抽检（UI 透明、角色保护） |

---

## 强制流水线

```
npm run build | npm run build:apk | npm run build:apk:release
        ↓
prebuild:
  1. ensure-ui-assets       （缺切片才生成到 tex/）
  2. build-tex-ship         （P0 过滤 + P2 优化；缓存命中则跳过）
  3. sync-tex-assets
  4. verify-ship-gate
  5. verify-ship-p2         （UI 透明 / 角色区保护抽检）
        ↓
tsc + vite build（dist/tex 只拷 P0）→ cap sync → assemble APK
        ↓
体积闸门（dist 无 P1/P2 泄漏 → 产物 ≤700MB）→ 签名验签 → 拷贝到桌面
```

`build:apk:release` 额外在 `cap:sync` 前插入 `assets:check-cloud`（云端美术一致性门禁）。

### 推荐命令

| 场景 | 命令 |
|------|------|
| 仅重建 ship（增量） | `npm run assets:build-ship` |
| 强制全量重压 | `npm run assets:build-ship:force` |
| 云端美术一致性检查 | `npm run assets:check-cloud` |
| 云端美术同步（上传 + 回写 hash） | `npm run assets:sync-cloud` |
| P2 抽检 | `node scripts/verify-ship-p2.mjs` |
| 跳过视频转码（排障） | `set SHIP_SKIP_VIDEO=1` |
| 跳过 GLB meshopt（排障） | `set SHIP_SKIP_GLB=1` |

---

## P2 优化规格（摘要）

**策略版本：** `2026-09-06-p2-mobile-v3.1-hq-e6-unref`（见 `assets-pipeline.config.mjs`）

### P0 排除（源保留，不进包）

- `*.mov`、未使用大视频（如 `pv01.mp4`）  
- `_candidates` / `_old_*` / `_qa*` / `_webm_out` / `_first*` / `_rekey` / `_pre_upscale` / `_likeness_test` / `_trim_qa` / `luoti_daiji` 等废稿目录  
- UI 切图母版 `UI01.png`、`Asset-xho8xde31z.png` 等  
- **v3.1 新增 AI 流水线中间件**（运行时无引用，参见 `.cursor/skills/` 下的生成管线）：  
  - `tex/juese/pifu/pifu_weizhi/**`（含 `webm_tentacle_loop/`、`tiaojiao/`、`_tent_*.json`）  
  - `tex/juese/pifu/shenghuoshizhuang01/new/**`  
  - `tex/juese/pifu/shenghuoshizhuang01/_key_qa/**`  
  - `tex/juese/pifu/shuiyi/pifu_weizhi/**`  
  - 任何 `**/greenscreen/**`、`**/chroma-key/**`、`**/luoti-pipeline/**`、`**/webm_tentacle_loop/**`  
- **v3.1 新增运行时无引用兜底**：上述排除之外，filter 会对所有 `juese/` 子树文件做模板匹配——
  不在 `SRC_REF_PATTERNS` 模板内的资源一律标 `no-runtime-reference` 排除。  
  模板来源：`src/data/characters.ts`、`src/data/characterSkins.ts`、`src/data/characterEmotionPoses.ts`、`src/ui/uiAssets.ts`、`src/ai/types.ts`、`src/ai/disciplinePoseNotes.ts`、`src/types.ts`。
- **成人向资产硬拦截**（市场版绝不打进 dist）：`juese/pifu/tiaojiao/**`、`juese/pifu/wuziqi/**`、
  `luoti` / `moan` 相关目录与文件名一律标 `adult-asset-blocked`。
  `wuziqi`（象棋主题皮）是 2026-10-22 归档的 H3 **失败稿**：画面无任何棋盘/棋子元素，
  且是裸身成人素材、未接入 `characterSkins.ts`、无 `dama/` 打码版 → 源保留在 `tex/`，
  不进包。详见 `docs/character-skins.md`「象棋主题皮 wuziqi」专章。

### P2a · UI 灰底抠图（sub-ui / wasteland-ui）

- **算法：** 四边 flood-fill，将外部 `#414140`（sub-ui）/ `#1a1a1a`（wasteland-ui）设为透明。  
- **时机：** `build-tex-ship` 编码 WebP 前（不写回 `tex/`）。  
- **效果：** 与 `btnSecondary` 一致——图标外灰底透明，可叠任意背景。

### P2b · 位图 WebP

| 类型 | 长边 | quality | 备注 |
|------|------|---------|------|
| **角色** emotion-poses | 1280 | 90 | `juese/**` 保护区 |
| **角色** 立绘/皮肤 | 1536 | 92 | 同上 |
| **角色** 头像 | 256 | 90 | 同上 |
| UI 图标/按钮 | 1024 | 84 | + edge-matte |
| UI 面板/顶栏 | 2048 | 86 | + edge-matte |
| 场景 Indoor / beijing / gallery / world | 2560 | 87 | v3：源图 ≤2736 基本直出，修复缩糊 |
| 战斗远景 / billboard | 2048 | 86 | v3：源图 1152×2048 不再缩放 |
| 海报 poster / game-poster | 1600 | 90 | v3：全屏海报提清晰度 |
| 道具 props | 1280 | 84 | |
| 其他默认 | 1920 | 85 | v3 |

### P2c · 非角色 MP4

- **范围：** `storyboards/*.mp4`、`beijing01.mp4`、`shop.mp4`、`pv_720p.mp4`  
- **参数：** H.264，最长边 1280，CRF 23，`+faststart`；环境视频去音轨，`pv_720p.mp4`、`shop.mp4` **保留 AAC 音轨**（商店开箱动画有声）  
- **工具：** 系统 `ffmpeg`（或 `FFMPEG_PATH`）  
- **角色区 `juese/**` 视频：原样拷贝**

### P2d · 3D

| 格式 | 处理 |
|------|------|
| `juese/*.glb` | **原样**（角色战斗模型） |
| 其他 `*.glb` | `@gltf-transform/cli optimize --compress meshopt`（可选，失败则拷贝） |
| `build/*.fbx`、`diren/*.fbx` | **原样**（Three.js FBXLoader 直读，不改格式） |

### 原样 passthrough

- 角色 `juese/**/*.webm`  
- 战斗语音 `tex/audio/**/*.wav`（路径硬编码，不改扩展名）  
- `music/`（独立目录）

---

## 换机 / CI 注意

1. `npm install`（需 `sharp`）。  
2. 视频转码需本机 `ffmpeg`；首次 GLB meshopt 可能需 `npx @gltf-transform/cli`。  
3. `tex-ship/` 可不提交；每次打包按源自动生成。  
4. 门禁失败：看 `verify-ship-gate` / `verify-ship-p2` 日志。

紧急绕过（**仅本地排障，禁止发布**）：

```bash
set ALLOW_TEX_FALLBACK=1
set SHIP_SKIP_VIDEO=1
```

---

## tex ↔ tex-ship 同步守卫（美术改源必读）

`tex/` 是美术源资产，**随时会被修改**。本项目存在两条互不相通的取资源路径：

| 场景 | 实际读取 | 是否经过 ship |
| --- | --- | --- |
| `npm run dev`（vite 中间件） | **`tex/` 源目录** | 否 |
| `npm run build`（`closeBundle`） | `tex-ship/` → `dist/tex` | 是 |

所以「改了 `tex/` 但没重跑 ship」会让 `tex-ship` **静默漂移**：开发预览正常，出包内容却是旧的；
若新资源有问题，还可能把空图/坏立绘固化进 `dist`。

### 自动守卫：`ensure-tex-sync.mjs`

已接入 npm 生命周期，**无需手工记忆**：

| 命令 | 前置钩子 | 行为 |
| --- | --- | --- |
| `npm run dev` / `live` / `dev:mobile` | `predev` | 启动前保证三方一致 |
| `npm run build` / `cap:sync` / `build:apk` | `prebuild` | 出包前强制闸门 + 门禁校验 |
| `npm run tex:sync` | — | 手工同步（等价于上面的守卫） |
| `npm run tex:sync:force` | — | 无条件全量重建 |
| `npm run tex:check` | — | 只检查，不同步则**非零退出**（CI 用） |

工作方式：

1. 先算**指纹**——只 `stat` 不读内容，口径与 `build-tex-ship` 完全一致（同样应用 `shouldSkipTexShip`，
   因此 `_candidates/`、`beifen/`、母带等不参与）。1780 个文件约 **0.5 秒**。
2. 指纹与上次成功同步的记录（`tex-ship/.tex-sync-stamp.json`）一致 → **秒级跳过**。
3. 不一致才真正执行 `build-tex-ship` + `sync-tex-assets`；两者本身已有 sha1 增量缓存，
   未改动的资源不会二次编码（实测约 38s，主要是 4.7GB 源文件的哈希开销）。
4. 同步前后各算一次指纹，若 `tex/` 在同步过程中又被改动则**直接失败**，要求停手重试，
   避免把半新半旧的状态写进缓存记录。

### 触发重同步的情形

- 任何进包资源的**新增 / 修改 / 删除**（内容或时间戳变化）
- `tex-ship/ship-manifest.json` 或 `dist/tex/ship-manifest.json` 缺失
- `dist/tex` 比 `tex-ship/` 旧
- `tex-ship/.tex-sync-stamp.json` 丢失（首次运行即属此类）

### 同步前的硬拦截

守卫与 `build-tex-ship` 都**拒绝处理 0 字节源资产**，并直接点名真实文件：

```
[ensure-tex-sync] 1 zero-byte source file(s) in tex/: juese/avatars/heartforge.png
  -> real content is likely juese/avatars/heartforge(1).png, restore it manually first
[ensure-tex-sync] FAIL: zero-byte source assets: rebuilding cannot fix these, fix tex/ first
```

> 云盘同步 / 中断拷贝常留下「`X.ext` 为空、`X(1).ext` 才是真身」的组合。
> 源为空时**重跑多少次 ship 都修不好**（复制空文件还是空），必须先手工回填。

`verify-ship-gate.mjs` 另有一道产物侧闸门：对 `tex-ship/` 与 `dist/tex/` **全目录递归扫描**
0 字节文件（不只看 manifest 的 `map`——`webm`/`glb` 走 passthrough 根本不在 `map` 里），
并同样体检 `tex/` 源资产。

### 手工全流程（排障用）

```bash
npm run tex:sync:force   # 忽略指纹，强制重建
npm run assets:verify    # 只跑门禁
```

---

## 变更流程

- 减弱优化、换平台：先改本文档 → `assets-pipeline.config.mjs` → 升 `SHIP_POLICY_VERSION` → `assets:build-ship:force`。  
- **未经文档与版本号更新，不得弱化门禁。**
