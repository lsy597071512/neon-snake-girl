/**
 * Phase E：玩法后果——战斗/礼物/任务/军械/商店写入状态、人设与人生目标。
 */
import { CHARACTER_MAP } from '../data/characters';
import type { SaveData } from '../types';
import {
  evolvePersonaAfterCombat,
  evolvePersonaAfterGift,
  evolvePersonaAfterPromise,
} from './characterPersona';
import { applyMoodImpulse } from './moodContinuum';
import { progressLifeGoal } from './lifeGoals';
import { pushCampLog, pushMemory } from './memory';
import type { AiLivingSave, CharacterAgenda, LightStatusTag } from './types';

function addStatus(
  living: AiLivingSave,
  characterId: string,
  tag: LightStatusTag,
  alsoRemove: LightStatusTag[] = [],
): void {
  const cur = new Set(living.characterStatus[characterId] ?? []);
  for (const r of alsoRemove) cur.delete(r);
  cur.add(tag);
  living.characterStatus[characterId] = [...cur].slice(0, 4) as LightStatusTag[];
}

/** 战斗回营后果（状态 + 人设 + 人生目标）。由 recordCombatReturn 调用。 */
export function applyCombatConsequences(
  living: AiLivingSave,
  opts: {
    victory: boolean;
    stageName: string;
    chapter?: number;
    kills?: number;
    squadIds: string[];
  },
): void {
  const { victory, stageName, chapter, kills = 0, squadIds } = opts;
  for (const cid of squadIds) {
    if (victory) {
      addStatus(living, cid, 'inspired', ['injured', 'anxiety_state', 'fear_state']);
      if (kills >= 12) addStatus(living, cid, 'calm');
      evolvePersonaAfterCombat(living, cid, true);
      applyMoodImpulse(living, cid, { kind: 'combat', victory: true });
      // 击破加成并入同一次推进，避免 combat_chapter + combat_any 双计
      const killBonus = kills >= 8 ? Math.min(12, Math.floor(kills / 2)) : 0;
      progressLifeGoal(living, cid, {
        kind: chapter != null ? 'combat_chapter' : 'combat_any',
        amount: (chapter != null ? 42 : 28) + killBonus,
        chapter,
        note: `清扫「${stageName}」胜利${kills ? `·击破约${kills}` : ''}`,
      });
    } else {
      addStatus(living, cid, 'fatigue');
      addStatus(living, cid, kills > 0 ? 'injured' : 'anxiety_state');
      evolvePersonaAfterCombat(living, cid, false);
      applyMoodImpulse(living, cid, { kind: 'combat', victory: false });
      progressLifeGoal(living, cid, {
        kind: 'combat_any',
        amount: 10,
        chapter,
        note: `从「${stageName}」撤归`,
      });
      // 败退也惦记休息目标
      progressLifeGoal(living, cid, {
        kind: 'rest',
        amount: 18,
        note: '想回营歇一口气',
      });
    }
  }
}

/** 礼物后果 */
export function applyGiftConsequences(
  living: AiLivingSave,
  characterId: string,
  tier: 0 | 1 | 2,
): void {
  evolvePersonaAfterGift(living, characterId, tier);
  applyMoodImpulse(living, characterId, { kind: 'gift', tier });
  addStatus(living, characterId, 'affection', ['jealousy']);
  if (tier >= 1) addStatus(living, characterId, 'calm');
  progressLifeGoal(living, characterId, {
    kind: 'gift_bond',
    amount: 22 + tier * 14,
    note: `收到档 ${tier + 1} 礼物`,
  });
}

/** 指挥官任务办完 */
export function applyPlayerTaskComplete(
  living: AiLivingSave,
  characterId: string,
  agenda: CharacterAgenda,
): void {
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const brief = agenda.reason || agenda.goal;
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${name}办完了指挥官交代的事：${brief}`,
    importance: 7,
  });
  pushCampLog(living, {
    text: `${name}办完了交代的事`,
    source: 'npc',
    characterIds: [characterId],
  });
  evolvePersonaAfterPromise(living, characterId, true);
  applyMoodImpulse(living, characterId, { kind: 'promise', kept: true });
  addStatus(living, characterId, 'inspired', ['anxiety_state']);
  progressLifeGoal(living, characterId, {
    kind: 'promise',
    amount: 45,
    note: brief.slice(0, 40),
  });
  if (/商店|商城/.test(`${agenda.targetRoomId} ${brief}`)) {
    progressLifeGoal(living, characterId, { kind: 'shop', amount: 20, note: '跑腿顺到商店' });
  }
  if (/武器|军械|armory/.test(`${agenda.targetRoomId} ${brief}`)) {
    progressLifeGoal(living, characterId, { kind: 'armory', amount: 20, note: '跑腿顺到武器库' });
  }
}

/** 食言 / 任务被打断 */
export function applyPlayerTaskBroken(
  living: AiLivingSave,
  characterId: string,
  agenda: CharacterAgenda,
  why: string,
): void {
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const brief = agenda.reason || agenda.goal;
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${name}没能办完指挥官交代的事（${why}）：${brief}`,
    importance: 7,
  });
  pushCampLog(living, {
    text: `${name}搁下了交代的事（${why}）`,
    source: 'system',
    characterIds: [characterId],
  });
  evolvePersonaAfterPromise(living, characterId, false);
  addStatus(living, characterId, 'anxiety_state');
  progressLifeGoal(living, characterId, {
    kind: 'promise',
    amount: 8,
    note: `食言阴影：${why}`,
  });
}

/** 军械箱 / 武器包：与在场或开箱角色联动叙事 */
export function recordArmoryGameplay(
  save: SaveData,
  living: AiLivingSave,
  opts: {
    characterId: string;
    lines: string[];
    kind: 'box' | 'pack' | 'upgrade';
  },
): void {
  const name = CHARACTER_MAP[opts.characterId]?.name ?? opts.characterId;
  const sample = opts.lines.slice(0, 2).join('；') || '新武装';
  const label =
    opts.kind === 'box' ? '开军械箱' : opts.kind === 'pack' ? '买武器包' : '升级军械箱';
  pushMemory(living, opts.characterId, {
    kind: 'event',
    summary: `${name}见证指挥官${label}：${sample}`,
    importance: 6,
  });
  progressLifeGoal(living, opts.characterId, {
    kind: 'armory',
    amount: opts.kind === 'upgrade' ? 35 : 22,
    note: label,
  });
  // 旁观：当天在武器库附近的同伴也听说
  const peers = save.ownedCharacters
    .map((o) => o.characterId)
    .filter((id) => id !== opts.characterId)
    .slice(0, 4);
  for (const pid of peers) {
    const ag = living.agendas?.[pid];
    if (ag?.targetRoomId === 'room_1f_armory' || /armory|武器/.test(ag?.goal ?? '')) {
      const pn = CHARACTER_MAP[pid]?.name ?? pid;
      pushMemory(living, pid, {
        kind: 'event',
        summary: `${pn}在武器库听见军械箱响：指挥官在${label}。`,
        importance: 5,
      });
      progressLifeGoal(living, pid, { kind: 'armory', amount: 10, note: '旁听开箱' });
    }
  }
  pushCampLog(living, {
    text: `武器库：指挥官${label}`,
    source: 'player',
    characterIds: [opts.characterId],
  });
}

/** 锈币大额消费 / 皮肤购买叙事钩子 */
export function recordShopOrSkinSpend(
  living: AiLivingSave,
  characterId: string,
  opts: { gold: number; label: string; kind: 'shop' | 'skin' },
): void {
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${name}记下指挥官花了 ${opts.gold} 锈币：${opts.label}`,
    importance: opts.kind === 'skin' ? 7 : 5,
  });
  progressLifeGoal(living, characterId, {
    kind: opts.kind,
    amount: opts.kind === 'skin' ? 40 : 18,
    note: opts.label,
  });
}
