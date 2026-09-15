/**
 * 泳池派对泳装：历史 rollout 已废弃「免费入库 + AI 通知指挥官去角色详情切换」。
 * 营地可按状态穿任何已配置皮肤；看板娘皮肤需在角色详情购买。
 * 仅 bump rev，避免旧档反复触发通知。
 */
import type { AiLivingSave } from './types';
import type { SaveData } from '../types';

/** 调高此值可再次跑空迁移（仍不解锁、不发消息） */
export const POOL_PARTY_SKIN_ROLLOUT_REV = 2;

export function applyPoolPartySkinRollout(
  _save: SaveData,
  living: AiLivingSave,
  _now = Date.now(),
): void {
  if (!living.skinRollouts) living.skinRollouts = {};
  if ((living.skinRollouts.pifu01 ?? 0) >= POOL_PARTY_SKIN_ROLLOUT_REV) return;
  living.skinRollouts.pifu01 = POOL_PARTY_SKIN_ROLLOUT_REV;
}
