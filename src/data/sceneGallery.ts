import { WORLD_MAP_SRC } from './worldMap';

/** 图库单张图（场景概念 / 地图） */
export type SceneGalleryImage = {
  id: string;
  title: string;
  src: string;
  /** landscape 进图集；portrait 作选图页背景 */
  orient: 'landscape' | 'portrait';
  caption?: string;
};

/** 区域内地点（预留细化：月台货场、走廊闸门等） */
export type SceneGalleryPlace = {
  id: string;
  name: string;
  blurb: string;
  images: SceneGalleryImage[];
};

/** 图库大类：世界图 / 战斗区域 */
export type SceneGalleryCategory = {
  id: string;
  name: string;
  titleEn: string;
  kind: 'world' | 'region';
  /** 对应作战章节；世界图为 null */
  chapterId: number | null;
  /** 战斗主题 id，与 chapters.theme / worldMap 对齐 */
  theme: string | null;
  blurb: string;
  places: SceneGalleryPlace[];
  /** 选图页竖屏背景（区域概念图） */
  mapSelectBg?: string;
};

const scene = (theme: string, file: 'landscape' | 'portrait') =>
  `./tex/gallery/scenes/${theme}/${file}.png`;

export const SCENE_GALLERY_CATEGORIES: SceneGalleryCategory[] = [
  {
    id: 'world',
    name: '锈带世界图',
    titleEn: 'WORLD ATLAS',
    kind: 'world',
    chapterId: null,
    theme: null,
    blurb: '锈带纪元全境鸟瞰。五大战区与废弃营地的相对方位，皆以此为纲。',
    places: [
      {
        id: 'atlas',
        name: '世界总览',
        blurb: '漫画风世界图 · 16:9',
        images: [
          {
            id: 'world-map',
            title: '锈带纪元·世界图',
            src: WORLD_MAP_SRC,
            orient: 'landscape',
            caption: '零号月台 · 锈带走廊 · 白棺谷 · 熔炉城废墟 · 星核禁区',
          },
        ],
      },
    ],
  },
  {
    id: 'station',
    name: '零号月台',
    titleEn: 'PLATFORM ZERO',
    kind: 'region',
    chapterId: 1,
    theme: 'station',
    blurb: '锈带北缘铁路废墟。黄沙铁轨、集装箱与废弃车厢，是远征的起点。',
    mapSelectBg: scene('station', 'portrait'),
    places: [
      {
        id: 'station-vista',
        name: '月台全景',
        blurb: '区域概念 · 横屏图集',
        images: [
          {
            id: 'station-land',
            title: '零号月台 · 黄昏站台',
            src: scene('station', 'landscape'),
            orient: 'landscape',
            caption: '沙尘与锈轨交织的邮差驿站',
          },
        ],
      },
    ],
  },
  {
    id: 'corridor',
    name: '锈带走廊',
    titleEn: 'RUST CORRIDOR',
    kind: 'region',
    chapterId: 2,
    theme: 'corridor',
    blurb: '贯穿废土的工业沙道。数字门与沙尘机械在此交错。',
    mapSelectBg: scene('corridor', 'portrait'),
    places: [
      {
        id: 'corridor-vista',
        name: '走廊全景',
        blurb: '区域概念 · 横屏图集',
        images: [
          {
            id: 'corridor-land',
            title: '锈带走廊 · 数字闸门',
            src: scene('corridor', 'landscape'),
            orient: 'landscape',
            caption: '热浪公路与巨型拱门',
          },
        ],
      },
    ],
  },
  {
    id: 'frost',
    name: '白棺谷',
    titleEn: 'WHITE COFFIN VALE',
    kind: 'region',
    chapterId: 3,
    theme: 'frost',
    blurb: '极寒封存谷地。冰蓝废墟与护盾机兵，冻结了整条山谷。',
    mapSelectBg: scene('frost', 'portrait'),
    places: [
      {
        id: 'frost-vista',
        name: '谷地全景',
        blurb: '区域概念 · 横屏图集',
        images: [
          {
            id: 'frost-land',
            title: '白棺谷 · 冰封峡谷',
            src: scene('frost', 'landscape'),
            orient: 'landscape',
            caption: '棺形冰壁下的工业残骸',
          },
        ],
      },
    ],
  },
  {
    id: 'forge',
    name: '熔炉城废墟',
    titleEn: 'FORGE RUINS',
    kind: 'region',
    chapterId: 4,
    theme: 'forge',
    blurb: '熄灭的高炉与工坊街区。橙热炉渣仍在锈红建筑间流淌。',
    mapSelectBg: scene('forge', 'portrait'),
    places: [
      {
        id: 'forge-vista',
        name: '炉城全景',
        blurb: '区域概念 · 横屏图集',
        images: [
          {
            id: 'forge-land',
            title: '熔炉城 · 夜烬高炉',
            src: scene('forge', 'landscape'),
            orient: 'landscape',
            caption: '熔渣河穿过熄灭的工厂城',
          },
        ],
      },
    ],
  },
  {
    id: 'core',
    name: '星核禁区',
    titleEn: 'STARCORE ZONE',
    kind: 'region',
    chapterId: 5,
    theme: 'core',
    blurb: '轨道残骸与脉动星种。终局战场的天空在此裂开。',
    mapSelectBg: scene('core', 'portrait'),
    places: [
      {
        id: 'core-vista',
        name: '禁区全景',
        blurb: '区域概念 · 横屏图集',
        images: [
          {
            id: 'core-land',
            title: '星核禁区 · 裂空星种',
            src: scene('core', 'landscape'),
            orient: 'landscape',
            caption: '同心环构与直贯天穹的光束',
          },
        ],
      },
    ],
  },
];

export function getSceneGalleryCategory(id: string): SceneGalleryCategory | null {
  return SCENE_GALLERY_CATEGORIES.find((c) => c.id === id) ?? null;
}

export function getSceneGalleryCategoryByChapter(chapterId: number): SceneGalleryCategory | null {
  return SCENE_GALLERY_CATEGORIES.find((c) => c.chapterId === chapterId) ?? null;
}

/** 作战选图页竖屏背景 */
export function getChapterMapSelectBg(chapterId: number): string | null {
  return getSceneGalleryCategoryByChapter(chapterId)?.mapSelectBg ?? null;
}

/** 图集内仅展示横屏（竖屏留给选图背景） */
export function getAlbumImages(category: SceneGalleryCategory): SceneGalleryImage[] {
  return category.places.flatMap((p) => p.images.filter((img) => img.orient === 'landscape'));
}
