import { stopWebSpeechFallback } from './webSpeechFallback';

let current: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let speaking = false;
let unlocked = false;

const listeners = new Set<(on: boolean) => void>();

export function isVoiceSpeaking(): boolean {
  return speaking;
}

export function onVoiceSpeakingChange(cb: (on: boolean) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setSpeaking(on: boolean): void {
  speaking = on;
  for (const cb of listeners) cb(on);
}

/** 供 Web Speech 等非 Audio 回退路径同步「正在说话」UI */
export function markVoiceSpeaking(on: boolean): void {
  setSpeaking(on);
}

/**
 * 在用户手势里解锁音频（麦克风 / 发送点击时调用）。
 * LLM 往返过久后浏览器会收回自动播放权限，导致「有时没声音」。
 */
export function unlockAudioPlayback(): void {
  if (unlocked) return;
  try {
    const a = new Audio(
      'data:audio/mpeg;base64,//uQxAAAAAABIAAAAAExBTUUzLjk4LjIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    );
    a.volume = 0.01;
    void a
      .play()
      .then(() => {
        unlocked = true;
        a.pause();
      })
      .catch(() => {
        /* 手势外失败可忽略，下次手势再试 */
      });
  } catch {
    /* ignore */
  }
}

export function stopVoicePlayback(): void {
  stopWebSpeechFallback();
  if (current) {
    current.pause();
    current.removeAttribute('src');
    current.load();
    current = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
  setSpeaking(false);
}

/**
 * 云端 pitch 会同时改变基频与时长（实测时长 ≈ 原时长 × pitch^-1.85）。
 * 这里在本地用 playbackRate 把时长拉回目标语速，并用 preservesPitch 保证音高不被二次改变；
 * 浏览器不支持 preservesPitch 时退化为"只调速不改音高"。
 */
export function resolveLocalPlaybackRate(rate: number, pitch: number): number {
  const p = Math.min(2, Math.max(0.5, pitch || 1));
  const comp = Math.pow(p, -1.85);
  const q = (rate || 1) * comp;
  return Math.min(2, Math.max(0.5, q));
}

function supportsPreservesPitch(audio: HTMLAudioElement): boolean {
  return 'preservesPitch' in audio;
}

/** 播放合成 blob；自动打断上一条 */
export function playVoiceBlob(
  blob: Blob,
  opts?: { rate?: number; pitch?: number },
): Promise<number> {
  stopVoicePlayback();
  const url = URL.createObjectURL(blob);
  currentUrl = url;
  const audio = new Audio(url);
  audio.preload = 'auto';
  const pitch = opts?.pitch ?? 1;
  const rate = opts?.rate ?? 1;
  if (supportsPreservesPitch(audio)) {
    (audio as HTMLAudioElement & { preservesPitch: boolean }).preservesPitch = true;
  }
  const w = audio as HTMLAudioElement & { webkitPreservesPitch?: boolean };
  if ('webkitPreservesPitch' in w) w.webkitPreservesPitch = true;
  // pitch 已在云端生效；这里只把语速调回来（保持音高不变）
  audio.playbackRate = Math.abs(pitch - 1) < 0.01 ? rate : resolveLocalPlaybackRate(rate, pitch);
  current = audio;
  setSpeaking(true);
  const started = performance.now();

  return new Promise((resolve, reject) => {
    const done = () => {
      const ms = Math.round(performance.now() - started);
      if (current === audio) {
        stopVoicePlayback();
      }
      resolve(ms);
    };
    audio.onended = done;
    audio.onerror = () => {
      stopVoicePlayback();
      reject(new Error('音频播放失败'));
    };
    void audio.play().catch((err) => {
      stopVoicePlayback();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
