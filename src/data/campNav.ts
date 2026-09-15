/**
 * 营地平面导航：房间锚点、门洞、走廊途经点、墙体碰撞盒
 * 坐标为平面图百分比（相对 shinei01_*lou.jpg 整图 2386×1590 横屏）
 *
 * 墙 = 家具/中庭 AABB（院落靠白线可行走，不再封死外框）；
 * 路 = 房间锚点 + luxian 白线网格
 */
import {
  CAMP_ROOM_MAP,
  findCampPath,
  neighborsOf,
  type CampFloor,
} from './campLayout';
import { findWhiteRoutePolyline, nearestWhitePoint } from './campWhiteRoute';

export type CampVec = { x: number; y: number };

export type CampRoomNav = {
  roomId: string;
  /** 房间内默认站立点（避开家具中心） */
  anchor: CampVec;
  /** 室内可微移的站立点（碰撞内可走） */
  spots: CampVec[];
  /** 通往邻接房间的门洞（世界坐标 %） */
  doors: Record<string, CampVec>;
};

/** 轴对齐墙体：角色锚点不可落入内部 */
export type CampWall = { x: number; y: number; w: number; h: number; floor: CampFloor };

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function dist(a: CampVec, b: CampVec): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function lerp(a: CampVec, b: CampVec, t: number): CampVec {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** 一楼房间导航（横屏整图 %） */
const NAV_1F: CampRoomNav[] = [
  {
    roomId: 'room_yard',
    anchor: { x: 11, y: 48 },
    spots: [
      { x: 9, y: 44 },
      { x: 12, y: 52 },
      { x: 14, y: 46 },
    ],
    doors: {
      room_1f_gate: { x: 22, y: 48 },
      room_1f_tower: { x: 14, y: 28 },
      room_1f_pool: { x: 16, y: 70 },
      room_1f_shop: { x: 70, y: 40 },
      room_1f_armory: { x: 72, y: 68 },
    },
  },
  {
    roomId: 'room_1f_tower',
    anchor: { x: 14, y: 20 },
    spots: [
      { x: 12, y: 22 },
      { x: 16, y: 24 },
    ],
    doors: {
      room_yard: { x: 14, y: 28 },
    },
  },
  {
    roomId: 'room_1f_pool',
    anchor: { x: 18, y: 80 },
    spots: [
      { x: 16, y: 78 },
      { x: 20, y: 82 },
    ],
    doors: {
      room_yard: { x: 16, y: 70 },
    },
  },
  {
    roomId: 'room_1f_shop_bed',
    anchor: { x: 82, y: 22 },
    spots: [
      { x: 80, y: 24 },
      { x: 84, y: 26 },
    ],
    doors: {
      room_1f_shop: { x: 82, y: 28 },
    },
  },
  {
    roomId: 'room_1f_shop',
    anchor: { x: 82, y: 34 },
    spots: [
      { x: 80, y: 32 },
      { x: 84, y: 36 },
    ],
    doors: {
      room_1f_shop_bed: { x: 82, y: 28 },
      room_yard: { x: 70, y: 40 },
    },
  },
  {
    roomId: 'room_1f_armory',
    anchor: { x: 84, y: 72 },
    spots: [
      { x: 82, y: 70 },
      { x: 86, y: 74 },
    ],
    doors: {
      room_yard: { x: 72, y: 68 },
    },
  },
  {
    roomId: 'room_1f_gate',
    anchor: { x: 35.7, y: 46.8 },
    spots: [
      { x: 34.9, y: 45.5 },
      { x: 36.1, y: 48.0 },
    ],
    doors: {
      room_yard: { x: 22, y: 48 },
      room_1f_hall1: { x: 39.1, y: 46.8 },
    },
  },
  {
    roomId: 'room_1f_bed1',
    anchor: { x: 38.2, y: 33.1 },
    spots: [
      { x: 37.4, y: 34.4 },
      { x: 39.1, y: 35.6 },
      { x: 37.8, y: 31.9 },
    ],
    doors: {
      room_1f_hall1: { x: 40.8, y: 38.1 },
    },
  },
  {
    roomId: 'room_1f_bed2',
    anchor: { x: 45.8, y: 31.9 },
    spots: [
      { x: 45.0, y: 33.1 },
      { x: 46.6, y: 34.4 },
    ],
    doors: {
      room_1f_hall1: { x: 45.8, y: 38.1 },
    },
  },
  {
    roomId: 'room_1f_bath',
    anchor: { x: 51.7, y: 31.9 },
    spots: [
      { x: 50.8, y: 33.1 },
      { x: 52.5, y: 34.4 },
    ],
    doors: {
      room_1f_hall1: { x: 50.0, y: 38.1 },
    },
  },
  {
    roomId: 'room_1f_machine',
    anchor: { x: 60.9, y: 33.1 },
    spots: [
      { x: 59.2, y: 34.4 },
      { x: 61.8, y: 35.6 },
      { x: 60.1, y: 36.8 },
    ],
    doors: {
      room_1f_hall1: { x: 56.7, y: 39.3 },
    },
  },
  {
    roomId: 'room_1f_hall1',
    anchor: { x: 46.6, y: 45.5 },
    spots: [
      { x: 44.1, y: 44.3 },
      { x: 48.3, y: 46.8 },
      { x: 45.8, y: 49.2 },
      { x: 49.2, y: 44.3 },
    ],
    doors: {
      room_1f_gate: { x: 39.1, y: 46.8 },
      room_1f_bed1: { x: 40.8, y: 38.1 },
      room_1f_bed2: { x: 45.8, y: 38.1 },
      room_1f_bath: { x: 50.0, y: 38.1 },
      room_1f_machine: { x: 56.7, y: 39.3 },
      room_1f_stairs: { x: 52.5, y: 48.0 },
      room_1f_storage: { x: 55.0, y: 49.2 },
      room_1f_hall2: { x: 47.5, y: 54.2 },
    },
  },
  {
    roomId: 'room_1f_stairs',
    anchor: { x: 53.4, y: 48.0 },
    spots: [
      { x: 52.5, y: 46.8 },
      { x: 54.2, y: 49.2 },
    ],
    doors: {
      room_1f_hall1: { x: 51.7, y: 48.0 },
      room_2f_stairs: { x: 53.4, y: 48.0 },
    },
  },
  {
    roomId: 'room_1f_storage',
    anchor: { x: 60.9, y: 49.2 },
    spots: [
      { x: 59.2, y: 48.0 },
      { x: 61.8, y: 50.5 },
      { x: 60.1, y: 51.7 },
    ],
    doors: {
      room_1f_hall1: { x: 55.0, y: 49.2 },
      room_1f_hall2: { x: 57.6, y: 55.4 },
    },
  },
  {
    roomId: 'room_1f_hall2',
    anchor: { x: 49.2, y: 61.6 },
    spots: [
      { x: 46.6, y: 60.4 },
      { x: 50.8, y: 62.9 },
      { x: 48.3, y: 64.1 },
    ],
    doors: {
      room_1f_hall1: { x: 47.5, y: 54.2 },
      room_1f_storage: { x: 57.6, y: 55.4 },
      room_1f_bed3: { x: 58.4, y: 62.9 },
      room_1f_mech: { x: 40.8, y: 61.6 },
    },
  },
  {
    roomId: 'room_1f_mech',
    anchor: { x: 38.2, y: 62.9 },
    spots: [
      { x: 37.4, y: 61.6 },
      { x: 39.1, y: 64.1 },
    ],
    doors: {
      room_1f_hall2: { x: 40.8, y: 61.6 },
    },
  },
  /** 负一楼小黑屋：对话瞬移用；不接日常折线 */
  {
    roomId: 'room_b1_discipline',
    anchor: { x: 38.2, y: 70.0 },
    spots: [
      { x: 37.5, y: 69.2 },
      { x: 39.0, y: 70.8 },
    ],
    doors: {},
  },
  {
    roomId: 'room_1f_bed3',
    anchor: { x: 61.8, y: 64.1 },
    spots: [
      { x: 60.9, y: 62.9 },
      { x: 62.6, y: 65.4 },
    ],
    doors: {
      room_1f_hall2: { x: 58.4, y: 62.9 },
    },
  },
];

/** 二楼：中庭「厅1」为镂空，可行走为环廊节点 atrium */
const NAV_2F: CampRoomNav[] = [
  {
    roomId: 'room_2f_bed4',
    anchor: { x: 37.4, y: 31.9 },
    spots: [
      { x: 36.6, y: 33.1 },
      { x: 38.2, y: 34.4 },
    ],
    doors: {
      room_2f_hall_west: { x: 39.1, y: 38.1 },
    },
  },
  {
    roomId: 'room_2f_bed5',
    anchor: { x: 45.8, y: 31.9 },
    spots: [
      { x: 45.0, y: 33.1 },
      { x: 46.6, y: 34.4 },
    ],
    doors: {
      room_2f_hall_west: { x: 45.8, y: 38.1 },
    },
  },
  {
    roomId: 'room_2f_wc',
    anchor: { x: 53.4, y: 31.9 },
    spots: [
      { x: 52.5, y: 33.1 },
      { x: 54.2, y: 34.4 },
    ],
    doors: {
      room_2f_atrium: { x: 52.5, y: 38.1 },
    },
  },
  {
    roomId: 'room_2f_storage',
    anchor: { x: 62.6, y: 33.1 },
    spots: [
      { x: 61.8, y: 34.4 },
      { x: 63.4, y: 35.6 },
    ],
    doors: {
      room_2f_atrium: { x: 59.2, y: 38.1 },
      room_2f_stairs: { x: 59.2, y: 43.0 },
    },
  },
  {
    roomId: 'room_2f_hall_west',
    anchor: { x: 38.2, y: 46.8 },
    spots: [
      { x: 37.4, y: 44.3 },
      { x: 39.1, y: 49.2 },
      { x: 39.9, y: 46.8 },
    ],
    doors: {
      room_2f_bed4: { x: 39.1, y: 38.1 },
      room_2f_bed5: { x: 45.8, y: 38.1 },
      room_2f_bed6: { x: 39.1, y: 57.9 },
      room_2f_atrium: { x: 43.3, y: 46.8 },
    },
  },
  {
    roomId: 'room_2f_atrium',
    anchor: { x: 49.2, y: 51.7 },
    spots: [
      { x: 46.6, y: 44.3 },
      { x: 51.7, y: 44.3 },
      { x: 49.2, y: 53.0 },
      { x: 45.8, y: 49.2 },
    ],
    doors: {
      room_2f_hall_west: { x: 43.3, y: 46.8 },
      room_2f_stairs: { x: 54.2, y: 46.8 },
      room_2f_yule: { x: 57.6, y: 49.2 },
      room_2f_lounge: { x: 49.2, y: 57.9 },
      room_2f_wc: { x: 52.5, y: 38.1 },
      room_2f_storage: { x: 59.2, y: 38.1 },
    },
  },
  {
    roomId: 'room_2f_stairs',
    anchor: { x: 55.0, y: 46.8 },
    spots: [
      { x: 54.2, y: 45.5 },
      { x: 55.9, y: 48.0 },
    ],
    doors: {
      room_2f_atrium: { x: 53.4, y: 46.8 },
      room_1f_stairs: { x: 55.0, y: 46.8 },
      room_2f_storage: { x: 59.2, y: 43.0 },
    },
  },
  {
    roomId: 'room_2f_yule',
    anchor: { x: 62.6, y: 50.5 },
    spots: [
      { x: 60.9, y: 48.0 },
      { x: 63.4, y: 51.7 },
      { x: 61.8, y: 53.0 },
    ],
    doors: {
      room_2f_atrium: { x: 57.6, y: 49.2 },
      room_2f_lounge: { x: 58.4, y: 57.9 },
    },
  },
  {
    roomId: 'room_2f_lounge',
    anchor: { x: 49.2, y: 64.1 },
    spots: [
      { x: 46.6, y: 62.9 },
      { x: 50.8, y: 65.4 },
      { x: 48.3, y: 61.6 },
    ],
    doors: {
      room_2f_atrium: { x: 49.2, y: 57.9 },
      room_2f_yule: { x: 58.4, y: 57.9 },
      room_2f_bed6: { x: 40.8, y: 62.9 },
      room_2f_bed7: { x: 58.4, y: 65.4 },
    },
  },
  {
    roomId: 'room_2f_bed6',
    anchor: { x: 37.4, y: 64.1 },
    spots: [
      { x: 36.6, y: 62.9 },
      { x: 38.2, y: 65.4 },
    ],
    doors: {
      room_2f_hall_west: { x: 39.1, y: 57.9 },
      room_2f_lounge: { x: 40.8, y: 62.9 },
    },
  },
  {
    roomId: 'room_2f_bed7',
    anchor: { x: 62.6, y: 65.4 },
    spots: [
      { x: 61.8, y: 64.1 },
      { x: 63.4, y: 66.6 },
    ],
    doors: {
      room_2f_lounge: { x: 58.4, y: 65.4 },
    },
  },
];

export const CAMP_NAV_BY_ROOM: Record<string, CampRoomNav> = Object.fromEntries(
  [...NAV_1F, ...NAV_2F].map((n) => [n.roomId, n]),
);

/**
 * 墙体 / 不可走区（粗略 AABB，百分比）
 * 院落开放（白线可行）；仅挡主楼家具与二楼中庭镂空
 */
export const CAMP_WALLS: CampWall[] = [

  { floor: 1, x: 35.7, y: 28.2, w: 4.2, h: 3.7 },
  { floor: 1, x: 43.3, y: 26.9, w: 4.2, h: 3.7 },
  { floor: 1, x: 50.0, y: 26.9, w: 3.4, h: 3.7 },
  { floor: 1, x: 58.4, y: 28.2, w: 5.9, h: 6.2 },
  { floor: 1, x: 44.1, y: 43.0, w: 5.0, h: 3.7 },
  { floor: 1, x: 58.4, y: 45.5, w: 5.0, h: 6.2 },
  { floor: 1, x: 45.8, y: 59.2, w: 6.7, h: 3.7 },
  { floor: 1, x: 34.9, y: 59.2, w: 4.2, h: 6.2 },
  { floor: 1, x: 60.1, y: 60.4, w: 4.2, h: 3.7 },
  { floor: 2, x: 45.0, y: 40.6, w: 7.6, h: 9.9 },
  { floor: 2, x: 34.9, y: 26.9, w: 4.2, h: 3.7 },
  { floor: 2, x: 43.3, y: 26.9, w: 4.2, h: 3.7 },
  { floor: 2, x: 50.8, y: 26.9, w: 4.2, h: 5.0 },
  { floor: 2, x: 60.1, y: 26.9, w: 5.0, h: 6.2 },
  { floor: 2, x: 34.9, y: 43.0, w: 5.0, h: 5.0 },
  { floor: 2, x: 60.1, y: 45.5, w: 5.0, h: 6.2 },
  { floor: 2, x: 45.8, y: 60.4, w: 5.9, h: 3.7 },
  { floor: 2, x: 34.9, y: 60.4, w: 4.2, h: 3.7 },
  { floor: 2, x: 60.1, y: 61.6, w: 4.2, h: 3.7 },
];
export function getRoomNav(roomId: string): CampRoomNav | null {
  return CAMP_NAV_BY_ROOM[roomId] ?? null;
}

export function roomFloor(roomId: string): CampFloor {
  return CAMP_ROOM_MAP[roomId]?.floor ?? 1;
}

export function pointInWall(p: CampVec, floor: CampFloor): boolean {
  for (const w of CAMP_WALLS) {
    if (w.floor !== floor) continue;
    if (p.x >= w.x && p.x <= w.x + w.w && p.y >= w.y && p.y <= w.y + w.h) return true;
  }
  return false;
}

/** 把点推出墙体（简单投影） */
export function resolveCollision(p: CampVec, floor: CampFloor): CampVec {
  let { x, y } = p;
  x = clamp(x, 2, 98);
  y = clamp(y, 4, 96);
  for (let i = 0; i < 4; i++) {
    let hit = false;
    for (const w of CAMP_WALLS) {
      if (w.floor !== floor) continue;
      if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) {
        hit = true;
        const dl = x - w.x;
        const dr = w.x + w.w - x;
        const dt = y - w.y;
        const db = w.y + w.h - y;
        const m = Math.min(dl, dr, dt, db);
        if (m === dl) x = w.x - 0.4;
        else if (m === dr) x = w.x + w.w + 0.4;
        else if (m === dt) y = w.y - 0.4;
        else y = w.y + w.h + 0.4;
      }
    }
    if (!hit) break;
  }
  return { x: clamp(x, 2, 98), y: clamp(y, 4, 96) };
}

function doorBetween(fromId: string, toId: string): CampVec | null {
  const a = CAMP_NAV_BY_ROOM[fromId];
  const b = CAMP_NAV_BY_ROOM[toId];
  if (a?.doors[toId]) return a.doors[toId];
  if (b?.doors[fromId]) return b.doors[fromId];
  if (
    (fromId === 'room_1f_stairs' && toId === 'room_2f_stairs') ||
    (fromId === 'room_2f_stairs' && toId === 'room_1f_stairs')
  ) {
    return a?.anchor ?? b?.anchor ?? null;
  }
  return null;
}

/** 房间图路径 → 平面折线：优先贴合 luxian 白线网格 */
export function buildWaypointPolyline(
  fromRoomId: string,
  toRoomId: string,
  preferSpot = true,
): CampVec[] {
  const path = findCampPath(fromRoomId, toRoomId);
  if (!path?.length) {
    const n = CAMP_NAV_BY_ROOM[toRoomId];
    return n ? [n.anchor] : [];
  }

  const startNav = CAMP_NAV_BY_ROOM[path[0]];
  const endNav = CAMP_NAV_BY_ROOM[path[path.length - 1]];
  if (!startNav || !endNav) return [];

  const dest =
    preferSpot && endNav.spots.length
      ? endNav.spots[Math.floor(Math.random() * endNav.spots.length)]
      : endNav.anchor;

  const fromFloor = roomFloor(path[0]);
  const toFloor = roomFloor(path[path.length - 1]);
  if (fromFloor === toFloor) {
    const white = findWhiteRoutePolyline(fromFloor, startNav.anchor, dest);
    return white.map((p) => resolveCollision(p, fromFloor));
  }

  const stairsFrom = fromFloor === 1 ? 'room_1f_stairs' : 'room_2f_stairs';
  const stairsTo = fromFloor === 1 ? 'room_2f_stairs' : 'room_1f_stairs';
  const stairsNavA = CAMP_NAV_BY_ROOM[stairsFrom];
  const stairsNavB = CAMP_NAV_BY_ROOM[stairsTo];
  if (!stairsNavA || !stairsNavB) {
    return [startNav.anchor, dest].map((p) => resolveCollision(p, fromFloor));
  }

  const leg1 = findWhiteRoutePolyline(fromFloor, startNav.anchor, stairsNavA.anchor);
  const leg2 = findWhiteRoutePolyline(toFloor, stairsNavB.anchor, dest);
  return [
    ...leg1.map((p) => resolveCollision(p, fromFloor)),
    ...leg2.map((p) => resolveCollision(p, toFloor)),
  ];
}

/** 同房间内微移：优先贴近白线 */
export function pickRoomWanderPoint(roomId: string, from: CampVec): CampVec {
  const nav = CAMP_NAV_BY_ROOM[roomId];
  if (!nav) return from;
  const candidates = [...nav.spots, nav.anchor];
  const pick = candidates[Math.floor(Math.random() * candidates.length)] ?? nav.anchor;
  const floor = roomFloor(roomId);
  const onWire = nearestWhitePoint(floor, pick);
  if (Math.hypot(onWire.x - nav.anchor.x, onWire.y - nav.anchor.y) > 14) {
    return resolveCollision(pick, floor);
  }
  return resolveCollision(onWire, floor);
}

export function samplePolyline(points: CampVec[], t: number): CampVec {
  if (!points.length) return { x: 50, y: 50 };
  if (points.length === 1) return points[0];
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = dist(points[i], points[i + 1]);
    segs.push(d);
    total += d;
  }
  if (total < 0.01) return points[points.length - 1];
  let remain = clamp(t, 0, 1) * total;
  for (let i = 0; i < segs.length; i++) {
    if (remain <= segs[i]) {
      const u = segs[i] < 0.01 ? 1 : remain / segs[i];
      return lerp(points[i], points[i + 1], u);
    }
    remain -= segs[i];
  }
  return points[points.length - 1];
}

export function estimateWalkDurationMs(points: CampVec[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += dist(points[i], points[i + 1]);
  return clamp(Math.round((total / 18) * 1000), 600, 5000);
}

export function syncLayoutAnchorsFromNav(): void {
  for (const [id, nav] of Object.entries(CAMP_NAV_BY_ROOM)) {
    const room = CAMP_ROOM_MAP[id];
    if (!room) continue;
    room.mapX = nav.anchor.x;
    room.mapY = nav.anchor.y;
  }
}

/** 校验邻接门洞是否齐全（开发期可打日志） */
export function validateNavDoors(): string[] {
  const issues: string[] = [];
  for (const id of Object.keys(CAMP_NAV_BY_ROOM)) {
    for (const n of neighborsOf(id)) {
      if (!CAMP_NAV_BY_ROOM[n]) continue;
      if (!doorBetween(id, n)) issues.push(`缺门洞: ${id} ↔ ${n}`);
    }
  }
  return issues;
}
