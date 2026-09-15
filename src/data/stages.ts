import type { SaveData, StageDef } from '../types';
import {
  CHAPTERS,
  CHAPTERS_PER_STAGE,
  combatParams,
  firstClearGold,
  stageName,
  stageType,
  sweepGold,
} from './chapters';
import {
  globalTier,
  hellStageId,
  isRaidBossIndex,
  normalStageId,
  raidBossHp,
  recommendedTcpForTier,
  RAID_BOSS_DURATION_SEC,
  squadSlotsForStageDef,
} from '../game/combatBalance';

function buildStage(
  id: number,
  chapter: number,
  chapterIndex: number,
  mode: StageDef['mode'],
): StageDef {
  const tier = globalTier(chapter, chapterIndex);
  const hell = mode === 'hell';
  const raidBoss = isRaidBossIndex(chapterIndex);
  const chapterBoss = chapterIndex === CHAPTERS_PER_STAGE;
  const params = combatParams(tier, hell);
  const type = stageType(chapterIndex);
  const bossBonus = chapterBoss ? 150 : raidBoss ? 80 : 0;
  const raidHp = raidBoss ? raidBossHp(tier, hell) : undefined;

  return {
    id,
    chapter,
    chapterIndex,
    name: stageName(chapter, chapterIndex, hell),
    recommendedTcp: recommendedTcpForTier(tier, { chapterBoss, hell }),
    isBoss: raidBoss || chapterBoss,
    type,
    mode,
    combatMode: raidBoss ? 'raidBoss' : 'wave',
    tier,
    firstClearGold: firstClearGold(tier, hell) + bossBonus,
    sweepGold: sweepGold(tier, hell),
    timer: raidBoss ? RAID_BOSS_DURATION_SEC : params.timer,
    waves: raidBoss ? 1 : params.waves,
    enemyHp: params.enemyHp,
    enemyDamage: params.enemyDamage,
    raidBossHp: raidHp,
  };
}

export const STAGES: StageDef[] = [];

for (let chapter = 1; chapter <= CHAPTERS.length; chapter++) {
  for (let chapterIndex = 1; chapterIndex <= CHAPTERS_PER_STAGE; chapterIndex++) {
    STAGES.push(buildStage(normalStageId(chapter, chapterIndex), chapter, chapterIndex, 'normal'));
    STAGES.push(buildStage(hellStageId(chapter, chapterIndex), chapter, chapterIndex, 'hell'));
  }
}

export const STAGE_MAP = Object.fromEntries(STAGES.map((s) => [s.id, s]));

export { CHAPTERS };

export const ECONOMY = {
  startGold: 800,
  startTickets: 3,
  singlePullGold: 900,
  tenPullGold: 8000,
  manualWinRatio: 0.82,
  bossManualRatio: 0.88,
};

export const STARTER = {
  characters: [
    { characterId: 'ashcrow', weaponId: 'w01' },
    /** 芹奈空枪：引导开箱 + 装备教学 */
    { characterId: 'heartforge', weaponId: null as string | null },
  ],
  /** 空编队：看板显示指挥官，由老板娘引导点名澪 */
  squad: [] as string[],
  ownedWeaponIds: ['w01'] as string[],
  bonusTickets: [{ stage: 3, amount: 1 }, { stage: 12, amount: 2 }],
};

export function squadSlotsForStage(stageId: number, save?: SaveData): number {
  const stage = STAGE_MAP[stageId];
  if (!stage) {
    if (stageId <= 1) return 1;
    if (stageId <= 2) return 2;
    return 3;
  }
  return squadSlotsForStageDef(stage, save);
}
