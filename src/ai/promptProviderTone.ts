/**
 * 对话提示词按通道微调：
 * 市场版源码本身即为合规文本，无需按通道再做措辞替换，统一直通。
 */
import { isLocalHomeGpuDialoguePath } from './providerConfig';

/** 市场版：源文本已合规，直接返回。 */
export function softenAdultPromptForCloud(text: string): string {
  return text ?? '';
}

/** 组装进模型前：市场版直通。 */
export function applyProviderPromptTone(text: string): string {
  if (!text) return text;
  if (isLocalHomeGpuDialoguePath()) return text;
  return text;
}
