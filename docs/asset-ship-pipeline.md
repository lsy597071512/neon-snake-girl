# 美术进包标准流程（强制）

> **状态：现行强制标准（2026-09-06 · P2 v3.1）**  
> 适用于：**所有机器**上的 Web 打包与 **Android / Capacitor 移动端打包**。  
> 若要换平台或减弱优化，须产品明确通知后再改本文件与脚本。

---

## 硬性规定

1. **角色相关资源保持高品质（P1 保护区）**  
   - v3.1 收紧：仅对**运行时可达**的 juese/ 子树生效——
     `avatars/`、`combat-back/`、`emotion-poses/`、`pifu/`（含 6 个子目录）、顶层 `<Stem>.{png|webm|glb}`。
   - 非保护区资源（场景、UI、道具、分镜视频、战斗 FBX 等）可在打包时合理压缩。
   - **v3.1 硬规则**：任何 tex/ 资源，若 src/ 中没有任何静态路径模板能命中其相对路径（即运行时不可达），必须排除——不得进包。  
     判定由 `scripts/asset-ship-filter.mjs` 的 `no-runtime-reference` 兜底实现；模板清单见 `SRC_REF_PATTERNS`。

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

5. **不得影响玩法逻辑**  
   - 仅改 `scripts/` 构建链路与 `tex-ship/` 产物；**禁止**为压缩而改 `src/` 资源路径或游戏系统逻辑。  
   - MP4 / FBX 等保持**原扩展名与原相对路径**，只替换文件内容。

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
tsc + vite build → cap sync → assemble APK
```

### 推荐命令

| 场景 | 命令 |
|------|------|
| 仅重建 ship（增量） | `npm run assets:build-ship` |
| 强制全量重压 | `npm run assets:build-ship:force` |
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

## 变更流程

- 减弱优化、换平台：先改本文档 → `assets-pipeline.config.mjs` → 升 `SHIP_POLICY_VERSION` → `assets:build-ship:force`。  
- **未经文档与版本号更新，不得弱化门禁。**
