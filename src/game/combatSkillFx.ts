import { CHARACTER_MAP } from '../data/characters';

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
