# 本地成人版 / 市场合规版 双轨工作流

> **架构变更（2026-10）**：从「运行时云端翻译」升级为「**市场版本地合规 + 本地版整树快照**」。
> 原因：发行硬约束要求**打包后的 APK 解包不可见任何成人内容**，运行时翻译无法满足（成人字符串仍进 bundle）。

## 1. 两套版本

| 版本 | 位置 | 说明 |
| --- | --- | --- |
| **市场合规版** | `src/**`、`docs/**` | 唯一参与打包的源码。**零成人内容**；擦边内容保留但已软化；调教/约束玩法已下线。 |
| **本地成人版** | `_adult-local/**`（已 `.gitignore`） | 改造前**整树快照**（`src/` + `docs/` + 成人脚本）。只在本地保存，不打包、不推送。 |

- 市场版打包：`npm run build:apk`（只含 `dist/`，由 `src/` + `public/` 构建）。
- 本地版还原：`powershell -ExecutionPolicy Bypass -File _adult-local/restore.ps1`（整树覆盖回 `src/` + `docs/`）。

## 2. 调教/约束玩法（小黑屋）

- **市场版**：功能完全下线。`src/ai/disciplineSession.ts`、`disciplinePoseNotes.ts`、`audio/disciplineOverlay.ts` 仅保留导出签名的**惰性空实现**，无成人文本、无行为、无皮肤；UI 入口不出现。
- **本地版**：完整实现在 `_adult-local/`，还原后照旧运行。

## 3. 浴室 / 成人事件层 / 机油 / 敏感点 / 色诱

- **只软化、不移除**，全部玩法保留（帮洗/共浴/交互流程/邀请/约会逻辑不变）。
- 露骨文案改为含蓄擦边（调笑、心跳、留白），删除露骨生理描写。

## 4. 打包前门禁

```bash
npm run cloud:check     # 扫描 src/ai src/data src/ui 的敏感词，市场版必须为 0
npm run build:apk
```

- 市场版 `cloud:check` 必须 **0 命中**，否则不许打包。
- `scripts/check-cloud-sensitive.mjs` 的词表 = 市场版合规红线。

## 5. 资源

- 露点皮肤/动态资产由人工筛选替换为**不漏点擦边资产 + 新路径**（见 `docs/character-skins.md` 与迁移计划）。
- 成人音频（如约束房间 BGM）不进入市场版打包。

## 6. 文档隔离

- 成人向文档（`discipline-*.md`、`adult-events.md`、`bath-assist-events.md`、`tiaojiao-*.md`、`discipline-moan-pipeline.md` 等）只保留在 `_adult-local/docs/`。
- 市场 `docs/` 只保留合规文档（本文件、迁移计划、以及各系统文档的合规版本）。

## 7. 每次修改流程

1. 需要成人内容时：用 `restore.ps1` 还原到本地版开发。
2. 需要发行时：确保 `src/**` 为市场合规版，跑 `cloud:check` 为 0，再打包。
3. 市场版新增任何文本，先跑 `cloud:check`。
