import { ACHIEVEMENTS } from '../data/achievements';
import type { SaveData } from '../types';

export function getClaimableAchievements(save: SaveData) {
  return ACHIEVEMENTS.filter(
    (a) => !save.achievementsClaimed.includes(a.id) && a.check(save.stats),
  );
}

export function claimAchievement(save: SaveData, id: string): { ok: boolean; msg: string } {
  const ach = ACHIEVEMENTS.find((a) => a.id === id);
  if (!ach) return { ok: false, msg: '成就不存在' };
  if (save.achievementsClaimed.includes(id)) return { ok: false, msg: '已领取' };
  if (!ach.check(save.stats)) return { ok: false, msg: '未达成' };

  save.achievementsClaimed.push(id);
  save.gold += ach.rewardGold;
  save.tickets += ach.rewardTickets;
  return {
    ok: true,
    msg: `领取成功：${ach.rewardGold ? ach.rewardGold + ' 锈币' : ''}${ach.rewardTickets ? ' ' + ach.rewardTickets + ' 券' : ''}`.trim(),
  };
}

export function sendGift(save: SaveData, characterId: string, price: number): { ok: boolean; msg: string } {
  if (save.gold < price) return { ok: false, msg: '锈币不足' };
  const oc = save.ownedCharacters.find((c) => c.characterId === characterId);
  if (!oc) return { ok: false, msg: '未拥有该角色' };

  save.gold -= price;
  oc.giftCount += 1;
  save.stats.giftsSent += 1;
  return { ok: true, msg: '礼物已送出' };
}
