/**
 * 战斗待机射击 WebM：按锁图测得的人头占屏比，统一各角色头高。
 * 数据由 scripts/_measure_combat_live_head.py 从 locks 绿幕图生成。
 */
import headScaleTable from './combatLiveHeadScale.json';
import { getCharacterArtStem } from '../ui/uiAssets';

type StemEntry = { scaleMul: number };

const BY_STEM = headScaleTable.byStem as Record<string, StemEntry>;

/** 将角色 WebM 缩放到「参考头高」；未知 stem 返回 1 */
export function getCombatLiveHeadScaleMul(charId: string): number {
  const stem = getCharacterArtStem(charId);
  if (!stem) return 1;
  const entry = BY_STEM[stem];
  return entry?.scaleMul ?? 1;
}
