/**
 * 战斗预制语音：每人胜利一句 + 受击一句。
 * 音频由 scripts/gen_combat_vo_qwen_tts.py 按角色 TTS 音色生成。
 */
export type CombatVoKind = 'victory' | 'hit';

export interface CombatVoLine {
  text: string;
  src: string;
}

export interface CombatVoSet {
  victory: CombatVoLine;
  hit: CombatVoLine;
}

function vo(id: string, kind: CombatVoKind, text: string): CombatVoLine {
  return { text, src: `./tex/audio/combat-vo/${id}_${kind}.wav` };
}

/** 短句贴性格：冷静短报 / 温柔护心 / 疏离数据 / 寡言完成 / 嘴毒贫嘴 / 空灵落子 / 反差卖萌 */
export const COMBAT_VO_LINES: Readonly<Record<string, CombatVoSet>> = {
  ashcrow: {
    victory: vo('ashcrow', 'victory', '路开了。'),
    hit: vo('ashcrow', 'hit', '唔。'),
  },
  heartforge: {
    victory: vo('heartforge', 'victory', '都还在，就好。'),
    hit: vo('heartforge', 'hit', '疼……没事。'),
  },
  mirror: {
    victory: vo('mirror', 'victory', '概率闭合。'),
    hit: vo('mirror', 'hit', '偏差。'),
  },
  neoncoil: {
    victory: vo('neoncoil', 'victory', '完成。'),
    hit: vo('neoncoil', 'hit', '啧。'),
  },
  prismrift: {
    victory: vo('prismrift', 'victory', '目标清除。'),
    hit: vo('prismrift', 'hit', '哼。'),
  },
  wireguard: {
    victory: vo('wireguard', 'victory', '哈，就这？'),
    hit: vo('wireguard', 'hit', '哎呦！'),
  },
  frostline: {
    victory: vo('frostline', 'victory', '结束了。'),
    hit: vo('frostline', 'hit', '呵。'),
  },
  pulse: {
    victory: vo('pulse', 'victory', '耶，清干净啦！'),
    hit: vo('pulse', 'hit', '哇！'),
  },
  dustblade: {
    victory: vo('dustblade', 'victory', '晚安。'),
    hit: vo('dustblade', 'hit', '嗯？'),
  },
  ironrain: {
    victory: vo('ironrain', 'victory', '热平衡，达标。'),
    hit: vo('ironrain', 'hit', '过热……唔。'),
  },
  skyshard: {
    victory: vo('skyshard', 'victory', '大家都在。'),
    hit: vo('skyshard', 'hit', '呀！'),
  },
  stellar: {
    victory: vo('stellar', 'victory', '句号。'),
    hit: vo('stellar', 'hit', '唔。'),
  },
  outercore: {
    victory: vo('outercore', 'victory', '只咬坏人哦。'),
    hit: vo('outercore', 'hit', '呜哇！'),
  },
};

export function getCombatVoLine(characterId: string, kind: CombatVoKind): CombatVoLine | null {
  return COMBAT_VO_LINES[characterId]?.[kind] ?? null;
}
