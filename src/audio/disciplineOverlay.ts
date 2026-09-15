/**
 * 小黑屋调教叠加曲：循环播放，不替换营地主 BGM。
 * 仅随 disciplineSession 启停。
 */
import { unlockBgm } from './bgm';

const SRC = './music/tiaojiaoqidong.mp3';
const TARGET_VOL = 0.38;
const FADE_MS = 700;

let audio: HTMLAudioElement | null = null;
let fadeGen = 0;
let wantPlaying = false;

function ensure(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio(SRC);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0;
  audio.setAttribute('playsinline', 'true');
  return audio;
}

function fadeTo(target: number, ms: number, onDone?: () => void): void {
  const el = ensure();
  const gen = ++fadeGen;
  const from = el.volume;
  if (ms <= 0 || Math.abs(from - target) < 0.01) {
    el.volume = target;
    onDone?.();
    return;
  }
  const t0 = performance.now();
  const step = (now: number) => {
    if (gen !== fadeGen) return;
    const t = Math.min(1, (now - t0) / ms);
    const eased = t * t * (3 - 2 * t);
    el.volume = from + (target - from) * eased;
    if (t < 1) {
      requestAnimationFrame(step);
      return;
    }
    el.volume = target;
    onDone?.();
  };
  requestAnimationFrame(step);
}

/** 开始循环叠加（幂等；不影响主 BGM） */
export async function startDisciplineOverlayMusic(): Promise<void> {
  wantPlaying = true;
  unlockBgm();
  const el = ensure();
  if (el.paused) {
    el.currentTime = 0;
    try {
      await el.play();
    } catch (err) {
      console.warn('[discipline-overlay] play blocked', err);
      return;
    }
  }
  if (!wantPlaying) return;
  fadeTo(TARGET_VOL, FADE_MS);
}

/** 结束叠加曲（调教结束时调用） */
export function stopDisciplineOverlayMusic(): void {
  wantPlaying = false;
  if (!audio) return;
  fadeTo(0, FADE_MS, () => {
    if (wantPlaying) return;
    audio?.pause();
    if (audio) audio.currentTime = 0;
  });
}

/** 读档 / 打开对话时：有进行中会话则续播，否则确保停 */
export function syncDisciplineOverlayMusic(active: boolean): void {
  if (active) void startDisciplineOverlayMusic();
  else stopDisciplineOverlayMusic();
}
