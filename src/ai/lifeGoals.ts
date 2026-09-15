/**
 * Phase E：中期人生目标——玩法推进可见，不只是数值。
 */
import { CHAPTERS } from '../data/chapters';
import { CHARACTER_MAP } from '../data/characters';
import { getAiProfile } from './aiProfiles';
import { pushMemory } from './memory';
import type { AiLivingSave, LifeGoalState } from './types';

export type LifeGoalKind = LifeGoalState['kind'];
export type { LifeGoalState };

function hash01(characterId: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < characterId.length; i++) h = (h * 31 + characterId.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function ensureMap(living: AiLivingSave): Record<string, LifeGoalState> {
  if (!living.lifeGoals) living.lifeGoals = {};
  return living.lifeGoals;
}

function pickLifeGoal(characterId: string, living: AiLivingSave): LifeGoalState {
  const profile = getAiProfile(characterId);
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const salt = living.dayIndex * 91 + living.gameMinutes;
  const roll = hash01(characterId, salt);
  const needs = (profile?.coreNeeds ?? []).join(' ');
  const fears = (profile?.fears ?? []).join(' ');

  type Cand = { kind: LifeGoalKind; text: string; meta?: number; w: number };
  const cands: Cand[] = [];

  const chapter = 1 + Math.floor(hash01(characterId, salt + 3) * CHAPTERS.length);
  const chName = CHAPTERS[chapter - 1]?.name ?? '锈带';
  cands.push({
    kind: 'combat_chapter',
    text: `想跟指挥官再闯一趟「${chName}」，把那股味道从装甲缝里洗掉`,
    meta: chapter,
    w: /战|守|护|路|清扫/.test(needs) ? 28 : 16,
  });
  cands.push({
    kind: 'gift_bond',
    text: `想让指挥官再记得送自己一件合心意的小东西（不是任务奖励）`,
    w: /陪伴|热|共情|喜欢/.test(needs) ? 26 : 14,
  });
  cands.push({
    kind: 'armory',
    text: `想把武器库点检做扎实，让军械箱再为小队吐出靠谱的东西`,
    w: /武|械|责任|巡/.test(needs) ? 24 : 12,
  });
  cands.push({
    kind: 'shop',
    text: `想去商店把缺货的修装件补齐，别再让营里将就`,
    w: /物资|修|缺/.test(needs) || /缺|断/.test(fears) ? 22 : 12,
  });
  cands.push({
    kind: 'skin',
    text: `想被指挥官认真对待自己的外覆（买下或让自己正大光明地穿上）`,
    w: 10 + (roll > 0.7 ? 8 : 0),
  });
  cands.push({
    kind: 'promise',
    text: `想把答应指挥官的一件小事真正办完，而不是说说就算`,
    w: 14 + (profile?.fears?.length ? 4 : 0),
  });
  cands.push({
    kind: 'rest',
    text: `想在营里真正歇一口气——泳池或星夜睡衣都好，别一直绷着`,
    w: /沙|风|暴|伤/.test(fears) ? 20 : 10,
  });

  // 加权抽
  const total = cands.reduce((s, c) => s + c.w, 0);
  let r = roll * total;
  let chosen = cands[0]!;
  for (const c of cands) {
    r -= c.w;
    if (r <= 0) {
      chosen = c;
      break;
    }
  }

  return {
    id: `${characterId}-${living.dayIndex}-${chosen.kind}-${Math.floor(salt % 997)}`,
    text: `${name}：${chosen.text}`,
    kind: chosen.kind,
    meta: chosen.meta,
    progress: 0,
    target: 100,
    daySeed: living.dayIndex,
  };
}

/** 获取或生成当前人生目标（完成后立即滚下一条） */
export function ensureLifeGoal(living: AiLivingSave, characterId: string): LifeGoalState {
  const map = ensureMap(living);
  let g = map[characterId];
  if (!g || (g.completedAtGameMin != null && g.progress >= g.target)) {
    g = pickLifeGoal(characterId, living);
    map[characterId] = g;
  }
  return g;
}

export function describeLifeGoalForPrompt(
  living: AiLivingSave,
  characterId: string,
): string {
  const g = ensureLifeGoal(living, characterId);
  const pct = Math.min(100, Math.round((g.progress / g.target) * 100));
  return `【人生目标·中期】${g.text}（进度 ${pct}%）——可在对白里自然惦记，勿做成任务清单播报。`;
}

export function lifeGoalProgressLine(
  living: AiLivingSave,
  characterId: string,
): string {
  const g = ensureLifeGoal(living, characterId);
  return `${g.text}（${Math.min(100, Math.round((g.progress / g.target) * 100))}%）`;
}

type ProgressOpts = {
  kind: LifeGoalKind | 'combat_any';
  amount: number;
  /** combat 时传入章节 */
  chapter?: number;
  note?: string;
};

/**
 * 推进人生目标；达成时写高重要度记忆并刷新下一条。
 * @returns 是否刚完成一条
 */
export function progressLifeGoal(
  living: AiLivingSave,
  characterId: string,
  opts: ProgressOpts,
): boolean {
  const g = ensureLifeGoal(living, characterId);
  let hit = false;

  if (opts.kind === 'combat_any') {
    hit = g.kind === 'combat_chapter';
  } else if (opts.kind === 'combat_chapter') {
    hit =
      g.kind === 'combat_chapter' &&
      (g.meta == null || opts.chapter == null || g.meta === opts.chapter);
  } else {
    hit = g.kind === opts.kind;
  }

  // 不匹配时给极少「活着」感，但不抢主线
  const add = hit ? opts.amount : Math.max(1, Math.floor(opts.amount * 0.12));
  g.progress = Math.min(g.target, g.progress + add);

  if (g.progress < g.target) return false;

  g.completedAtGameMin = living.gameMinutes;
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${name}推进完人生目标：「${g.text}」${opts.note ? `（${opts.note}）` : ''}`,
    importance: 8,
  });
  // 立刻滚下一条，避免卡在完成态
  ensureMap(living)[characterId] = pickLifeGoal(characterId, living);
  return true;
}
