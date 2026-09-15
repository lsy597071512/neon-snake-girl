/**
 * 营地自主生活：角色在室内/门口附近按人设作息自驱活动。
 * 本地规则为默认；营地页打开且生活路径导演运行时，用 LLM 覆盖落点。
 */
import {
  CAMP_ROOM_MAP,
  getCharacterHomeRoom,
  getCharacterSleepRoom,
  type CampRoomDef,
} from '../data/campLayout';
import { getAgent } from './campAgents';
import { agendaToPresenceOverride, getAgenda, isAgendaActive } from './characterAgenda';
import { coerceActivityToRoom } from './dialoguePresence';
import { applyLifePathOverrideToPresence } from './lifePathDirector';
import { applySleepPresenceOverride } from './sleepSystem';
import { getDayMinute, getHour } from './worldClock';
import type { AiLivingSave, CharacterActivity, LightStatusTag, LivingPresence } from './types';

function stableRoll(characterId: string, living: AiLivingSave, salt = 0): number {
  let h = living.dayIndex * 131 + getDayMinute(living) + salt * 97;
  for (let i = 0; i < characterId.length; i++) h = (h * 31 + characterId.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

/** 身体锚点保鲜期（游戏分钟）：期内作息表不得瞬移；过后自主生活自然接管 */
export const BODY_ANCHOR_TTL_GAME_MIN = 180;

/** 白天偏好点（全在营地生活圈） */
const DAY_WORK: Record<string, string> = {
  ashcrow: 'room_yard',
  heartforge: 'room_1f_hall1',
  mirror: 'room_2f_atrium',
  neoncoil: 'room_1f_storage',
  prismrift: 'room_1f_hall2',
  wireguard: 'room_1f_machine',
  frostline: 'room_2f_atrium',
  pulse: 'room_2f_yule',
  dustblade: 'room_yard',
  ironrain: 'room_1f_mech',
  skyshard: 'room_1f_hall1',
  stellar: 'room_2f_atrium',
  outercore: 'room_2f_yule',
};

const BEHAVIOR: Partial<
  Record<string, Partial<Record<CharacterActivity, string>>>
> = {
  ashcrow: {
    patrol: '在门口附近巡视风向',
    guard: '守着大门透气',
    busy: '整理出发前的短清单',
    maintain: '擦枪与翼饰',
  },
  heartforge: {
    maintain: '在大厅检修盾面并顺手整理补给',
    busy: '帮人挡门挡风、留意谁还没吃饭',
    rest: '安静坐着歇一口气，盾靠在脚边',
  },
  mirror: {
    busy: '在中庭观察楼下动静',
    idle: '靠栏杆发呆读光',
  },
  neoncoil: {
    busy: '在仓库清点刃具',
    maintain: '保养刺刀',
  },
  prismrift: {
    busy: '在大厅2核对射击纪律',
    eat: '沉默地吃饭',
  },
  wireguard: {
    maintain: '在机房听管线噪声',
    busy: '校准频谱',
    play: '在娱乐间大声连射空包玩笑',
  },
  frostline: {
    patrol: '在中庭安静站岗',
    idle: '背光处擦刃',
  },
  pulse: {
    play: '在娱乐间吵着打台球',
    busy: '给大家定节拍',
  },
  dustblade: {
    guard: '门口微笑守一阵',
    patrol: '在门口沙地走一圈',
    play: '在大厅说笑着道别式闲聊',
  },
  ironrain: {
    maintain: '在机械区听炉火还剩多久',
    busy: '检修液冷与警戒条',
    rest: '检修台发呆',
  },
  skyshard: {
    rest: '在大厅问人还好吗',
    bathe: '浴室里做接口除冰',
    idle: '静静坐着分享一点冷',
  },
  stellar: {
    idle: '在中庭写看不见的句号',
    busy: '校准光环',
  },
  outercore: {
    play: '在娱乐间逗兔式起哄',
    busy: '假装很闲其实在盯脉动',
  },
};

function dayWorkRoom(characterId: string): CampRoomDef {
  const id = DAY_WORK[characterId];
  if (id && CAMP_ROOM_MAP[id]) return CAMP_ROOM_MAP[id];
  return getCharacterHomeRoom(characterId);
}

function activityLabel(activity: CharacterActivity): string {
  const map: Record<CharacterActivity, string> = {
    idle: '发呆',
    busy: '忙碌',
    talking: '交谈',
    sleeping: '睡觉恢复电力',
    patrol: '巡逻',
    maintain: '维护',
    rest: '歇息',
    play: '玩乐',
    bathe: '洗浴',
    eat: '用餐',
    guard: '守门',
  };
  return map[activity];
}

function defaultBehavior(activity: CharacterActivity, room: CampRoomDef): string {
  const place = room.kind === 'yard' ? '营地门口' : `${room.floor}楼·${room.label}`;
  const map: Record<CharacterActivity, string> = {
    idle: `在${place}发呆`,
    busy: `在${place}做事`,
    talking: `在${place}跟人说话`,
    sleeping: `在${place}睡觉`,
    patrol: `在${place}附近走动`,
    maintain: `在${place}检修/收拾`,
    rest: `在${place}歇着`,
    play: `在${place}一起玩`,
    bathe: `在${place}清洗`,
    eat: `在${place}吃饭`,
    guard: `在${place}守着`,
  };
  return map[activity];
}

function pickBehavior(characterId: string, activity: CharacterActivity, room: CampRoomDef): string {
  return BEHAVIOR[characterId]?.[activity] ?? defaultBehavior(activity, room);
}

function roomLabel(room: CampRoomDef): string {
  return room.kind === 'yard' ? '营地门口' : `${room.floor}楼·${room.label}`;
}

/**
 * 角色自驱作息：只在营地室内 + 门口附近。
 * 用稳定随机让同一时段不同人分散，并形成大厅/娱乐间聚集。
 */
export function resolvePresence(characterId: string, living: AiLivingSave): LivingPresence {
  const hour = getHour(living);
  const sleep = getCharacterSleepRoom(characterId);
  const workRoom = dayWorkRoom(characterId);
  const saved = living.characterStatus[characterId] ?? [];
  const R = CAMP_ROOM_MAP;
  const roll = stableRoll(characterId, living);
  const roll2 = stableRoll(characterId, living, 3);

  let room: CampRoomDef = workRoom;
  let activity: CharacterActivity = 'idle';
  const tags: LightStatusTag[] = [...saved];

  if (hour >= 0 && hour < 5) {
    room = sleep;
    activity = 'sleeping';
    if (!tags.includes('fatigue')) tags.push('fatigue');
  } else if (hour >= 5 && hour < 7) {
    if (hour === 5) {
      room = roll > 0.45 ? R.room_1f_bath : R.room_2f_wc;
      activity = 'bathe';
    } else {
      room = workRoom.kind === 'yard' ? R.room_yard : workRoom;
      activity = workRoom.kind === 'yard' ? 'patrol' : 'maintain';
    }
  } else if (hour >= 7 && hour < 12) {
    room = workRoom;
    activity = workRoom.kind === 'yard' ? 'guard' : workRoom.kind === 'mechanical' || workRoom.kind === 'utility' ? 'maintain' : 'busy';
    if (hour >= 10 && !tags.includes('thirst')) tags.push('thirst');
  } else if (hour >= 12 && hour < 14) {
    room = R.room_1f_hall2;
    activity = 'eat';
    if (!tags.includes('hunger')) tags.push('hunger');
  } else if (hour >= 14 && hour < 18) {
    if (roll > 0.72) {
      room = R.room_1f_hall1;
      activity = 'talking';
    } else if (workRoom.kind === 'bedroom') {
      room = R.room_1f_hall1;
      activity = 'busy';
    } else {
      room = workRoom;
      activity = 'busy';
    }
  } else if (hour >= 18 && hour < 22) {
    // 晚间社交：娱乐间 / 大厅聚集
    if (roll2 > 0.55) {
      room = R.room_2f_yule;
      activity = 'play';
    } else if (roll > 0.4) {
      room = R.room_1f_hall1;
      activity = 'idle';
    } else {
      room = workRoom.kind === 'yard' ? R.room_yard : R.room_2f_lounge;
      activity = workRoom.kind === 'yard' ? 'guard' : 'rest';
    }
    if (hour >= 20 && !tags.includes('cold')) tags.push('cold');
  } else {
    room = roll > 0.55 ? sleep : workRoom.kind === 'yard' ? R.room_yard : sleep;
    activity = room.id === sleep.id ? 'sleeping' : 'patrol';
    if (!tags.includes('fatigue')) tags.push('fatigue');
  }

  const behavior = pickBehavior(characterId, activity, room);

  let base: LivingPresence = {
    characterId,
    locationId: room.sceneId,
    roomId: room.id,
    activity,
    behavior,
    statusTags: tags.slice(0, 4),
    label: `${activityLabel(activity)} · ${roomLabel(room)}`,
  };

  // 意图议程优先于纯作息表
  const agenda = getAgenda(living, characterId);
  if (isAgendaActive(agenda)) {
    const ov = agendaToPresenceOverride(characterId, agenda!);
    const agent = getAgent(characterId);
    const roomId = agent?.roomId && CAMP_ROOM_MAP[agent.roomId] ? agent.roomId : ov.roomId;
    const r = CAMP_ROOM_MAP[roomId];
    if (r) {
      // 身体以 agent 房间为准；活动必须与房间相容（防任意「错房+错活动」幽灵状态）
      const bodyMatchesAgenda = roomId === ov.roomId;
      let activity = bodyMatchesAgenda
        ? ov.activity
        : ((agent?.activity as CharacterActivity | undefined) ||
          (roomId === 'room_1f_bath' ? 'bathe' : ov.activity));
      activity = coerceActivityToRoom(roomId, activity, '');
      const behavior = bodyMatchesAgenda
        ? ov.behavior
        : agent?.behavior ||
          (roomId === 'room_1f_bath' ? '在浴室洗浴' : ov.behavior);
      base = {
        ...base,
        roomId,
        locationId: r.sceneId,
        activity,
        behavior,
        label: `${activityLabel(activity)} · ${roomLabel(r)}`,
      };
    }
  } else {
    // 身体锚点：对话世界同步的持久账本。议程过期/缺席时，锚点新鲜期内
    // 作息表不得把人瞬移走（修复「浴室聊完、再开变大厅」类世界失忆）。
    // 锚点过期（TTL）后由此处下方作息自然接管；接管时的叙事记忆在
    // livingService.reconcileBodyAnchor 里补写。
    const anchor = living.bodyAnchors?.[characterId];
    const anchorFresh =
      !!anchor && living.gameMinutes - anchor.atGameMin <= BODY_ANCHOR_TTL_GAME_MIN;
    if (anchor && anchorFresh) {
      const r = CAMP_ROOM_MAP[anchor.roomId];
      if (r) {
        const activity = coerceActivityToRoom(anchor.roomId, anchor.activity, '');
        base = {
          ...base,
          roomId: anchor.roomId,
          locationId: r.sceneId,
          activity,
          behavior: anchor.behavior || base.behavior,
          label: `${activityLabel(activity)} · ${roomLabel(r)}`,
        };
      }
    }
  }

  // 小黑屋会话是最高优先级：作息、生活路径和睡眠相位都不能覆盖它。
  const discipline = living.disciplineSession;
  if (discipline?.active && discipline.characterId === characterId) {
    const room = R["room_b1_discipline"];
    if (room) {
      return {
        ...base,
        roomId: room.id,
        locationId: room.sceneId,
        activity: 'talking',
        behavior:
          discipline.poseIndex != null && discipline.poseIndex > 0
            ? `在负一楼小黑屋触手调教姿势${discipline.poseIndex}中，被机械触手固定，无法自行离开`
            : '在负一楼小黑屋穿着调教约束皮待机，尚未被触手加压姿势缠住；房间门锁死，无法自行离开',
        label: `调教中 · ${room.floor}楼·${room.label}`,
      };
    }
  }

  const withLife = applyLifePathOverrideToPresence(characterId, base);
  // 睡眠系统相位优先：准备入睡 / 睡着 / 被打扰 锁卧室与活动
  return applySleepPresenceOverride(characterId, living, withLife);
}

/** 院落可见簇：默认外景应能看见大门/泳池/塔/商店/武器库的人 */
export const YARD_CLUSTER_ROOMS = new Set([
  'room_yard',
  'room_1f_pool',
  'room_1f_tower',
  'room_1f_shop',
  'room_1f_armory',
  'room_1f_shop_bed',
]);

export function isYardClusterRoom(roomId: string): boolean {
  return YARD_CLUSTER_ROOMS.has(roomId);
}

export function listPresencesAt(
  characterIds: string[],
  living: AiLivingSave,
  locationId: string,
): LivingPresence[] {
  return characterIds
    .map((id) => resolvePresence(id, living))
    .filter((p) => {
      // 默认营地外景 / 大门：整片院落地标都算「在外面看得见」
      if (
        locationId === 'camp_auto' ||
        locationId === 'camp_yard' ||
        locationId === 'outdoor_gate' ||
        locationId.startsWith('camp_')
      ) {
        return (
          isYardClusterRoom(p.roomId) ||
          p.locationId === 'camp_yard' ||
          p.locationId === 'outdoor_gate' ||
          p.locationId.startsWith('outdoor_') ||
          p.locationId === 'indoor_shop' ||
          p.locationId === 'indoor_armory' ||
          p.locationId === 'indoor_shop_bed'
        );
      }
      // 具体外景卡：按场景对齐房间
      if (locationId === 'outdoor_pool') return p.roomId === 'room_1f_pool';
      if (locationId === 'outdoor_tower') return p.roomId === 'room_1f_tower';
      if (locationId === 'indoor_shop') {
        return p.roomId === 'room_1f_shop' || p.roomId === 'room_1f_shop_bed';
      }
      if (locationId === 'indoor_armory') return p.roomId === 'room_1f_armory';
      return p.locationId === locationId;
    });
}

export function listPresencesOnFloor(
  characterIds: string[],
  living: AiLivingSave,
  floor: 1 | 2,
): LivingPresence[] {
  return characterIds
    .map((id) => resolvePresence(id, living))
    .filter((p) => CAMP_ROOM_MAP[p.roomId]?.floor === floor);
}

export function resolveCharacterSceneImageId(characterId: string, living: AiLivingSave): string {
  const p = resolvePresence(characterId, living);
  // 旧存档可能仍写 camp_yard；统一映射到大门场景
  if (p.locationId === 'camp_yard') return 'outdoor_gate';
  return p.locationId;
}

export function resolveCharacterRoomId(characterId: string, living: AiLivingSave): string {
  return resolvePresence(characterId, living).roomId;
}

export function describePresenceForPrompt(p: LivingPresence): string {
  const room = CAMP_ROOM_MAP[p.roomId];
  const place = room ? roomLabel(room) : p.locationId;
  return `${place}｜${p.behavior}`;
}
