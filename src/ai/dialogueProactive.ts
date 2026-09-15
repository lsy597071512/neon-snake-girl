/**
 * 对话页角色主动发言：按性格/环境估算沉默等待与是否续说。
 */
import { getPersona } from './characterPersona';
import { resolvePresence } from './livingState';
import { proactiveContactBlockReason } from './sleepSystem';
import type { AiLivingSave } from './types';

export type ProactiveSpeakPlan = {
  /** 指挥官沉默多久后尝试主动开口（ms） */
  idleDelayMs: number;
  /** 本轮主动后是否倾向再接一句 */
  continueChance: number;
  /** 续说间隔（ms） */
  continueDelayMs: number;
  /** 是否允许主动（忙/睡等可能拒绝） */
  allow: boolean;
  motive: string;
};

/** 根据性格与环境决定主动发言节奏 */
export function planProactiveSpeak(
  living: AiLivingSave,
  characterId: string,
): ProactiveSpeakPlan {
  const sleepBlock = proactiveContactBlockReason(living, characterId);
  if (sleepBlock) {
    return {
      idleDelayMs: 60_000,
      continueChance: 0,
      continueDelayMs: 60_000,
      allow: false,
      motive: sleepBlock,
    };
  }

  const persona = getPersona(living, characterId);
  const presence = resolvePresence(characterId, living);
  const t = persona.traits;
  const act = presence.activity;

  const busy = ['sleeping', 'bathe', 'maintain', 'busy', 'guard', 'patrol'].includes(act);
  // 社交/玩闹更爱开口；内敛/谨慎更沉默；忙碌时少插话
  const talkativeness =
    40 +
    t.warmth * 0.9 +
    t.play * 1.1 -
    t.caution * 0.8 -
    (persona.dayMode === 'withdrawn' ? 18 : 0) +
    (persona.dayMode === 'social' || persona.dayMode === 'playful' ? 14 : 0) +
    (persona.dayMode === 'dutiful' ? -6 : 0);

  let allow = talkativeness > 8;
  if (busy) allow = talkativeness > 28 && act !== 'sleeping';
  if (persona.dayMode === 'withdrawn' && talkativeness < 22) allow = false;

  const idleDelayMs = Math.round(
    clamp(9000 - talkativeness * 120 + (busy ? 8000 : 0) + t.caution * 80, 5500, 28000),
  );
  const continueChance = clamp(0.12 + talkativeness / 180 + t.play / 120, 0.08, 0.55);
  const continueDelayMs = Math.round(clamp(2800 + t.caution * 40 - t.play * 30, 1800, 7000));

  const motiveBits: string[] = [];
  if (busy) motiveBits.push(`你正在${presence.behavior}，指挥官却沉默着`);
  else motiveBits.push('指挥官这会儿没说话');
  if (persona.dayMode === 'social' || persona.dayMode === 'playful') {
    motiveBits.push('你闲不住，想把气氛接住');
  } else if (persona.dayMode === 'withdrawn') {
    motiveBits.push('你本不想多说，但气氛太静了');
  } else if (persona.dayMode === 'dutiful') {
    motiveBits.push('你想确认接下来有没有事要办');
  }
  motiveBits.push(persona.moodNote || '按自己的性子开口');

  return {
    idleDelayMs,
    continueChance,
    continueDelayMs,
    allow,
    motive: motiveBits.join('；'),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
