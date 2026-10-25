/**
 * LLM 通道分流：
 * - dialogue：可切 DashScope 千问（默认）或 OpenAI 兼容（本机 Fable Q4 / Ollama）
 * - life / 摘要：仍走 DashScope（需玩家 Key）；失败由上层本地兜底
 */
import {
  chatJsonQwen,
  chatJsonQwenNow,
  chatTextQwenStreamNow,
  enqueueLlmTask,
  hasApiKey,
  hasDialogueEndpointReady,
  isQuotaLikeError,
  type ChatMessage,
  type LlmClientOptions,
} from './llmClient';
import {
  getConfiguredChatModel,
  getConfiguredLifeModel,
  DEFAULT_CHAT_MODEL,
} from './modelConfig';
import { getChatProvider, getCompatModel } from './providerConfig';
import { extractStreamingDialogueField, type StreamChatHandlers } from './llmStream';
import { parseJsonFromLlm } from './llmClient';

export function hasRoutableApiKey(): boolean {
  return hasDialogueEndpointReady() || hasApiKey();
}

/** 对话可用 */
export function hasDialogueApiKey(): boolean {
  return hasDialogueEndpointReady();
}

/** 行为路径可用（生活路径仍要 DashScope Key） */
export function hasLifePathApiKey(): boolean {
  return hasApiKey();
}

export type RoutedChatOpts = LlmClientOptions & {
  timeoutMs?: number;
  forceProvider?: 'qwen' | 'compat';
  channel?: 'dialogue' | 'life' | 'other';
};

/** DashScope 模型名绝不能打到家里 Fable / Ollama 口 */
function isDashScopeModelId(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m.startsWith('qwen') || m.includes('plus-character') || m.startsWith('tongyi');
}

function normalizeDialogueModel(model: string | undefined, fallback: string): string {
  // 家里云端：始终用兼容口模型（fable-q4），忽略传入的千问名
  if (getChatProvider() === 'openai_compatible') {
    if (model && !isDashScopeModelId(model)) return model;
    return fallback || getCompatModel();
  }
  if (!model) return fallback;
  if (model.includes('/') || model.startsWith('gpt')) return fallback;
  return model;
}

/**
 * 按通道分流：
 * - life → qwen-plus（行为调度 JSON，DashScope）
 * - dialogue → Provider 决定千问或本机 Fable Q4
 */
export async function chatJsonRouted<T>(
  messages: ChatMessage[],
  opts: RoutedChatOpts = {},
): Promise<T> {
  const channel = opts.channel ?? 'other';

  if (channel === 'life') {
    return chatJsonQwen<T>(messages, {
      ...opts,
      channel: 'life',
      model: normalizeDialogueModel(opts.model, getConfiguredLifeModel()),
    });
  }

  const dialogueModel =
    getChatProvider() === 'openai_compatible'
      ? getCompatModel()
      : getConfiguredChatModel() || DEFAULT_CHAT_MODEL;

  return chatJsonQwen<T>(messages, {
    ...opts,
    channel: channel === 'dialogue' ? 'dialogue' : 'other',
    model: normalizeDialogueModel(opts.model, dialogueModel),
  });
}

export type DialogueStreamOpts = RoutedChatOpts & {
  /** 抽出的 dialogue 字段增量（已清洗字符串，非原始 JSON） */
  onDialoguePartial?: (dialogueText: string) => void;
  signal?: AbortSignal;
};

/**
 * 对话首包流式：边收边抽出 dialogue；完成后 parse JSON。
 * 玩家直接发言走独立队列，避免被营地后台任务阻塞。
 */
export async function chatDialogueStreamJson<T>(
  messages: ChatMessage[] | (() => Promise<ChatMessage[]>),
  opts: DialogueStreamOpts = {},
): Promise<T> {
  return enqueueLlmTask('interactive', async () => {
    const resolvedMessages = typeof messages === 'function' ? await messages() : messages;
    return chatDialogueStreamJsonNow<T>(resolvedMessages, opts);
  });
}

async function chatDialogueStreamJsonNow<T>(
  messages: ChatMessage[],
  opts: DialogueStreamOpts = {},
): Promise<T> {
  const usingCompat = getChatProvider() === 'openai_compatible';

  // 本机 llama.cpp：优先 SSE 流式（首包出 dialogue，体感快）。失败再回落非流式。
  // 旧 Ollama 口若 SSE 不稳，回落路径仍可用。
  if (usingCompat) {
    const dialogueModel = getCompatModel();
    const model = normalizeDialogueModel(opts.model, dialogueModel);
    if (!hasDialogueEndpointReady()) {
      throw new Error('未配置 OpenAI 兼容接口：请在「营地生活」启用家里云端。');
    }
    try {
      return await _tryDialogueStream<T>(messages, { ...opts, model }, true, {
        timeoutMs: opts.timeoutMs ?? 120_000,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      // 连不上就别再打第二条请求；否则同一次失败会在面板上刷两遍
      if ((err as { network?: boolean } | null)?.network) throw err;
      const abortController = new AbortController();
      const timeoutMs = opts.timeoutMs ?? 120_000;
      const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);
      const onAbort = () => abortController.abort();
      if (opts.signal) {
        if (opts.signal.aborted) abortController.abort();
        else opts.signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        return await chatJsonQwenNow<T>(messages, {
          ...opts,
          model,
          channel: 'dialogue',
          signal: abortController.signal,
        });
      } finally {
        clearTimeout(timeoutHandle);
        opts.signal?.removeEventListener('abort', onAbort);
      }
    }
  }

  // 千问：流式首包。网关偶发空包时仅重试一次，不把空响应直接显示给玩家。
  try {
    return await _tryDialogueStream<T>(messages, opts, false, {
      timeoutMs: opts.timeoutMs ?? 30_000,
    });
  } catch (err) {
    // 网络/DNS 失败时重试无意义，只会让玩家多等一轮再看到同一条报错
    if ((err as { network?: boolean } | null)?.network) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (!/空内容|empty content/i.test(message)) throw err;
    if (opts.signal?.aborted) throw err;
    return _tryDialogueStream<T>(messages, opts, false, {
      timeoutMs: opts.timeoutMs ?? 30_000,
    });
  }
}

/**
 * 实际发起流式对话请求。
 * @param usingCompat  true = openai_compatible（Ollama），false = DashScope 千问
 * @param timeoutMs    请求超时（毫秒）
 */
async function _tryDialogueStream<T>(
  messages: ChatMessage[],
  opts: DialogueStreamOpts,
  usingCompat: boolean,
  { timeoutMs }: { timeoutMs: number },
): Promise<T> {
  let lastDialogue = '';
  let abortController: AbortController | null = null;

  const onDelta: StreamChatHandlers['onDelta'] = (full) => {
    const dialogue = extractStreamingDialogueField(full);
    if (dialogue && dialogue !== lastDialogue) {
      lastDialogue = dialogue;
      opts.onDialoguePartial?.(dialogue);
    }
  };

  const dialogueModel = usingCompat
    ? getCompatModel()
    : getConfiguredChatModel() || DEFAULT_CHAT_MODEL;
  const model = normalizeDialogueModel(opts.model, dialogueModel);

  if (!hasDialogueEndpointReady()) {
    throw new Error(
      usingCompat
        ? '未配置 OpenAI 兼容接口：请在「营地生活」填写 Base URL 与模型名（Fable / Ollama）。'
        : '未配置 API Key：请在「营地生活」填入你自己的阿里云百炼/DashScope API Key（玩家自备）。',
    );
  }

  // 带超时的 signal
  abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController!.abort(), timeoutMs);

  try {
    const rawText = await chatTextQwenStreamNow(
      messages,
      { ...opts, model, channel: 'dialogue' },
      { onDelta, signal: abortController.signal },
    );
    return parseJsonFromLlm<T>(rawText);
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (err instanceof DOMException && err.name === 'AbortError') {
      // 超时或主动取消 → 抛出让上层处理
      throw err;
    }
    // 网络/DNS 失败：回落非流式只会再失败一次，直接把首条错误交给上层
    if ((err as { network?: boolean } | null)?.network) throw err;
    // 流式失败 → 回落非流式。
    // 非流式请求同样可能无限挂起（移动网络黑洞）：加 60 秒硬超时，
    // 并跟随租约信号（玩家发新消息时立即让位），避免交互队列被堵死。
    const fallbackAbort = new AbortController();
    const onLeaseAbort = () => fallbackAbort.abort();
    let leaseListenerAttached = false;
    if (opts.signal) {
      if (opts.signal.aborted) fallbackAbort.abort();
      else {
        opts.signal.addEventListener('abort', onLeaseAbort, { once: true });
        leaseListenerAttached = true;
      }
    }
    const fallbackTimer = setTimeout(
      () => fallbackAbort.abort(new Error('千问非流式响应超时（60 秒），已放弃本轮')),
      60_000,
    );
    try {
      return await chatJsonQwenNow<T>(messages, {
        ...opts,
        model,
        channel: 'dialogue',
        signal: fallbackAbort.signal,
      });
    } finally {
      clearTimeout(fallbackTimer);
      if (leaseListenerAttached && opts.signal) {
        opts.signal.removeEventListener('abort', onLeaseAbort);
      }
    }
  } finally {
    clearTimeout(timeoutHandle);
  }
}
