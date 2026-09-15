/**
 * 语音输入优先级：
 * 【国内 Android APK】有 Qwen Key → 麦克风录音 + 百炼 ASR（主路径，不依赖 Google）
 * 【原生无 Key】Capacitor SpeechRecognition（系统/Google 引擎，国内常 network=2 失败）
 * 【Web】有 Key → 百炼；否则浏览器 Web Speech
 *
 * 防串音：每次录音/识别有 sessionId；取消或新开时丢弃旧结果。
 */

import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { hasApiKey } from '../llmClient';
import { recognizeWithDashScope } from './dashscopeAsr';
import { isNativeApp } from './platform';

export type SpeechInputHandlers = {
  onStart?: () => void;
  onEnd?: () => void;
  onResult: (text: string) => void;
  /** 浏览器/系统 interim 听写（百炼录音路径无中间结果） */
  onPartial?: (text: string, isFinal: boolean) => void;
  onError?: (message: string) => void;
  onStatus?: (text: string) => void;
};

type RecCtor = new () => SpeechRecognitionWeb;

interface SpeechRecognitionWeb extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/** 浏览器 SpeechRecognition 结果（DOM lib 偶发缺 resultIndex） */
type SpeechRecognitionEventLoose = SpeechRecognitionEvent & {
  resultIndex: number;
  results: SpeechRecognitionResultList;
};

function getSpeechRecognitionCtor(): RecCtor | null {
  const w = window as Window & {
    SpeechRecognition?: RecCtor;
    webkitSpeechRecognition?: RecCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isSpeechInputSupported(): boolean {
  if (isNativeApp()) return true;
  return Boolean(navigator.mediaDevices?.getUserMedia) || Boolean(getSpeechRecognitionCtor());
}

let webRec: SpeechRecognitionWeb | null = null;
let mediaStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let recording = false;
/** 录音已结束、DashScope 识别进行中 */
let recognizing = false;
let nativeListening = false;
let maxTimer: number | null = null;
/** 防刷屏：同类语音错误短时间内只提示一次 */
let lastNativeErrAt = 0;
let lastNativeErrKey = '';
/** 会话代数：取消/新开时递增，旧回调全部作废 */
let sessionGen = 0;
let asrAbort: AbortController | null = null;
/** 原生识别会话，用于丢弃取消后的迟到结果 */
let nativeSession = 0;

function clearMaxTimer(): void {
  if (maxTimer != null) {
    window.clearTimeout(maxTimer);
    maxTimer = null;
  }
}

function stopTracks(): void {
  mediaStream?.getTracks().forEach((t) => t.stop());
  mediaStream = null;
}

function abortAsrFetch(): void {
  if (asrAbort) {
    try {
      asrAbort.abort();
    } catch {
      /* ignore */
    }
    asrAbort = null;
  }
}

export function stopSpeechInput(): void {
  sessionGen += 1;
  abortAsrFetch();
  clearMaxTimer();
  if (nativeListening) {
    nativeSession += 1;
    void SpeechRecognition.stop().catch(() => undefined);
    void SpeechRecognition.removeAllListeners().catch(() => undefined);
    nativeListening = false;
  }
  if (webRec) {
    try {
      webRec.onresult = null;
      webRec.onerror = null;
      webRec.onend = null;
      webRec.stop();
    } catch {
      /* ignore */
    }
    webRec = null;
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    try {
      mediaRecorder.stop();
    } catch {
      /* ignore */
    }
  }
  mediaRecorder = null;
  recording = false;
  recognizing = false;
  chunks = [];
  stopTracks();
}

export function isSpeechListening(): boolean {
  return recording || recognizing || Boolean(webRec) || nativeListening;
}

function pickRecorderMime(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

/**
 * Android SpeechRecognizer 错误码（系统常把裸数字抛给 JS）：
 * 1 NETWORK_TIMEOUT · 2 NETWORK · 3 AUDIO · 4 SERVER · 5 CLIENT
 * 6 SPEECH_TIMEOUT · 7 NO_MATCH · 8 BUSY · 9 INSUFFICIENT_PERMISSIONS
 */
function friendlyNativeAsrError(raw: string): { key: string; message: string; soft: boolean } {
  const msg = (raw || '').trim();
  const code = /^\d+$/.test(msg) ? Number(msg) : NaN;

  if (
    code === 9 ||
    /Insufficient permissions|Missing permission|permission|权限/i.test(msg)
  ) {
    return {
      key: 'perm',
      message:
        '系统语音引擎无法使用麦克风（不一定是 App 权限关了）。国内机请优先在营地生活填写 Qwen Key，用百炼识别；或到设置里确认麦克风已开。',
      soft: false,
    };
  }
  if (code === 2 || code === 1 || /network|ERROR_NETWORK|Network error|Network timeout/i.test(msg)) {
    return {
      key: 'net',
      message:
        '系统语音识别需要 Google 语音服务（错误码网络/超时）。国内手机通常不可用。请在营地生活填写 Qwen API Key，改用百炼语音识别。',
      soft: false,
    };
  }
  if (code === 7 || /Didn't understand|no match|没听清|ERROR_NO_MATCH|No match/i.test(msg)) {
    return { key: 'nomatch', message: '没听清，请靠近麦克风再说一次。', soft: true };
  }
  if (code === 6 || /No speech|SPEECH_TIMEOUT/i.test(msg)) {
    return { key: 'timeout', message: '没听到声音，请再说一次。', soft: true };
  }
  if (code === 8 || /busy|ERROR_RECOGNIZER_BUSY|RecognitionService busy/i.test(msg)) {
    return { key: 'busy', message: '识别引擎忙，请稍后再试。', soft: true };
  }
  if (code === 3 || /Audio recording error/i.test(msg)) {
    return { key: 'audio', message: '录音失败，请检查是否被其他应用占用麦克风。', soft: false };
  }
  if (code === 5 || /Client side error/i.test(msg)) {
    return {
      key: 'client',
      message: '系统语音客户端异常。请改用百炼识别（营地生活填 Qwen Key）或重启 App 再试。',
      soft: false,
    };
  }
  if (code === 4 || /error from server|ERROR_SERVER/i.test(msg)) {
    return {
      key: 'server',
      message: '系统语音服务器错误。国内请改用百炼识别（填 Qwen Key）。',
      soft: false,
    };
  }
  return { key: 'other', message: `语音识别失败：${msg}`, soft: false };
}

/** 这类失败应立刻改走百炼，而不是再弹 Google 对话框 */
function shouldFallbackToDashScope(raw: string): boolean {
  const { key } = friendlyNativeAsrError(raw);
  return key === 'net' || key === 'perm' || key === 'client' || key === 'server' || key === 'audio';
}

function emitNativeError(handlers: SpeechInputHandlers, raw: string): void {
  const { key, message, soft } = friendlyNativeAsrError(raw);
  const now = Date.now();
  if (soft && key === lastNativeErrKey && now - lastNativeErrAt < 4000) return;
  if (!soft && key === lastNativeErrKey && now - lastNativeErrAt < 2500) return;
  lastNativeErrKey = key;
  lastNativeErrAt = now;
  handlers.onError?.(message);
}

async function ensureSpeechPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const checked = await SpeechRecognition.checkPermissions();
    if (checked.speechRecognition === 'granted') return 'granted';
  } catch {
    /* 插件查询失败时不要直接判死 */
  }
  try {
    const perm = await SpeechRecognition.requestPermissions();
    const state = perm.speechRecognition;
    if (state === 'granted') return 'granted';
    if (state === 'denied') return 'denied';
    if (state === 'prompt') return 'prompt';
  } catch {
    return 'unknown';
  }
  return 'unknown';
}

type NativeOnceResult = 'ok' | 'empty' | 'fail';

async function startNativeOnce(
  handlers: SpeechInputHandlers,
  opts: { popup: boolean; silent?: boolean },
): Promise<{ status: NativeOnceResult; raw?: string }> {
  const mySession = ++nativeSession;
  nativeListening = true;
  if (!opts.silent) {
    handlers.onStart?.();
    handlers.onStatus?.(opts.popup ? '正在听…（系统对话框）' : '正在听…（系统识别）');
  }

  try {
    const result = await SpeechRecognition.start({
      language: 'zh-CN',
      maxResults: 3,
      prompt: '请说话',
      partialResults: true,
      popup: opts.popup,
    });
    if (mySession !== nativeSession) {
      return { status: 'fail', raw: 'cancelled' };
    }
    nativeListening = false;
    const text = result.matches?.find((m) => m?.trim())?.trim();
    if (text) {
      handlers.onPartial?.(text, true);
      handlers.onResult(text);
      handlers.onEnd?.();
      return { status: 'ok' };
    }
    if (!opts.silent) {
      emitNativeError(handlers, "Didn't understand, please try again.");
      handlers.onEnd?.();
    }
    return { status: 'empty', raw: 'No match' };
  } catch (err) {
    if (mySession !== nativeSession) return { status: 'fail', raw: 'cancelled' };
    nativeListening = false;
    void SpeechRecognition.removeAllListeners().catch(() => undefined);
    const msg = err instanceof Error ? err.message : String(err);
    if (!opts.silent) {
      emitNativeError(handlers, msg);
      handlers.onEnd?.();
    }
    return { status: 'fail', raw: msg };
  }
}

/**
 * 系统 Google ASR（国内常失败）。
 * @returns 'ok' 已识别 | 'fallback' 应改百炼 | 'done' 已提示结束勿再试
 */
async function startNativeSpeech(
  handlers: SpeechInputHandlers,
): Promise<'ok' | 'fallback' | 'done'> {
  try {
    const { available } = await SpeechRecognition.available();
    if (!available) return 'fallback';

    const state = await ensureSpeechPermission();
    // 设置里已开麦克风时，OEM 偶发仍报 denied/unknown → 仍尝试一次，失败再降级
    if (state === 'denied') {
      if (hasApiKey()) return 'fallback';
      emitNativeError(handlers, 'Insufficient permissions');
      return 'done';
    }

    const first = await startNativeOnce(handlers, { popup: false });
    if (first.status === 'ok') return 'ok';
    if (first.status === 'empty') return 'done';

    const raw = first.raw || '';
    if (shouldFallbackToDashScope(raw) && hasApiKey()) {
      return 'fallback';
    }

    // 非网络类：再试系统对话框（不静默，让用户看见）
    if (!shouldFallbackToDashScope(raw)) {
      const again = await ensureSpeechPermission();
      if (again === 'denied' && hasApiKey()) return 'fallback';
      const second = await startNativeOnce(handlers, { popup: true });
      if (second.status === 'ok') return 'ok';
      if (second.raw && shouldFallbackToDashScope(second.raw) && hasApiKey()) {
        return 'fallback';
      }
      return 'done';
    }

    // 网络类且无 Key：把友好错误抛给用户
    emitNativeError(handlers, raw || '2');
    handlers.onEnd?.();
    return 'done';
  } catch (err) {
    nativeListening = false;
    void SpeechRecognition.removeAllListeners().catch(() => undefined);
    const msg = err instanceof Error ? err.message : String(err);
    if (/not available|unimplemented|plugin/i.test(msg)) return 'fallback';
    if (hasApiKey() && shouldFallbackToDashScope(msg)) return 'fallback';
    emitNativeError(handlers, msg);
    handlers.onEnd?.();
    return 'done';
  }
}

async function startDashScopeRecording(handlers: SpeechInputHandlers): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) {
    handlers.onError?.('当前环境无法访问麦克风。');
    return false;
  }
  if (!hasApiKey()) {
    handlers.onError?.(
      '国内语音请先在「营地生活」填写 Qwen API Key（百炼识别）；系统 Google 语音在国内通常不可用。',
    );
    return false;
  }

  // 新开录音前作废上一轮识别
  sessionGen += 1;
  abortAsrFetch();
  const myGen = sessionGen;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  } catch {
    handlers.onError?.('麦克风权限被拒绝，请在系统设置→应用→锈带纪元→权限里打开麦克风。');
    return false;
  }

  if (myGen !== sessionGen) {
    stopTracks();
    return false;
  }

  const mime = pickRecorderMime();
  try {
    mediaRecorder = mime
      ? new MediaRecorder(mediaStream, { mimeType: mime })
      : new MediaRecorder(mediaStream);
  } catch {
    stopTracks();
    handlers.onError?.('无法启动录音（WebView MediaRecorder）。请更新 WebView 或改用文字。');
    return false;
  }

  chunks = [];
  recording = true;
  recognizing = false;
  const recorder = mediaRecorder;

  mediaRecorder.ondataavailable = (ev) => {
    if (myGen !== sessionGen) return;
    if (ev.data.size > 0) chunks.push(ev.data);
  };
  mediaRecorder.onerror = () => {
    if (myGen !== sessionGen) return;
    stopSpeechInput();
    handlers.onError?.('录音出错');
    handlers.onEnd?.();
  };
  mediaRecorder.onstop = () => {
    if (myGen !== sessionGen) {
      return;
    }

    const blob = new Blob(chunks, {
      type: recorder.mimeType || mime || 'audio/webm',
    });
    chunks = [];
    recording = false;
    mediaRecorder = null;
    stopTracks();
    clearMaxTimer();

    if (!blob.size) {
      recognizing = false;
      handlers.onError?.('没录到声音，请再点麦克风后说话，再点一次结束。');
      handlers.onEnd?.();
      return;
    }

    recognizing = true;
    handlers.onStatus?.('正在识别…（百炼）');
    abortAsrFetch();
    asrAbort = new AbortController();
    const signal = asrAbort.signal;

    void recognizeWithDashScope(blob, { signal })
      .then((text) => {
        if (myGen !== sessionGen || signal.aborted) return;
        if (text) handlers.onResult(text);
        else handlers.onError?.('没听清，请再说一次');
      })
      .catch((err) => {
        if (myGen !== sessionGen || signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        handlers.onError?.(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (myGen === sessionGen) {
          recognizing = false;
          asrAbort = null;
          handlers.onEnd?.();
        }
      });
  };

  mediaRecorder.start(200);
  handlers.onStart?.();
  handlers.onStatus?.('正在听…再点麦克风结束（百炼）');
  maxTimer = window.setTimeout(() => {
    if (myGen !== sessionGen) return;
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try {
        mediaRecorder.stop();
      } catch {
        /* ignore */
      }
    }
  }, 12_000);
  return true;
}

function startWebSpeech(handlers: SpeechInputHandlers): boolean {
  const SR = getSpeechRecognitionCtor();
  if (!SR) {
    handlers.onError?.('浏览器不支持语音识别。请填 Qwen Key，或打 APK 用百炼识别。');
    return false;
  }

  const rec = new SR();
  webRec = rec;
  const myGen = ++sessionGen;
  rec.lang = 'zh-CN';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;

  rec.onresult = (ev: SpeechRecognitionEvent) => {
    if (myGen !== sessionGen) return;
    const e = ev as SpeechRecognitionEventLoose;
    let interim = '';
    let finalText = '';
    const start = typeof e.resultIndex === 'number' ? e.resultIndex : 0;
    for (let i = start; i < e.results.length; i++) {
      const row = e.results[i];
      const piece = row?.[0]?.transcript?.trim() ?? '';
      if (!piece) continue;
      if (row.isFinal) finalText += piece;
      else interim += piece;
    }
    if (interim) handlers.onPartial?.(interim, false);
    if (finalText) {
      handlers.onPartial?.(finalText, true);
      handlers.onResult(finalText);
    }
  };
  rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
    if (myGen !== sessionGen) return;
    const code = ev.error || 'error';
    if (code !== 'aborted' && code !== 'no-speech') {
      if (code === 'network') {
        handlers.onError?.(
          '浏览器语音 network 失败（连不上 Google）。请填 Qwen Key 用百炼识别。',
        );
      } else if (code === 'not-allowed') {
        handlers.onError?.('麦克风权限被拒绝。');
      } else {
        handlers.onError?.(`语音识别失败：${code}`);
      }
    }
    stopSpeechInput();
    handlers.onEnd?.();
  };
  rec.onend = () => {
    if (webRec === rec) webRec = null;
    if (myGen === sessionGen) handlers.onEnd?.();
  };

  try {
    handlers.onStart?.();
    handlers.onStatus?.('正在听…（浏览器识别）');
    rec.start();
    return true;
  } catch (err) {
    stopSpeechInput();
    handlers.onError?.(err instanceof Error ? err.message : String(err));
    handlers.onEnd?.();
    return false;
  }
}

export function toggleSpeechInput(handlers: SpeechInputHandlers): boolean {
  // 录音中 → 结束并进入识别
  if (recording && mediaRecorder) {
    try {
      mediaRecorder.stop();
    } catch {
      stopSpeechInput();
      handlers.onEnd?.();
    }
    return false;
  }

  // 识别中 / 浏览器听写 / 原生听写 → 取消，不叠新会话
  if (recognizing || webRec || nativeListening) {
    stopSpeechInput();
    handlers.onStatus?.('已取消识别');
    handlers.onEnd?.();
    return false;
  }

  if (isNativeApp()) {
    void (async () => {
      // 国内主路径：有 Key 直接百炼，避开 Google SpeechRecognizer（错误码 2）
      if (hasApiKey()) {
        const ok = await startDashScopeRecording(handlers);
        if (ok) return;
        // getUserMedia 失败时再试系统引擎（极少数机型）
        const native = await startNativeSpeech(handlers);
        if (native === 'ok') return;
        return;
      }

      const native = await startNativeSpeech(handlers);
      if (native === 'ok') return;
      if (native === 'fallback') {
        handlers.onError?.(
          '系统语音不可用（国内常见）。请打开营地生活，填写 Qwen API Key 后即可语音对话。',
        );
        handlers.onEnd?.();
        return;
      }
      // done：已提示
    })();
    return true;
  }

  if (hasApiKey()) {
    void startDashScopeRecording(handlers);
    return true;
  }
  return startWebSpeech(handlers);
}
