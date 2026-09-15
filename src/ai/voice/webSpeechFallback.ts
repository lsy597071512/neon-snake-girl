/**
 * Edge TTS 失败时的系统朗读回退（Android WebView / 浏览器 speechSynthesis）。
 * 音质弱于 Edge，但能保证「有声」；不依赖微软 WebSocket。
 * 注意：勿反向 import player（会循环依赖）；调用前由 orchestrator/player 停掉旧音频。
 */

function getSpeechSynthesis(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis ?? null;
}

export function canUseWebSpeechFallback(): boolean {
  const synth = getSpeechSynthesis();
  return !!synth && typeof SpeechSynthesisUtterance !== 'undefined';
}

function pickZhVoice(synth: SpeechSynthesis): SpeechSynthesisVoice | null {
  const voices = synth.getVoices();
  if (!voices.length) return null;
  return (
    voices.find((v) => /^zh(-|_|$)/i.test(v.lang) && /female|xiaoxiao|huihui|ting|yaoyao/i.test(v.name)) ||
    voices.find((v) => /^zh-CN/i.test(v.lang)) ||
    voices.find((v) => /^zh/i.test(v.lang)) ||
    null
  );
}

/** 等待 voiceschanged（部分 WebView 首次 getVoices 为空） */
async function ensureVoices(synth: SpeechSynthesis): Promise<void> {
  if (synth.getVoices().length) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      synth.removeEventListener('voiceschanged', done);
      resolve();
    };
    synth.addEventListener('voiceschanged', done);
    window.setTimeout(done, 400);
  });
}

/**
 * 用系统 TTS 朗读；返回大致时长 ms。
 * 调用方应先 stopVoicePlayback()，避免与 Edge 音频叠播。
 */
export async function speakWithWebSpeechFallback(
  text: string,
  opts?: { rate?: number; pitch?: number },
): Promise<number> {
  const synth = getSpeechSynthesis();
  if (!synth) throw new Error('Web Speech 不可用');

  synth.cancel();
  await ensureVoices(synth);

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  utter.rate = Math.max(0.7, Math.min(1.4, opts?.rate ?? 1.05));
  utter.pitch = Math.max(0.5, Math.min(2, opts?.pitch ?? 1));
  const voice = pickZhVoice(synth);
  if (voice) utter.voice = voice;

  const started = performance.now();
  return new Promise((resolve, reject) => {
    utter.onend = () => resolve(Math.round(performance.now() - started));
    utter.onerror = (ev) => {
      reject(new Error(`系统朗读失败：${ev.error || 'unknown'}`));
    };
    try {
      synth.speak(utter);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export function stopWebSpeechFallback(): void {
  try {
    getSpeechSynthesis()?.cancel();
  } catch {
    /* ignore */
  }
}
