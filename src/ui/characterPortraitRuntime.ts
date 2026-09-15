/** 同系列静态立绘当前索引（主页点击 / 档案切换共用） */

const indexByChar = new Map<string, number>();

export function getPortraitSeriesIndex(characterId: string): number {
  return indexByChar.get(characterId) ?? 0;
}

export function setPortraitSeriesIndex(characterId: string, index: number): void {
  indexByChar.set(characterId, Math.max(0, index));
}

/** 切换到下一套同系列静态立绘，返回新索引 */
export function cyclePortraitSeriesIndex(characterId: string, seriesLength: number): number {
  if (seriesLength <= 1) return 0;
  const next = (getPortraitSeriesIndex(characterId) + 1) % seriesLength;
  setPortraitSeriesIndex(characterId, next);
  return next;
}
