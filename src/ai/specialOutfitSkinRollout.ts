/**
 * 特殊服装01：历史 rollout 已废弃「免费入库 + AI 通知指挥官去角色详情切换」。
 * 营地可按状态穿；看板娘需购买。仅 bump rev。
 */
import type { AiLivingSave } from './types';
import type { SaveData } from '../types';

export const SPECIAL_OUTFIT_01_SKIN_ROLLOUT_REV = 2;

export function applySpecialOutfitSkinRollout(
  _save: SaveData,
  living: AiLivingSave,
  _now = Date.now(),
): void {
  if (!living.skinRollouts) living.skinRollouts = {};
  if ((living.skinRollouts.pifu05 ?? 0) >= SPECIAL_OUTFIT_01_SKIN_ROLLOUT_REV) return;
  living.skinRollouts.pifu05 = SPECIAL_OUTFIT_01_SKIN_ROLLOUT_REV;
}
