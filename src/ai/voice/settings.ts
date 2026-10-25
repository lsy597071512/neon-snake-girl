const KEY_ENABLED = 'rustbelt.voice.enabled';
const KEY_EXPRESSION_MODE = 'rustbelt.voice.expression-mode';

/**
 * 语音能力总开关（默认开）。
 * 开启后：仅当玩家用麦克风说话时，角色才 TTS 回复；打字仍纯文字。
 * TTS 走百炼 Qwen-Audio-TTS（与对话同一 Qwen API Key）。
 */
export function isVoiceEnabled(): boolean {
  const v = localStorage.getItem(KEY_ENABLED);
  if (v === null) return true;
  return v === '1' || v === 'true';
}

export function setVoiceEnabled(on: boolean): void {
  localStorage.setItem(KEY_ENABLED, on ? '1' : '0');
}

/**
 * 角色表达模式（默认 voice，聊天页右上角开关切换）：
 * - voice：无论玩家用语音、打字还是按钮，角色一律语音回复
 * - text：无论玩家用什么输入，角色一律纯文字回复
 * 与 isVoiceEnabled（能力总开关）正交：总开关关 = 永不 TTS；
 * 总开关开时，每轮是否出声由表达模式决定（不再跟随玩家输入方式）。
 */
export type VoiceExpressionMode = 'voice' | 'text';

export function getVoiceExpressionMode(): VoiceExpressionMode {
  try {
    return localStorage.getItem(KEY_EXPRESSION_MODE) === 'text' ? 'text' : 'voice';
  } catch {
    return 'voice';
  }
}

export function setVoiceExpressionMode(mode: VoiceExpressionMode): void {
  try {
    localStorage.setItem(KEY_EXPRESSION_MODE, mode);
  } catch {
    /* ignore */
  }
}
