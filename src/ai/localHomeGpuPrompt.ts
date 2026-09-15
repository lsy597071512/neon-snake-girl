/**
 * 本机家里 GPU（Fable Q4）对话适配层 + 双路径共用回答锁
 *
 * - `buildDialogueSystemPrompt`：仅 Fable 叠加协议锁头；千问走人设原文
 * - `buildPlayerTurnPriorityLock`：**千问与 Fable 共用**（本轮先接指挥官原话）
 * 见 docs/ai-dialogue-pipeline.md §0 / §2。
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
- 【速度】dialogue / action / inner_thought 各尽量一句短句；勿注水、勿长独白；能短则短（本机解码按字计时）。
`.trim();

export function buildDialogueSystemPrompt(characterId: string): string {
  const base = buildSystemPrompt(characterId);
  if (!isLocalHomeGpuDialoguePath()) return base;
  return `${LOCAL_HOME_GPU_ADAPTER_HEADER}

${base}`;
}

/**
 * 本轮回答锁（千问与 Fable 共用）：先接指挥官原话，压过欲望/外观独白。
 */
export function buildPlayerTurnPriorityLock(playerMessage: string): string {
  const msg = playerMessage.trim().slice(0, 200);
  return `【本轮回答锁】指挥官原话：「${msg}」。dialogue 必须先直接回应这句话（优先级高于欲望/未了/外观独白/续聊模板）；禁止自报名、禁止抄记念句、禁止演与此刻地点不符的假现场。`;
}

/** @deprecated 同 buildPlayerTurnPriorityLock */
export function buildLocalHomeGpuTurnLock(playerMessage: string): string {
  return `${buildPlayerTurnPriorityLock(playerMessage)} dialogue/action/inner_thought 各一句短句即可。`;
}

/** 本机旁路思考档：low（服务端需 --reasoning auto/on） */
export const LOCAL_HOME_GPU_REASONING_EFFORT = 'low' as const;

/**
 * 本机旁路 completion 上限。
 * think=low 时思考也会占 max_tokens，过低易空 content；640–900 较稳。
 */
export const LOCAL_HOME_GPU_MAX_TOKENS = 720;
