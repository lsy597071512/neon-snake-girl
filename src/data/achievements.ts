import type { AchievementDef } from '../types';

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'chapter1',
    name: '初出锈带',
    desc: '通关第 1 章（关 8）',
    check: (s) => s.highestStage >= 8,
    rewardGold: 300,
    rewardTickets: 1,
  },
  {
    id: 'kills500',
    name: '机兵猎人',
    desc: '累计击杀 500 个敌人',
    check: (s) => s.totalKills >= 500,
    rewardGold: 500,
    rewardTickets: 0,
  },
  {
    id: 'chars5',
    name: '收藏家',
    desc: '拥有 5 名角色',
    check: (s) => s.charactersOwned >= 5,
    rewardGold: 0,
    rewardTickets: 1,
  },
  {
    id: 'legendary',
    name: '武装到位',
    desc: '首次装备传说武器',
    check: (s) => s.legendariesEquipped >= 1,
    rewardGold: 800,
    rewardTickets: 0,
  },
  {
    id: 'clear40',
    name: '锈带传奇',
    desc: '通关第 40 关',
    check: (s) => s.highestStage >= 40,
    rewardGold: 2000,
    rewardTickets: 3,
  },
  {
    id: 'gifts10',
    name: '记忆馈赠',
    desc: '累计送礼 10 次',
    check: (s) => s.giftsSent >= 10,
    rewardGold: 200,
    rewardTickets: 0,
  },
];

export function rankingScore(stats: {
  stagesCleared: number;
  totalKills: number;
  charactersOwned: number;
  giftsSent: number;
}): number {
  return (
    stats.stagesCleared * 100 +
    stats.totalKills +
    stats.charactersOwned * 500 +
    stats.giftsSent * 10
  );
}
