/**
 * OpenAI 兼容聊天客户端（带简单队列）
 * - 默认：阿里云 DashScope（qwen-plus-character 等）· 玩家 BYOK
 * - 可选：本地/自建 OpenAI 兼容口（Ollama Fable 等）· 见 providerConfig
 */

import {
  DEFAULT_CHAT_MODEL,
  getConfiguredChatModel,
} from './modelConfig';
import {
  getChatProvider,
  resolveDialogueEndpoint,
  type AiChatProviderId,
} from './providerConfig';
import { readOpenAiChatSse, type StreamChatHandlers } from './llmStream';
import { normalizeChatMessagesForStrictTemplate } from './chatMessageNormalize';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type LlmClientOptions = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  /** Player-triggered dialogue must not wait behind camp background work. */
  priority?: 'interactive' | 'background';
  /** Cancels an in-flight request when a newer turn supersedes it. */
  signal?: AbortSignal;
  /**
   * 通道：
   * - dialogue：跟 Provider 切换（可本机 Fable Q4）
   * - life / other：固定 DashScope（有 Key 时）
   */
  channel?: 'dialogue' | 'life' | 'other';
};

const DEFAULT_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

const API_KEY_STORAGE = 'rust-belt-ai-api-key';
const EXHAUST_STORAGE = 'rust-belt-qwen-model-exhausted-v2';

let interactiveQueue: Promise<unknown> = Promise.resolve();
let backgroundQueue: Promise<unknown> = Promise.resolve();
const exhaustedModels = new Set<string>(loadExhaustedModels());

function loadExhaustedModels(): string[] {
  try {
    const raw = sessionStorage.getItem(EXHAUST_STORAGE);
    if (!raw) return [];
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persistExhaustedModels(): void {
  try {
    sessionStorage.setItem(EXHAUST_STORAGE, JSON.stringify([...exhaustedModels]));
  } catch {
    /* ignore */
  }
}

export function markQwenModelExhausted(model: string): void {
  exhaustedModels.add(model);
  persistExhaustedModels();
}

export function clearQwenModelExhaustion(): void {
  exhaustedModels.clear();
  try {
    sessionStorage.removeItem(EXHAUST_STORAGE);
  } catch {
    /* ignore */
  }
}

function isModelExhausted(model: string): boolean {
  return exhaustedModels.has(model);
}

function throwHttpError(status: number, body: string, model: string): never {
  const err = new Error(`LLM HTTP ${status}: ${body.slice(0, 200)}`) as Error & {
    status?: number;
    quota?: boolean;
    model?: string;
  };
  err.status = status;
  err.model = model;
  err.quota = isQuotaLikeError(status, body);
  if (err.quota) markQwenModelExhausted(model);
  throw err;
}

/** 配额/欠费类错误识别（原 gptGatewayClient 实现，随厂商统一内联） */
export function isQuotaLikeError(status: number, body: string): boolean {
  if (status === 402 || status === 429) return true;
  const t = body.toLowerCase();
  return /insufficient[_\s-]?quota|quota[_\s-]?exceeded|billing|balance|payment.?required|pre_consume|额度|余额|用尽|耗尽|不足|over.?quota|credit|no remaining|资源包/.test(
    t,
  );
}

/** 固定单模型：无级联备用（失败直接抛，由上层本地兜底） */
function cascadeModels(preferred: string): string[] {
  return [preferred];
}

/**
 * 玩家自备 Key（BYOK）：只读本地存储，不再回落构建期环境变量——
 * 保证发布产物内不含任何开发者密钥。
 */
export function getStoredApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setStoredApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE, key.trim());
}

export function hasApiKey(): boolean {
  return Boolean(getStoredApiKey());
}

/** 角色对话是否已可发起（千问要 Key；兼容口要 Base URL） */
export function hasDialogueEndpointReady(): boolean {
  if (getChatProvider() === 'openai_compatible') {
    return Boolean(resolveDialogueEndpoint().baseUrl);
  }
  return hasApiKey();
}

function resolveRequest(opts: LlmClientOptions = {}): {
  provider: AiChatProviderId | 'dashscope_forced';
  apiKey: string;
  model: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
} {
  const channel = opts.channel ?? 'other';
  const useCompat = channel === 'dialogue' && getChatProvider() === 'openai_compatible';

  if (useCompat) {
    const ep = resolveDialogueEndpoint({
      apiKey: opts.apiKey,
      model: opts.model,
      baseUrl: opts.baseUrl,
    });
    if (!ep.baseUrl) {
      throw new Error('未配置 OpenAI 兼容 Base URL：请在「营地生活」填写 Ollama/Fable 接口地址。');
    }
    return {
      provider: 'openai_compatible',
      apiKey: ep.apiKey || 'ollama',
      model: ep.model,
      baseUrl: ep.baseUrl,
      temperature: opts.temperature ?? ep.temperature,
      maxTokens: opts.maxTokens ?? ep.maxTokens,
    };
  }

  const apiKey = opts.apiKey || getStoredApiKey();
  if (!apiKey) {
    throw new Error(
      '未配置 API Key：请在「营地生活」填入你自己的阿里云百炼/DashScope API Key（玩家自备）。',
    );
  }
  return {
    provider: 'dashscope_forced',
    apiKey,
    model: opts.model || getConfiguredChatModel() || DEFAULT_CHAT_MODEL,
    baseUrl: opts.baseUrl || DEFAULT_BASE,
    temperature: opts.temperature ?? 1.15,
    maxTokens: opts.maxTokens ?? 450,
  };
}

type OpenAiChatMessage = {
  role?: string;
  content?: string;
  reasoning?: string;
};

function stripFence(text: string): string {
  const t = text.trim();
  if (!t.includes('```')) return t;
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  return m ? m[1].trim() : t;
}

async function postChatCompletion(
  req: { baseUrl: string; apiKey: string; model: string; temperature: number },
  messages: ChatMessage[],
  extras: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<OpenAiChatMessage> {
  const res = await fetch(req.baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({
      model: req.model,
      messages,
      temperature: req.temperature,
      ...extras,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throwHttpError(res.status, text, req.model);
  }
  const data = (await res.json()) as {
    choices?: { message?: OpenAiChatMessage }[];
  };
  return data.choices?.[0]?.message ?? {};
}

/**
 * 本机 OpenAI 兼容口（llama.cpp / Ollama）：
 * - think=low（reasoning_effort）；内心戏仍以 JSON inner_thought 为主
 * - max_tokens 需给思考留余量（约 720），过低易空 content
 * - 若偶发空 content：抬预算再试 → 仍空则报错
 */
async function rawCompatChatLocal(
  req: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
  },
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const budget = Math.min(Math.max(req.maxTokens, 480), 960);
  const attempts: Array<Record<string, unknown>> = [
    { max_tokens: budget, reasoning_effort: 'low' },
    { max_tokens: Math.min(budget + 200, 960), reasoning_effort: 'low' },
  ];
  let lastErr = 'LLM 返回空内容';
  for (const extras of attempts) {
    const msg = await postChatCompletion(
      req,
      messages,
      {
        ...extras,
        // llama.cpp 忽略 keep_alive；Ollama 备胎时仍有用
        keep_alive: -1,
      },
      signal,
    );
    const content = stripFence(msg.content ?? '');
    if (content) return content;
    lastErr = msg.reasoning
      ? 'LLM 返回空 content（thinking 占满预算）'
      : 'LLM 返回空内容';
  }
  throw new Error(lastErr);
}

async function rawChat(messages: ChatMessage[], opts: LlmClientOptions = {}): Promise<string> {
  const req = resolveRequest(opts);
  const payloadMessages =
    req.provider === 'openai_compatible'
      ? normalizeChatMessagesForStrictTemplate(messages)
      : messages;

  if (req.provider === 'openai_compatible') {
    return rawCompatChatLocal(req, payloadMessages, opts.signal);
  }

  const msg = await postChatCompletion(
    req,
    payloadMessages,
    { max_tokens: req.maxTokens },
    opts.signal,
  );
  const content = stripFence(msg.content ?? '');
  if (!content) throw new Error('LLM 返回空内容');
  return content;
}

function enqueue<T>(priority: LlmClientOptions['priority'], task: () => Promise<T>): Promise<T> {
  const previous = priority === 'interactive' ? interactiveQueue : backgroundQueue;
  const run = previous.then(task);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  if (priority === 'interactive') interactiveQueue = settled;
  else backgroundQueue = settled;
  return run;
}

/**
 * Queues work before its request payload is built. This is required for live
 * dialogue, where scene state must be read when the request actually starts.
 */
export function enqueueLlmTask<T>(
  priority: LlmClientOptions['priority'],
  task: () => Promise<T>,
): Promise<T> {
  return enqueue(priority, task);
}

export function enqueueChat(messages: ChatMessage[], opts?: LlmClientOptions): Promise<string> {
  return enqueue(opts?.priority, () => rawChat(messages, opts));
}

async function rawChatStream(
  messages: ChatMessage[],
  opts: LlmClientOptions = {},
  handlers: StreamChatHandlers = {},
): Promise<string> {
  const req = resolveRequest(opts);
  const payloadMessages =
    req.provider === 'openai_compatible'
      ? normalizeChatMessagesForStrictTemplate(messages)
      : messages;

  const res = await fetch(req.baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    signal: handlers.signal ?? opts.signal,
    body: JSON.stringify({
      model: req.model,
      messages: payloadMessages,
      temperature: req.temperature,
      max_tokens:
        req.provider === 'openai_compatible'
          ? Math.min(Math.max(req.maxTokens, 480), 960)
          : req.maxTokens,
      stream: true,
      ...(req.provider === 'openai_compatible'
        ? { keep_alive: -1, reasoning_effort: 'low' }
        : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throwHttpError(res.status, text, req.model);
  }

  try {
    return await readOpenAiChatSse(res, handlers);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (req.provider !== 'openai_compatible' && isQuotaLikeError(0, msg)) {
      markQwenModelExhausted(req.model);
    }
    throw err;
  }
}

/** Runs a streaming request immediately; callers that need scheduling use enqueueLlmTask. */
export async function chatTextQwenStreamNow(
  messages: ChatMessage[],
  opts?: LlmClientOptions,
  handlers?: StreamChatHandlers,
): Promise<string> {
  const channel = opts?.channel ?? 'dialogue';
  let preferred = opts?.model;
  if (!preferred) {
    if (channel === 'dialogue' && getChatProvider() === 'openai_compatible') {
      preferred = resolveDialogueEndpoint().model;
    } else {
      preferred = getConfiguredChatModel();
    }
  }
  const cascade = cascadeModels(preferred);
  let lastErr: unknown;
  for (const model of cascade) {
    try {
      return await rawChatStream(messages, { ...opts, model, channel }, handlers);
    } catch (err) {
      lastErr = err;
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      const e = err as Error & { quota?: boolean };
      if (e.quota || isQuotaLikeError(0, e.message || '')) markQwenModelExhausted(model);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function enqueueChatStream(
  messages: ChatMessage[],
  opts?: LlmClientOptions,
  handlers?: StreamChatHandlers,
): Promise<string> {
  return enqueue(opts?.priority, () => rawChatStream(messages, opts, handlers));
}

/** 纯文本流式（对话首包）；失败时由上层回退非流式 */
export async function chatTextQwenStream(
  messages: ChatMessage[],
  opts?: LlmClientOptions,
  handlers?: StreamChatHandlers,
): Promise<string> {
  return enqueue(opts?.priority, () => chatTextQwenStreamNow(messages, opts, handlers));
}

export function parseJsonFromLlm<T>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        /* fall through */
      }
    }
    // 本机 Fable Q4 偶发纯中文：包成对话 JSON，避免整轮失败成「……」
    if (getChatProvider() === 'openai_compatible' && trimmed && !trimmed.startsWith('{')) {
      const spoken = trimmed.split('\n').map((l) => l.replace(/^["']|["']$/g, '').trim()).find(Boolean) || trimmed;
      return {
        dialogue: spoken.slice(0, 180),
        action: '',
        inner_thought: '',
        emotion: 'calm',
        want_continue: false,
      } as T;
    }
    throw new Error('无法解析 LLM JSON');
  }
}

/** Parses a non-streaming request without entering a queue again. */
export async function chatJsonQwenNow<T>(
  messages: ChatMessage[],
  opts?: LlmClientOptions,
): Promise<T> {
  const channel = opts?.channel ?? 'other';
  let preferred = opts?.model;
  if (!preferred) {
    if (channel === 'dialogue' && getChatProvider() === 'openai_compatible') {
      preferred = resolveDialogueEndpoint().model;
    } else {
      preferred = getConfiguredChatModel();
    }
  }
  const cascade = cascadeModels(preferred);
  let lastErr: unknown;
  for (const model of cascade) {
    try {
      return parseJsonFromLlm<T>(await rawChat(messages, { ...opts, model, channel }));
    } catch (err) {
      lastErr = err;
      const e = err as Error & { quota?: boolean };
      if (e.quota || isQuotaLikeError(0, e.message || '')) markQwenModelExhausted(model);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 纯阿里云 Qwen（离线摘要等质量优先通道） */
export async function chatJsonQwen<T>(messages: ChatMessage[], opts?: LlmClientOptions): Promise<T> {
  return enqueue(opts?.priority, () => chatJsonQwenNow<T>(messages, opts));
}

/** @deprecated 请优先用 chatJsonRouted；此处仍指向纯 Qwen 以兼容旧调用 */
export const chatJson = chatJsonQwen;
