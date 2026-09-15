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

/** 播放合成 blob；自动打断上一条 */
export function playVoiceBlob(blob: Blob): Promise<number> {
  stopVoicePlayback();
  const url = URL.createObjectURL(blob);
  currentUrl = url;
  const audio = new Audio(url);
  audio.preload = 'auto';
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
