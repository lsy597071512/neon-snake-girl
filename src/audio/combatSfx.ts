/**
 * 战斗音效（WebAudio 实时合成，零素材开销，移动端友好）
 *
 * 设计原则：
 *  - 不引入新的 .wav/.mp3 资源，避免进包与缓冲；
 *  - 每发声音 ≈ 60~250ms，单帧占用极小；
 *  - 限制同一帧最大并发 voice 数（10），超限自动丢弃最旧的；
 *  - 全局静音开关（与 uiSound 同步）由调用方决定；
 *  - 与 showSkillBanner/showHitEmotion 配合使用，传入相同 characterId 即可与角色联动。
 *
 * 用法（在 Combat3D 中）：
 *  - onFire(charId) 发射时
 *  - onHit(...) 命中时
 *  - onKill(...) 击杀时
 *  - onSkill(fxDef, charId) 技能触发时
 *  - ~~onHurt(...) 我方被击中~~ → 用户要求删除：角色受击不再播放任何语音
 */
import type { CharacterSkillId } from '../core/skillEffects';

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let masterCompressor: DynamicsCompressorNode | null = null;
let enabled = true;
/** 简单多 voice 计数：用于节流 */
let activeVoices = 0;
const MAX_VOICES = 12;

function getCtx(): AudioContext | null {
  if (!enabled || typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  const Win = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = Win.AudioContext ?? Win.webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  masterCompressor = audioCtx.createDynamicsCompressor();
  masterCompressor.threshold.value = -18;
  masterCompressor.knee.value = 24;
  masterCompressor.ratio.value = 4;
  masterCompressor.attack.value = 0.003;
  masterCompressor.release.value = 0.18;
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.85;
  masterCompressor.connect(masterGain);
  masterGain.connect(audioCtx.destination);
  return audioCtx;
}

/** 与 uiSound 共用——确保点击/手势后 audioCtx 已经 resume */
export function unlockCombatAudio(): void {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  // 静默开音
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  g.gain.value = 0.0001;
  osc.connect(g);
  g.connect(masterCompressor ?? ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.01);
}

export function setCombatSfxEnabled(on: boolean): void {
  enabled = on;
}

interface VoiceEnd {
  (): void;
}

/** 通用：合成一段衰减正弦（带 attack/sustain/release 三段），tone 给主频；body 给可选 sub-octave 重建 */
function synthBlip(
  freq: number,
  duration: number,
  opts: {
    type?: OscillatorType;
    attack?: number;
    release?: number;
    /** 第二正弦叠加（八度或倍频） */
    subFreqRatio?: number;
    subGainRatio?: number;
    /** 末段轻微去谐，让"金属感"显著 */
    detuneEnd?: number;
    /** 主音量（gain 缩放，乘到 masterGain 之前） */
    volume?: number;
    /** 滤波：biquad lowpass cutoffHz */
    filterHz?: number;
  } = {},
): void {
  const ctx = getCtx();
  if (!ctx || !masterCompressor) return;
  if (activeVoices >= MAX_VOICES) return;
  activeVoices++;
  const t0 = ctx.currentTime;
  const attack = opts.attack ?? 0.005;
  const release = opts.release ?? duration;
  const volume = opts.volume ?? 0.8;
  let ended = false;
  const onEnd: VoiceEnd = () => {
    if (ended) return;
    ended = true;
    activeVoices = Math.max(0, activeVoices - 1);
  };

  const osc = ctx.createOscillator();
  osc.type = opts.type ?? 'square';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.detuneEnd) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + opts.detuneEnd), t0 + duration);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(volume, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + release);

  let filter: BiquadFilterNode | null = null;
  if (opts.filterHz) {
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(opts.filterHz, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, opts.filterHz * 0.45), t0 + duration);
    filter.Q.value = 1;
    osc.connect(filter);
    filter.connect(g);
  } else {
    osc.connect(g);
  }
  g.connect(masterCompressor);

  let subOsc: OscillatorNode | null = null;
  if (opts.subFreqRatio && opts.subGainRatio && opts.subGainRatio > 0) {
    subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(freq * opts.subFreqRatio, t0);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t0);
    sg.gain.exponentialRampToValueAtTime(volume * opts.subGainRatio, t0 + attack);
    sg.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + release);
    subOsc.connect(sg);
    sg.connect(masterCompressor);
    subOsc.start(t0);
    subOsc.stop(t0 + duration + 0.02);
    subOsc.onended = onEnd;
  }
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
  osc.onended = () => {
    if (subOsc) return; // 等 sub
    onEnd();
  };
}

/** 合成一段白噪（无衰减被打断的爆裂感） */
function synthNoise(duration: number, opts: {
  volume?: number;
  filterHzStart?: number;
  filterHzEnd?: number;
}): void {
  const ctx = getCtx();
  if (!ctx || !masterCompressor) return;
  if (activeVoices >= MAX_VOICES) return;
  activeVoices++;
  const t0 = ctx.currentTime;
  const volume = opts.volume ?? 0.4;
  let ended = false;
  const onEnd: VoiceEnd = () => {
    if (ended) return;
    ended = true;
    activeVoices = Math.max(0, activeVoices - 1);
  };
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  if (opts.filterHzStart) filter.frequency.setValueAtTime(opts.filterHzStart, t0);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(60, opts.filterHzEnd ?? 200),
    t0 + duration,
  );
  filter.Q.value = 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(volume, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  src.connect(filter);
  filter.connect(g);
  g.connect(masterCompressor);
  src.start(t0);
  src.stop(t0 + duration + 0.02);
  src.onended = onEnd;
}

/* =========== 公共 API =========== */

/** 玩家开火：高频短音 + 白噪爆点（音量压低 50%，与打击音一致） */
export function playFireSfx(seed = 0): void {
  const f = 720 + (seed % 5) * 50 + Math.floor(Math.random() * 80);
  synthBlip(f, 0.08, {
    type: 'square',
    attack: 0.002,
    release: 0.08,
    detuneEnd: -300,
    subFreqRatio: 0.5,
    subGainRatio: 0.5,
    volume: 0.16,
    filterHz: 4200,
  });
  synthNoise(0.06, { volume: 0.09, filterHzStart: 6000, filterHzEnd: 1200 });
}

/** 统一打击音：所有命中/击杀/受击/技能都用这一种短促的"嗒"声（音量压低 50%，避免高频叠加刺耳） */
function playUnifiedHitSfx(): void {
  synthBlip(640, 0.06, {
    type: 'square',
    attack: 0.002,
    release: 0.06,
    detuneEnd: -160,
    volume: 0.15,
    filterHz: 3600,
  });
  synthNoise(0.04, { volume: 0.06, filterHzStart: 4000, filterHzEnd: 900 });
}

/** 命中敌人：统一打击音（参数忽略） */
export function playHitSfx(_crit = false): void {
  playUnifiedHitSfx();
}

/** 击杀：统一打击音（参数忽略） */
export function playKillSfx(_boss = false): void {
  playUnifiedHitSfx();
}

/** 护盾抵挡：金属 ping + 短暂脉冲 */
export function playShieldSfx(): void {
  synthBlip(660, 0.06, {
    type: 'sine',
    attack: 0.002,
    release: 0.06,
    detuneEnd: 200,
    volume: 0.32,
    filterHz: 4200,
  });
  synthBlip(1320, 0.08, {
    type: 'sine',
    attack: 0.003,
    release: 0.07,
    volume: 0.18,
    filterHz: 6000,
  });
}

/** 技能触发：统一打击音 */
export function playSkillSfx(_skillId: CharacterSkillId): void {
  playUnifiedHitSfx();
}
