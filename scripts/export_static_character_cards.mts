/**
 * 从游戏源码一比一导出 13 人完整静态角色卡（Markdown）。
 *
 * 数据源：
 * - characters.ts
 * - lore/ai_profiles.json
 * - sr-bios / ssr-ur-bios (characterLore)
 * - aiProfiles VOICE_BY_ID + buildSystemPrompt
 * - characterSkins + disciplinePoseNotes
 * - relationshipArc
 * - commanderCanon / violetLotusPrompt
 * - characterVoices（TTS 基线）
 *
 * Usage:
 *   npx tsx scripts/export_static_character_cards.mts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CHARACTERS } from '../src/data/characters.ts';
import { getCharacterLore } from '../src/data/characterLore.ts';
import { getCharacterSkins, getSkinSecondaryClipCount } from '../src/data/characterSkins.ts';
import {
  buildSystemPrompt,
  COMMANDER_BOND_RULES,
  getAiProfile,
  getVoiceCard,
  listAiProfileIds,
} from '../src/ai/aiProfiles.ts';
import {
  buildCommanderCanonPromptBlock,
} from '../src/ai/commanderCanon.ts';
import {
  VIOLET_ADAPTER_HEADER,
  VIOLET_WORLD_ANCHOR,
} from '../src/ai/violetLotusPrompt.ts';
import {
  DISCIPLINE_POSE_NOTES,
  getDisciplinePoseCount,
  getDisciplinePoseNote,
} from '../src/ai/disciplinePoseNotes.ts';
import { RELATIONSHIP_ARC_STAGES } from '../src/ai/relationshipArc.ts';
import { getCharacterVoiceProfile } from '../src/ai/voice/characterVoices.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'docs', 'violet-lotus', 'static-cards');

const ORDER = [
  'ashcrow',
  'heartforge',
  'mirror',
  'neoncoil',
  'prismrift',
  'wireguard',
  'frostline',
  'pulse',
  'dustblade',
  'ironrain',
  'skyshard',
  'stellar',
  'outercore',
] as const;

function mdEscapeList(items: string[] | undefined): string {
  if (!items?.length) return '（无）';
  return items.map((x) => `- ${x}`).join('\n');
}

function buildSharedPreamble(): string {
  const arcs = RELATIONSHIP_ARC_STAGES.map(
    (s) =>
      `- **${s.id}**（好感≥${s.minAffinity} · ${s.labelZh}）\n  - 称呼：${s.addressHint}\n  - 话题：${s.topicFreedom}\n  - 约束：${s.constraint}`,
  ).join('\n');

  return `# 锈带纪元 · 13 人静态角色卡（共用前言）

> **生成方式**：\`npx tsx scripts/export_static_character_cards.mts\`  
> **原则**：字段一律来自游戏源码，与运行时 AI 一致；不含「本轮」场景/记忆/好感数值（那些由 promptAssembler 动态注入）。

## 0. 使用说明

每张角色卡 = **本前言（世界观/指挥官/全员规则）** + **该角色专属文件**。  
喂给 Violet-Lotus / LoRA 时：先放前言，再放对应角色卡，再拼运行时用户消息。

## 1. Violet 适配锁（英文底模型）

${VIOLET_ADAPTER_HEADER}

## 2. 世界观短锚

${VIOLET_WORLD_ANCHOR}

## 3. 指挥官·本体设定

${buildCommanderCanonPromptBlock()}

## 4. 指挥官羁绊·全员硬规则

${COMMANDER_BOND_RULES}

## 5. 关系弧（好感 0–100）

${arcs}

## 6. 皮肤 ID 语义（全员）

| id | 名称 | 用途 |
|----|------|------|
| （空/default） | 默认装甲 | 出征/日常默认 |
| pifu01 | 泳池 | 泳池派对等 |
| pifu02 | 睡衣 | 睡眠/休憩 |
| pifu03 | 蒸汽毛巾 | 仅洗浴 |
| pifu04 | 都市私服 | 活动/派对/好心情 |
| pifu05 | 特殊服装01 | 角色主动调情展示 |
| pifu06 | 调教约束 | 仅小黑屋 |

- \`skin_change\` = 开始去换（立绘未立刻变）
- \`skin_clip\` = 当前这套的互动条 1..N，禁止跨套
- 小黑屋禁止用 pifu05 代替约束皮

## 7. 调教 idle 说明（全员）

${getDisciplinePoseNote('ashcrow', null)}

---

各角色专属卡见同目录 \`NN-id-name.md\`。
`;
}

function buildCharacterCard(characterId: string): string {
  const def = CHARACTERS.find((c) => c.id === characterId);
  if (!def) throw new Error(`missing character ${characterId}`);
  const profile = getAiProfile(characterId);
  const lore = getCharacterLore(characterId);
  const voice = getVoiceCard(characterId);
  const skins = getCharacterSkins(characterId);
  const tts = getCharacterVoiceProfile(characterId);
  const runtimeSystem = buildSystemPrompt(characterId);
  const poseCount = getDisciplinePoseCount(characterId);
  const poseTable = DISCIPLINE_POSE_NOTES[characterId] ?? {};

  const skinLines = skins.length
    ? skins
        .map((s) => {
          const clips = getSkinSecondaryClipCount(characterId, s.id);
          return [
            `### ${s.id} · ${s.name}`,
            `- 价格字段：${s.price}（营地穿搭不依赖购买）`,
            `- 互动动态条数 skin_clip：${clips}`,
            `- AI 外观句：${s.aiLookNote || '（无 aiLookNote）'}`,
            s.preview ? `- preview：\`${s.preview}\`` : '',
            s.portraitLive ? `- portraitLive：\`${s.portraitLive}\`` : '',
          ]
            .filter(Boolean)
            .join('\n');
        })
        .join('\n\n')
    : '（无配置皮肤表）';

  const poseLines =
    poseCount > 0
      ? Array.from({ length: poseCount }, (_, i) => {
          const n = i + 1;
          return `- **姿势 ${n}**：${poseTable[n] ?? getDisciplinePoseNote(characterId, n)}`;
        }).join('\n')
      : '- （无调教二次动态条；回落通用句）';

  return `# 静态角色卡 · ${def.name}（\`${characterId}\`）

> 与游戏一比一：\`characters.ts\` + \`ai_profiles.json\` + \`sr-bios\`/\`ssr-ur-bios\` + \`VOICE_BY_ID\` + skins + disciplinePoseNotes  
> 生成：export_static_character_cards.mts

## A. 基础表（characters.ts）

| 字段 | 值 |
|------|-----|
| id | ${def.id} |
| name | ${def.name} |
| rarity | ${def.rarity} |
| basePower | ${def.basePower} |
| icon | ${def.icon} |
| tag | ${def.tag} |
| age | ${def.age} |
| height | ${def.height} |
| measurements | ${def.measurements} |
| personality | ${def.personality} |
| giftPreference | ${def.giftPreference} |
| skillName | ${def.skillName ?? '（无）'} |
| skillDesc | ${def.skillDesc ?? '（无）'} |
| skillId | ${def.skillId ?? '（无）'} |
| portraitFront | \`${def.portraitFront}\` |
| portraitLive | \`${def.portraitLive}\` |
| combatModel | \`${def.combatModel ?? ''}\` |

### 图鉴短 bio

${def.bio}

## B. AI Profile（ai_profiles.json）

${
  profile
    ? `
- **summary**：${profile.summary}
- **homeBase**：${profile.homeBase}
- **knownLocations**：
${mdEscapeList(profile.knownLocations)}
- **dailyRoutine**：${profile.dailyRoutine}
- **emotionalBaseline**：${profile.emotionalBaseline}
- **coreNeeds**：
${mdEscapeList(profile.coreNeeds)}
- **fears**：
${mdEscapeList(profile.fears)}
- **speechStyle**：${profile.speechStyle}
- **relationshipNotes**：${profile.relationshipNotes}
- **secrets**：${profile.secrets}
- **sensoryAnchors**：
${mdEscapeList(profile.sensoryAnchors)}
`
    : '（无 profile）'
}

## C. 详细档案（characterLore / bios）

${
  lore
    ? `
- **homeRegion**：${lore.homeRegion}
- **speechStyle**：${lore.speechStyle}
- **dailyRhythm**：${lore.dailyRhythm}
- **emotionalBaseline**：${lore.emotionalBaseline}
- **coreNeeds**：
${mdEscapeList(lore.coreNeeds)}

### detailedBio（全文）

${lore.detailedBio}
`
    : '（无 lore）'
}

## D. 专属声线卡（VOICE_BY_ID · 运行时强制）

| 项 | 内容 |
|----|------|
| voice | ${voice.voice} |
| affection | ${voice.affection} |
| affMin ~ affMax | ${voice.affMin} ~ ${voice.affMax} |
| flavor | ${voice.flavor} |
| good（正例） | ${voice.good} |
| bad（反例） | ${voice.bad} |
| forbid | ${voice.forbid} |
| adult | ${voice.adult} |

## E. TTS 声线基线（characterVoices）

${
  tts
    ? `- voice：${tts.voice}
- voiceLabel：${tts.voiceLabel ?? ''}
- instruction：${tts.instruction ?? ''}
- emotionGain：${tts.emotionGain ?? ''}
- base prosody：${JSON.stringify(tts.base ?? {})}`
    : '（无）'
}

## F. 皮肤与外观（characterSkins）

${skinLines}

## G. 小黑屋调教姿势（disciplinePoseNotes）

- idle：${getDisciplinePoseNote(characterId, null)}
- secondary 条数：${poseCount}

${poseLines}

## H. 运行时压缩 System Prompt（buildSystemPrompt 原文）

以下与游戏对话 system 层 B **逐字一致**（Violet 路径会再前置适配锁，见共用前言）：

\`\`\`
${runtimeSystem}
\`\`\`

## I. 身份锁死摘要（给评测用一句话）

你是「${def.name}」本人（id=${characterId}），不是另外 12 人。语气指纹：${voice.flavor}。禁止统一傲娇模板。
`;
}

function main(): void {
  mkdirSync(OUT_DIR, { recursive: true });
  const ids = listAiProfileIds();
  for (const id of ORDER) {
    if (!ids.includes(id)) {
      console.warn(`warn: ${id} missing from ai_profiles`);
    }
  }

  writeFileSync(join(OUT_DIR, '00-SHARED-PREAMBLE.md'), buildSharedPreamble(), 'utf8');

  const indexLines = [
    '# 13 人完整静态卡索引',
    '',
    '先读 [`00-SHARED-PREAMBLE.md`](./00-SHARED-PREAMBLE.md)，再读对应角色卡。',
    '',
    '| # | id | 文件 |',
    '|---|----|------|',
  ];

  ORDER.forEach((id, i) => {
    const def = CHARACTERS.find((c) => c.id === id)!;
    const num = String(i + 1).padStart(2, '0');
    const file = `${num}-${id}-${def.name.replace(/·/g, '')}.md`;
    writeFileSync(join(OUT_DIR, file), buildCharacterCard(id), 'utf8');
    indexLines.push(`| ${i + 1} | \`${id}\` | [${file}](./${file}) |`);
    console.log('wrote', file);
  });

  indexLines.push(
    '',
    '## 重新生成',
    '',
    '```bash',
    'npx tsx scripts/export_static_character_cards.mts',
    '```',
    '',
  );
  writeFileSync(join(OUT_DIR, 'README.md'), indexLines.join('\n'), 'utf8');
  console.log('done →', OUT_DIR);
}

main();
