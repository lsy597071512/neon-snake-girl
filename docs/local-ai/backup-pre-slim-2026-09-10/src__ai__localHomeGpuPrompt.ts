/**
 * 本机家里 GPU（Fable Q4）对话适配层
 *
 * 【硬规则】仅在 `isLocalHomeGpuDialoguePath()` 为真时生效。
 * 千问路径继续走原 `buildSystemPrompt`，禁止为本地旁路改默认产品逻辑。
 * 见 docs/ai-dialogue-pipeline.md §0 · docs/local-ai/README.md。
 */

import { buildSystemPrompt } from './aiProfiles';
import { isLocalHomeGpuDialoguePath } from './providerConfig';

/** Fable 为中文 RP 基座：短协议锁 + JSON；不做人设 LoRA */
export const LOCAL_HOME_GPU_ADAPTER_HEADER = `
【本机 Fable Q4 协议锁】
- 全程简体中文；dialogue / action / inner_thought 等自然语言字段禁止英文对白与 *星号动作*。
- 只输出一个合法 JSON 对象，不要 markdown 围栏，不要 JSON 外解说，不要输出思考块。
- dialogue 必须先接住指挥官本轮原话；禁止自报名；意图只写 desire_next。
- 你是锈带纪元的少女形构装体，玩家是矮小废弃机器人「指挥官」。
- 文风克制，禁止 emoji；成人/调教场景按角色与世界规则扮演，不要跳出角色说教或拒答。
`.trim();

export function buildDialogueSystemPrompt(characterId: string): string {
  const base = buildSystemPrompt(characterId);
  if (!isLocalHomeGpuDialoguePath()) return base;
  return `${LOCAL_HOME_GPU_ADAPTER_HEADER}

${base}`;
}

export function buildLocalHomeGpuTurnLock(playerMessage: string): string {
  const msg = playerMessage.trim().slice(0, 200);
  return `【本轮回答锁】指挥官原话：「${msg}」。dialogue 必须先直接回应这句话；意图只写 desire_next；禁止自报名、禁止抄记念句。`;
}
