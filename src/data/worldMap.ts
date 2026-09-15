/** 锈带纪元漫画世界地图：与章节战斗场景视觉/叙事对齐 */

export const WORLD_MAP_SRC = './tex/world/world-map-manga.png';

export type WorldMapRegion = {
  id: string;
  name: string;
  /** 对应战斗章节；营地无章节 */
  chapterId: number | null;
  /** 地图归一化坐标 0–1（相对图片左上） */
  x: number;
  y: number;
  blurb: string;
  combatTheme: string;
};

export const WORLD_MAP_REGIONS: WorldMapRegion[] = [
  {
    id: 'station',
    name: '零号月台',
    chapterId: 1,
    x: 0.2,
    y: 0.3,
    blurb: '锈带北缘的铁路废墟与邮差驿站。教程战场的黄沙铁轨、集装箱与废弃车厢，皆源于此地。',
    combatTheme: 'station',
  },
  {
    id: 'camp',
    name: '废弃营地',
    chapterId: null,
    x: 0.26,
    y: 0.4,
    blurb: '主角矮小机器人守灯的地方。机械少女档案、编队与休眠多在此完成——世界时间线的「家」。',
    combatTheme: 'station',
  },
  {
    id: 'corridor',
    name: '锈带走廊',
    chapterId: 2,
    x: 0.48,
    y: 0.48,
    blurb: '贯穿废土的工业沙道。数字门、沙尘机械与走私痕迹在此交错，战斗场景的开阔公路多取此貌。',
    combatTheme: 'corridor',
  },
  {
    id: 'frost',
    name: '白棺谷',
    chapterId: 3,
    x: 0.72,
    y: 0.24,
    blurb: '极寒封存谷地。护盾机兵与冰蓝废墟决定了战斗场景的冷色天空与冻结残骸。',
    combatTheme: 'frost',
  },
  {
    id: 'forge',
    name: '熔炉城废墟',
    chapterId: 4,
    x: 0.3,
    y: 0.7,
    blurb: '熄灭的高炉与工坊街区。高血量工业敌人、橙热炉渣与锈红建筑，是本章战斗的视觉母题。',
    combatTheme: 'forge',
  },
  {
    id: 'core',
    name: '星核禁区',
    chapterId: 5,
    x: 0.78,
    y: 0.72,
    blurb: '轨道残骸与脉动星种。终局混合波次的天空裂痕与异质光芒，皆映射此地。',
    combatTheme: 'core',
  },
];

export function getWorldMapRegionByChapter(chapterId: number): WorldMapRegion | null {
  return WORLD_MAP_REGIONS.find((r) => r.chapterId === chapterId) ?? null;
}

export function getWorldMapRegionById(id: string): WorldMapRegion | null {
  return WORLD_MAP_REGIONS.find((r) => r.id === id) ?? null;
}
