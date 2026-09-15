/**
 * 结构化事实表：承诺/称呼/约定/偏好 — 每轮强注入 Prompt，独立于自由文本记忆。
 */
import type { AiLivingSave } from './types';
import { pushCampLog, pushMemory } from './memory';

export type StructuredFactKind =
  | 'promise'
  | 'nickname'
  | 'preference'
  | 'agreement'
  | 'identity'
  | 'milestone';

export type StructuredFact = {
  id: string;
  kind: StructuredFactKind;
  /** 短中文事实句，给模型直接用 */
  text: string;
  createdGameMin: number;
  dayIndex: number;
  source: 'memory_write' | 'dialogue' | 'gift' | 'arc' | 'system';
  importance: number;
};

const MAX_FACTS_PER_CHAR = 28;

function uid(): string {
  return `sf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function ensureFacts(living: AiLivingSave, characterId: string): StructuredFact[] {
  if (!living.structuredFacts) living.structuredFacts = {};
  if (!Array.isArray(living.structuredFacts[characterId])) {
    living.structuredFacts[characterId] = [];
  }
  return living.structuredFacts[characterId]!;
}

function trimFacts(list: StructuredFact[]): StructuredFact[] {
  return [...list]
    .sort((a, b) => b.importance - a.importance || b.createdGameMin - a.createdGameMin)
    .slice(0, MAX_FACTS_PER_CHAR);
}

export function listStructuredFacts(
  living: AiLivingSave,
  characterId: string,
): StructuredFact[] {
  return [...(living.structuredFacts?.[characterId] ?? [])].sort(
    (a, b) => b.importance - a.importance || b.createdGameMin - a.createdGameMin,
  );
}

/** 去重写入；极似文本则升 importance */
export function upsertStructuredFact(
  living: AiLivingSave,
  characterId: string,
  input: {
    kind: StructuredFactKind;
    text: string;
    source: StructuredFact['source'];
    importance?: number;
  },
): StructuredFact | null {
  const text = input.text.trim().slice(0, 80);
  if (!text || text.length < 2) return null;

  const list = ensureFacts(living, characterId);
  const norm = text.replace(/\s+/g, '');
  const existing = list.find((f) => f.text.replace(/\s+/g, '') === norm || f.text.includes(text.slice(0, 12)));
  if (existing) {
    existing.importance = Math.max(existing.importance, input.importance ?? existing.importance);
    existing.kind = input.kind;
    living.structuredFacts![characterId] = trimFacts(list);
    return existing;
  }

  const fact: StructuredFact = {
    id: uid(),
    kind: input.kind,
    text,
    createdGameMin: living.gameMinutes | 0,
    dayIndex: living.dayIndex | 0,
    source: input.source,
    importance: input.importance ?? 7,
  };
  list.push(fact);
  living.structuredFacts![characterId] = trimFacts(list);
  return fact;
}

const KIND_LABEL: Record<StructuredFactKind, string> = {
  promise: '承诺',
  nickname: '称呼',
  preference: '偏好',
  agreement: '约定',
  identity: '身份',
  milestone: '里程碑',
};

export function buildStructuredFactsPromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const facts = listStructuredFacts(living, characterId).slice(0, 16);
  if (!facts.length) {
    return `【结构化事实表】暂无硬事实。若本轮产生约定/专属称呼/重要承诺，必须填 memory_write 记下一句。`;
  }
  const lines = facts.map(
    (f) => `- [${KIND_LABEL[f.kind]}] ${f.text}`,
  );
  return `【结构化事实表·强制遵守】（比闲聊记忆更硬；禁止否认、禁止装忘）
${lines.join('\n')}
- 谈及相关话题时必须像真人记得一样自然用上；不可说「我没有记忆」。`;
}

/** 从 memory_write / 对白粗提取事实种类 */
export function classifyFactText(text: string): StructuredFactKind {
  const t = text.trim();
  if (/叫我|称呼|以后叫|喊我|名字是|我叫/.test(t)) return 'nickname';
  if (/喜欢|讨厌|害怕|受不了|偏好|最爱|不吃/.test(t)) return 'preference';
  if (/答应|保证|一定|不会再|约定|一言为定|记好|承诺/.test(t)) return 'promise';
  if (/规则|协议|只能|不准|以后都|我们说好/.test(t)) return 'agreement';
  if (/第一次|告白|牵手|吵架|和解|出征前|里程碑/.test(t)) return 'milestone';
  return 'identity';
}

/**
 * 对话回合后：把 memory_write 与明显约定句写入事实表。
 */
export function ingestFactsFromDialogueTurn(
  living: AiLivingSave,
  characterId: string,
  opts: {
    playerMessage: string;
    dialogue: string;
    memoryWrite?: string;
  },
): void {
  if (opts.memoryWrite?.trim()) {
    const kind = classifyFactText(opts.memoryWrite);
    upsertStructuredFact(living, characterId, {
      kind,
      text: opts.memoryWrite.trim(),
      source: 'memory_write',
      importance: kind === 'promise' || kind === 'nickname' ? 9 : 7,
    });
  }

  const blob = `${opts.playerMessage} ${opts.dialogue}`;
  // 玩家起的称呼
  const nick = opts.playerMessage.match(
    /(?:叫我|称呼我|喊我)\s*[「「"']?([\u4e00-\u9fffA-Za-z]{1,8})/,
  );
  if (nick?.[1]) {
    upsertStructuredFact(living, characterId, {
      kind: 'nickname',
      text: `指挥官希望被称作「${nick[1]}」`,
      source: 'dialogue',
      importance: 9,
    });
  }

  if (/答应|保证|说好了|一言为定|不会忘|记得/.test(blob) && /约|事|来|陪|等/.test(blob)) {
    const line = (opts.memoryWrite || opts.dialogue || opts.playerMessage).trim().slice(0, 60);
    if (line.length >= 4) {
      upsertStructuredFact(living, characterId, {
        kind: 'promise',
        text: line,
        source: 'dialogue',
        importance: 8,
      });
    }
  }
}

/** 弧线跨越时写入里程碑事实 + 记忆 */
export function recordArcTransitionFact(
  living: AiLivingSave,
  characterId: string,
  fromLabel: string,
  toLabel: string,
  nextAffinity: number,
): void {
  const text = `与指挥官关系从「${fromLabel}」进入「${toLabel}」（好感 ${nextAffinity}）`;
  upsertStructuredFact(living, characterId, {
    kind: 'milestone',
    text,
    source: 'arc',
    importance: 10,
  });
  pushMemory(living, characterId, {
    kind: 'talk',
    summary: text,
    importance: 8,
  });
  pushCampLog(living, {
    source: 'system',
    text: `羁绊：${text}`,
    characterIds: [characterId],
  });
}

/** 送礼等高价值事件 */
export function recordGiftBondFact(
  living: AiLivingSave,
  characterId: string,
  giftName: string,
): void {
  upsertStructuredFact(living, characterId, {
    kind: 'milestone',
    text: `指挥官送过「${giftName}」`,
    source: 'gift',
    importance: 7,
  });
}
