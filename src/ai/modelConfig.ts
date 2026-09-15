/**
 * 游戏 AI 模型选型（P2 统一厂商：全栈阿里云 DashScope，玩家自备 API Key）
 *
 * 固定三模型，无级联备用（模型失败直接报错，由上层本地兜底）：
 * - 对话/情感：qwen-plus-character（角色扮演特调，质量优先）
 * - 生活路径/行为调度：qwen-plus（原 NVIDIA minimax-m3 的同档对位；JSON 稳、中文强）
 * - 离线摘要：qwen-flash（压缩型任务，性价比最高；原 qwen-max 降本）
 *
 * 注意：勿用裸名 qwen-flash-character（仅 8K，且易吐散文不吐 JSON）。
 */

export const DEFAULT_CHAT_MODEL = 'qwen-plus-character';
export const DEFAULT_LIFE_MODEL = 'qwen-plus';
export const OFFLINE_SUMMARY_MODEL = 'qwen-flash';

/** 已下线/别名失效 → 当前可用模型 */
const DEPRECATED_MODEL_MAP: Record<string, string> = {
  'qwen-plus-latest': 'qwen-plus',
};

const MODEL_STORAGE = 'rust-belt-ai-model';

function normalizeModelId(raw: string): string {
  const id = raw.trim();
  return DEPRECATED_MODEL_MAP[id] ?? id;
}

export function getConfiguredChatModel(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  if (env?.VITE_QWEN_MODEL?.trim()) return normalizeModelId(env.VITE_QWEN_MODEL);
  try {
    const stored = localStorage.getItem(MODEL_STORAGE);
    if (stored?.trim()) {
      const next = normalizeModelId(stored);
      if (next !== stored.trim()) {
        try {
          localStorage.setItem(MODEL_STORAGE, next);
        } catch {
          /* ignore */
        }
      }
      return next;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_CHAT_MODEL;
}

export function setConfiguredChatModel(model: string): void {
  localStorage.setItem(MODEL_STORAGE, normalizeModelId(model));
}

export function getConfiguredSummaryModel(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  if (env?.VITE_QWEN_SUMMARY_MODEL?.trim()) {
    return normalizeModelId(env.VITE_QWEN_SUMMARY_MODEL);
  }
  return OFFLINE_SUMMARY_MODEL;
}

/** 生活路径/行为调度模型（原 NVIDIA 通道；固定 qwen-plus，可用 env 覆盖） */
export function getConfiguredLifeModel(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  if (env?.VITE_QWEN_LIFE_MODEL?.trim()) return normalizeModelId(env.VITE_QWEN_LIFE_MODEL);
  return DEFAULT_LIFE_MODEL;
}

export const MODEL_OPTIONS: { id: string; label: string; note: string }[] = [
  {
    id: 'qwen-plus-character',
    label: 'Qwen-Plus-Character',
    note: '推荐：角色扮演特调（对话/情感）',
  },
  {
    id: 'qwen-flash-character-2026-02-26',
    label: 'Qwen-Flash-Character',
    note: '更快更省，长上下文（省钱档）',
  },
  { id: 'qwen-plus', label: 'Qwen-Plus', note: '通用稳态打底' },
];
