import { getCharacterVoiceProfile } from './characterVoices';
import {
  resolvePreferredQwenPath,
  synthesizeQwenTts,
  type QwenTtsPath,
} from './qwenTtsClient';
import {
  buildSpeakInstruction,
  emotionToCloudInstruct,
  normalizeEmotion,
  resolveQwenProsody,
} from './emotionProsody';
import {
  markVoiceSpeaking,
  playVoiceBlob,
  stopVoicePlayback,
  unlockAudioPlayback,
} from './player';
import { isVoiceEnabled } from './settings';
import { prepareSpeakText } from './textPrep';
import type { SpeakRequest, SpeakResult } from './types';
import {
  canUseWebSpeechFallback,
  speakWithWebSpeechFallback,
} from './webSpeechFallback';

export { stopVoicePlayback, unlockAudioPlayback };

/** 对话会话内锁定合成路径，禁止同一角色 instruct↔flash↔系统朗读来回跳 */
type SessionVoicePath = QwenTtsPath | 'webspeech';
const pathLocks = new Map<string, SessionVoicePath>();

export function clearDialogueVoiceSession(characterId?: string): void {
  if (characterId) pathLocks.delete(characterId);
  else pathLocks.clear();
}

export function getDialogueVoicePathLock(characterId: string): SessionVoicePath | undefined {
  return pathLocks.get(characterId);
}

function isAuthOrNetworkFailure(message: string): boolean {
  return /401|403|forbidden|api key|未配置|network|failed to fetch|timeout|CORS/i.test(
    message,
  );
}

/**
 * 对话结果 → 清洗 → Qwen-TTS 合成 → 播放
 * 默认仅当 wantSpeak=true（玩家语音输入）时朗读。
 *
 * 音色稳定性：
 * - 每角色在本轮对话锁定唯一合成路径（vc / instruct / flash）
 * - 禁止 instruct 失败后静默改走 flash（听感像换人）
 * - Qwen 已成功过则禁止再回退系统 speechSynthesis
 */
export async function speakDialogue(req: SpeakRequest): Promise<SpeakResult> {
  if (!isVoiceEnabled()) {
    return { ok: false, skipped: true, reason: 'voice_disabled' };
  }
  if (!req.wantSpeak) {
    return { ok: false, skipped: true, reason: 'text_mode' };
  }

  unlockAudioPlayback();

  const preparedText = prepareSpeakText(req.text);
  if (!preparedText) {
    return { ok: false, skipped: true, reason: 'empty_text' };
  }

  const profile = getCharacterVoiceProfile(req.characterId);
  const prosody = resolveQwenProsody(req);
  const instruction = buildSpeakInstruction(req);
  const locked = pathLocks.get(req.characterId);

  // 已锁定系统朗读：整段对话保持同一回退声，避免突然切回云端又换一次
  if (locked === 'webspeech') {
    if (!canUseWebSpeechFallback()) {
      return {
        ok: false,
        reason: '系统朗读不可用',
        voice: 'system-speechSynthesis',
        prosody,
        instruction,
        preparedText,
      };
    }
    try {
      stopVoicePlayback();
      markVoiceSpeaking(true);
      const durationMs = await speakWithWebSpeechFallback(preparedText, {
        rate: prosody.rate,
        pitch: prosody.pitch,
      });
      return {
        ok: true,
        voice: 'system-speechSynthesis',
        prosody,
        instruction,
        preparedText,
        durationMs,
      };
    } catch (fallbackErr) {
      const fb = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      return {
        ok: false,
        reason: fb,
        voice: 'system-speechSynthesis',
        prosody,
        instruction,
        preparedText,
      };
    } finally {
      markVoiceSpeaking(false);
    }
  }

  const forcePath: QwenTtsPath =
    locked === 'vc' || locked === 'instruct' || locked === 'flash'
      ? locked
      : resolvePreferredQwenPath(profile.voice);

  try {
    const { blob, path } = await synthesizeQwenTts({
      text: preparedText,
      voice: profile.voice,
      params: prosody,
      instruction: forcePath === 'instruct' ? instruction : undefined,
      forcePath,
    });
    pathLocks.set(req.characterId, path);
    const durationMs = await playVoiceBlob(blob);
    return {
      ok: true,
      voice: profile.voice,
      prosody,
      instruction,
      preparedText,
      durationMs,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[voice] Qwen TTS failed:', message, { forcePath, locked });

    // 已锁定云端路径：宁可本句失败，也不换路径/系统声（防中途换音色）
    if (locked === 'vc' || locked === 'instruct' || locked === 'flash') {
      return {
        ok: false,
        reason: message,
        voice: profile.voice,
        prosody,
        instruction,
        preparedText,
      };
    }

    // 首次失败：若偏好 instruct，尝试一次固定 flash 并锁定（之后不再回 instruct）
    if (forcePath === 'instruct') {
      try {
        const { blob, path } = await synthesizeQwenTts({
          text: preparedText,
          voice: profile.voice,
          params: prosody,
          forcePath: 'flash',
        });
        pathLocks.set(req.characterId, path);
        console.info('[voice] first-turn instruct failed → lock flash for session');
        const durationMs = await playVoiceBlob(blob);
        return {
          ok: true,
          voice: profile.voice,
          prosody,
          instruction,
          preparedText,
          durationMs,
        };
      } catch (flashErr) {
        const flashMsg = flashErr instanceof Error ? flashErr.message : String(flashErr);
        console.warn('[voice] flash fallback also failed:', flashMsg);
      }
    }

    // 仅会话第一句、且云端全挂时，才允许系统朗读，并锁定 webspeech
    if (isAuthOrNetworkFailure(message) && canUseWebSpeechFallback()) {
      try {
        stopVoicePlayback();
        markVoiceSpeaking(true);
        const durationMs = await speakWithWebSpeechFallback(preparedText, {
          rate: prosody.rate,
          pitch: prosody.pitch,
        });
        pathLocks.set(req.characterId, 'webspeech');
        console.info('[voice] fell back to Web Speech Synthesis (locked for session)');
        return {
          ok: true,
          voice: 'system-speechSynthesis',
          prosody,
          instruction,
          preparedText,
          durationMs,
        };
      } catch (fallbackErr) {
        const fb = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        console.warn('[voice] Web Speech fallback failed:', fb);
        return {
          ok: false,
          reason: `${message}；系统朗读亦失败：${fb}`,
          voice: profile.voice,
          prosody,
          instruction,
          preparedText,
        };
      } finally {
        markVoiceSpeaking(false);
      }
    }

    return {
      ok: false,
      reason: message,
      voice: profile.voice,
      prosody,
      instruction,
      preparedText,
    };
  }
}

export function previewCloudInstruct(emotion?: string): string {
  return emotionToCloudInstruct(normalizeEmotion(emotion));
}
