/**
 * OpenAI 兼容 SSE 流式读取 + 从半成品 JSON 中抽出 dialogue 字段。
 * 仅用于对话通道首包；补全/傲娇重写仍走非流式。
 */

/** 从增量 JSON 文本中尽量抽出已写出的 dialogue 字符串（未闭合也返回已生成部分） */
export function extractStreamingDialogueField(accum: string): string {
  const m = /"dialogue"\s*:\s*"/.exec(accum);
  if (!m || m.index == null) return '';
  let i = m.index + m[0].length;
  let out = '';
  while (i < accum.length) {
    const c = accum[i]!;
    if (c === '\\') {
      if (i + 1 >= accum.length) break;
      const n = accum[i + 1]!;
      if (n === 'n') out += '\n';
      else if (n === 't') out += '\t';
      else if (n === 'r') out += '\r';
      else if (n === '"' || n === '\\' || n === '/') out += n;
      else if (n === 'u' && i + 5 < accum.length) {
        const hex = accum.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        out += n;
      } else out += n;
      i += 2;
      continue;
    }
    if (c === '"') break;
    out += c;
    i += 1;
  }
  return out;
}

export type StreamChatHandlers = {
  onDelta?: (fullText: string, delta: string) => void;
  signal?: AbortSignal;
};

/**
 * 读取 chat/completions SSE（stream:true）拼成完整 content。
 * 兼容 `data: {...}` / 多行拼接；忽略空心跳。
 */
export async function readOpenAiChatSse(
  res: Response,
  handlers: StreamChatHandlers = {},
): Promise<string> {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.body) {
    // 少数网关把 stream 当整包 JSON 回
    const data = (await res.json()) as {
      choices?: { message?: { content?: string }; delta?: { content?: string } }[];
    };
    const content =
      data.choices?.[0]?.message?.content ?? data.choices?.[0]?.delta?.content ?? '';
    if (!content) throw new Error('LLM 返回空内容');
    handlers.onDelta?.(content, content);
    return content;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) return;
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const json = JSON.parse(payload) as {
        choices?: { delta?: { content?: string }; message?: { content?: string } }[];
      };
      const piece =
        json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? '';
      if (!piece) return;
      full += piece;
      handlers.onDelta?.(full, piece);
    } catch {
      /* 半截 JSON 行：留给 buffer */
    }
  };

  while (true) {
    if (handlers.signal?.aborted) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new DOMException('Aborted', 'AbortError');
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) consumeLine(line);
  }
  if (buffer.trim()) consumeLine(buffer);

  if (!full.trim()) throw new Error('LLM 流式返回空内容');
  return full;
}
