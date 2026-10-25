import { getCharacterVoiceProfile, legacyVoiceFor, systemFallbackVoiceFor } from './characterVoices';
import {
  synthesizeQwen3Tts,
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


/**
 * 对话结果 → 清洗 → Qwen-TTS 合成 → 播放
 * 默认仅当 wantSpeak=true（玩家语音输入）时朗读。
 *
 * 音色稳定性：
 * - 每角色在本轮对话锁定唯一合成路径（vc / instruct / flash）
 * - 禁止 instruct 失败后静默改走 flash（听感像换人）
 * - Qwen 已成功过则禁止再回退系统 speechSynthesis
 */
/**
 * 角色音色身份锁（Voice Identity Lock）
 * ------------------------------------------------------------------
 * 目标：同一个角色在一局游戏里声音**绝不跳变**。
 * 之前的跳变来源有 4 个，这里逐个堵死：
 *  1) 通道切换：云端失败就改走旧通道/系统朗读 → 音色完全换人。
 *     现在：一旦某角色成功出声过，就锁死它的通道+音色；后续只允许"同一通道同一声线重试"，
 *     宁可这一句静音，也绝不换声线。
 *  2) 情绪改音高：情绪 pitch 偏移会让同一角色每句音高不同，听起来像换人。
 *     现在：音高固定为角色基线（见 emotionProsody），情绪只走语速/音量/instruction。
 *  3) 云端随机性：同一音色不同 seed 的渲染细节会飘。
 *     现在：每个角色使用由 characterId 派生的固定 seed → 同一角色每次渲染完全一致。
 *  4) 旧复刻音色与系统音色混用：见 tryLegacyVoices，已收敛为"仅在首次出声前允许"。
 */
type VoiceChannel = 'audio' | 'legacy' | 'webspeech';
interface VoiceIdentity {
  channel: VoiceChannel;
  /** 实际使用的音色（云端音色 ID 或 'system-speechSynthesis'） */
  voice: string;
}

const voiceIdentities = new Map<string, VoiceIdentity>();
/** 角色是否已经成功出声过（出声后禁止再切通道） */
const voicedOnce = new Set<string>();

export function getVoiceIdentity(characterId: string): VoiceIdentity | undefined {
  return voiceIdentities.get(characterId);
}

/** 改音色配置后可手动清空身份锁（例如切换整套角色音色） */
export function resetVoiceIdentities(): void {
  voiceIdentities.clear();
  voicedOnce.clear();
  pathLocks.clear();
}

/**
 * 判断失败是否为"永久性"（音色/模型/参数不被支持）。
 * 临时故障（限流、超时、网络）不得触发换声线，否则会出现"同一角色忽然换了个人"。
 */
function isPermanentVoiceFailure(message: string): boolean {
  const m = (message || '').toLowerCase();
  if (!m) return false;
  const permanent = [
    'invalidparameter',
    'invalid voice',
    'not exist',
    'model not',
    'not licensed',
    'unsupported',
    'invalidapi',
    'unauthorized',
    'accessdenied',
    'invalid access',
  ];
  if (permanent.some((k) => m.includes(k))) return true;
  const transient = ['throttling', 'timeout', 'timed out', '429', '500', '502', '503', '504', 'network', 'failed to fetch', 'econnreset'];
  if (transient.some((k) => m.includes(k))) return false;
  return false;
}

/** 由角色 id 派生固定 seed：同一角色每次合成都用同一 seed，音色细节稳定不飘 */
function seedForCharacter(characterId: string): number {
  let h = 2166136261;
  for (let i = 0; i < characterId.length; i++) {
    h ^= characterId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 1000 + (Math.abs(h) % 60000);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  const identity = voiceIdentities.get(req.characterId);
  const seed = seedForCharacter(req.characterId);

  // 配置里换了音色（用户主动调音）时，采纳新音色——这属于显式变更，不是"跳变"
  if (identity && identity.channel === 'audio' && identity.voice !== profile.voice) {
    voiceIdentities.set(req.characterId, { channel: 'audio', voice: profile.voice });
    return speakDialogue(req);
  }
  if (identity && identity.channel === 'legacy' && identity.voice !== legacyVoiceFor(req.characterId)) {
    voiceIdentities.set(req.characterId, {
      channel: 'legacy',
      voice: legacyVoiceFor(req.characterId),
    });
    return speakDialogue(req);
  }

  // 已锁定系统朗读：整段对话保持同一回退声，避免突然切回云端又换一次
  // 身份锁优先：如果身份锁说"用云端音色"，这里的旧 path 锁必须让位（否则会出现跳变）
  if (locked === 'webspeech' && (!identity || identity.channel === 'webspeech')) {
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
      voiceIdentities.set(req.characterId, {
        channel: 'webspeech',
        voice: 'system-speechSynthesis',
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

  let lastMessage = '';

  /** 云端主通道：同一 voice + 同一 seed，失败重试同一条路径 */
  const tryAudio = async (voice: string): Promise<Blob | null> => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { blob } = await synthesizeQwenTts({
          text: preparedText,
          voice,
          params: prosody,
          instruction,
          seed,
        });
        return blob;
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        lastMessage = m;
        console.warn('[voice] Qwen-Audio-TTS failed:', m, { voice, attempt });
        await sleep(300 + attempt * 400);
      }
    }
    return null;
  };

  /** 旧通道：只在"该角色还没出声过"时允许，避免出声后换声线 */
  const tryLegacy = async (
    opts?: { allowMigrated?: boolean },
  ): Promise<{ voice: string; blob: Blob } | null> => {
    // 只有"音色/模型本身不可用"才允许退旧通道；
    // 限流/网络抖动属于临时故障，宁可这一句静音也不要换声线
    if (!opts?.allowMigrated && !isPermanentVoiceFailure(lastMessage)) {
      console.warn('[voice] transient failure, keep voice identity (no legacy swap):', lastMessage);
      return null;
    }
    if (!opts?.allowMigrated && voicedOnce.has(req.characterId)) return null;
    const candidates = [
      legacyVoiceFor(req.characterId),
      systemFallbackVoiceFor(req.characterId),
    ];
    const tried = new Set<string>();
    for (const candidate of candidates) {
      const v = candidate?.trim();
      if (!v || tried.has(v)) continue;
      tried.add(v);
      try {
        const { blob } = await synthesizeQwen3Tts({
          text: preparedText,
          voice: v,
          params: prosody,
          forcePath: 'flash',
        });
        return { voice: v, blob };
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        lastMessage = m;
        console.warn('[voice] legacy voice failed:', v, m);
      }
    }
    return null;
  };

  /** 已锁定的通道：只允许同通道同音色重试，绝不换声线 */
  if (identity) {
    if (identity.channel === 'audio') {
      const blob = await tryAudio(identity.voice);
      if (blob) {
        pathLocks.set(req.characterId, 'audio');
        const durationMs = await playVoiceBlob(blob, {
          rate: prosody.rate,
          pitch: prosody.pitch,
        });
        return {
          ok: true,
          voice: identity.voice,
          prosody,
          instruction,
          preparedText,
          durationMs,
        };
      }
      // 永久性失败（音色/模型被下线）：这时"换声线"是唯一出路，
      // 但只允许迁移一次并把新声线锁死，避免在多声线之间反复横跳。
      if (isPermanentVoiceFailure(lastMessage)) {
        const migrated = await tryLegacy({ allowMigrated: true });
        if (migrated) {
          voiceIdentities.set(req.characterId, {
            channel: 'legacy',
            voice: migrated.voice,
          });
          pathLocks.set(req.characterId, 'flash');
          console.warn('[voice] permanent failure → migrated once to legacy voice:', migrated.voice);
          const durationMs = await playVoiceBlob(migrated.blob);
          return {
            ok: true,
            voice: migrated.voice,
            prosody,
            instruction,
            preparedText,
            durationMs,
          };
        }
      }
      // 同一角色不允许换声线：这一句静音，但保持锁定
      console.warn('[voice] locked voice failed, staying silent to avoid voice swap:', identity.voice);
      return {
        ok: false,
        reason: lastMessage || '语音服务暂不可用',
        voice: identity.voice,
        prosody,
        instruction,
        preparedText,
      };
    }
    if (identity.channel === 'webspeech') {
      // 已锁定系统朗读：保持同一回退声，不允许跳回云端换声线
      if (!canUseWebSpeechFallback()) {
        return {
          ok: false,
          reason: '系统朗读不可用',
          voice: identity.voice,
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
        pathLocks.set(req.characterId, 'webspeech');
        return {
          ok: true,
          voice: identity.voice,
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
          voice: identity.voice,
          prosody,
          instruction,
          preparedText,
        };
      } finally {
        markVoiceSpeaking(false);
      }
    }
    if (identity.channel === 'legacy') {
      // 已锁旧通道：只允许同一条旧声线重试，不允许换别的声音
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { blob } = await synthesizeQwen3Tts({
            text: preparedText,
            voice: identity.voice,
            params: prosody,
            forcePath: 'flash',
          });
          const durationMs = await playVoiceBlob(blob);
          return {
            ok: true,
            voice: identity.voice,
            prosody,
            instruction,
            preparedText,
            durationMs,
          };
        } catch (e) {
          lastMessage = e instanceof Error ? e.message : String(e);
          await sleep(300);
        }
      }
      return {
        ok: false,
        reason: lastMessage || '语音服务暂不可用',
        voice: identity.voice,
        prosody,
        instruction,
        preparedText,
      };
    }
  }

  // 首次出声：优先云端主通道
  const blob = await tryAudio(profile.voice);
  if (blob) {
    pathLocks.set(req.characterId, 'audio');
    voiceIdentities.set(req.characterId, { channel: 'audio', voice: profile.voice });
    voicedOnce.add(req.characterId);
    // 云端只做了 pitch，语速在本地用 playbackRate 还原（preservesPitch 保音高）
    const durationMs = await playVoiceBlob(blob, {
      rate: prosody.rate,
      pitch: prosody.pitch,
    });
    return {
      ok: true,
      voice: profile.voice,
      prosody,
      instruction,
      preparedText,
      durationMs,
    };
  }

  // 尚未出声过，但失败是临时性的（限流/网络）：不降级、不换声线，
  // 这一句保持安静，下一句继续用同一条声线重试云端。
  if (!isPermanentVoiceFailure(lastMessage)) {
    console.warn('[voice] transient failure before first voice, staying silent (no downgrade):', lastMessage);
    return {
      ok: false,
      reason: lastMessage || '语音服务暂不可用',
      voice: profile.voice,
      prosody,
      instruction,
      preparedText,
    };
  }

  // 尚未出声过：允许退到旧通道，并锁定该声线
  const legacy = await tryLegacy();
  if (legacy) {
    pathLocks.set(req.characterId, 'flash');
    voiceIdentities.set(req.characterId, { channel: 'legacy', voice: legacy.voice });
    voicedOnce.add(req.characterId);
    const durationMs = await playVoiceBlob(legacy.blob);
    return {
      ok: true,
      voice: legacy.voice,
      prosody,
      instruction,
      preparedText,
      durationMs,
    };
  }

  // 云端彻底不可用（模型不存在/鉴权/网络）：允许系统朗读，并锁定本次对话
  if (canUseWebSpeechFallback()) {
    try {
      stopVoicePlayback();
      markVoiceSpeaking(true);
      const durationMs = await speakWithWebSpeechFallback(preparedText, {
        rate: prosody.rate,
        pitch: prosody.pitch,
      });
      pathLocks.set(req.characterId, 'webspeech');
      voiceIdentities.set(req.characterId, {
        channel: 'webspeech',
        voice: 'system-speechSynthesis',
      });
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
    } finally {
      markVoiceSpeaking(false);
    }
  }

  // 全部失败：解锁路径，下一轮重新尝试云端（不要因为一次失败整段对话静音）
  pathLocks.delete(req.characterId);
  return {
    ok: false,
    reason: lastMessage || '语音服务暂不可用',
    voice: profile.voice,
    prosody,
    instruction,
    preparedText,
  };
}

export function previewCloudInstruct(emotion?: string): string {
  return emotionToCloudInstruct(normalizeEmotion(emotion));
}
