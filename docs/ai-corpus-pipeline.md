# Rust Belt · 场景/角色卡语料流水线

新美术入库后，按此流程写入 Prompt 可用的结构化卡，让文本 LLM「看见」世界。

> **对话 Provider / 千问主路径 vs Violet 测试旁路** 见强制规范：[`ai-dialogue-pipeline.md`](./ai-dialogue-pipeline.md) §0。

## 场景图

1. 放入 `tex/`（营地）或 `tex/Indoor/`（室内），拼音命名。
2. 在 [`src/data/lore/scene_cards.json`](../src/data/lore/scene_cards.json) 增加条目，必填：
   - `id` / `label` / `kind` / `image`
   - `atmosphere`（1–2 句氛围）
   - `sensory[]` / `dialogueHints[]` / `interactables[]`
3. 可用代码草稿：`draftSceneFromFilename()`（`src/ai/corpusPipeline.ts`），再人工润色。
4. 校验：`validateSceneCard(draft)` 无错误后再提交。

## 角色图

1. 立绘/头像进既有 `tex/juese/` 流程。
2. 更新 [`src/data/lore/ai_profiles.json`](../src/data/lore/ai_profiles.json) 的 `sensoryAnchors` / `speechStyle` 等。
3. 可选：用 `draftCharacterCard(id, imageRefs, notes)` 记视觉备注，供日后视觉模型打标。

## 与游戏的关系

- 营地时段图由 `WorldClock` 自动切换，不必改 hub 视频。
- 室内漫游顺序见 `INDOOR_ROAM_ORDER`。
- 远征归来会写入营地日志与角色记忆（`recordCombatReturn`）。
