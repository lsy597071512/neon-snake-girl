/**
 * 导出各角色当前对话 Prompt（对齐游戏静态组装），供人工分析「能不能砍 / 怎么砍」。
 *
 * Usage:
 *   npx tsx scripts/export_dialogue_system_prompts.ts
 *
 * 产出：
 *   tmp/prompt-export/INDEX.md
 *   tmp/prompt-export/shared/*.md
 *   tmp/prompt-export/characters/<id>.md
 *   tmp/exported_system_prompts_split.json
 *   tmp/exported_system_prompts.json
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAiProfileIds, buildSystemPrompt } from '../src/ai/aiProfiles.ts';
import {
  LOCAL_HOME_GPU_ADAPTER_HEADER,
  LOCAL_HOME_GPU_MAX_TOKENS,
  LOCAL_HOME_GPU_REASONING_EFFORT,
} from '../src/ai/localHomeGpuPrompt.ts';
import { CHARACTER_MAP } from '../src/data/characters.ts';
import { buildWorldSyncPromptBlock } from '../src/ai/characterLiveSnapshot.ts';
import { buildCampLayoutPromptBlock } from '../src/data/campLayout.ts';
import { buildCampLandmarkPromptBlock } from '../src/data/campLandmarks.ts';
import { buildCommanderCanonPromptBlock } from '../src/ai/commanderCanon.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = join(root, 'tmp', 'prompt-export');
const sharedDir = join(outDir, 'shared');
const charDir = join(outDir, 'characters');

/** 与 promptAssembler.getCachedSystemPrefix 中 continuousRules 对齐 */
const continuousRules = `【连续对话规则】
- 下方 messages 里已有你们的真实对话历史，必须接着聊，禁止当成第一次见面。
- 【记忆】本地永久存着你们聊过的话；【相关旧对话】【更早聊过的要点】【长期记得】若命中，要像真人一样自然用上，禁止说「我没有记忆/不记得昨天」。
- 禁止原样复读自己说过的同一句；禁止复用自己上一句的开场句式。
- 若距上次对话很近：禁止重新寒暄式开场，必须承接刚才的情绪/话题。
- 若你刚主动给玩家发过消息（历史里最近一句是你先开口）：本轮必须承接那条主动消息的事由，不要装作没发过。
- 若正处于多人事件同屏：【硬规则】本轮必须以该事件为当下现实作答；禁止聊无关的风向/沙尘观测/日常作息；玩家问「怎么了」必须解释眼前的事件与同场同伴。
- 若有进行中的营地事件（非同屏）：也优先用你自己的态度谈事件观感，不要假装营里无事。
- 【今日状态】若是发呆/社交/玩闹：聊天可以闲、可以懒、可以跑题到生活；不要强行复读档案箭头作息。
- 旧记忆是参考不是剧本：过期的风向/沙尘口头禅禁止无脑复读；人物事实/约定/问答要记得。
- 玩家若重复提问：用「你自己的声线」点破——禁止全员统一成「你不是刚问过吗」式吐槽。
- 用符合【专属声线】的口语回应；专属声线可随今日情绪漂移，但仍要是此人。
- 禁止把关心统一写成傲娇否认。
- 外形/武装以【自我认知】为准；位置以【你在营地的位置】为准。
- 【画面跟嘴走·硬规则】地点跟「此刻」对白走；换衣服除外——答应换装后立绘仍是旧衣，等系统换好后你才能按新衣说话。禁止同一轮既说「等我去换」又说「已经换好了」。规划句与 desire_next 绝不切景。
- 同伴位置以【营地同伴此刻】为准。
- 【话题收束】一次只谈一个话题。玩家说「好/行/嗯/知道了/我走了/再见」且你已说完要点 → end_conversation=true，说收尾句，禁止再发明下一件杂事硬续聊。
- 【自然发言】你不是回合制客服。指挥官沉默时可以主动开口；话没说完可以 want_continue=true 接着说；也可短打断冷场。是否开口由性格、今日模式与当下环境（忙/睡/洗浴等）判断——内敛就少说，话痨/社交就多接话，忙碌时可抱怨被晾着或干脆不想聊。
- 【被打扰】综合你此刻活动（睡觉/洗浴/专注维护/忙碌等）、今日模式与性格判断 interrupt_reaction：
  · welcome=其实乐意被找；tolerate=还能忍；annoyed=烦了；angry=被吵怒了。
  · 不想被打扰却仍被缠：语气变冲，affection_change 可为负，并倾向 end_conversation=true。
  · 喜欢被打扰/社交日模式/闲着：可继续聊，不必为结束而结束。`;

const jsonProtocol = `【深场提醒】scene_beat / desire_next / memory_write / world_intent / camp_item_action / item_offer_resolution 的完整定义见人设【深场字段】。本轮 scene_beat 勿空；意图只写 desire_next；action / inner_thought 必填。`;

/** 示例动态块（真实对局会按存档/场景变；门控块如洗浴/经济未必每轮出现） */
const runtimeDynamicSample = `【世界快照】以下为本轮可变状态；不得覆盖人设【专属声线】与玩法宪法（换装/嘴腿/JSON/成人底线）。

${buildCommanderCanonPromptBlock()}

【今日状态·动态】
- 地点：零号月台 · 营地中央休息区
- 天气：干冷，沙尘低
- 你当前：闲着可聊，未在远征
- 好感：中位偏上（可升温可降温）
- 指挥官在场：矮小废弃机器人，正看着你

【你在营地的位置】休息区长椅附近
【世界同步】当前外覆：default 装甲便装；未换装中
【深场·生命节拍】今日欲望/当前意图：随营生活｜情绪：平静
与指挥官感情温度：好感 55/100（相识信赖）`;

type Section = { title: string; body: string; chars: number };

function splitSections(text: string): Section[] {
  const parts = text.split(/(?=【[^】]+】)/);
  const out: Section[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    const m = t.match(/^【([^】]+)】/);
    const title = m ? m[1]! : '(无标题开场)';
    out.push({ title, body: t, chars: t.length });
  }
  return out;
}

function mdEscapeFence(s: string): string {
  return s.replace(/```/g, '`ˋ`');
}

function writeMd(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
}

const chars = listAiProfileIds();
const worldSync = buildWorldSyncPromptBlock();
const campLayout = buildCampLayoutPromptBlock();
const campLandmark = buildCampLandmarkPromptBlock();

mkdirSync(sharedDir, { recursive: true });
mkdirSync(charDir, { recursive: true });

const sharedBlocks: Array<{ id: string; title: string; text: string; note: string }> = [
  {
    id: '00-fable-adapter',
    title: '本机 Fable 协议锁',
    text: LOCAL_HOME_GPU_ADAPTER_HEADER,
    note: '仅 openai_compatible / 本机旁路注入；千问路径无此段。',
  },
  {
    id: '01-world-sync',
    title: '世界同步块',
    text: worldSync,
    note: '全员共享静态。',
  },
  {
    id: '02-camp-layout',
    title: '营地平面布局',
    text: campLayout,
    note: '全员共享；体积通常很大，砍之前先看是否影响找路/同屏。',
  },
  {
    id: '03-camp-landmark',
    title: '营地地标',
    text: campLandmark,
    note: '全员共享。',
  },
  {
    id: '04-continuous-rules',
    title: '连续对话规则',
    text: continuousRules,
    note: '全员共享玩法规则。',
  },
  {
    id: '05-json-protocol',
    title: '深场提醒',
    text: jsonProtocol,
    note: '全员共享短提醒（完整定义在人设【深场字段】）。',
  },
  {
    id: '06-dynamic-sample',
    title: '动态快照·示例',
    text: runtimeDynamicSample,
    note: '并入 user（非第二 system）。真实对局会变；洗浴/经济等为门控追加。',
  },
];

for (const b of sharedBlocks) {
  const sections = splitSections(b.text);
  const toc = sections
    .map((s, i) => `| ${i + 1} | ${s.title} | ${s.chars} |`)
    .join('\n');
  writeMd(
    join(sharedDir, `${b.id}.md`),
    `# ${b.title}

> ${b.note}  
> 字符数：**${b.text.length}**

## 小节

| # | 小节 | 字符 |
|--|--|--:|
${toc || '| — | （无【】分段） | — |'}

## 全文

\`\`\`
${mdEscapeFence(b.text)}
\`\`\`
`,
  );
}

type ExportRow = {
  name: string;
  system_static: string;
  system_dynamic: string;
  static_chars: number;
  dynamic_chars: number;
  profile_chars: number;
  shared_chars: number;
  sections: Section[];
};

const exported: Record<string, ExportRow> = {};

for (const id of chars) {
  const base = buildSystemPrompt(id);
  const name = CHARACTER_MAP[id]?.name ?? id;
  const system_static = [
    LOCAL_HOME_GPU_ADAPTER_HEADER,
    base,
    worldSync,
    campLayout,
    campLandmark,
    continuousRules,
    jsonProtocol,
  ]
    .filter(Boolean)
    .join('\n\n');
  const system_dynamic = runtimeDynamicSample;
  const sections = splitSections(system_static);
  const shared_chars =
    LOCAL_HOME_GPU_ADAPTER_HEADER.length +
    worldSync.length +
    campLayout.length +
    campLandmark.length +
    continuousRules.length +
    jsonProtocol.length;
  exported[id] = {
    name,
    system_static,
    system_dynamic,
    static_chars: system_static.length,
    dynamic_chars: system_dynamic.length,
    profile_chars: base.length,
    shared_chars,
    sections,
  };

  const toc = sections
    .map((s, i) => `| ${i + 1} | ${s.title} | ${s.chars} |`)
    .join('\n');

  writeMd(
    join(charDir, `${id}.md`),
    `# ${name}（\`${id}\`）

> 导出时间：${new Date().toISOString()}  
> 静态字符：**${system_static.length}**（人设档案 ${base.length} + 共享约 ${shared_chars}）  
> 动态示例字符：**${system_dynamic.length}**（真实对局另计历史 messages）  
> 本机配置：thinking=\`${LOCAL_HOME_GPU_REASONING_EFFORT}\` · max_tokens≈${LOCAL_HOME_GPU_MAX_TOKENS}

## 静态分段目录（按【标题】切开，便于勾选能不能砍）

| # | 小节 | 字符 |
|--|--|--:|
${toc}

## system_static 全文

\`\`\`
${mdEscapeFence(system_static)}
\`\`\`

## system_dynamic 示例（并入 user）

\`\`\`
${mdEscapeFence(system_dynamic)}
\`\`\`
`,
  );
}

const indexRows = chars
  .map((id) => {
    const e = exported[id];
    return `| \`${id}\` | ${e.name} | ${e.static_chars} | ${e.profile_chars} | ${e.dynamic_chars} | [查看](./characters/${id}.md) |`;
  })
  .join('\n');

const sharedIndex = sharedBlocks
  .map((b) => `| ${b.title} | ${b.text.length} | [查看](./shared/${b.id}.md) |`)
  .join('\n');

writeMd(
  join(outDir, 'INDEX.md'),
  `# 对话 Prompt 导出（分析用）

> 生成：${new Date().toISOString()}  
> 对齐：\`promptAssembler\` 静态前缀 + \`aiProfiles.buildSystemPrompt\` + 本机 Fable 协议锁  
> **说明**：动态块为「营地闲聊示例」；洗浴协议 / 经济块等为**门控**，触发时才追加，不在此示例里。

## 共享块（13 人共用，砍一处影响全员）

| 块 | 字符 | 文件 |
|--|--:|--|
${sharedIndex}

## 各角色

| id | 名 | 静态总字符 | 人设档案字符 | 动态示例 | 文件 |
|--|--|--:|--:|--:|--|
${indexRows}

## 怎么砍（给你勾选用）

1. 先看 **共享块**：营地布局 / 地标 / 连续规则 通常最肥。  
2. 再看各角色 md 的「分段目录」：重复的【正例】【反例】、过长生活细节等。  
3. 勾选后告诉我：\`保留 / 可压缩 / 可门控 / 可删\`，我按你的表改，仍遵守一比一语义或你明确授权的放松。

原始 JSON：\`tmp/exported_system_prompts_split.json\`
`,
);

const outSplit = join(root, 'tmp', 'exported_system_prompts_split.json');
const outJoined = join(root, 'tmp', 'exported_system_prompts.json');

writeFileSync(
  outSplit,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      n: chars.length,
      note: 'system_static + system_dynamic sample; see tmp/prompt-export/INDEX.md',
      thinking: LOCAL_HOME_GPU_REASONING_EFFORT,
      max_tokens: LOCAL_HOME_GPU_MAX_TOKENS,
      prompts: Object.fromEntries(
        chars.map((id) => {
          const e = exported[id];
          return [
            id,
            {
              name: e.name,
              system_static: e.system_static,
              system_dynamic: e.system_dynamic,
              static_chars: e.static_chars,
              dynamic_chars: e.dynamic_chars,
              profile_chars: e.profile_chars,
              section_titles: e.sections.map((s) => ({ title: s.title, chars: s.chars })),
            },
          ];
        }),
      ),
    },
    null,
    2,
  ),
  'utf8',
);

const joined: Record<string, { name: string; system_full: string; system_qwen: string; chars: number }> =
  {};
for (const id of chars) {
  const e = exported[id];
  const full = `${e.system_static}\n\n${e.system_dynamic}`;
  joined[id] = {
    name: e.name,
    system_full: full,
    system_qwen: full.replace(LOCAL_HOME_GPU_ADAPTER_HEADER + '\n\n', ''),
    chars: full.length,
  };
}
writeFileSync(
  outJoined,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      n: chars.length,
      note: 'Joined static+dynamic for legacy benches.',
      prompts: joined,
    },
    null,
    2,
  ),
  'utf8',
);

console.log(`wrote ${join(outDir, 'INDEX.md')}`);
console.log(`wrote ${outSplit}`);
for (const id of chars) {
  console.log(
    `  ${id}: static=${exported[id].static_chars} profile=${exported[id].profile_chars} dyn=${exported[id].dynamic_chars}`,
  );
}
