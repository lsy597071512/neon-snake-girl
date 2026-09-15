import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getStoredApiKey } from '../llmClient';
import type { QwenTtsParams } from './types';

/** 官方非实时 TTS：多模态 generation（非旧 SpeechSynthesizer） */
const TTS_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

export const QWEN_TTS_MODEL = 'qwen3-tts-flash';
export const QWEN_TTS_INSTRUCT_MODEL = 'qwen3-tts-instruct-flash';
/** 声音复刻专用模型；voice 必须是 enrollment 返回的音色 ID */
export const QWEN_TTS_VC_MODEL = 'qwen3-tts-vc-2026-01-22';

/**
 * 仅支持 Flash、不支持 Instruct 的系统音色。
 * 对这些音色若先打 instruct 再回退 flash，会多一次失败请求；
 * 若偶发「错误路由」还会造成听感跳变。
 * @see https://help.aliyun.com/zh/model-studio/qwen-tts-voice-list
 */
export const QWEN_FLASH_ONLY_VOICES = new Set([
  'Katerina',
  'Jennifer',
  'Ryan',
  'Aiden',
]);

export type QwenTtsPath = 'vc' | 'instruct' | 'flash';

export function isClonedQwenVoice(voice: string): boolean {
  return /^qwen-tts-vc-/i.test(voice.trim());
}

export function isFlashOnlyQwenVoice(voice: string): boolean {
  return QWEN_FLASH_ONLY_VOICES.has(voice.trim());
}

/** 按音色解析本应使用的稳定路径（不含会话锁） */
export function resolvePreferredQwenPath(voice: string): QwenTtsPath {
  if (isClonedQwenVoice(voice)) return 'vc';
  if (isFlashOnlyQwenVoice(voice)) return 'flash';
  return 'instruct';
}

export type QwenSynthesizeInput = {
  text: string;
  voice: string;
  params: QwenTtsParams;
  instruction?: string;
  /**
   * 强制合成路径。对话会话内必须固定，禁止 instruct↔flash 来回切（音色会变）。
   * 不传则按音色偏好自动选择，且失败时不跨路径回退。
   */
  forcePath?: QwenTtsPath;
};

export type QwenSynthesizeOutput = {
  blob: Blob;
  contentType: string;
  requestId?: string;
  /** 实际使用的合成路径（供会话锁） */
  path: QwenTtsPath;
};

type TtsJson = {
  request_id?: string;
  code?: string;
  message?: string;
  output?: {
    finish_reason?: string;
    audio?: {
      data?: string;
      url?: string;
      id?: string;
    };
  };
};

function base64ToBlob(b64: string, contentType: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: contentType });
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** OSS 常返回 http；Capacitor https 页会 mixed-content 拦截 → Failed to fetch */
function preferHttpsUrl(url: string): string {
  if (url.startsWith('http://')) return `https://${url.slice('http://'.length)}`;
  return url;
}

async function postJsonNative(url: string, apiKey: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await CapacitorHttp.post({
    url,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    data: body,
    // TTS should fail fast enough to reach the local speech fallback instead
    // of leaving the dialogue blocked for tens of seconds on Android.
    connectTimeout: 12000,
    readTimeout: 20000,
  });
  const text =
    typeof res.data === 'string'
      ? res.data
      : res.data != null
        ? JSON.stringify(res.data)
        : '';
  return { status: res.status, text };
}

async function postJsonWeb(url: string, apiKey: string, body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function fetchAudioBlob(url: string): Promise<Blob> {
  const httpsUrl = preferHttpsUrl(url);
  const tryUrls = httpsUrl === url ? [url] : [httpsUrl, url];

  if (Capacitor.isNativePlatform()) {
    let lastErr: Error | null = null;
    for (const u of tryUrls) {
      try {
        const res = await CapacitorHttp.get({
          url: u,
          responseType: 'arraybuffer',
          connectTimeout: 10000,
          readTimeout: 20000,
        });
        if (res.status < 200 || res.status >= 300) {
          lastErr = new Error(`拉取 TTS 音频失败 HTTP ${res.status}`);
          continue;
        }
        const data = res.data;
        let buffer: ArrayBuffer;
        if (typeof data === 'string') {
          // native 可能返回 base64
          buffer = base64ToArrayBuffer(data);
        } else if (data instanceof ArrayBuffer) {
          buffer = data;
        } else {
          lastErr = new Error('拉取 TTS 音频格式异常');
          continue;
        }
        if (!buffer.byteLength) {
          lastErr = new Error('Qwen TTS 返回空音频');
          continue;
        }
        return new Blob([buffer], { type: 'audio/wav' });
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw lastErr ?? new Error('拉取 TTS 音频失败');
  }

  let lastErr: Error | null = null;
  for (const u of tryUrls) {
    try {
      const audioRes = await fetch(u);
      if (!audioRes.ok) {
        lastErr = new Error(`拉取 TTS 音频失败 HTTP ${audioRes.status}`);
        continue;
      }
      const blob = await audioRes.blob();
      if (!blob.size) {
        lastErr = new Error('Qwen TTS 返回空音频');
        continue;
      }
      return blob;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error('拉取 TTS 音频失败');
}

/**
 * 百炼 Qwen3-TTS（非实时 HTTP）
 * @see https://help.aliyun.com/zh/model-studio/qwen-tts-api
 *
 * 稳定性约定：单次请求只走一条路径，禁止 instruct 失败后再打 flash
 * （那是对话中途「换了一个人」的主因）。
 */
export async function synthesizeQwenTts(
  input: QwenSynthesizeInput,
): Promise<QwenSynthesizeOutput> {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    throw new Error('未配置 Qwen API Key，无法使用语音。请在营地生活面板填入 Key。');
  }

  const preferred = input.forcePath ?? resolvePreferredQwenPath(input.voice);
  // Flash-only / VC 绝不能走 instruct
  const path: QwenTtsPath =
    preferred === 'instruct' &&
    (isClonedQwenVoice(input.voice) || isFlashOnlyQwenVoice(input.voice))
      ? isClonedQwenVoice(input.voice)
        ? 'vc'
        : 'flash'
      : preferred;

  const useInstruct = path === 'instruct' && Boolean(input.instruction?.trim());
  const model =
    path === 'vc'
      ? QWEN_TTS_VC_MODEL
      : useInstruct
        ? QWEN_TTS_INSTRUCT_MODEL
        : QWEN_TTS_MODEL;

  const body = {
    model,
    input: {
      text: input.text.slice(0, 600),
      voice: input.voice,
      language_type: 'Chinese',
      ...(useInstruct
        ? {
            instructions: input.instruction!.trim().slice(0, 800),
            // 关闭语义改写：optimize 每轮重写指令会导致同一角色音色漂移
            optimize_instructions: false,
          }
        : {}),
    },
  };

  const post = Capacitor.isNativePlatform() ? postJsonNative : postJsonWeb;
  const { status, text: raw } = await post(TTS_URL, apiKey, body);

  let data: TtsJson;
  try {
    data = JSON.parse(raw) as TtsJson;
  } catch {
    throw new Error(`Qwen TTS 响应非 JSON（HTTP ${status}）`);
  }

  if (status < 200 || status >= 300 || data.code) {
    const err = new Error(data.message || `Qwen TTS HTTP ${status}`);
    (err as Error & { code?: string; path?: QwenTtsPath }).code = data.code;
    (err as Error & { path?: QwenTtsPath }).path = path;
    throw err;
  }

  const audio = data.output?.audio;
  if (audio?.data) {
    return {
      blob: base64ToBlob(audio.data, 'audio/wav'),
      contentType: 'audio/wav',
      requestId: data.request_id,
      path,
    };
  }
  if (audio?.url) {
    const blob = await fetchAudioBlob(audio.url);
    return {
      blob,
      contentType: blob.type || 'audio/wav',
      requestId: data.request_id,
      path,
    };
  }

  throw new Error('Qwen TTS 未返回音频');
}
