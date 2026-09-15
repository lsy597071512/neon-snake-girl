import { getStoredApiKey } from '../llmClient';

const ASR_CHAT_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const ASR_MM_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取录音失败'));
    reader.readAsDataURL(blob);
  });
}

function pickMime(blob: Blob): string {
  const t = blob.type || 'audio/webm';
  if (t.includes('webm')) return 'audio/webm';
  if (t.includes('mp4') || t.includes('m4a')) return 'audio/mp4';
  if (t.includes('mpeg') || t.includes('mp3')) return 'audio/mpeg';
  if (t.includes('wav')) return 'audio/wav';
  if (t.includes('ogg')) return 'audio/ogg';
  return t.split(';')[0] || 'audio/webm';
}

function extractTextFromChat(data: unknown): string {
  const d = data as {
    choices?: { message?: { content?: string | { text?: string }[] } }[];
  };
  const content = d.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : c?.text || ''))
      .join('')
      .trim();
  }
  return '';
}

function extractTextFromMm(data: unknown): string {
  const d = data as {
    output?: {
      choices?: { message?: { content?: { text?: string }[] } }[];
      text?: string;
    };
  };
  if (d.output?.text?.trim()) return d.output.text.trim();
  const parts = d.output?.choices?.[0]?.message?.content;
  if (Array.isArray(parts)) {
    return parts.map((p) => p?.text || '').join('').trim();
  }
  return '';
}

export type DashScopeAsrOpts = {
  signal?: AbortSignal;
};

/** 用百炼 qwen3-asr-flash 识别本地录音（国内可用，不依赖 Google） */
export async function recognizeWithDashScope(
  blob: Blob,
  opts: DashScopeAsrOpts = {},
): Promise<string> {
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    throw new Error('未配置 Qwen API Key，无法使用国内语音识别。请在营地生活填入 Key。');
  }
  if (!blob.size) throw new Error('录音为空，请再说一次');
  if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  let dataUrl = await blobToDataUrl(blob);
  // 统一 MIME，避免浏览器 dataURL 带 codecs= 导致服务端拒识
  const mime = pickMime(blob);
  const b64 = dataUrl.split(',')[1];
  if (!b64) throw new Error('录音编码失败');
  dataUrl = `data:${mime};base64,${b64}`;

  // 1) OpenAI 兼容接口（与现有对话同域名）
  try {
    const res = await fetch(ASR_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: opts.signal,
      body: JSON.stringify({
        model: 'qwen3-asr-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: { data: dataUrl },
              },
            ],
          },
        ],
        asr_options: {
          language: 'zh',
          enable_itn: true,
        },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const text = extractTextFromChat(data);
      if (text) return text;
    }
  } catch (err) {
    if (opts.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      throw err;
    }
    /* fall through */
  }

  if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // 2) 多模态 generation 兜底
  const res2 = await fetch(ASR_MM_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: 'qwen3-asr-flash',
      input: {
        messages: [
          {
            role: 'user',
            content: [{ audio: dataUrl }],
          },
        ],
      },
      parameters: {
        asr_options: {
          language: 'zh',
          enable_itn: true,
        },
      },
    }),
  });

  if (!res2.ok) {
    const errText = await res2.text().catch(() => '');
    throw new Error(`语音识别失败 HTTP ${res2.status}: ${errText.slice(0, 160)}`);
  }
  const data2 = await res2.json();
  const text2 = extractTextFromMm(data2) || extractTextFromChat(data2);
  if (!text2) throw new Error('语音识别结果为空，请再说清楚一点');
  return text2;
}
