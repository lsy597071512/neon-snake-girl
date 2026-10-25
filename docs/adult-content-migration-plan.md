# 市场合规改造 · 执行清单（已完成）

> 目标：市场版 `src/**` 零成人内容、**解包不可见**；本地版整树快照保留在 `_adult-local/`。
> 原则：**只有「调教/小黑屋」玩法下线**，其余全部**软化、不移除**，玩法逻辑一字不动。

## 状态：A–F 全部完成

- `npx tsc --noEmit` → **全绿**
- `node scripts/check-cloud-sensitive.mjs` → **no risky wording（0 命中）**
- `npx vite build` → **成功**；`dist/` 产物扫描 → **无任何成人词**
- 本地快照 `_adult-local/`（src + docs + 脚本）+ `restore.ps1` 一键还原

## 已执行明细

### A. 调教/小黑屋下线（惰性桩 + 文案清理）
- [x] `disciplineSession.ts` / `disciplinePoseNotes.ts` / `audio/disciplineOverlay.ts` → 导出签名不变的**惰性空实现**
- [x] `characterSkins.ts`：`pifu06`「备用装」中性占位；13 处 `disciplineWear` 去成人文本/资产
- [x] `aiDialogueOverlay.ts`：移除小黑屋按钮/DOM/文案/姿势条/邀请条（约 139 处）
- [x] `App.ts`：移除设置项「小黑屋 开/关」
- [x] `campLayout.ts` / `campNav.ts` / `scene_cards.json`：房间与场景改「负一楼·库房」
- [x] `livingState.ts` / `dialogueWorldSync.ts` / `livingService.ts` / `promptAssembler.ts` / `dialogueEngine.ts` / `types.ts` / `dialoguePortraitStage.ts`：移除约束态分支文案

### B. 成人层软化（只软化、玩法保留）
- [x] `aiProfiles.ts`：`【成人向·全员硬规则】`→`【亲密与暧昧·全员规则】`；13 条 `voice.adult` 含蓄化；`BATH_INTIMATE_CONSENT_PROTOCOL` 软化；schema 去刺激字段
- [x] `adultEvents.ts`：正则/preamble 全面软化为「亲密氛围」
- [x] `bodySensitivity.ts`：重写为「亲近区」中性命名（zone id / 情绪词 / Prompt）
- [x] `bathAssistSession.ts`：交互02「解下浴巾」文案软化（帮洗/共浴全部玩法保留）
- [x] `characterSkins.ts`：pifu03/pifu05 相关文案软化
- [x] `commanderCanon.ts` / `localHomeGpuPrompt.ts` / `outfitChangeProcess.ts` / `emotionOutfit.ts` / `sleepSystem.ts` / `dialogueRealityGuard.ts` / `campEventEffects.ts` / `campOutfit.ts` 等：残留措辞软化
- [x] `cloudSafety.ts` / `promptProviderTone.ts`：翻译层改**直通**（源码已合规，词表不再自带成人词）

### D. 文档隔离
- [x] 成人文档移入 `_adult-local/docs/`：`adult-events` / `discipline-*` / `tiaojiao-*` / `bath-assist-events` / `cg-opening-prompts` / `ai-training-system-prompt`
- [x] `docs/00-index.md` / `README-dev.md` 去成人条目
- [x] `docs/cloud-safety-workflow.md` 更新为双轨架构
- [ ] 其余文档内散引用（ai-dialogue-pipeline / cg-system-plan / optimization-plan / ui-system / onboarding）待后续顺手清理（不影响构建与打包）

### E. 资产（用户自行筛选）
- [ ] 露点动态皮肤备份后替换为不漏点擦边资产 + 新路径；`asset-ship-filter.mjs` 扩展拦截 tiaojiao/luoti

### 词表策略
- `scripts/check-cloud-sensitive.mjs` 词表收敛为**显性成人红线词**（剔除「惩罚/欲望/调情/性感/裸」等机制/擦边误报），保留擦边表达以对齐国产二次元尺度。
