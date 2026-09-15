/**
 * 角色意图议程：可持续目标，到期前不换；驱动走动而非随机邻房跳转。
 */
import { CHARACTER_MAP } from '../data/characters';
import {
  CAMP_ROOM_MAP,
  findCampPath,
  getCharacterHomeRoom,
  getCharacterSleepRoom,
  neighborsOf,
} from '../data/campLayout';
import { getAiProfile } from './aiProfiles';
import { getAgent, setAgentDestination } from './campAgents';
import type {
  AgendaSource,
  AiLivingSave,
  CharacterActivity,
  CharacterAgenda,
  CampEventReactionKind,
} from './types';
import { getHour } from './worldClock';
import { personaDayMode } from './characterPersona';
import {
  applyDesireBoostsToCandidates,
  pushDesireForcedCandidates,
} from './characterDesires';
import { tryApplyCompanionFollows } from './companionFollow';
import {
  applyPlayerTaskBroken,
  applyPlayerTaskComplete,
} from './gameplayConsequences';

/** 白天工作偏好房（与 livingState 对齐） */
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

const TOPIC_SEEDS = [
  '今天水压怪不怪',
  '门口风沙有没有变大',
  '想不想吃点热的',
  '昨晚有没有做梦',
  '机房噪声吵不吵',
  '有没有人乱翻仓库',
  '娱乐间台球局还开不开',
  '浴室热水还够不够',
  '巡逻路线要不要换',
  '想不想听怪信号录音',
  '谁又把工具乱扔了',
  '窗外锈带颜色偏红',
];

function ensureAgendas(living: AiLivingSave): Record<string, CharacterAgenda> {
  if (!living.agendas) living.agendas = {};
  return living.agendas;
}

export function getAgenda(living: AiLivingSave, characterId: string): CharacterAgenda | null {
  return ensureAgendas(living)[characterId] ?? null;
}

export function setAgenda(living: AiLivingSave, characterId: string, agenda: CharacterAgenda): void {
  const prev = ensureAgendas(living)[characterId];
  // 替换未到期的指挥官任务 → 食言（含被另一条 player_task 顶替）
  if (
    prev &&
    prev.source === 'player_task' &&
    prev.remainGameMin > 0 &&
    agenda.goal !== prev.goal
  ) {
    const why =
      agenda.source === 'player_task' ? '被新的指挥官交代顶替' : '被新意图打断';
    applyPlayerTaskBroken(living, characterId, prev, why);
  }
  ensureAgendas(living)[characterId] = agenda;
}

export function clearAgenda(living: AiLivingSave, characterId: string): void {
  delete ensureAgendas(living)[characterId];
}

function roomLabel(roomId: string): string {
  const room = CAMP_ROOM_MAP[roomId];
  if (!room) return roomId;
  return room.kind === 'yard' ? '营地门口' : `${room.floor}楼·${room.label}`;
}

function activityLabel(activity: CharacterActivity): string {
  const map: Record<CharacterActivity, string> = {
    idle: '发呆',
    busy: '忙碌',
    talking: '交谈',
    sleeping: '休息',
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

function hash01(characterId: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < characterId.length; i++) h = (h * 31 + characterId.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function randRange(characterId: string, salt: number, lo: number, hi: number): number {
  return Math.floor(lo + hash01(characterId, salt) * (hi - lo + 1));
}

export function dailyTopicSeed(living: AiLivingSave, characterId: string): string {
  const idx =
    Math.floor(hash01(characterId, living.dayIndex * 97 + 13) * TOPIC_SEEDS.length) %
    TOPIC_SEEDS.length;
  return TOPIC_SEEDS[idx];
}

export function isAgendaActive(agenda: CharacterAgenda | null | undefined): boolean {
  return !!agenda && agenda.remainGameMin > 0;
}

/** 事件议程是否仍绑定进行中的营地事件（不依赖 remainGameMin） */
export function isEventAgendaBound(
  living: AiLivingSave,
  agenda: CharacterAgenda | null | undefined,
): boolean {
  if (!agenda || agenda.source !== 'event' || !agenda.eventInstanceId) return false;
  return (living.activeCampEvents ?? []).some(
    (e) =>
      e.instanceId === agenda.eventInstanceId &&
      (e.phase === 'warn' || e.phase === 'active'),
  );
}

/**
 * 事件赴约 / 指挥官交代任务：生活导演与主动消息不得随便打断。
 * 事件绑定以 activeCampEvents 为准（remain 耗尽仍保护，直到事件引擎收尾）。
 */
export function isProtectedAgenda(
  living: AiLivingSave,
  agenda: CharacterAgenda | null | undefined,
): boolean {
  if (!agenda) return false;
  if (agenda.source === 'player_task' && agenda.remainGameMin > 0) return true;
  if (isEventAgendaBound(living, agenda)) return true;
  // 睡眠系统会话：准备入睡 / 睡着期间不被生活导演随便打断
  if (
    (agenda.goal === 'sleep' || agenda.goal === 'prepare_sleep') &&
    agenda.remainGameMin > 0
  ) {
    return true;
  }
  return false;
}

const TASK_ASK_RE =
  /帮我|替我|去(商店|武器库|仓库|机房|机械|泳池|大厅)?.*(拿|取|买|带|找)|能不能.*(拿|取|买|带)|拿一下|取一下|买.*回来|带.*回来/;
const TASK_AGREE_RE =
  /行[。.!！]?|好[。.!！]?|我去|帮你|顺路|拿来|带回来|带回去|货架|你站开|去拿|去取|去买|我顺路/;
const TASK_REFUSE_RE = /不去|不行|没空|自己去|别让我|拒绝|做不到|现在不行/;

function inferTaskRoomId(playerMessage: string, reply: string): string {
  const text = `${playerMessage} ${reply}`;
  if (/商店|商城|杂货/.test(text)) return 'room_1f_shop';
  if (/武器库|军械/.test(text)) return 'room_1f_armory';
  if (/机械区|散热|纳米胶|胶布/.test(text)) return 'room_1f_mech';
  if (/仓库/.test(text)) return 'room_1f_storage';
  if (/机房/.test(text)) return 'room_1f_machine';
  if (/泳池|泳装/.test(text)) return 'room_1f_pool';
  if (/大门|门口/.test(text)) return 'room_yard';
  if (/娱乐/.test(text)) return 'room_2f_yule';
  return 'room_1f_shop';
}

/**
 * 玩家交代跑腿/取物且角色答应时，写入受保护议程；拒绝则不写。
 * 解决：答应去商店后立刻主动发无关消息的「人格分裂」。
 */
export function tryCommitPlayerTaskAgenda(
  living: AiLivingSave,
  characterId: string,
  playerMessage: string,
  reply: string,
): boolean {
  const ask = playerMessage.trim();
  const ans = reply.trim();
  if (!ask || !ans) return false;
  if (!TASK_ASK_RE.test(ask)) return false;
  if (TASK_REFUSE_RE.test(ans) && !TASK_AGREE_RE.test(ans)) return false;
  if (!TASK_AGREE_RE.test(ans)) return false;

  const targetRoomId = inferTaskRoomId(ask, ans);
  if (!CAMP_ROOM_MAP[targetRoomId]) return false;

  const brief = ask.replace(/\s+/g, '').slice(0, 36);
  setAgenda(living, characterId, {
    goal: `player_task:${brief}`,
    targetRoomId,
    activity: 'busy',
    behavior: `正办理指挥官交代的事：${brief}`,
    remainGameMin: 90,
    startedGameMin: living.gameMinutes,
    reason: `答应指挥官：${brief}`,
    source: 'player_task',
  });
  setAgentDestination(characterId, targetRoomId, {
    activity: 'busy',
    behavior: `前往${roomLabel(targetRoomId)}办理指挥官交代的事`,
  });
  return true;
}

/** 推进意图剩余时间（按游戏分钟差） */
export function tickAgendaRemain(
  living: AiLivingSave,
  characterId: string,
  prevGameMinutes: number,
): void {
  const agenda = getAgenda(living, characterId);
  if (!agenda) return;
  const delta = Math.max(0, living.gameMinutes - prevGameMinutes);
  if (delta <= 0) return;

  // 事件议程：按事件结束时刻刷新剩余，永不因本地 remain 归零而解锁
  if (agenda.source === 'event' && agenda.eventInstanceId) {
    const ev = (living.activeCampEvents ?? []).find(
      (e) => e.instanceId === agenda.eventInstanceId,
    );
    if (ev && (ev.phase === 'warn' || ev.phase === 'active')) {
      agenda.remainGameMin = Math.max(1, ev.endsAtGameMin - living.gameMinutes);
      return;
    }
    // 事件已不在进行中 → 清掉残留事件议程
    clearAgenda(living, characterId);
    return;
  }

  agenda.remainGameMin = Math.max(0, agenda.remainGameMin - delta);
  if (agenda.remainGameMin > 0) return;

  if (agenda.source === 'player_task') {
    const atTarget = resolveCurrentRoomId(living, characterId) === agenda.targetRoomId;
    if (atTarget) {
      applyPlayerTaskComplete(living, characterId, agenda);
    } else {
      // 时间到了人还没到 → 食言，而不是假装办完
      applyPlayerTaskBroken(living, characterId, agenda, '没能赶到地点');
    }
    clearAgenda(living, characterId);
    return;
  }

  // 普通意图到期清除
  clearAgenda(living, characterId);
}

export function tickAllAgendas(living: AiLivingSave, ownedIds: string[], prevGameMinutes: number): void {
  for (const id of ownedIds) tickAgendaRemain(living, id, prevGameMinutes);
  // 欲望驱动的新意图在 ensureAndApplyAgenda / 生活导演里生成；这里做关系尾随偶遇
  tryApplyCompanionFollows(living, ownedIds);
}

function hasStatus(living: AiLivingSave, characterId: string, tag: string): boolean {
  return (living.characterStatus[characterId] ?? []).includes(tag as never);
}

function dayWorkRoom(characterId: string): string {
  const id = DAY_WORK[characterId];
  if (id && CAMP_ROOM_MAP[id]) return id;
  return getCharacterHomeRoom(characterId).id;
}

type AgendaCandidate = {
  goal: string;
  targetRoomId: string;
  activity: CharacterActivity;
  behavior: string;
  remainGameMin: number;
  reason: string;
  source: AgendaSource;
  weight: number;
};

/** 按作息/需求生成候选意图，选权重最高者 */
export function pickNewAgenda(
  living: AiLivingSave,
  characterId: string,
  opts?: { forceSource?: AgendaSource },
): CharacterAgenda {
  const hour = getHour(living);
  const sleep = getCharacterSleepRoom(characterId);
  const home = getCharacterHomeRoom(characterId);
  const profile = getAiProfile(characterId);
  const needs = profile?.coreNeeds ?? [];
  const fears = profile?.fears ?? [];
  const salt = living.gameMinutes + living.dayIndex * 17;
  const dayMode = personaDayMode(living, characterId);
  const candidates: AgendaCandidate[] = [];

  const push = (c: AgendaCandidate) => {
    if (!CAMP_ROOM_MAP[c.targetRoomId]) return;
    candidates.push(c);
  };

  // 按今日模式抬高/压低权重
  const modeBoost = (goal: string, base: number): number => {
    if (dayMode === 'idle') {
      if (goal === 'idle_home' || goal === 'rest') return base + 8;
      if (goal === 'work' || goal === 'patrol') return base - 4;
    }
    if (dayMode === 'social') {
      if (goal === 'play' || goal === 'hall_chat' || goal === 'eat' || goal === 'browse_shop')
        return base + 7;
      if (goal === 'work') return base - 3;
    }
    if (dayMode === 'withdrawn') {
      if (goal === 'rest' || goal === 'idle_home' || goal === 'sleep') return base + 6;
      if (goal === 'play' || goal === 'hall_chat' || goal === 'pool_soak') return base - 5;
    }
    if (dayMode === 'playful') {
      if (goal === 'play' || goal === 'pool_soak') return base + 9;
      if (goal === 'work') return base - 3;
    }
    if (dayMode === 'restless') {
      if (goal === 'work' || goal === 'wc' || goal === 'hall_chat' || goal === 'browse_shop')
        return base + 4;
      if (goal === 'sleep') return base - 2;
    }
    if (dayMode === 'dutiful') {
      if (goal === 'work' || goal === 'armory_maintain') return base + 5;
    }
    return base;
  };

  // 深夜睡觉（睡眠系统会接管时长；此处给回房意图）
  if (hour >= 22 || hour < 5) {
    push({
      goal: 'sleep',
      targetRoomId: sleep.id,
      activity: 'sleeping',
      behavior: `在${roomLabel(sleep.id)}睡觉恢复电力`,
      remainGameMin: hour < 5 ? randRange(characterId, salt, 90, 180) : randRange(characterId, salt, 120, 240),
      reason: '夜深了该睡，恢复电力',
      source: 'schedule',
      weight: 12,
    });
  }

  // 白天也可能补觉（几率低于夜间；疲劳时更想睡）
  if (hour >= 13 && hour < 17) {
    const fatigued = (living.characterStatus?.[characterId] ?? []).includes('fatigue');
    push({
      goal: 'sleep',
      targetRoomId: sleep.id,
      activity: 'sleeping',
      behavior: `白天回${roomLabel(sleep.id)}补觉恢复电力`,
      remainGameMin: randRange(characterId, salt + 77, 60, 120),
      reason: fatigued ? '太累了想补觉' : '白天也想眯一会儿恢复电力',
      source: 'need',
      weight: fatigued ? 5.5 : 2.2,
    });
  }

  // 清晨洗浴
  if (hour >= 5 && hour < 8) {
    push({
      goal: 'bathe',
      targetRoomId: 'room_1f_bath',
      activity: 'bathe',
      behavior: '在浴室清洗接头与装甲',
      remainGameMin: randRange(characterId, salt + 1, 50, 90),
      reason: '晨间清理',
      source: 'schedule',
      weight: 6 + (needs.some((n) => /洁|干净|水/.test(n)) ? 3 : 0),
    });
  }

  // 泡澡/晨洗后的泳池（少量权重，让院落有人气）
  if ((hour >= 7 && hour < 11) || (hour >= 15 && hour < 20)) {
    const waterLike = needs.some((n) => /水|洁|放松|凉/.test(n));
    const fearOutdoor = fears.some((f) => /沙|风|外|暴/.test(f));
    push({
      goal: 'pool_soak',
      targetRoomId: 'room_1f_pool',
      activity: 'play',
      behavior: hour < 11 ? '洗完后去泳池泡一会儿' : '去泳池边戏水或清脑子',
      remainGameMin: randRange(characterId, salt + 31, 45, 90),
      reason: hour < 11 ? '洗完顺路去泳池' : '想去泳池透透',
      source: 'social',
      weight:
        3.6 +
        (waterLike ? 1.5 : 0) +
        (fearOutdoor ? -1.2 : 0) +
        (dayMode === 'playful' ? 1.5 : 0) +
        (hour >= 7 && hour < 10 ? 1.8 : 0) + // 晨洗后窗口更容易进前三
        (hash01(characterId, salt + 32) > 0.72 ? 1.2 : 0),
    });
  }

  // 逛商店（白天/傍晚，低权重短时）
  if (hour >= 9 && hour < 21 && hash01(characterId, salt + 33) > 0.38) {
    push({
      goal: 'browse_shop',
      targetRoomId: 'room_1f_shop',
      activity: 'idle',
      behavior: '在营地商店逛货架、看看缺什么',
      remainGameMin: randRange(characterId, salt + 34, 35, 70),
      reason: '想逛逛商店',
      source: 'social',
      weight:
        3.4 +
        (needs.some((n) => /补给|零件|吃|物/.test(n)) ? 1.2 : 0) +
        (dayMode === 'social' || dayMode === 'idle' ? 1 : 0),
    });
  }

  // 维护武器库（白天岗位感 / 傍晚擦械）
  if ((hour >= 8 && hour < 18) || (hour >= 19 && hour < 22)) {
    const combatLike = /刃|盾|射|械|战|巡|守/.test(
      `${CHARACTER_MAP[characterId]?.tag ?? ''} ${profile?.summary ?? ''}`,
    );
    push({
      goal: 'armory_maintain',
      targetRoomId: 'room_1f_armory',
      activity: 'maintain',
      behavior: hour < 18 ? '去武器库点检架上武装' : '在武器库擦械、聊两句战场碎嘴',
      remainGameMin: randRange(characterId, salt + 35, 40, 85),
      reason: hour < 18 ? '武器库该点检了' : '想去武器库待一会',
      source: 'schedule',
      weight:
        3.2 +
        (combatLike ? 1.8 : 0) +
        (dayMode === 'dutiful' ? 1.5 : 0) +
        (characterId === 'neoncoil' || characterId === 'ironrain' || characterId === 'ashcrow'
          ? 1.2
          : 0),
    });
  }

  // 用餐时段
  if ((hour >= 11 && hour < 14) || (hour >= 17 && hour < 20) || hasStatus(living, characterId, 'hunger')) {
    push({
      goal: 'eat',
      targetRoomId: 'room_1f_hall2',
      activity: 'eat',
      behavior: '在大厅2吃饭',
      remainGameMin: randRange(characterId, salt + 2, 70, 140),
      reason: hasStatus(living, characterId, 'hunger') ? '饿了' : '开饭点',
      source: 'need',
      weight: 8 + (hasStatus(living, characterId, 'hunger') ? 5 : 0),
    });
  }

  // 疲劳 → 卧室歇息
  if (hasStatus(living, characterId, 'fatigue') || (hour >= 14 && hour < 16 && hash01(characterId, salt) > 0.55)) {
    push({
      goal: 'rest',
      targetRoomId: home.id,
      activity: 'rest',
      behavior: `在${roomLabel(home.id)}歇口气`,
      remainGameMin: randRange(characterId, salt + 3, 60, 120),
      reason: '想歇一会儿',
      source: 'need',
      weight: 5 + (hasStatus(living, characterId, 'fatigue') ? 4 : 0),
    });
  }

  // 白天工作岗
  if (hour >= 7 && hour < 18) {
    const work = dayWorkRoom(characterId);
    const act: CharacterActivity =
      /machine|mech/.test(work) ? 'maintain' : /yard|gate/.test(work) ? 'guard' : 'busy';
    push({
      goal: 'work',
      targetRoomId: work,
      activity: act,
      behavior: `在${roomLabel(work)}${activityLabel(act)}`,
      remainGameMin: randRange(characterId, salt + 4, 100, 200),
      reason: '白天岗位',
      source: 'schedule',
      weight: 7,
    });
  }

  // 社交 / 娱乐
  if (hour >= 18 && hour < 22) {
    push({
      goal: 'play',
      targetRoomId: 'room_2f_yule',
      activity: 'play',
      behavior: '在娱乐间打发时间',
      remainGameMin: randRange(characterId, salt + 5, 80, 160),
      reason: '晚上想热闹一点',
      source: 'social',
      weight: 6 + (needs.some((n) => /社交|热闹|玩|陪伴/.test(n)) ? 3 : 0),
    });
    push({
      goal: 'hall_chat',
      targetRoomId: 'room_1f_hall1',
      activity: 'talking',
      behavior: '在大厅跟人闲聊',
      remainGameMin: randRange(characterId, salt + 6, 60, 120),
      reason: '想跟人说说话',
      source: 'social',
      weight: 4,
    });
  }

  // 厕所短需求（低权重，短时长）
  if (hour >= 6 && hour < 23 && hash01(characterId, salt + 9) > 0.82) {
    push({
      goal: 'wc',
      targetRoomId: 'room_2f_wc',
      activity: 'busy',
      behavior: '去二楼厕所一趟',
      remainGameMin: randRange(characterId, salt + 7, 25, 45),
      reason: '生理需要',
      source: 'need',
      weight: 3,
    });
  }

  // 恐惧相关：避开门口
  if (fears.some((f) => /沙|风|外|暴/.test(f)) && hour >= 10 && hour < 20) {
    push({
      goal: 'indoor_safe',
      targetRoomId: 'room_2f_lounge',
      activity: 'idle',
      behavior: '躲在二楼南大厅避风',
      remainGameMin: randRange(characterId, salt + 8, 70, 120),
      reason: '不想挨着门外风沙',
      source: 'need',
      weight: 3,
    });
  }

  // 兜底：在据点发呆
  push({
    goal: 'idle_home',
    targetRoomId: home.id,
    activity: 'idle',
    behavior: `在${roomLabel(home.id)}发呆`,
    remainGameMin: randRange(characterId, salt + 10, 50, 100),
    reason: '没事做',
    source: 'schedule',
    weight: 1,
  });

  // 欲望极强时补地标短意图
  pushDesireForcedCandidates(living, characterId, push);

  // idle/social 白天也允许娱乐与闲聊候选
  if ((dayMode === 'idle' || dayMode === 'social' || dayMode === 'playful') && hour >= 9 && hour < 18) {
    push({
      goal: dayMode === 'playful' ? 'play' : 'hall_chat',
      targetRoomId: dayMode === 'playful' ? 'room_2f_yule' : dayMode === 'idle' ? 'room_yard' : 'room_1f_hall1',
      activity: dayMode === 'playful' ? 'play' : dayMode === 'idle' ? 'idle' : 'talking',
      behavior:
        dayMode === 'playful'
          ? '在娱乐间瞎玩'
          : dayMode === 'idle'
            ? '在门口发呆看沙'
            : '在大厅找人闲聊',
      remainGameMin: randRange(characterId, salt + 21, 80, 160),
      reason: dayMode === 'idle' ? '今天就想发呆' : dayMode === 'playful' ? '今天想玩' : '今天想找人',
      source: 'social',
      weight: 10,
    });
  }

  // 今日模式 + 欲望表抬权（商店/泳池/武器库/塔等）
  for (const c of candidates) {
    c.weight = Math.max(0.5, modeBoost(c.goal, c.weight));
  }
  applyDesireBoostsToCandidates(living, characterId, candidates);

  candidates.sort((a, b) => b.weight - a.weight || hash01(characterId, salt + a.goal.length) - 0.5);
  // 在前 3 名里按权重加权随机，避免全员同步
  const top = candidates.slice(0, Math.min(3, candidates.length));
  const totalW = top.reduce((s, c) => s + c.weight, 0);
  let roll = hash01(characterId, salt + 99) * totalW;
  let chosen = top[0];
  for (const c of top) {
    roll -= c.weight;
    if (roll <= 0) {
      chosen = c;
      break;
    }
  }

  if (opts?.forceSource) {
    chosen = { ...chosen, source: opts.forceSource };
  }

  return {
    goal: chosen.goal,
    targetRoomId: chosen.targetRoomId,
    activity: chosen.activity,
    behavior: chosen.behavior,
    remainGameMin: chosen.remainGameMin,
    startedGameMin: living.gameMinutes,
    reason: chosen.reason,
    source: chosen.source,
  };
}

/** 事件强制写入意图 */
export function forceEventAgenda(
  living: AiLivingSave,
  characterId: string,
  opts: {
    goal: string;
    targetRoomId: string;
    activity: CharacterActivity;
    behavior: string;
    remainGameMin: number;
    reason: string;
    eventInstanceId: string;
    eventStance: CampEventReactionKind;
  },
): CharacterAgenda {
  const agenda: CharacterAgenda = {
    goal: opts.goal,
    targetRoomId: opts.targetRoomId,
    activity: opts.activity,
    behavior: opts.behavior,
    remainGameMin: opts.remainGameMin,
    startedGameMin: living.gameMinutes,
    reason: opts.reason,
    source: 'event',
    eventInstanceId: opts.eventInstanceId,
    eventStance: opts.eventStance,
  };
  setAgenda(living, characterId, agenda);
  return agenda;
}

/** 当前房间：代理优先，否则议程目标/卧室 */
export function resolveCurrentRoomId(living: AiLivingSave, characterId: string): string {
  const agent = getAgent(characterId);
  if (agent?.roomId && CAMP_ROOM_MAP[agent.roomId]) return agent.roomId;
  const agenda = getAgenda(living, characterId);
  if (agenda?.targetRoomId && CAMP_ROOM_MAP[agenda.targetRoomId]) return agenda.targetRoomId;
  return getCharacterHomeRoom(characterId).id;
}

/**
 * 朝目标迈一步（沿最短路径的下一邻房），或已在目标房则微停留。
 * 禁止无目标随机邻房。
 */
export function applyAgendaMovement(
  living: AiLivingSave,
  characterId: string,
  agenda: CharacterAgenda,
): void {
  const cur = resolveCurrentRoomId(living, characterId);
  const target = agenda.targetRoomId;
  if (!CAMP_ROOM_MAP[target]) return;

  if (cur === target) {
    setAgentDestination(characterId, target, {
      activity: agenda.activity,
      behavior: agenda.behavior,
      fromRoomId: cur,
    });
    return;
  }

  const path = findCampPath(cur, target);
  let next = target;
  if (path && path.length >= 2) {
    next = path[1];
  } else {
    const neigh = neighborsOf(cur);
    // 尽量选缩短距离的邻房
    let best = neigh[0] ?? cur;
    let bestLen = 999;
    for (const n of neigh) {
      const p = findCampPath(n, target);
      const len = p ? p.length : 999;
      if (len < bestLen) {
        bestLen = len;
        best = n;
      }
    }
    next = best;
  }

  const goingLabel = roomLabel(target);
  setAgentDestination(characterId, next === cur ? target : next, {
    activity: agenda.activity === 'sleeping' ? 'busy' : agenda.activity,
    behavior: cur === target ? agenda.behavior : `前往${goingLabel}：${agenda.reason.slice(0, 12)}`,
    fromRoomId: cur,
  });
}

/** 确保有有效意图并驱动移动；到期则换新意图 */
export function ensureAndApplyAgenda(
  living: AiLivingSave,
  characterId: string,
): CharacterAgenda {
  let agenda = getAgenda(living, characterId);
  // 指挥官任务 / 事件赴约进行中：只续走，禁止被作息随机意图顶掉
  if (isProtectedAgenda(living, agenda)) {
    applyAgendaMovement(living, characterId, agenda!);
    return agenda!;
  }
  if (!isAgendaActive(agenda)) {
    agenda = pickNewAgenda(living, characterId);
    setAgenda(living, characterId, agenda);
  }
  applyAgendaMovement(living, characterId, agenda!);
  return agenda!;
}

export function agendaToPresenceOverride(
  characterId: string,
  agenda: CharacterAgenda,
): {
  roomId: string;
  activity: CharacterActivity;
  behavior: string;
  label: string;
} {
  const agent = getAgent(characterId);
  const roomId =
    agent?.roomId && CAMP_ROOM_MAP[agent.roomId] ? agent.roomId : agenda.targetRoomId;
  const room = CAMP_ROOM_MAP[roomId] ?? CAMP_ROOM_MAP[agenda.targetRoomId];
  const place = room ? roomLabel(room.id) : roomId;
  return {
    roomId,
    activity: agenda.activity,
    behavior: agenda.behavior,
    label: `${activityLabel(agenda.activity)} · ${place}`,
  };
}

export function describeAgendaForPrompt(living: AiLivingSave, characterId: string): string {
  const agenda = getAgenda(living, characterId);
  if (!isAgendaActive(agenda)) return '暂无明确意图，随营生活。';
  const a = agenda!;
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const stance = a.eventStance ? `；对事件态度：${a.eventStance}` : '';
  return `${name}正打算「${a.reason}」→ 去${roomLabel(a.targetRoomId)}（${a.behavior}），大约还要 ${a.remainGameMin} 游戏分钟${stance}。`;
}
