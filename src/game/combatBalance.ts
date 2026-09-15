import type { StageDef, SaveData } from '../types';

/** 战斗内义体健康上限（与营地义体一致） */
export const COMBAT_HEALTH_MAX = 100;

/** 雷电式 BOSS 限时（秒） */
export const RAID_BOSS_DURATION_SEC = 20;

/** 地狱模式伤害倍率 */
export const HELL_DAMAGE_MUL = 2;

/** 地狱模式敌人数量倍率 */
export const HELL_ENEMY_COUNT_MUL = 1.4;

/** 地狱模式敌人逼近 / 卷轴倍率 */
export const HELL_APPROACH_MUL = 1.2;
export const HELL_SCROLL_MUL = 1.1;

export function globalTier(chapter: number, chapterIndex: number): number {
  return (chapter - 1) * 12 + chapterIndex;
}

/** 每 7 关为一关雷电式悬空 BOSS（7、14、21…） */
export function isRaidBossIndex(chapterIndex: number): boolean {
  return chapterIndex > 0 && chapterIndex % 7 === 0;
}

export function recommendedTcpForTier(tier: number, opts?: { chapterBoss?: boolean; hell?: boolean }): number {
  const base = 95 + 22 * tier + Math.floor(Math.pow(tier, 1.22) * 2.4);
  let tcp = base;
  if (opts?.chapterBoss) tcp = Math.floor(tcp * 1.12);
  if (opts?.hell) tcp = Math.floor(tcp * 1.42);
  return tcp;
}

export function combatParamsForTier(tier: number, hell = false) {
  const hellMul = hell ? 1.35 : 1;
  const hellDmgMul = hell ? 1.25 : 1;
  return {
    timer: Math.max(55, 88 - Math.floor(tier / 8) * 2),
    waves: Math.min(hell ? 9 : 8, 3 + Math.floor(tier / 12) + (hell ? 1 : 0)),
    // v2 曲线：以「推荐 TCP 弹伤 ≈ tcp/8×1.4」为基准，TTK 从 ~2 发抬到 3.5~5 发
    enemyHp: Math.floor((38 + tier * 10 + Math.floor(tier * tier * 0.22)) * hellMul),
    enemyDamage: Math.floor((5 + Math.floor(tier / 4) * 2) * hellDmgMul),
  };
}

/** 波内敌数（与 Combat3D.spawnWave 对齐） */
export function waveEnemyCount(
  wave: number,
  tier: number,
  squadSize: number,
  hell = false,
): number {
  const base = 4 + wave + Math.floor(tier / 10);
  let count = base;
  if (squadSize >= 3) count = Math.ceil(base * 0.85);
  else if (squadSize === 2) count = Math.ceil(base * 0.92);
  if (hell) count = Math.ceil(count * HELL_ENEMY_COUNT_MUL);
  return Math.max(2, count);
}

/** 雷电 BOSS 血量：推荐 TCP 下约 15–18 秒击杀 */
export function raidBossHp(tier: number, hell = false): number {
  const tcp = recommendedTcpForTier(tier, { hell });
  const mul = hell ? 6.8 : 4.4;
  return Math.max(800, Math.floor(tcp * mul));
}

/**
 * 普通关小怪被命中扣血；雷电 BOSS 弹幕命中扣血（地狱再 ×2）。
 * 碰撞伤害随章节递增：义体上限 100，前期 1/次、第五章 4/次，让漏怪真正有威胁。
 */
export function combatHitDamage(stage: StageDef, kind: 'grunt' | 'raidBoss'): number {
  const base =
    kind === 'raidBoss'
      ? 2 + Math.floor(Math.min(48, stage.tier) / 24)
      : 1 + Math.floor(Math.min(45, stage.tier) / 15);
  const mul = stage.mode === 'hell' ? HELL_DAMAGE_MUL : 1;
  return base * mul;
}

export function squadSlotsForStageDef(stage: StageDef, save?: SaveData): number {
  if (stage.mode === 'hell') return 3;
  if (stage.chapter === 1) {
    if (stage.chapterIndex === 1) return 1;
    if (stage.chapterIndex === 2) return 2;
    return 3;
  }
  const cleared = save?.clearedStages ?? [];
  const tutorialDone = cleared.includes(3) || cleared.some((id) => id > 3);
  return tutorialDone ? 3 : 2;
}

export function isChapterHellUnlocked(chapter: number, clearedStages: number[]): boolean {
  const endId = chapter * 12;
  for (let i = endId - 11; i <= endId; i++) {
    if (!clearedStages.includes(i)) return false;
  }
  return true;
}

export function hellStageId(chapter: number, chapterIndex: number): number {
  return 60 + (chapter - 1) * 12 + chapterIndex;
}

export function normalStageId(chapter: number, chapterIndex: number): number {
  return (chapter - 1) * 12 + chapterIndex;
}
