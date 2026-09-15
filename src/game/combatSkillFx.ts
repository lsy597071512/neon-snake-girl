import type { CharacterSkillId } from '../core/skillEffects';
import { CHARACTER_MAP } from '../data/characters';

export interface SkillFxDef {
  id: CharacterSkillId;
  name: string;
  /** 主色（环波/spark 主源） */
  color: string;
  /** 副色（叠层环波/中心高亮） */
  accentColor: string;
  /** 周期光环提示间隔（秒），0 = 无周期 */
  pulseInterval: number;
  /** 状态栏文字描述 */
  pulseLabel: string;
  /** 横幅文案（进场显示） */
  bannerTitle: string;
  /** 横幅详情 */
  bannerDetail: string;
  /** 该技能形状语言 */
  shapeKind:
    | 'frost'
    | 'spark'
    | 'pierce'
    | 'rain'
    | 'shield'
    | 'judgment'
    | 'pulse';
  /** 横幅配色（CSS 变量） */
  bannerColor: string;
}

const SKILL_FX: Record<CharacterSkillId, Omit<SkillFxDef, 'id'>> = {
  // 夜爪撕裂：减速 42% + 寒霜减速圈 + 蓝色环波
  // P2+：accentColor 从 #ffffff → #cfe7ff（冰蓝偏亮但不是纯白），消除 additive 下的白色爆闪。
  frost_overload: {
    name: '夜爪撕裂',
    color: '#5ee7ff',
    accentColor: '#cfe7ff',
    pulseInterval: 6,
    pulseLabel: '攻速+18% 减伤+10%',
    bannerTitle: '夜爪撕裂',
    bannerDetail: '寒霜侵骨 · 全场减速 42%',
    shapeKind: 'frost',
    bannerColor: '#5ee7ff',
  },
  // 翠翼连闪：三发绿色 + 弧线尾焰 + 光柱
  resonance_burst: {
    name: '翠翼连闪',
    color: '#7CFF4A',
    accentColor: '#aaff66',
    pulseInterval: 0,
    pulseLabel: '三连射击',
    bannerTitle: '翠翼连闪',
    bannerDetail: '连击击杀 3 · 三连发弹幕',
    shapeKind: 'spark',
    bannerColor: '#7CFF4A',
  },
  // 绯尾贯穿：双段穿透 + 粉红残影 + 碎片
  sand_pierce: {
    name: '绯尾贯穿',
    color: '#ff5e8a',
    accentColor: '#ffaaca',
    pulseInterval: 0,
    pulseLabel: '穿透+1',
    bannerTitle: '绯尾贯穿',
    bannerDetail: '穿透锋刃 · 本次攻击贯穿目标',
    shapeKind: 'pierce',
    bannerColor: '#ff5e8a',
  },
  // 锻渣雨幕：橙红炉渣从空中砸下 + 落地环波
  iron_rain: {
    name: '锻渣雨幕',
    color: '#ff8840',
    accentColor: '#ffaa50',
    pulseInterval: 0,
    pulseLabel: '过热清场',
    bannerTitle: '锻渣雨幕',
    bannerDetail: '熔渣倾泻 · 范围 120% 伤害',
    shapeKind: 'rain',
    bannerColor: '#ff8840',
  },
  // 冰华护壳：六角冰晶护盾 + 蓝白光柱
  shard_shell: {
    name: '冰华护壳',
    color: '#b8e0ff',
    accentColor: '#ffffff',
    pulseInterval: 7,
    pulseLabel: '减伤+12% 攻速+10%',
    bannerTitle: '冰华护壳',
    bannerDetail: '晶体壁障 · 减伤 12% / 攻速 +10%',
    shapeKind: 'shield',
    bannerColor: '#b8e0ff',
  },
  // 光轮裁决：金黄天罚 + 雷电 + 巨型环波
  stellar_judgment: {
    name: '光轮裁决',
    color: '#ffd54f',
    accentColor: '#fff6c0',
    pulseInterval: 5.5,
    pulseLabel: '攻速+25% Boss暴击+',
    bannerTitle: '光轮裁决',
    bannerDetail: '终审之雷 · 攻速 +25% / Boss 暴击 +15%',
    shapeKind: 'judgment',
    bannerColor: '#ffd54f',
  },
  // 兔械同调：橙红脉冲 + 暖光柱
  outer_pulse: {
    name: '兔械同调',
    color: '#ff9a4a',
    accentColor: '#ffcf75',
    pulseInterval: 5.5,
    pulseLabel: '攻速+20% 续航强化',
    bannerTitle: '兔械同调',
    bannerDetail: '义体脉冲 · 攻速 +20% / 减伤 +8% / Boss +10%',
    shapeKind: 'pulse',
    bannerColor: '#ff9a4a',
  },
};

export function getSkillFx(skillId: CharacterSkillId | undefined): SkillFxDef | null {
  if (!skillId || !(skillId in SKILL_FX)) return null;
  return { id: skillId, ...SKILL_FX[skillId] };
}

export function getSquadSkillFxList(characterIds: string[]): SkillFxDef[] {
  const out: SkillFxDef[] = [];
  const seen = new Set<string>();
  for (const cid of characterIds) {
    const sid = CHARACTER_MAP[cid]?.skillId;
    const fx = getSkillFx(sid as CharacterSkillId | undefined);
    if (!fx || seen.has(fx.id)) continue;
    seen.add(fx.id);
    out.push(fx);
  }
  return out;
}

/** 普通弹幕显示名（用角色名短称号） */
export function getShotLabel(charId: string): string {
  const c = CHARACTER_MAP[charId];
  if (!c) return '能量弹';
  const name = c.name.split('·')[0] || c.name;
  return `${name}弹`;
}

export function formationOffsetX(index: number, total: number): number {
  if (total <= 1) return 0;
  const side = 0.4;
  // 两人：占两翼位 -0.4 / +0.4，间距与三人编队侧翼相同
  if (total === 2) return index === 0 ? -side : side;
  if (index === 0) return 0;
  if (index === 1) return -side;
  return side;
}

/** 翼机与队长同比例（人头归一化后不再人为缩小翼机） */
export function formationScaleMul(index: number, total: number): number {
  void index;
  void total;
  return 1;
}
