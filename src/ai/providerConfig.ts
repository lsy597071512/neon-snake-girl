/**
 * 对话 Provider 配置（多方案可切换）
 *
 * - dashscope（默认 · 产品主路径）：阿里云千问，对话模型默认 qwen-plus-character
 * - openai_compatible（个人测试旁路）：本机 Fable Q4 / Ollama / 家里 GPU
 *
 * 【硬规则】本机 Fable 仅供个人 A/B，不得改默认 Provider，不得为迁就本地旁路
 * 改写千问路径的 Prompt / 温度 / 营地 AI 逻辑。详见 docs/ai-dialogue-pipeline.md §0。
 *
 * 生活路径 / TTS / ASR 仍优先走 DashScope（有 Key 时）；仅「角色对话」可切到本机 GPU。
 */

export type AiChatProviderId = 'dashscope' | 'openai_compatible';

const PROVIDER_STORAGE = 'rust-belt-ai-chat-provider';
const COMPAT_BASE_STORAGE = 'rust-belt-ai-compat-base-url';
const COMPAT_KEY_STORAGE = 'rust-belt-ai-compat-api-key';
const COMPAT_MODEL_STORAGE = 'rust-belt-ai-compat-model';
/** 包内 home-gpu-config 版本戳；变化时强制覆盖手机本地旧隧道/模型 */
const SHIPPED_GPU_CFG_STORAGE = 'rust-belt-ai-shipped-gpu-cfg-id';

/** llama.cpp OpenAI 兼容默认口（本机旁路；Ollama 备胎见 docs/local-ai） */
export const DEFAULT_COMPAT_BASE_URL = 'http://127.0.0.1:8080/v1/chat/completions';

/** 本机唯一本地对话基座：Fable Q4（无 LoRA） */
export const DEFAULT_LOCAL_MODEL = 'fable-q4:latest';

/** @deprecated 使用 DEFAULT_LOCAL_MODEL */
export const DEFAULT_VIOLET_MODEL = DEFAULT_LOCAL_MODEL;

/**
 * 角色 → 本地模型。全体共用同一 Fable 基座；人设由 aiProfiles / Prompt 负责。
 */
export const CHARACTER_MODEL_MAP: Record<string, string> = {
  ashcrow: DEFAULT_LOCAL_MODEL,
  heartforge: DEFAULT_LOCAL_MODEL,
  mirror: DEFAULT_LOCAL_MODEL,
  neoncoil: DEFAULT_LOCAL_MODEL,
  prismrift: DEFAULT_LOCAL_MODEL,
  wireguard: DEFAULT_LOCAL_MODEL,
  frostline: DEFAULT_LOCAL_MODEL,
  pulse: DEFAULT_LOCAL_MODEL,
  dustblade: DEFAULT_LOCAL_MODEL,
  ironrain: DEFAULT_LOCAL_MODEL,
  skyshard: DEFAULT_LOCAL_MODEL,
  stellar: DEFAULT_LOCAL_MODEL,
  outercore: DEFAULT_LOCAL_MODEL,
};

export function resolveCharacterModel(characterId: string): string {
  return CHARACTER_MODEL_MAP[characterId] ?? DEFAULT_LOCAL_MODEL;
}

export async function warmupCharacterModel(characterId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  if (getChatProvider() !== 'openai_compatible') return;
  const baseUrl = getCompatBaseUrl();
  if (!baseUrl) return;
  const model = resolveCharacterModel(characterId);
  if (!model) return;
  try {
    await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${getCompatApiKey() || 'ollama'}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: 'OK' },
          { role: 'user', content: 'ok' },
        ],
        max_tokens: 1,
        keep_alive: -1,
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    /* 预热失败不重要 */
  }
}

export type HomeGpuConfig = {
  version?: number;
  shipId?: string;
  generatedAt?: string;
  provider?: AiChatProviderId;
  model?: string;
  apiKey?: string;
  baseUrlLocal?: string;
  baseUrlLan?: string | null;
  baseUrlTailscale?: string | null;
  baseUrlCloudflare?: string | null;
  baseUrlRemote?: string | null;
  cloudflareQuick?: string | null;
  preferredMode?: 'localhost' | 'lan' | 'tailscale' | 'cloudflare';
  character?: string;
  backend?: string;
  note?: string;
  ollamaHost?: string;
};

function asChatCompletionsUrl(raw: string): string {
  const u = raw.trim().replace(/\/+$/, '');
  if (!u) return u;
  if (/\/v1\/chat\/completions$/i.test(u)) return u;
  if (/\/v1$/i.test(u)) return `${u}/chat/completions`;
  return `${u}/v1/chat/completions`;
}

function pickCloudflareUrl(cfg: HomeGpuConfig): string {
  const direct = (cfg.baseUrlCloudflare || cfg.baseUrlRemote || '').trim();
  if (direct) return asChatCompletionsUrl(direct);
  const quick = (cfg.cloudflareQuick || '').trim();
  if (quick) return asChatCompletionsUrl(quick);
  return '';
}

export function applyHomeGpuConfig(
  cfg: HomeGpuConfig,
  mode: 'localhost' | 'lan' | 'tailscale' | 'cloudflare' | 'remote' = 'localhost',
): { ok: true; baseUrl: string; model: string } | { ok: false; reason: string } {
  const model = (cfg.model || DEFAULT_LOCAL_MODEL).trim();
  let baseUrl = DEFAULT_COMPAT_BASE_URL;
  if (mode === 'localhost') {
    baseUrl = asChatCompletionsUrl(cfg.baseUrlLocal || DEFAULT_COMPAT_BASE_URL);
  } else if (mode === 'lan') {
    if (!cfg.baseUrlLan?.trim()) return { ok: false, reason: '配置里没有局域网地址' };
    baseUrl = asChatCompletionsUrl(cfg.baseUrlLan);
  } else if (mode === 'tailscale') {
    if (!cfg.baseUrlTailscale?.trim()) return { ok: false, reason: '配置里没有 Tailscale 地址' };
    baseUrl = asChatCompletionsUrl(cfg.baseUrlTailscale);
  } else if (mode === 'cloudflare') {
    const cf = pickCloudflareUrl(cfg);
    if (!cf) return { ok: false, reason: '配置里没有 Cloudflare 远程地址' };
    baseUrl = cf;
  } else {
    const remote =
      pickCloudflareUrl(cfg) ||
      (cfg.baseUrlTailscale || '').trim() ||
      (cfg.baseUrlLan || '').trim() ||
      '';
    if (!remote) return { ok: false, reason: '配置里没有远程地址' };
    baseUrl = asChatCompletionsUrl(remote);
  }
  setChatProvider('openai_compatible');
  setCompatModel(model);
  setCompatBaseUrl(baseUrl);
  setCompatApiKey((cfg.apiKey || 'ollama').trim());
  const shipId = (cfg.shipId || cfg.generatedAt || `${cfg.model}|${baseUrl}`).trim();
  try {
    localStorage.setItem(SHIPPED_GPU_CFG_STORAGE, shipId);
  } catch {
    /* ignore */
  }
  return { ok: true, baseUrl, model };
}

export async function forceApplyShippedHomeGpuConfig(): Promise<
  { ok: true; baseUrl: string; model: string; forced: boolean } | { ok: false; reason: string }
> {
  try {
    const res = await fetch(`/home-gpu-config.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
      return { ok: false, reason: '包内无 home-gpu-config.json' };
    }
    const cfg = (await res.json()) as HomeGpuConfig;
    const shipId = (cfg.shipId || cfg.generatedAt || '').trim();
    let prev = '';
    try {
      prev = localStorage.getItem(SHIPPED_GPU_CFG_STORAGE) || '';
    } catch {
      prev = '';
    }
    const currentUrl = getCompatBaseUrl();
    const staleTunnel =
      /trycloudflare\.com/i.test(currentUrl) &&
      !currentUrl.includes((cfg.cloudflareQuick || '').replace(/^https?:\/\//, '').split('/')[0] || '___');
    const staleModel =
      /violet-lotus|ashcrow-fast|ashcrow-32k|rustbelt-|remnant-glm4|glm4-32b/i.test(getCompatModel());
    const needForce = !shipId || prev !== shipId || staleTunnel || staleModel;
    if (!needForce && getChatProvider() === 'openai_compatible') {
      return {
        ok: true,
        baseUrl: getCompatBaseUrl(),
        model: getCompatModel(),
        forced: false,
      };
    }
    try {
      localStorage.removeItem(COMPAT_BASE_STORAGE);
      localStorage.removeItem(COMPAT_MODEL_STORAGE);
    } catch {
      /* ignore */
    }
    const mode =
      cfg.preferredMode === 'tailscale'
        ? 'tailscale'
        : cfg.preferredMode === 'lan'
          ? 'lan'
          : cfg.preferredMode === 'localhost'
            ? 'localhost'
            : cfg.preferredMode === 'cloudflare' ||
                Boolean((cfg.baseUrlCloudflare || cfg.cloudflareQuick || cfg.baseUrlRemote || '').trim())
              ? 'cloudflare'
              : 'remote';
    const r = applyHomeGpuConfig(cfg, mode);
    if (!r.ok) return r;
    return { ...r, forced: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg };
  }
}

/** 本机一键启用 Fable Q4 */
export function applyLocalHomeGpuPreset(model = DEFAULT_LOCAL_MODEL): void {
  applyHomeGpuConfig(
    {
      model,
      apiKey: 'ollama',
      baseUrlLocal: DEFAULT_COMPAT_BASE_URL,
    },
    'localhost',
  );
}

/** @deprecated 使用 applyLocalHomeGpuPreset */
export function applyLocalVioletPreset(model = DEFAULT_LOCAL_MODEL): void {
  applyLocalHomeGpuPreset(model);
}

export async function fetchAndApplyHomeGpuConfig(
  mode: 'localhost' | 'lan' | 'tailscale' | 'cloudflare' | 'remote' = 'localhost',
): Promise<{ ok: true; baseUrl: string; model: string } | { ok: false; reason: string }> {
  try {
    const res = await fetch(`/home-gpu-config.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) {
      return {
        ok: false,
        reason: '未找到 home-gpu-config.json。请先在 PC 配置家里 GPU。',
      };
    }
    const cfg = (await res.json()) as HomeGpuConfig;
    return applyHomeGpuConfig(cfg, mode);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: msg };
  }
}

export function parseHomeGpuConfigJson(raw: string): HomeGpuConfig | null {
  try {
    const cfg = JSON.parse(raw) as HomeGpuConfig;
    if (!cfg || typeof cfg !== 'object') return null;
    return cfg;
  } catch {
    return null;
  }
}

export const PROVIDER_OPTIONS: {
  id: AiChatProviderId;
  label: string;
  note: string;
}[] = [
  {
    id: 'dashscope',
    label: '阿里云千问（默认）',
    note: 'qwen-plus-character · 玩家自备 DashScope Key',
  },
  {
    id: 'openai_compatible',
    label: '家里 GPU / Fable Q4（仅测试）',
    note: '个人 A/B 旁路 · fable-q4 · 默认产品仍是千问',
  },
];

function readStorage(key: string): string {
  try {
    return localStorage.getItem(key)?.trim() ?? '';
  } catch {
    return '';
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value.trim());
  } catch {
    /* ignore */
  }
}

export function getChatProvider(): AiChatProviderId {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  const fromEnv = env?.VITE_AI_CHAT_PROVIDER?.trim();
  if (fromEnv === 'openai_compatible' || fromEnv === 'dashscope') return fromEnv;

  const stored = readStorage(PROVIDER_STORAGE);
  if (stored === 'openai_compatible' || stored === 'dashscope') return stored;
  return 'dashscope';
}

export function setChatProvider(id: AiChatProviderId): void {
  writeStorage(PROVIDER_STORAGE, id);
}

export function getCompatBaseUrl(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  if (env?.VITE_AI_COMPAT_BASE_URL?.trim()) return env.VITE_AI_COMPAT_BASE_URL.trim();
  return readStorage(COMPAT_BASE_STORAGE) || DEFAULT_COMPAT_BASE_URL;
}

export function setCompatBaseUrl(url: string): void {
  writeStorage(COMPAT_BASE_STORAGE, url || DEFAULT_COMPAT_BASE_URL);
}

export function getCompatApiKey(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  if (env?.VITE_AI_COMPAT_API_KEY?.trim()) return env.VITE_AI_COMPAT_API_KEY.trim();
  return readStorage(COMPAT_KEY_STORAGE) || 'ollama';
}

export function setCompatApiKey(key: string): void {
  writeStorage(COMPAT_KEY_STORAGE, key || 'ollama');
}

export function getCompatModel(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  if (env?.VITE_AI_COMPAT_MODEL?.trim()) return env.VITE_AI_COMPAT_MODEL.trim();
  return readStorage(COMPAT_MODEL_STORAGE) || DEFAULT_LOCAL_MODEL;
}

export function setCompatModel(model: string): void {
  writeStorage(COMPAT_MODEL_STORAGE, model || DEFAULT_LOCAL_MODEL);
}

/** 当前是否走本机家里 GPU（Fable Q4）对话旁路 */
export function isLocalHomeGpuDialoguePath(): boolean {
  return getChatProvider() === 'openai_compatible';
}

/** @deprecated 使用 isLocalHomeGpuDialoguePath */
export function isVioletLotusDialoguePath(): boolean {
  return isLocalHomeGpuDialoguePath();
}

export type ResolvedChatEndpoint = {
  provider: AiChatProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  requireApiKey: boolean;
  temperature: number;
  maxTokens: number;
};

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

export function resolveDialogueEndpoint(opts?: {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}): ResolvedChatEndpoint {
  const provider = getChatProvider();

  if (provider === 'openai_compatible') {
    let model = (opts?.model || getCompatModel()).trim();
    if (!model || model.toLowerCase().startsWith('qwen') || model.toLowerCase().includes('plus-character')) {
      model = getCompatModel();
    }
    return {
      provider,
      baseUrl: opts?.baseUrl || getCompatBaseUrl(),
      apiKey: opts?.apiKey || getCompatApiKey(),
      model,
      requireApiKey: false,
      // Fable / llama.cpp：temp 1.0；think=low 时 maxTokens 需给思考留余量
      temperature: 1.0,
      maxTokens: 720,
    };
  }

  return {
    provider: 'dashscope',
    baseUrl: opts?.baseUrl || DASHSCOPE_BASE,
    apiKey: opts?.apiKey || '',
    model: opts?.model || '',
    requireApiKey: true,
    temperature: 1.15,
    maxTokens: 450,
  };
}
