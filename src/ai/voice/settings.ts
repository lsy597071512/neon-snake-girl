const KEY_ENABLED = 'rustbelt.voice.enabled';

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
