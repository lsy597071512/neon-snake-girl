import type { SaveData } from '../types';

export const SWEEP_MAX_CHARGES = 15;
export const SWEEP_RECOVER_MS = 15 * 60 * 1000;

export interface SweepStatus {
  current: number;
  max: number;
  nextRecoverMs: number;
}

/** 按离线时间结算扫荡次数恢复 */
export function syncSweepRecovery(save: SaveData, now = Date.now()): void {
  if (save.sweepCharges == null) save.sweepCharges = SWEEP_MAX_CHARGES;
  if (!save.sweepRecoverAnchorAt) save.sweepRecoverAnchorAt = now;

  if (save.sweepCharges >= SWEEP_MAX_CHARGES) {
    save.sweepCharges = SWEEP_MAX_CHARGES;
    save.sweepRecoverAnchorAt = now;
    return;
  }

  const gained = Math.floor((now - save.sweepRecoverAnchorAt) / SWEEP_RECOVER_MS);
  if (gained <= 0) return;

  save.sweepCharges = Math.min(SWEEP_MAX_CHARGES, save.sweepCharges + gained);
  save.sweepRecoverAnchorAt += gained * SWEEP_RECOVER_MS;
  if (save.sweepCharges >= SWEEP_MAX_CHARGES) save.sweepRecoverAnchorAt = now;
}

export function getSweepStatus(save: SaveData, now = Date.now()): SweepStatus {
  syncSweepRecovery(save, now);
  const current = save.sweepCharges ?? SWEEP_MAX_CHARGES;
  if (current >= SWEEP_MAX_CHARGES) {
    return { current, max: SWEEP_MAX_CHARGES, nextRecoverMs: 0 };
  }
  const elapsed = now - (save.sweepRecoverAnchorAt ?? now);
  const nextRecoverMs = Math.max(0, SWEEP_RECOVER_MS - (elapsed % SWEEP_RECOVER_MS));
  return { current, max: SWEEP_MAX_CHARGES, nextRecoverMs };
}

export function consumeSweepCharge(save: SaveData, now = Date.now()): { ok: boolean; msg: string } {
  syncSweepRecovery(save, now);
  if ((save.sweepCharges ?? 0) <= 0) {
    return { ok: false, msg: '扫荡次数不足，每 15 分钟恢复 1 次' };
  }
  if (save.sweepCharges === SWEEP_MAX_CHARGES) {
    save.sweepRecoverAnchorAt = now;
  }
  save.sweepCharges -= 1;
  return { ok: true, msg: '' };
}
