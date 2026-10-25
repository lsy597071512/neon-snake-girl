/** 对话 TTS 请求 / 角色音色配置（Qwen-Audio-TTS） */
export type VoiceEmotion =
  | 'joy'
  | 'anger'
  | 'sadness'
  | 'surprise'
  | 'fear'
  | 'disgust'
  | 'neutral'
  | 'thinking';

export type VoiceLineType = 'dialogue' | 'whisper' | 'shout' | 'narration';

/** Qwen TTS 数值韵律：rate/pitch 约 0.5–2.0，volume 0–100 */
export type QwenTtsParams = {
  rate: number;
  pitch: number;
  volume: number;
};

/** @deprecated 兼容旧名 */
export type EdgeProsody = QwenTtsParams;

export type CharacterVoiceProfile = {
  characterId: string;
  /** Qwen TTS voice：系统音色短名，或 qwen-tts-vc-* 复刻音色 ID */
  voice: string;
  /** 旧通道（qwen3-tts-flash）可用的音色：Qwen-Audio 不可用时兜底 */
  legacyVoice?: string;
  /** 调试展示用中文名 */
  voiceLabel: string;
  /** 中性态基线韵律（再叠 emotion） */
  base: QwenTtsParams;
  /** 情感幅度 0.5～1.4：冷角色压低，活泼角色放大 */
  emotionGain: number;
  /**
   * 可选 pitch 下限（默认青年女声约 1.02）。
   * 略御姐/厚重角色可降到 0.95～1.0。
   */
  pitchFloor?: number;
  /** free-style 指令：压年轻女声 + 人设 */
  instruction: string;
  /** 复刻音色不可用时的系统音色兜底（不设则用 Cherry） */
  fallbackVoice?: string;
  /** 选音理由（调试） */
  reason: string;
};

export type SpeakRequest = {
  characterId: string;
  text: string;
  emotion?: string;
  type?: string;
  /** 被打扰态度：略微 sharpen 语速 */
  interruptReaction?: 'welcome' | 'tolerate' | 'annoyed' | 'angry';
  /**
   * 是否朗读本轮。
   * 与 cyber 交互一致：玩家语音输入 → true；玩家打字 → false。
   */
  wantSpeak?: boolean;
};

export type SpeakResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  voice?: string;
  prosody?: QwenTtsParams;
  instruction?: string;
  preparedText?: string;
  durationMs?: number;
};
