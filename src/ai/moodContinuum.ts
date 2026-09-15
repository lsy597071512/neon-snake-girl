/**
 * 情绪连续体：valence / arousal + 时间衰减 + 事件驱动。
 * moodNote 仍作可读文案；本模块提供可观察量表，营地 UI 可见。
 */
import type { AiLivingSave } from './types';
import { getPersona, type CharacterPersonaLive } from './characterPersona';

export type MoodSnapshot = {
  /** -100..100 愉悦度 */
  valence: number;
  /** 0..100 唤醒度 */
  arousal: number;
  labelZh: string;
  /** 给 Prompt 的短描述（不暴露精确数值） */
  promptHint: string;
};

const VALENCE_BASELINE = 8;
const AROUSAL_BASELINE = 38;
/** 每游戏分钟向基线漂移 */
const VALENCE_DECAY_PER_MIN = 0.22;
const AROUSAL_DECAY_PER_MIN = 0.18;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function ensureMoodFields(p: CharacterPersonaLive): void {
  if (typeof p.moodValence !== 'number' || Number.isNaN(p.moodValence)) {
    p.moodValence = seedValenceFromPersona(p);
  }
  if (typeof p.moodArousal !== 'number' || Number.isNaN(p.moodArousal)) {
    p.moodArousal = seedArousalFromPersona(p);
  }
  if (typeof p.lastMoodTickGameMin !== 'number') {
    p.lastMoodTickGameMin = 0;
  }
}

function seedValenceFromPersona(p: CharacterPersonaLive): number {
  let v = VALENCE_BASELINE + p.traits.warmth * 0.8 + p.traits.play * 0.4;
  if (p.dayMode === 'playful' || p.dayMode === 'social') v += 12;
  if (p.dayMode === 'withdrawn' || p.dayMode === 'idle') v -= 8;
  if (p.dayMode === 'restless') v -= 4;
  return clamp(Math.round(v), -100, 100);
}

function seedArousalFromPersona(p: CharacterPersonaLive): number {
  let a = AROUSAL_BASELINE + p.traits.play * 0.5 + Math.abs(p.traits.caution) * 0.3;
  if (p.dayMode === 'restless' || p.dayMode === 'playful') a += 14;
  if (p.dayMode === 'idle' || p.dayMode === 'withdrawn') a -= 10;
  if (p.dayMode === 'dutiful') a += 4;
  return clamp(Math.round(a), 0, 100);
}

export function moodLabelZh(valence: number, arousal: number): string {
  const v = valence;
  const a = arousal;
  if (v >= 55 && a >= 55) return '开心得有点蹦';
  if (v >= 55 && a < 40) return '温和愉快';
  if (v >= 25 && a >= 60) return '兴奋活跃';
  if (v >= 25) return '心情不错';
  if (v <= -55 && a >= 55) return '焦躁难受';
  if (v <= -55 && a < 40) return '低落发闷';
  if (v <= -25 && a >= 55) return '烦躁紧绷';
  if (v <= -25) return '有点沉';
  if (a >= 65) return '坐不住';
  if (a <= 28) return '懒洋洋';
  return '平稳';
}

function moodPromptHint(valence: number, arousal: number, label: string): string {
  const vTone =
    valence >= 40 ? '偏积极' : valence <= -40 ? '偏消极' : valence >= 15 ? '略偏暖' : valence <= -15 ? '略偏冷' : '中性';
  const aTone =
    arousal >= 60 ? '唤醒偏高（话可更快/动作更利落）' : arousal <= 30 ? '唤醒偏低（可懒/可短答）' : '唤醒适中';
  return `此刻连续心情「${label}」（${vTone}；${aTone}）。语气与动作要贴合，勿突然跳到相反极端，除非本轮事件极强。`;
}

export function getMoodSnapshot(living: AiLivingSave, characterId: string): MoodSnapshot {
  const p = getPersona(living, characterId);
  ensureMoodFields(p);
  const valence = clamp(p.moodValence ?? VALENCE_BASELINE, -100, 100);
  const arousal = clamp(p.moodArousal ?? AROUSAL_BASELINE, 0, 100);
  const labelZh = moodLabelZh(valence, arousal);
  return {
    valence,
    arousal,
    labelZh,
    promptHint: moodPromptHint(valence, arousal, labelZh),
  };
}

/** 时间衰减：按游戏分钟差向基线漂移 */
export function tickMoodDecay(
  living: AiLivingSave,
  characterId: string,
  nowGameMin = living.gameMinutes,
): void {
  const p = getPersona(living, characterId);
  ensureMoodFields(p);
  const last = p.lastMoodTickGameMin ?? nowGameMin;
  const dt = Math.max(0, Math.min(240, (nowGameMin | 0) - (last | 0)));
  if (dt <= 0) {
    p.lastMoodTickGameMin = nowGameMin | 0;
    return;
  }
  let v = p.moodValence ?? VALENCE_BASELINE;
  let a = p.moodArousal ?? AROUSAL_BASELINE;
  const vStep = VALENCE_DECAY_PER_MIN * dt;
  const aStep = AROUSAL_DECAY_PER_MIN * dt;
  if (v > VALENCE_BASELINE) v = Math.max(VALENCE_BASELINE, v - vStep);
  else if (v < VALENCE_BASELINE) v = Math.min(VALENCE_BASELINE, v + vStep);
  if (a > AROUSAL_BASELINE) a = Math.max(AROUSAL_BASELINE, a - aStep);
  else if (a < AROUSAL_BASELINE) a = Math.min(AROUSAL_BASELINE, a + aStep);
  p.moodValence = clamp(Math.round(v), -100, 100);
  p.moodArousal = clamp(Math.round(a), 0, 100);
  p.lastMoodTickGameMin = nowGameMin | 0;
  syncMoodNote(p);
}

export function tickMoodDecayForOwned(living: AiLivingSave, ownedIds: string[]): void {
  for (const id of ownedIds) tickMoodDecay(living, id);
}

export type MoodImpulse =
  | { kind: 'talk'; affectionDelta: number }
  | { kind: 'gift'; tier: 0 | 1 | 2 }
  | { kind: 'combat'; victory: boolean }
  | { kind: 'event'; tone: 'up' | 'down' | 'spike' }
  | { kind: 'ignored' }
  | { kind: 'promise'; kept: boolean }
  | { kind: 'asr_hint'; valenceDelta: number; arousalDelta: number };

/** 事件瞬时推动连续体（不同步精确数值给 AI，只影响后续 moodNote/提示） */
export function applyMoodImpulse(
  living: AiLivingSave,
  characterId: string,
  impulse: MoodImpulse,
): MoodSnapshot {
  const p = getPersona(living, characterId);
  ensureMoodFields(p);
  tickMoodDecay(living, characterId);
  let dv = 0;
  let da = 0;
  switch (impulse.kind) {
    case 'talk':
      dv = impulse.affectionDelta * 2.2;
      da = Math.abs(impulse.affectionDelta) * 1.5 + 2;
      if (impulse.affectionDelta < 0) da += 4;
      break;
    case 'gift':
      dv = 6 + impulse.tier * 5;
      da = 4 + impulse.tier * 2;
      break;
    case 'combat':
      if (impulse.victory) {
        dv = 10;
        da = 8;
      } else {
        dv = -14;
        da = 16;
      }
      break;
    case 'event':
      if (impulse.tone === 'up') {
        dv = 8;
        da = 6;
      } else if (impulse.tone === 'down') {
        dv = -10;
        da = 8;
      } else {
        dv = 0;
        da = 18;
      }
      break;
    case 'ignored':
      dv = -12;
      da = 6;
      break;
    case 'promise':
      if (impulse.kept) {
        dv = 8;
        da = 3;
      } else {
        dv = -16;
        da = 10;
      }
      break;
    case 'asr_hint':
      dv = impulse.valenceDelta;
      da = impulse.arousalDelta;
      break;
  }
  p.moodValence = clamp(Math.round((p.moodValence ?? 0) + dv), -100, 100);
  p.moodArousal = clamp(Math.round((p.moodArousal ?? AROUSAL_BASELINE) + da), 0, 100);
  p.lastMoodTickGameMin = living.gameMinutes | 0;
  syncMoodNote(p);
  return getMoodSnapshot(living, characterId);
}

function syncMoodNote(p: CharacterPersonaLive): void {
  const label = moodLabelZh(p.moodValence ?? 0, p.moodArousal ?? AROUSAL_BASELINE);
  // 保留原有 traits 文案风格：连续体标签放前
  const prev = (p.moodNote || '').replace(/^【[^】]+】\s*/, '');
  p.moodNote = `【${label}】${prev || '情绪接近基线，但仍不是复读档案'}`;
}

export function describeMoodContinuumForPrompt(
  living: AiLivingSave,
  characterId: string,
): string {
  const snap = getMoodSnapshot(living, characterId);
  return `【情绪连续体】${snap.promptHint}`;
}

/** 营地 UI 短标签 */
export function campMoodChip(living: AiLivingSave, characterId: string): string {
  return getMoodSnapshot(living, characterId).labelZh;
}
