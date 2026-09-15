import type { ChapterDef } from '../types';
import { combatParamsForTier } from '../game/combatBalance';

export const CHAPTERS_PER_STAGE = 12;

export const CHAPTERS: ChapterDef[] = [
  { id: 1, name: '零号月台', desc: '教程与基础战斗', theme: 'station' },
  { id: 2, name: '锈带走廊', desc: '数字门与沙尘机械', theme: 'corridor' },
  { id: 3, name: '白棺谷', desc: '冰冻废墟与护盾机兵', theme: 'frost' },
  { id: 4, name: '熔炉城废墟', desc: '高血量工业敌人', theme: 'forge' },
  { id: 5, name: '星核禁区', desc: '终局混合波次', theme: 'core' },
];

/** @deprecated 使用 recommendedTcpForTier；保留给旧引用 */
export function recommendedTcp(n: number): number {
  const chapter = Math.ceil(n / CHAPTERS_PER_STAGE);
  const chapterIndex = ((n - 1) % CHAPTERS_PER_STAGE) + 1;
  const tier = (chapter - 1) * 12 + chapterIndex;
  return 95 + 28 * tier + Math.floor(Math.pow(tier, 1.25) * 2.8);
}

export function firstClearGold(tier: number, hell = false): number {
  const base = 40 + 10 * tier + Math.floor(tier / 5) * 25;
  return hell ? Math.floor(base * 2.2) : base;
}

export function sweepGold(tier: number, hell = false): number {
  const base = Math.floor(firstClearGold(tier, false) * 0.55);
  return hell ? Math.floor(base * 2.0) : base;
}

export function stageType(chapterIndex: number): 'normal' | 'door' | 'barrel' | 'boss' {
  if (chapterIndex === CHAPTERS_PER_STAGE) return 'boss';
  if (chapterIndex % 7 === 0) return 'boss';
  if (chapterIndex === 4) return 'door';
  if (chapterIndex === 8) return 'barrel';
  return 'normal';
}

const STAGE_PREFIXES = [
  '侦察',
  '推进',
  '协同',
  '门选',
  '压制',
  '清扫',
  '决战',
  '打桶',
  '渗透',
  '压制',
  '突袭',
  'Boss',
] as const;

export function stageName(chapter: number, chapterIndex: number, hell = false): string {
  const prefix = STAGE_PREFIXES[chapterIndex - 1] ?? `节点-${chapterIndex}`;
  const chapterName = CHAPTERS[chapter - 1]?.name ?? `第${chapter}章`;
  const modeLabel = hell ? '地狱' : '';
  return `${chapterName}${modeLabel ? `·${modeLabel}` : ''} · ${prefix}-${chapterIndex}`;
}

/** 统一委托 combatBalance 的唯一数值源（旧实现曾在此漂移出第二份曲线） */
export function combatParams(tier: number, hell = false) {
  return combatParamsForTier(tier, hell);
}
