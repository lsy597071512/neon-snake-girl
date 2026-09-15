export type {
  CharacterVoiceProfile,
  EdgeProsody,
  QwenTtsParams,
  SpeakRequest,
  SpeakResult,
  VoiceEmotion,
  VoiceLineType,
} from './types';
export {
  CHARACTER_VOICE_PROFILES,
  QWEN_YOUNG_FEMALE_VOICES,
  formatProsody,
  getCharacterVoiceProfile,
  listCharacterVoiceProfiles,
} from './characterVoices';
export {
  buildSpeakInstruction,
  emotionToCloudInstruct,
  normalizeEmotion,
  normalizeLineType,
  resolveEdgeProsody,
  resolveQwenProsody,
} from './emotionProsody';
export { prepareSpeakText } from './textPrep';
export { speakDialogue, stopVoicePlayback, unlockAudioPlayback, previewCloudInstruct, clearDialogueVoiceSession, getDialogueVoicePathLock } from './orchestrator';
export { canUseWebSpeechFallback } from './webSpeechFallback';
export { isVoiceSpeaking, onVoiceSpeakingChange } from './player';
export { isVoiceEnabled, setVoiceEnabled } from './settings';
export {
  isSpeechInputSupported,
  isSpeechListening,
  stopSpeechInput,
  toggleSpeechInput,
} from './speechInput';
export {
  inferAsrEmotionHint,
  listeningEmotionHint,
  type AsrEmotionHint,
} from './asrEmotionHint';
export { recognizeWithDashScope } from './dashscopeAsr';
export {
  synthesizeQwenTts,
  QWEN_TTS_MODEL,
  QWEN_TTS_INSTRUCT_MODEL,
  QWEN_FLASH_ONLY_VOICES,
  isFlashOnlyQwenVoice,
  resolvePreferredQwenPath,
} from './qwenTtsClient';
export { isNativeApp, nativePlatform } from './platform';
