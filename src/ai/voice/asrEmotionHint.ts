/**
 * ASR / 听写文本 → 即时情绪姿势提示（启发式，不调 LLM）。
 * 用于麦克风聆听/识别完成后、完整对话返回前的立绘反应。
 */
import {
  EMOTION_POSE_CATALOG,
  normalizeEmotionPoseKey,
  type DialogueEmotion,
} from '../../data/characterEmotionPoses';

export type AsrEmotionHint = {
  pose: string;
  emotion: DialogueEmotion;
  /** 连续体轻推（不同步精确值给模型） */
  valenceDelta: number;
  arousalDelta: number;
  reason: string;
};

const LISTENING_POSE = 'curiosity';

function resolvePose(characterId: string, preferred: string, emotion: DialogueEmotion): string {
  return (
    normalizeEmotionPoseKey(characterId, preferred) ||
    normalizeEmotionPoseKey(characterId, fallbackPose(emotion)) ||
    preferred
  );
}

function fallbackPose(emotion: DialogueEmotion): string {
  const hit = EMOTION_POSE_CATALOG.find((e) => e.dialogueEmotion === emotion);
  return hit?.key ?? 'joy';
}

/** 聆听中：好奇/倾听态 */
export function listeningEmotionHint(characterId: string): AsrEmotionHint {
  return {
    pose: resolvePose(characterId, LISTENING_POSE, 'thinking'),
    emotion: 'thinking',
    valenceDelta: 0,
    arousalDelta: 4,
    reason: 'listening',
  };
}

type Rule = {
  re: RegExp;
  pose: string;
  emotion: DialogueEmotion;
  valenceDelta: number;
  arousalDelta: number;
  reason: string;
};

const RULES: Rule[] = [
  {
    re: /怎么了|没事吧|受伤|疼不疼|心疼|担心你|你还好/,
    pose: 'concern',
    emotion: 'neutral',
    valenceDelta: 2,
    arousalDelta: 6,
    reason: 'concern',
  },
  {
    re: /喜欢|想你|可爱|亲|抱抱|爱你|想陪/,
    pose: 'intimacy',
    emotion: 'joy',
    valenceDelta: 8,
    arousalDelta: 8,
    reason: 'affection',
  },
  {
    re: /谢谢|辛苦|麻烦你|帮大忙/,
    pose: 'contentment',
    emotion: 'joy',
    valenceDelta: 5,
    arousalDelta: 3,
    reason: 'thanks',
  },
  {
    re: /对不起|抱歉|是我错|别生气/,
    pose: 'guilt',
    emotion: 'sadness',
    valenceDelta: -2,
    arousalDelta: 5,
    reason: 'apology',
  },
  {
    re: /滚|闭嘴|笨蛋|没用|烦死|讨厌你/,
    pose: 'anger',
    emotion: 'anger',
    valenceDelta: -10,
    arousalDelta: 12,
    reason: 'insult',
  },
  {
    re: /害怕|好可怕|救命|危险|沙暴|敌袭/,
    pose: 'panic',
    emotion: 'fear',
    valenceDelta: -6,
    arousalDelta: 14,
    reason: 'fear',
  },
  {
    re: /哈哈|搞笑|好玩|逗我|真有趣/,
    pose: 'excitement',
    emotion: 'joy',
    valenceDelta: 6,
    arousalDelta: 7,
    reason: 'fun',
  },
  {
    re: /什么\?|啥\?|啊\?|真的假的|不会吧/,
    pose: 'shock',
    emotion: 'surprise',
    valenceDelta: 0,
    arousalDelta: 10,
    reason: 'surprise',
  },
  {
    re: /再见|拜拜|先走了|晚安|回头聊/,
    pose: 'loneliness',
    emotion: 'sadness',
    valenceDelta: -3,
    arousalDelta: -2,
    reason: 'farewell',
  },
  {
    re: /任务|出征|编队|战斗|准备好/,
    pose: 'anticipation',
    emotion: 'joy',
    valenceDelta: 1,
    arousalDelta: 8,
    reason: 'duty',
  },
];

/** 根据听写/ASR 文本推断即时姿势；无命中则 null */
export function inferAsrEmotionHint(
  characterId: string,
  text: string,
): AsrEmotionHint | null {
  const t = text.trim();
  if (t.length < 1) return null;
  for (const rule of RULES) {
    if (!rule.re.test(t)) continue;
    return {
      pose: resolvePose(characterId, rule.pose, rule.emotion),
      emotion: rule.emotion,
      valenceDelta: rule.valenceDelta,
      arousalDelta: rule.arousalDelta,
      reason: rule.reason,
    };
  }
  if (/[？?]$/.test(t) || /吗$|呢$|啥|什么|怎么/.test(t)) {
    return {
      pose: resolvePose(characterId, 'curiosity', 'thinking'),
      emotion: 'thinking',
      valenceDelta: 1,
      arousalDelta: 5,
      reason: 'question',
    };
  }
  return null;
}
