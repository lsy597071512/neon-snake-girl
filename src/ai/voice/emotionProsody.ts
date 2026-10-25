import { getCharacterVoiceProfile } from './characterVoices';
import type { QwenTtsParams, SpeakRequest, VoiceEmotion, VoiceLineType } from './types';

/**
 * 情感只做轻偏移；人设主要靠独立 voice + instruction。
 */
const EMOTION_DELTA: Record<
  VoiceEmotion,
  { rate: number; pitch: number; volume: number }
> = {
  joy: { rate: 0.04, pitch: 0.03, volume: 3 },
  anger: { rate: 0.03, pitch: 0.02, volume: 4 },
  sadness: { rate: -0.05, pitch: -0.02, volume: -4 },
  surprise: { rate: 0.05, pitch: 0.04, volume: 2 },
  fear: { rate: -0.03, pitch: 0.02, volume: -5 },
  disgust: { rate: -0.02, pitch: -0.02, volume: -3 },
  neutral: { rate: 0, pitch: 0, volume: 0 },
  thinking: { rate: -0.04, pitch: 0, volume: -2 },
};

const TYPE_DELTA: Record<VoiceLineType, { rate: number; pitch: number; volume: number }> = {
  dialogue: { rate: 0, pitch: 0, volume: 0 },
  whisper: { rate: -0.08, pitch: -0.02, volume: -12 },
  shout: { rate: 0.06, pitch: 0.03, volume: 8 },
  narration: { rate: -0.03, pitch: 0, volume: -2 },
};

const EMOTION_CN: Record<VoiceEmotion, string> = {
  joy: '开心轻快',
  anger: '有点生气',
  sadness: '低落柔软',
  surprise: '惊讶上扬',
  fear: '紧张不安',
  disgust: '嫌弃不悦',
  neutral: '自然平静',
  thinking: '若有所思',
};

export function normalizeEmotion(raw?: string): VoiceEmotion {
  const e = (raw || 'neutral').toLowerCase();
  if (e in EMOTION_DELTA) return e as VoiceEmotion;
  if (e === 'happy' || e === 'cheerful') return 'joy';
  if (e === 'mad' || e === 'rage') return 'anger';
  if (e === 'sad' || e === 'cry') return 'sadness';
  if (e === 'scared' || e === 'anxious') return 'fear';
  if (e === 'think' || e === 'confused') return 'thinking';
  return 'neutral';
}

export function normalizeLineType(raw?: string): VoiceLineType {
  const t = (raw || 'dialogue').toLowerCase();
  if (t === 'whisper' || t === 'shout' || t === 'narration') return t;
  return 'dialogue';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function resolveQwenProsody(req: SpeakRequest): QwenTtsParams {
  const profile = getCharacterVoiceProfile(req.characterId);
  const emotion = normalizeEmotion(req.emotion);
  const lineType = normalizeLineType(req.type);
  const gain = profile.emotionGain;

  const ed = EMOTION_DELTA[emotion];
  const td = TYPE_DELTA[lineType];

  // 语速与音量随情绪变化（不改音色）；
  // 音高固定为角色基线——云端 pitch 是重采样，逐句变音高会让"同一个角色听起来像换了人"，
  // 这是角色音色跳变的主要来源，所以情绪起伏全部交给 instruction 与语速表达。
  let rate = profile.base.rate + ed.rate * gain + td.rate;
  const pitch = profile.base.pitch;
  let volume = profile.base.volume + ed.volume * gain + td.volume;

  if (req.interruptReaction === 'annoyed') {
    rate += 0.03;
    volume += 2;
  } else if (req.interruptReaction === 'angry') {
    rate += 0.05;
    volume += 4;
  }

  // 青年少女向默认不落到粗沉；音高下限只由角色显式 pitchFloor 决定
  // （不因 whisper 等句型临时抬高，否则同一角色不同句子音高不一致 = 听起来换人）
  const floor = profile.pitchFloor ?? profile.base.pitch;
  const finalPitch = Math.max(floor, pitch);
  const pitchMin = profile.pitchFloor != null ? Math.min(profile.pitchFloor, 0.95) : 0.9;

  return {
    rate: clamp(Number(rate.toFixed(2)), 0.7, 1.35),
    pitch: clamp(Number(finalPitch.toFixed(2)), pitchMin, 1.25),
    volume: Math.round(clamp(volume, 30, 80)),
  };
}

/** @deprecated 旧名兼容 */
export const resolveEdgeProsody = resolveQwenProsody;

/** 叠在角色 instruction 上的情绪短句（禁止改写年龄/性别/嗓音身份） */
export function buildSpeakInstruction(req: SpeakRequest): string {
  const profile = getCharacterVoiceProfile(req.characterId);
  const emotion = normalizeEmotion(req.emotion);
  const lineType = normalizeLineType(req.type);
  // 人设指令固定；情绪只加「语气」一层，避免 instruct 模型每轮重塑音色
  const parts = [profile.instruction];
  if (lineType === 'whisper') parts.push('音量略轻，仍是同一角色嗓音。');
  if (lineType === 'shout') parts.push('略提高力度，仍保持同一年轻女声身份。');
  parts.push(`本句语气略偏${EMOTION_CN[emotion]}，但不要换成另一个人。`);
  // 身份约束放在最后：确保模型以"同一嗓音"收尾，避免逐句重塑音色造成跳变
  parts.push('整段对话保持同一嗓音身份，不要突然换成熟度、性别感或声线厚度。');
  return parts.join('');
}

export function emotionToCloudInstruct(emotion: VoiceEmotion): string {
  return `你说话的情感是${
    (
      {
        joy: 'happy',
        anger: 'angry',
        sadness: 'sad',
        surprise: 'surprised',
        fear: 'fearful',
        disgust: 'disgusted',
        neutral: 'neutral',
        thinking: 'neutral',
      } as const
    )[emotion]
  }。`;
}
