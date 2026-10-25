/**
 * 云端安全层：市场版源码本身即为合规文本，无需再做敏感词翻译。
 * 保留 API 供调用方使用；如需本地成人版实现，见 _adult-local/src/ai/cloudSafety.ts。
 */
export const CLOUD_SAFE_REPLACEMENTS: Array<[RegExp, string]> = [];

/** 运行时翻译：市场版为直通（源码已合规）。 */
export function toCloudSafeText(input: string): string {
  return input ?? '';
}

/** 当前是否为云端模型路径。 */
export function isCloudModelTarget(provider: string, model: string): boolean {
  const target = `${provider} ${model}`.toLowerCase();
  if (
    target.includes('local') ||
    target.includes('ollama') ||
    target.includes('127.0.0.1') ||
    target.includes('localhost')
  ) {
    return false;
  }
  return true;
}
