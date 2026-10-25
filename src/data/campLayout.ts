/**
 * 家园营地平面图（一楼 / 二楼）+ 院落外延
 * 美术：tex/Indoor/shinei01_1lou.jpg · shinei01_2lou.jpg（横屏 2386×1590）
 * 路线：shinei01_*lou_luxian.* → campRouteGraph.generated.ts
 * 角色日常只在此活动（室内或营地院落），不跑外地远方。
 */

export type CampFloor = 1 | 2 | -1;

export type CampRoomDef = {
  id: string;
  label: string;
  floor: CampFloor;
  sceneId: string;
  kind:
    | 'bedroom'
    | 'hall'
    | 'bath'
    | 'utility'
    | 'storage'
    | 'entrance'
    | 'stairs'
    | 'entertainment'
    | 'mechanical'
    | 'yard'
    | 'shop'
    | 'armory'
    | 'tower'
    | 'pool'
    | 'discipline';
  notes: string;
  /** 平面图头像落点 %（相对整图） */
  mapX: number;
  mapY: number;
};

export type CampEdge = [string, string];

export const CAMP_FLOOR_MAP_IMAGE: Record<CampFloor, string> = {
  1: './tex/Indoor/shinei01_1lou.jpg',
  2: './tex/Indoor/shinei01_2lou.jpg',
  /** 负一楼暂用室内背景作示意平面 */
  [-1]: './tex/Indoor/shinei01_tiaojiaoshi.png',
};

/** 横屏地图尺寸（与 tex 一致） */
export const CAMP_MAP_PIXEL_SIZE = { w: 2386, h: 1590 } as const;

/**
 * 旧竖屏「主楼铺满」坐标 → 新横屏整图百分比。
 * 主楼约落在整图中部 AABB。
 */
const MAIN_BUILDING = { x0: 29, y0: 17, x1: 71, y1: 79 };

function embedMain(ox: number, oy: number): { mapX: number; mapY: number } {
  return {
    mapX: Math.round(MAIN_BUILDING.x0 + (ox / 100) * (MAIN_BUILDING.x1 - MAIN_BUILDING.x0)),
    mapY: Math.round(MAIN_BUILDING.y0 + (oy / 100) * (MAIN_BUILDING.y1 - MAIN_BUILDING.y0)),
  };
}

/** 校准 map 落点到导航锚点（与 campNav 对齐，运行时 syncLayoutAnchorsFromNav 会覆盖） */
export const CAMP_ROOMS: CampRoomDef[] = [
  // —— 一楼·院落 ——
  {
    id: 'room_yard',
    label: '营地大门',
    floor: 1,
    sceneId: 'outdoor_gate',
    kind: 'yard',
    notes: '围栏西侧营地大门，可守门透气，不出远征',
    mapX: 11,
    mapY: 48,
  },
  {
    id: 'room_1f_tower',
    label: '警卫塔',
    floor: 1,
    sceneId: 'outdoor_tower',
    kind: 'tower',
    notes: '西北角瞭望塔',
    mapX: 14,
    mapY: 20,
  },
  {
    id: 'room_1f_pool',
    label: '泳池',
    floor: 1,
    sceneId: 'outdoor_pool',
    kind: 'pool',
    notes: '西南废土精修水池',
    mapX: 18,
    mapY: 80,
  },
  {
    id: 'room_1f_shop_bed',
    label: '商店卧室',
    floor: 1,
    sceneId: 'indoor_shop_bed',
    kind: 'bedroom',
    notes: '东侧商铺附卧',
    mapX: 82,
    mapY: 22,
  },
  {
    id: 'room_1f_shop',
    label: '商店',
    floor: 1,
    sceneId: 'indoor_shop',
    kind: 'shop',
    notes: '东侧废土杂货铺',
    mapX: 82,
    mapY: 34,
  },
  {
    id: 'room_1f_armory',
    label: '武器库',
    floor: 1,
    sceneId: 'indoor_armory',
    kind: 'armory',
    notes: '东南武器库',
    mapX: 84,
    mapY: 72,
  },

  // —— 一楼·主楼 ——
  { id: 'room_1f_bed1', label: '卧室1', floor: 1, sceneId: 'indoor_woshi01', kind: 'bedroom', notes: '工业窄舱单人床', ...embedMain(20, 19) },
  { id: 'room_1f_bed2', label: '卧室2', floor: 1, sceneId: 'indoor_woshi02', kind: 'bedroom', notes: '偏私密卧室', ...embedMain(36, 17) },
  { id: 'room_1f_bath', label: '浴室', floor: 1, sceneId: 'indoor_yushi', kind: 'bath', notes: '浴缸与工业热水器', ...embedMain(52, 17) },
  { id: 'room_1f_machine', label: '机房', floor: 1, sceneId: 'indoor_jifang', kind: 'utility', notes: '发电机与锅炉', ...embedMain(73, 19) },
  { id: 'room_1f_gate', label: '大厅大门', floor: 1, sceneId: 'indoor_damen', kind: 'entrance', notes: '主楼西侧入口过渡', ...embedMain(13, 41) },
  { id: 'room_1f_hall1', label: '大厅1', floor: 1, sceneId: 'indoor_dating', kind: 'hall', notes: '一楼中央枢纽·白板工位', ...embedMain(36, 41) },
  { id: 'room_1f_stairs', label: '楼梯', floor: 1, sceneId: 'indoor_stairs', kind: 'stairs', notes: '通往二楼与负一楼安抚室', ...embedMain(56, 44) },
  { id: 'room_1f_storage', label: '仓库', floor: 1, sceneId: 'indoor_cangku', kind: 'storage', notes: '货架木箱', ...embedMain(72, 45) },
  { id: 'room_1f_bed3', label: '卧室3', floor: 1, sceneId: 'indoor_woshi03', kind: 'bedroom', notes: '稍大卧室', ...embedMain(76, 71) },
  { id: 'room_1f_hall2', label: '大厅2', floor: 1, sceneId: 'indoor_dating02', kind: 'hall', notes: '一楼南侧大厅·星徽地坪', ...embedMain(44, 69) },
  { id: 'room_1f_mech', label: '机械区', floor: 1, sceneId: 'indoor_jixie', kind: 'mechanical', notes: '罐体粗管检修', ...embedMain(20, 71) },

  /**
   * 负一楼安抚室（原库房）：对话事件 + 营地 B1 页可见。
   */
  {
    id: 'room_b1_discipline',
    label: '安抚室',
    floor: -1,
    sceneId: 'indoor_tiaojiaoshi',
    kind: 'discipline',
    notes: '负一层安抚室；软垫与棉花，暖光',
    mapX: 50,
    mapY: 58,
  },

  // —— 二楼·主楼（院落在二楼图上可见，角色仍以室内为主） ——
  { id: 'room_2f_bed4', label: '卧室4', floor: 2, sceneId: 'indoor_woshi04', kind: 'bedroom', notes: '西北卧室', ...embedMain(17, 18) },
  { id: 'room_2f_bed5', label: '卧室5', floor: 2, sceneId: 'indoor_woshi05', kind: 'bedroom', notes: '北侧卧室', ...embedMain(35, 18) },
  { id: 'room_2f_wc', label: '厕所', floor: 2, sceneId: 'indoor_wc2', kind: 'bath', notes: '二楼公厕', ...embedMain(55, 18) },
  { id: 'room_2f_storage', label: '储物间', floor: 2, sceneId: 'indoor_chuwu', kind: 'storage', notes: '二楼储物', ...embedMain(78, 18) },
  { id: 'room_2f_hall_west', label: '二楼大厅·西', floor: 2, sceneId: 'indoor_dating_f2', kind: 'hall', notes: '皮沙发起居·窗外星沙', ...embedMain(19, 43) },
  { id: 'room_2f_atrium', label: '厅1·中庭', floor: 2, sceneId: 'indoor_ting1', kind: 'hall', notes: '中庭回廊（绕栏杆走）', ...embedMain(42, 43) },
  { id: 'room_2f_stairs', label: '二楼楼梯口', floor: 2, sceneId: 'indoor_stairs', kind: 'stairs', notes: '下到一楼', ...embedMain(60, 43) },
  { id: 'room_2f_yule', label: '娱乐间', floor: 2, sceneId: 'indoor_yule', kind: 'entertainment', notes: '台球与牌局', ...embedMain(77, 46) },
  { id: 'room_2f_lounge', label: '二楼大厅·南', floor: 2, sceneId: 'indoor_dating_f2b', kind: 'hall', notes: '南大厅·夹层俯视车间', ...embedMain(46, 72) },
  { id: 'room_2f_bed6', label: '卧室6', floor: 2, sceneId: 'indoor_woshi06', kind: 'bedroom', notes: '西南卧室', ...embedMain(18, 71) },
  { id: 'room_2f_bed7', label: '卧室7', floor: 2, sceneId: 'indoor_woshi07', kind: 'bedroom', notes: '东南卧室', ...embedMain(76, 71) },
];

export const CAMP_ROOM_MAP = Object.fromEntries(CAMP_ROOMS.map((r) => [r.id, r])) as Record<
  string,
  CampRoomDef
>;

export const SCENE_TO_ROOMS: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {};
  for (const r of CAMP_ROOMS) {
    (m[r.sceneId] ??= []).push(r.id);
  }
  return m;
})();

export const CAMP_EDGES: CampEdge[] = [
  // 院落白线
  ['room_yard', 'room_1f_tower'],
  ['room_yard', 'room_1f_pool'],
  ['room_yard', 'room_1f_gate'],
  ['room_yard', 'room_1f_shop'],
  ['room_yard', 'room_1f_armory'],
  ['room_1f_shop', 'room_1f_shop_bed'],
  // 主楼一楼
  ['room_1f_gate', 'room_1f_hall1'],
  ['room_1f_bed1', 'room_1f_hall1'],
  ['room_1f_bed2', 'room_1f_hall1'],
  ['room_1f_bath', 'room_1f_hall1'],
  ['room_1f_machine', 'room_1f_hall1'],
  ['room_1f_stairs', 'room_1f_hall1'],
  ['room_1f_hall1', 'room_1f_hall2'],
  ['room_1f_hall1', 'room_1f_storage'],
  ['room_1f_hall2', 'room_1f_bed3'],
  ['room_1f_hall2', 'room_1f_storage'],
  ['room_1f_hall2', 'room_1f_mech'],
  // 垂直
  ['room_1f_stairs', 'room_2f_stairs'],
  ['room_1f_stairs', 'room_b1_discipline'],
  // 二楼环线
  ['room_2f_stairs', 'room_2f_atrium'],
  ['room_2f_atrium', 'room_2f_hall_west'],
  ['room_2f_atrium', 'room_2f_yule'],
  ['room_2f_atrium', 'room_2f_lounge'],
  ['room_2f_hall_west', 'room_2f_bed4'],
  ['room_2f_hall_west', 'room_2f_bed5'],
  ['room_2f_hall_west', 'room_2f_bed6'],
  ['room_2f_bed4', 'room_2f_bed5'],
  ['room_2f_bed5', 'room_2f_wc'],
  ['room_2f_wc', 'room_2f_storage'],
  ['room_2f_storage', 'room_2f_stairs'],
  ['room_2f_yule', 'room_2f_lounge'],
  ['room_2f_lounge', 'room_2f_bed7'],
  ['room_2f_bed6', 'room_2f_lounge'],
];

const ADJ: Record<string, string[]> = (() => {
  const g: Record<string, string[]> = {};
  for (const [a, b] of CAMP_EDGES) {
    (g[a] ??= []).push(b);
    (g[b] ??= []).push(a);
  }
  return g;
})();

export function getCampRoom(roomId: string): CampRoomDef | null {
  return CAMP_ROOM_MAP[roomId] ?? null;
}

export function getCampRoomBySceneId(sceneId: string): CampRoomDef | null {
  if (sceneId === 'camp_auto' || sceneId.startsWith('camp_') || sceneId === 'outdoor_gate') {
    return CAMP_ROOM_MAP.room_yard ?? null;
  }
  const ids = SCENE_TO_ROOMS[sceneId];
  if (!ids?.length) return null;
  return CAMP_ROOM_MAP[ids[0]] ?? null;
}

export function neighborsOf(roomId: string): string[] {
  return ADJ[roomId] ?? [];
}

export function findCampPath(fromRoomId: string, toRoomId: string): string[] | null {
  if (fromRoomId === toRoomId) return [fromRoomId];
  if (!CAMP_ROOM_MAP[fromRoomId] || !CAMP_ROOM_MAP[toRoomId]) return null;
  const q = [fromRoomId];
  const prev = new Map<string, string | null>([[fromRoomId, null]]);
  while (q.length) {
    const cur = q.shift()!;
    for (const n of neighborsOf(cur)) {
      if (prev.has(n)) continue;
      prev.set(n, cur);
      if (n === toRoomId) {
        const path = [n];
        let p: string | null = cur;
        while (p) {
          path.push(p);
          p = prev.get(p) ?? null;
        }
        return path.reverse();
      }
      q.push(n);
    }
  }
  return null;
}

export function describePath(path: string[]): string {
  return path.map((id) => CAMP_ROOM_MAP[id]?.label ?? id).join(' → ');
}

export const CHARACTER_HOME_ROOM: Record<string, string> = {
  ashcrow: 'room_1f_bed1',
  heartforge: 'room_1f_bed1',
  mirror: 'room_1f_bed2',
  neoncoil: 'room_1f_bed2',
  prismrift: 'room_1f_bed3',
  wireguard: 'room_2f_bed4',
  frostline: 'room_1f_bed3',
  pulse: 'room_2f_bed5',
  dustblade: 'room_2f_bed6',
  ironrain: 'room_1f_bed3',
  skyshard: 'room_2f_bed4',
  stellar: 'room_2f_bed7',
  outercore: 'room_2f_bed5',
};

export const CHARACTER_SLEEP_ROOM: Record<string, string> = {
  ...CHARACTER_HOME_ROOM,
};

export function getCharacterHomeRoom(characterId: string): CampRoomDef {
  const id = CHARACTER_HOME_ROOM[characterId] ?? 'room_1f_bed1';
  return CAMP_ROOM_MAP[id]!;
}

export function getCharacterSleepRoom(characterId: string): CampRoomDef {
  const id = CHARACTER_SLEEP_ROOM[characterId] ?? CHARACTER_HOME_ROOM[characterId] ?? 'room_1f_bed1';
  return CAMP_ROOM_MAP[id]!;
}

export function roomToSceneId(roomId: string): string {
  return CAMP_ROOM_MAP[roomId]?.sceneId ?? 'indoor_dating';
}

export function listRoomsOnFloor(floor: CampFloor): CampRoomDef[] {
  return CAMP_ROOMS.filter((r) => r.floor === floor && r.mapX >= 0);
}

export function buildCampLayoutPromptBlock(): string {
  return `【家园营地·生活范围（硬规则）】
你和同伴的日常只在「室内双层主楼 + 围栏院落」活动，禁止自称远征外地、白棺谷任务途中、熔炉城出差等——那些是出征玩法，不是营地生活。
营地生活核心：在此「真的过日子」，并与同伴一起围着指挥官（矮小废弃机器人，见【指挥官·本体设定】）形成有感情温度的羁绊团队；他在场时间=玩家打开游戏的时间。
院落地标：营地大门、警卫塔、泳池、商店（含商店卧室与商店老板娘）、武器库；沙地白线连通。各地标功能细则见【营地院落地标·功能与硬规则】。
一楼主楼：大厅大门→大厅1（枢纽）连通卧室1/2、浴室、机房、楼梯、仓库、大厅2；大厅2连通卧室3与机械区。
二楼：楼梯→中庭回廊，环通西/南大厅、娱乐间；卧室4–7、厕所、储物间挂环线。
相遇多在大厅、娱乐间与院落；换层必须走楼梯。平面移动沿白线走廊，不穿墙、不踩家具。
硬界限：除远征/战斗玩法外，不得走出营地大门到「远处」。`;
}

export function buildCharacterCampPromptLines(
  characterId: string,
  currentSceneOrRoom: string,
  behavior?: string,
): string {
  const home = getCharacterHomeRoom(characterId);
  const sleep = getCharacterSleepRoom(characterId);
  let cur = getCampRoom(currentSceneOrRoom);
  if (!cur) cur = getCampRoomBySceneId(currentSceneOrRoom);
  const yardKinds = new Set(['yard', 'tower', 'pool']);
  const here = cur
    ? `${yardKinds.has(cur.kind) ? `院落·${cur.label}` : `${cur.floor === -1 ? '负一' : cur.floor}楼·${cur.label}`}（${cur.notes}）`
    : currentSceneOrRoom;
  const path = cur ? findCampPath(cur.id, sleep.id) : null;
  return [
    `你的卧室：${sleep.floor}楼·${sleep.label}`,
    `日常据点偏好：${home.floor}楼·${home.label}`,
    `此刻所在：${here}`,
    behavior ? `此刻在做：${behavior}` : '',
    path && path.length > 1 ? `回卧室路线：${describePath(path)}` : '',
    `生活圈：只在营地室内与院落，不在外地。`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** 同营其他人实时位置（进 Prompt，让角色知道谁在哪） */
export function buildCampRosterPromptBlock(
  livingPresences: { name: string; roomLabel: string; behavior: string }[],
): string {
  if (!livingPresences.length) return '';
  const lines = livingPresences
    .slice(0, 12)
    .map((p) => `- ${p.name}：${p.roomLabel}｜${p.behavior}`)
    .join('\n');
  return `【营地同伴此刻】（实时，会变）\n${lines}`;
}

export const CAMP_INDOOR_SCENE_ORDER: string[] = [
  'outdoor_gate',
  'outdoor_tower',
  'outdoor_pool',
  'indoor_shop',
  'indoor_shop_bed',
  'indoor_armory',
  'indoor_damen',
  'indoor_dating',
  'indoor_woshi01',
  'indoor_woshi02',
  'indoor_yushi',
  'indoor_jifang',
  'indoor_stairs',
  'indoor_cangku',
  'indoor_dating02',
  'indoor_woshi03',
  'indoor_jixie',
  'indoor_dating_f2',
  'indoor_ting1',
  'indoor_woshi04',
  'indoor_woshi05',
  'indoor_wc2',
  'indoor_chuwu',
  'indoor_yule',
  'indoor_dating_f2b',
  'indoor_woshi06',
  'indoor_woshi07',
];
