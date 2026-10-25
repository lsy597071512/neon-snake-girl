import type { CharacterVoiceProfile, QwenTtsParams } from './types';

/**
 * Qwen-Audio-TTS（主通道）系统音色：`*_v3.1` 命名，全部支持 instruction 指令控制。
 * 旧通道 qwen3-tts-flash 的音色写在 `legacyVoice`，主通道不可用时兜底。
 * @see https://help.aliyun.com/zh/model-studio/qwen-audio-tts-voice-list
 */
export const QWEN_YOUNG_FEMALE_VOICES = [
  'Cherry',
  'Serena',
  'Chelsie',
  'Momo',
  'Vivian',
  'Maia',
  'Bella',
  'Mia',
  'Bunny',
  'Nini',
  'Seren',
  'Stella',
  'Bellona',
  'Katerina',
] as const;

/** 中性态基线：rate/pitch 1.0 为默认；volume 0–100（本地播放侧可再用，云端 API 不再传） */
export const CHARACTER_VOICE_PROFILES: Record<string, CharacterVoiceProfile> = {
  ashcrow: {
    characterId: 'ashcrow',
    voice: 'longyingtao_v3.1',
    voiceLabel: '龙应桃·温柔淡定（Audio·已调校）',
    legacyVoice: 'Cherry',
    base: { rate: 0.95, pitch: 1.03, volume: 54 },
    emotionGain: 0.9,
    instruction:
      '请用十八岁冷静开路少女的嗓音说话，音色偏女性、清晰柔韧，吐字干脆但不中性不沙哑；像突击手确认风向，年轻女声，不要撒娇粘人，不要老气或御姐感。',
    reason: '苍羽·澪｜冷静责任感（Cherry：比 Bellona 更女性）',
  },
  heartforge: {
    characterId: 'heartforge',
    voice: 'longwan_v3.1',
    voiceLabel: '龙婉·细腻柔声（Audio·已调校）',
    legacyVoice: 'Serena',
    base: { rate: 1.01, pitch: 1.01, volume: 54 },
    emotionGain: 1.1,
    instruction:
      '请用十九岁温柔能干的少女嗓音说话，暖、稳、护心，像贤内助关心队友，不要刻薄，也不要稚气童声。',
    reason: '白楯·芹奈｜温柔护心',
  },
  mirror: {
    characterId: 'mirror',
    voice: 'yezhiqing_v3.1',
    voiceLabel: '叶知晴·轻快自然（Audio·已调校）',
    legacyVoice: 'Maia',
    base: { rate: 1.03, pitch: 1, volume: 50 },
    emotionGain: 0.8,
    instruction:
      '请用十八岁疏离理性的少女嗓音说话，语速偏稳、带一点距离感，像光学观测在报概率，不要傲娇，不要成熟御姐。',
    reason: '银绯·玲｜疏离洞察',
  },
  neoncoil: {
    characterId: 'neoncoil',
    voice: 'yuxiaoyun_v3.1',
    voiceLabel: '于小云·元气亲切（Audio·已调校）',
    legacyVoice: 'Katerina',
    base: { rate: 0.98, pitch: 1.04, volume: 46 },
    emotionGain: 0.7,
    instruction:
      '请用十八岁寡言渗透刃少女的嗓音，轻、短、几乎不带情绪起伏，像任务完成式汇报；可略疏离空灵，仍是青年女声，不要甜腻，不要沧桑老气或成熟御姐播音腔。',
    reason: '苍斩·凛｜寡言冷淡（Katerina 仅 Flash）',
  },
  prismrift: {
    characterId: 'prismrift',
    voice: 'anruorou_v3.1',
    voiceLabel: '安若柔·气声知性（Audio·已调校）',
    legacyVoice: 'Vivian',
    base: { rate: 0.93, pitch: 0.95, volume: 55 },
    emotionGain: 0.85,
    instruction:
      '请用二十岁务实重炮少女的嗓音，数字感强、少闲聊，像确认目标距离；可用一点干脆小暴躁的锋芒，干练但不沉闷老成。',
    reason: '焰甲·朱里｜沉默务实（改用原澪音色 Vivian）',
  },
  wireguard: {
    characterId: 'wireguard',
    voice: 'yunhuanhuan_v3.1',
    voiceLabel: '云欢欢·高亢热情（Audio·已调校）',
    legacyVoice: 'Cherry',
    base: { rate: 0.95, pitch: 1.03, volume: 58 },
    emotionGain: 1.25,
    instruction:
      '请用十八岁戏谑嘴毒的狐耳少女嗓音，语速偏快、尾音可上扬，玩笑里藏警戒，年轻明亮，不要御姐。',
    reason: '黄狐·萤｜嘴毒戏谑',
  },
  frostline: {
    characterId: 'frostline',
    /** 复刻音色未按 Audio 模型重建前，先用系统音色：龙婉·细腻柔声 + 压沉指令 */
    voice: 'baianran_v3.1',
    voiceLabel: '白安然·低沉浑厚气声（Audio·已调校）',
    legacyVoice: 'qwen-tts-vc-yinse_pulse-voice-20260814110227791-7aaf',
    fallbackVoice: 'Nini',
    base: { rate: 1.13, pitch: 1.06, volume: 48 },
    emotionGain: 0.65,
    pitchFloor: 0.86,
    instruction:
      '请用二十一岁清冷夜袭少女的嗓音：在此音色上刻意压沉、压低、少亮少尖；吐字克制、气声偏暗，像夜里压着杀意的夜爪；亲密话也只用低沉气声，禁止甜腻上扬、禁止小孩声或尖亮。',
    reason: '夜爪·黑织｜与翠翼对调音色后压沉（原 pulse 复刻 + 低 pitch/rate）',
  },
  pulse: {
    characterId: 'pulse',
    voice: 'xuxiaoqiao_v3.1',
    voiceLabel: '徐小俏·自然俏皮（Audio·已调校）',
    legacyVoice: 'Nini',
    base: { rate: 0.96, pitch: 0.96, volume: 54 },
    emotionGain: 1.05,
    instruction:
      '请用十八岁明朗频谱少女的嗓音，健谈自然、略带上扬，但不要小孩声、不要又尖又亮；像同龄队友聊天，青年女声，禁止童声和刺耳尖音。',
    reason: '翠翼·铃｜与夜爪对调音色（原 frostline Nini）',
  },
  dustblade: {
    characterId: 'dustblade',
    voice: 'longxing_v3.1',
    voiceLabel: '龙星·温婉邻家（Audio·已调校）',
    legacyVoice: 'Chelsie',
    base: { rate: 0.93, pitch: 0.99, volume: 53 },
    emotionGain: 1.05,
    instruction:
      '请用十九岁沙漠猎手少女的嗓音，语速稍快、利落自然；温柔微笑里带一点危险，句尾可轻扬，不是娇羞傲娇，也不是老气风情。',
    reason: '绯尾·椿（SSR04_1）｜温柔危险',
  },
  ironrain: {
    characterId: 'ironrain',
    voice: 'wenhuaiqing_v3.1',
    voiceLabel: '温怀清·清亮柔和（Audio·已调校）',
    legacyVoice: 'Mia',
    base: { rate: 0.86, pitch: 0.98, volume: 52 },
    emotionGain: 1.15,
    instruction:
      '请用十八岁温软共情少女的嗓音，轻声、多关心，像把硬壳留给战斗，甜美年轻，不要童声过头。',
    reason: '橙铠·琥珀｜沿用冰华·雫当前 Mia',
  },
  skyshard: {
    characterId: 'skyshard',
    /** 复刻音色未按 Audio 模型重建前，先用系统音色：龙安灵心·知心温暖 */
    voice: 'longanlingxin_v3.1',
    voiceLabel: '龙安灵心·知心温暖（Audio·已调校）',
    legacyVoice: 'qwen-tts-vc-yinse_skyshard-voice-20260814110224868-a391',
    fallbackVoice: 'Mia',
    base: { rate: 0.97, pitch: 1.06, volume: 52 },
    emotionGain: 1.15,
    instruction:
      '请用十八岁温软共情少女的嗓音，轻声、多关心，像把硬壳留给战斗，甜美年轻，不要童声过头。',
    reason: '冰华·雫｜yinse 1:1 声音复刻',
  },
  stellar: {
    characterId: 'stellar',
    voice: 'longanwen_v3.1',
    voiceLabel: '龙安温·优雅知性（Audio·已调校）',
    legacyVoice: 'Seren',
    base: { rate: 0.85, pitch: 0.98, volume: 48 },
    emotionGain: 0.75,
    instruction:
      '请用外表十九岁的原型决战少女嗓音，疏离、短句像宣判，少人称；声线可低回舒缓但仍青年女声略飘，不要成熟播音腔或御姐感。',
    reason: '光轮·天音｜空灵决断（与苍斩对调：Seren）',
  },
  outercore: {
    characterId: 'outercore',
    voice: 'longhua_v3.1',
    voiceLabel: '龙华·元气甜美（Audio·已调校）',
    legacyVoice: 'Momo',
    base: { rate: 1.03, pitch: 1, volume: 58 },
    emotionGain: 1.25,
    instruction:
      '请用十八岁星种兔少女的嗓音，俏皮卖萌接梗，内核可瞬间转冷；年轻甜萌，禁止老气或御姐。',
    reason: '橙兔·美羽｜俏皮反差',
  },
};

const FALLBACK: CharacterVoiceProfile = {
  characterId: '_default',
  voice: 'longanhuan_v3.1',
  voiceLabel: '龙安欢·默认（Audio）',
  legacyVoice: 'Cherry',
  base: { rate: 1.02, pitch: 1.1, volume: 55 },
  emotionGain: 1,
  instruction: '请用年轻少女的嗓音自然说话，明亮、不老气。',
  reason: '默认年轻女声',
};

export function getCharacterVoiceProfile(characterId: string): CharacterVoiceProfile {
  return CHARACTER_VOICE_PROFILES[characterId] ?? { ...FALLBACK, characterId };
}

/**
 * 云端音色不可用时的系统音色兜底：
 * - 复刻音色（qwen-tts-vc-*）必须回退到系统音色，否则模型/音色不匹配会整段静音；
 * - 系统音色保持原音色。
 */
export function systemFallbackVoiceFor(characterId: string): string {
  const p = CHARACTER_VOICE_PROFILES[characterId];
  if (!p) return 'Cherry';
  if (p.fallbackVoice) return p.fallbackVoice;
  const legacy = p.legacyVoice?.trim();
  if (legacy && !/^qwen-tts-vc-/i.test(legacy)) return legacy;
  return 'Cherry';
}

/**
 * 角色音色唯一性自检：任何两个角色共用同一条音色都会让"音色混乱"看起来像串号。
 * 开发期打印一次，正式构建忽略。
 */
export function validateVoiceUniqueness(): string[] {
  const seen = new Map<string, string[]>();
  for (const p of Object.values(CHARACTER_VOICE_PROFILES)) {
    const list = seen.get(p.voice) ?? [];
    list.push(p.characterId);
    seen.set(p.voice, list);
  }
  const dupes: string[] = [];
  for (const [voice, ids] of seen) {
    if (ids.length > 1) dupes.push(`${voice} <- ${ids.join(', ')}`);
  }
  return dupes;
}

/** 旧通道（qwen3-tts-flash）的首选音色：优先原 legacy 音色（含复刻 ID） */
export function legacyVoiceFor(characterId: string): string {
  const p = CHARACTER_VOICE_PROFILES[characterId];
  if (!p) return 'Cherry';
  return p.legacyVoice?.trim() || systemFallbackVoiceFor(characterId);
}

export function listCharacterVoiceProfiles(): CharacterVoiceProfile[] {
  return Object.values(CHARACTER_VOICE_PROFILES);
}

export function formatProsody(p: QwenTtsParams): string {
  return `rate ${p.rate.toFixed(2)} · pitch ${p.pitch.toFixed(2)} · vol ${p.volume}`;
}
