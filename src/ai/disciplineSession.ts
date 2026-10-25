/**
 * 【市场版 · 功能已下线】原「约束房间」会话模块。
 *
 * 本文件在市场版中仅保留导出接口签名，实现全部为惰性空操作（no-op），
 * 不包含任何成人向文本、行为、场景或皮肤；该玩法在本版本中完全不可用。
 *
 * 本地成人版对应实现保存在仓库本地快照（见 _adult-local/src/ai/disciplineSession.ts），
 * 不在任何打包产物中出现。
 */
import type { AiLivingSave } from './types';

export const DISCIPLINE_ROOM_ID = '';
export const DISCIPLINE_SCENE_ID = '';
export const DISCIPLINE_BG_PATH = '';
export const DISCIPLINE_POSE_COOLDOWN_MS = 20_000;

export type DisciplineEntrySource =
  | 'player_button'
  | 'threat_fulfilled'
  | 'character_request'
  | 'recover';

export type DisciplineValence = 'tragic' | 'mixed' | 'joyful';

export type DisciplineSessionState = {
  active: boolean;
  characterId: string;
  prevRoomId: string | null;
  prevCampSkinId: string | null;
  prevEventTemp?: import('./types').EventTempSkinState | null;
  poseIndex: number | null;
  startedAt: number;
  lastPoseAt: number;
  awaitingPoseReply: boolean;
  entrySource: DisciplineEntrySource;
  valenceHints: DisciplineValence[];
  justEntered?: boolean;
  justLeft?: boolean;
  justLeftTurnsLeft?: number;
  settling?: boolean;
};

export type DisciplineInvitePending = {
  characterId: string;
  proposedAt: number;
  dayIndex: number;
  preview: string;
};

export const DISCIPLINE_THREAT_RE = /$^/;

export function isDisciplineEnabled(_save: unknown): boolean {
  return false;
}

export function getDisciplineSession(_living: AiLivingSave): DisciplineSessionState | null {
  return null;
}

export function isDisciplineActiveFor(_living: AiLivingSave, _characterId: string): boolean {
  return false;
}

export function detectDisciplineThreat(_playerMessage: string): boolean {
  return false;
}

export function disciplineBodyBehavior(_poseIndex: number | null | undefined): string {
  return '在营地自由活动';
}

export type DisciplineEnterResult = {
  ok: boolean;
  msg: string;
  systemLine?: string;
};

export function enterDisciplineSession(
  _save: unknown,
  _living: AiLivingSave,
  _characterId: string,
  _entrySource: DisciplineEntrySource = 'player_button',
): DisciplineEnterResult {
  return { ok: false, msg: '该功能在本版本中不可用' };
}

export type DisciplineLeaveResult = {
  ok: boolean;
  msg: string;
  valence: DisciplineValence;
  affinityDelta: number;
  systemLine?: string;
};

export function leaveDisciplineSession(
  _save: unknown,
  _living: AiLivingSave,
  _opts?: {
    valence?: DisciplineValence;
    reason?: string;
    oneLineMemory?: string;
    force?: boolean;
  },
): DisciplineLeaveResult {
  return { ok: false, msg: '未在会话中', valence: 'mixed', affinityDelta: 0 };
}

export function scrubOrphanDisciplineArtifacts(_living: AiLivingSave): void {}

export function settleActiveDisciplineSession(
  _save: unknown,
  _living: AiLivingSave,
  _reason: string,
): DisciplineLeaveResult | null {
  return null;
}

export function recoverStaleDisciplineSession(_save: unknown, _living: AiLivingSave): boolean {
  return false;
}

export function buildDisciplineThreatPromptBlock(): string {
  return '';
}

export function buildDisciplineActivePromptBlock(
  _living: AiLivingSave,
  _characterId: string,
): string {
  return '';
}

export function buildDisciplineJustLeftPromptBlock(
  _living: AiLivingSave,
  _characterId: string,
): string {
  return '';
}

export function consumeDisciplineJustLeftTurn(_living: AiLivingSave, _characterId: string): void {}

export const DISCIPLINE_ENTER_REACT_MOTIVE = '';
export const DISCIPLINE_LEAVE_REACT_MOTIVE = '';

export function consumeDisciplineJustEntered(
  _living: AiLivingSave,
  _characterId: string,
): boolean {
  return false;
}

export function normalizeDisciplineValence(_raw: unknown): DisciplineValence | null {
  return null;
}

export function recordDisciplineValenceHint(
  _living: AiLivingSave,
  _characterId: string,
  _valence: DisciplineValence | null | undefined,
): void {}

export function clearDisciplinePoseAwaiting(_living: AiLivingSave, _characterId: string): void {}

export type DisciplinePoseSwitchResult = {
  ok: boolean;
  msg: string;
  playerMessage?: string;
  poseIndex?: number;
};

export function applyDisciplinePoseSwitch(
  _living: AiLivingSave,
  _characterId: string,
  _poseIndex: number,
): DisciplinePoseSwitchResult {
  return { ok: false, msg: '该功能在本版本中不可用' };
}

export function applyDisciplineIdleReset(
  _living: AiLivingSave,
  _characterId: string,
): DisciplinePoseSwitchResult {
  return { ok: false, msg: '该功能在本版本中不可用' };
}

export function getDisciplinePoseCooldownRemainingMs(_living: AiLivingSave): number {
  return 0;
}

export function isDisciplinePoseUiLocked(_living: AiLivingSave, _characterId: string): boolean {
  return true;
}

export function maybeProposeDisciplineInvite(
  _save: unknown,
  _living: AiLivingSave,
  _characterId: string,
  _dialogue: string,
): DisciplineInvitePending | null {
  return null;
}

export function acceptDisciplineInvite(
  _save: unknown,
  _living: AiLivingSave,
): DisciplineEnterResult {
  return { ok: false, msg: '该功能在本版本中不可用' };
}

export function rejectDisciplineInvite(_living: AiLivingSave): string {
  return '';
}

export async function requestDisciplineSettleValence(
  _living: AiLivingSave,
  _characterId: string,
): Promise<{ valence: DisciplineValence; one_line_memory: string } | null> {
  return null;
}
