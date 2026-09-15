/**
 * 战斗场景情绪动作图：按性格从 emotion-poses 目录里各筛 3 张。
 * 胜利 / 失败在结算时全屏偏下弹出；受击在撞击时短暂弹出。
 * 占屏比小于营地对话立绘（营地 max 52vh / 520px）。
 */
import { emotionPosePath } from './characterEmotionPoses';

export type CombatEmotionKind = 'victory' | 'defeat' | 'hit';

export interface CombatEmotionSet {
  victory: readonly [string, string, string];
  defeat: readonly [string, string, string];
  hit: readonly [string, string, string];
}

/**
 * 选型原则：贴性格，不贴通用喜怒。
 * 冷静克制 → 克制浅喜 / 低气压受挫 / 绷紧受击
 * 温柔护心 → 暖意满足 / 担忧自伤 / 慌乱心疼
 * 疏离理性 → 笃定轻蔑 / 验算受挫 / 数据震惊
 * 寡言猎手 → Pride/contempt / 阴沉 / 敌意一闪
 * 戏谑嘴毒 → 讥讽开怀 / 尴尬烦躁 / 吃痛仍贫嘴
 * 明朗节奏 → 兴奋喜悦 / 沮丧慌乱 / 大惊小怪
 * 温软内敛 → 信赖满足 / 忧伤自怜 / 惊恐缩肩
 * 空灵决断 → 轻蔑裁决 / 疏离沮丧 / 骤然一滞
 * 俏皮狠厉 → 兴奋亲密 / 尴尬酸意 / 吃痛还笑
 */
export const COMBAT_EMOTION_POSES: Readonly<Record<string, CombatEmotionSet>> = {
  ashcrow: {
    victory: ['pride', 'contentment', 'trust'],
    defeat: ['dejection', 'tension', 'guilt'],
    hit: ['tension', 'shock', 'irritability'],
  },
  heartforge: {
    victory: ['joy', 'contentment', 'doting'],
    defeat: ['sorrow', 'worry', 'self_pity'],
    hit: ['fluster', 'worry', 'shock'],
  },
  mirror: {
    victory: ['pride', 'contempt', 'contentment'],
    defeat: ['doubt', 'dejection', 'irritability'],
    hit: ['shock', 'amazement', 'tension'],
  },
  neoncoil: {
    victory: ['pride', 'contentment', 'contempt'],
    defeat: ['irritability', 'dejection', 'resentment'],
    hit: ['tension', 'hostility', 'shock'],
  },
  prismrift: {
    victory: ['pride', 'contentment', 'anticipation'],
    defeat: ['irritability', 'dejection', 'grudge'],
    hit: ['tension', 'anger', 'shock'],
  },
  wireguard: {
    victory: ['sarcasm', 'joy', 'excitement'],
    defeat: ['awkwardness', 'irritability', 'dejection'],
    hit: ['fluster', 'shock', 'sarcasm'],
  },
  frostline: {
    victory: ['pride', 'contempt', 'contentment'],
    defeat: ['loneliness', 'sorrow', 'dejection'],
    hit: ['hostility', 'shock', 'tension'],
  },
  pulse: {
    victory: ['joy', 'excitement', 'pleasant_surprise'],
    defeat: ['dejection', 'fluster', 'sorrow'],
    hit: ['shock', 'fluster', 'panic'],
  },
  dustblade: {
    victory: ['intimacy', 'joy', 'pride'],
    defeat: ['sorrow', 'loneliness', 'dejection'],
    hit: ['shock', 'hostility', 'irritability'],
  },
  ironrain: {
    victory: ['pride', 'contentment', 'anticipation'],
    defeat: ['dejection', 'irritability', 'doubt'],
    hit: ['tension', 'shock', 'anger'],
  },
  skyshard: {
    victory: ['trust', 'contentment', 'friendliness'],
    defeat: ['sorrow', 'self_pity', 'worry'],
    hit: ['panic', 'fluster', 'shock'],
  },
  stellar: {
    victory: ['pride', 'contempt', 'contentment'],
    defeat: ['dejection', 'doubt', 'loneliness'],
    hit: ['shock', 'tension', 'hostility'],
  },
  outercore: {
    victory: ['excitement', 'joy', 'pleasant_surprise'],
    defeat: ['awkwardness', 'dejection', 'irritability'],
    hit: ['shock', 'fluster', 'sarcasm'],
  },
};

const lastPick = new Map<string, string>();

export function pickCombatEmotionKey(
  characterId: string,
  kind: CombatEmotionKind,
): string | null {
  const set = COMBAT_EMOTION_POSES[characterId];
  if (!set) return null;
  const pool = set[kind];
  const mapKey = `${characterId}:${kind}`;
  const prev = lastPick.get(mapKey);
  const rest = prev ? pool.filter((k) => k !== prev) : [...pool];
  const pick = rest[Math.floor(Math.random() * rest.length)] ?? pool[0]!;
  lastPick.set(mapKey, pick);
  return pick;
}

export function pickCombatEmotionSrc(
  characterId: string,
  kind: CombatEmotionKind,
): string | null {
  const key = pickCombatEmotionKey(characterId, kind);
  if (!key) return null;
  return emotionPosePath(characterId, key);
}
