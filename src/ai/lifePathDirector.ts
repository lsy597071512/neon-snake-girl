/**
 * 营地生活路径导演
 *
 * - 本地意图议程驱动走动（可持续目标，禁止无目标邻房乱跳）
 * - 营地页每 25s 可选 NVIDIA 微调意图候选；失败则纯本地议程
 * - 对话/情感不走此通道（见 dialogueEngine → Qwen）
 */
import { CHARACTER_MAP } from '../data/characters';
import {
  CAMP_ROOM_MAP,
  getCharacterHomeRoom,
  getCharacterSleepRoom,
  neighborsOf,
} from '../data/campLayout';
import {
  applyAgendaMovement,
  ensureAndApplyAgenda,
  getAgenda,
  isAgendaActive,
  isProtectedAgenda,
  pickNewAgenda,
  setAgenda,
} from './characterAgenda';
import { applyBatheShowerSkins, applyEventTempSkins } from './campEvents/campEventEffects';
import { tryApplyCompanionFollows } from './companionFollow';
import { tryApplyEmotionOutfits } from './emotionOutfit';
import { saveManager } from '../core/SaveManager';
import { getAiProfile } from './aiProfiles';
import { chatJsonRouted, hasLifePathApiKey } from './llmRouter';
import { recordLifeNote } from './lifeArchive';
import { getAffinity } from './relationship';
import type { AiLivingSave, CharacterActivity, CharacterAgenda, LivingPresence } from './types';
import { formatGameClock, getHour, describeTimeScale } from './worldClock';

export type LifePathOverride = {
  roomId: string;
  activity: CharacterActivity;
  behavior: string;
  updatedAt: number;
  source: 'llm' | 'local';
  intentStartedGameMin: number;
};

const ACTIVITIES: CharacterActivity[] = [
  'idle',
  'busy',
  'talking',
  'sleeping',
  'patrol',
  'maintain',
  'rest',
  'play',
  'bathe',
  'eat',
  'guard',
];

const LIFE_INTERVAL_MS = 25_000;
const OVERRIDE_TTL_MS = 90_000;

const overrides = new Map<string, LifePathOverride>();
let running = false;
let timer: number | null = null;
let tickInFlight = false;
let onTick: (() => void) | null = null;
let getOwnedIds: (() => string[]) | null = null;
let getLiving: (() => AiLivingSave) | null = null;

function sanitizeActivity(raw: string | undefined): CharacterActivity {
  const a = (raw || 'idle') as CharacterActivity;
  return ACTIVITIES.includes(a) ? a : 'idle';
}

function sanitizeRoomId(raw: string | undefined, fallback: string): string {
  if (raw && CAMP_ROOM_MAP[raw]) return raw;
  return fallback;
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

function roomLabel(roomId: string): string {
  const room = CAMP_ROOM_MAP[roomId];
  if (!room) return roomId;
  return room.kind === 'yard' ? '营地门口' : `${room.floor}楼·${room.label}`;
}

function syncOverrideFromAgenda(characterId: string, agenda: CharacterAgenda, source: 'llm' | 'local'): void {
  overrides.set(characterId, {
    roomId: agenda.targetRoomId,
    activity: agenda.activity,
    behavior: agenda.behavior,
    updatedAt: Date.now(),
    source,
    intentStartedGameMin: agenda.startedGameMin,
  });
}

export function getLifePathOverride(characterId: string): LifePathOverride | null {
  const o = overrides.get(characterId);
  if (!o) return null;
  if (Date.now() - o.updatedAt > OVERRIDE_TTL_MS) return null;
  return o;
}

export function applyLifePathOverrideToPresence(
  characterId: string,
  base: LivingPresence,
): LivingPresence {
  const o = getLifePathOverride(characterId);
  if (!o) return base;
  const room = CAMP_ROOM_MAP[o.roomId];
  if (!room) return base;
  // 若代理已到中途房，presence 仍用 base.roomId（由 livingState 读代理）；这里只覆盖活动文案倾向
  return {
    ...base,
    roomId: base.roomId || o.roomId,
    locationId: CAMP_ROOM_MAP[base.roomId]?.sceneId ?? room.sceneId,
    activity: o.activity,
    behavior: o.behavior,
    label: `${activityLabel(o.activity)} · ${roomLabel(base.roomId || o.roomId)}`,
  };
}

/** 本地：续航或换新意图，并迈向目标 */
function localAgendaTick(characterId: string, living: AiLivingSave): void {
  const cur = getAgenda(living, characterId);
  // 事件赴约 / 指挥官交代任务：不可被生活导演打断
  if (isProtectedAgenda(living, cur)) {
    applyAgendaMovement(living, characterId, cur!);
    syncOverrideFromAgenda(characterId, cur!, 'local');
    return;
  }
  const agenda = ensureAndApplyAgenda(living, characterId);
  syncOverrideFromAgenda(characterId, agenda, 'local');
}

function applyLlmAgendaChoice(
  characterId: string,
  living: AiLivingSave,
  raw: { roomId?: string; activity?: string; behavior?: string; reason?: string; remainGameMin?: number },
): void {
  const cur = getAgenda(living, characterId);
  if (isProtectedAgenda(living, cur)) {
    applyAgendaMovement(living, characterId, cur!);
    syncOverrideFromAgenda(characterId, cur!, 'llm');
    return;
  }

  // 已有意图且剩余充足：只续走，不换目标
  if (cur && isAgendaActive(cur) && cur.remainGameMin >= 50) {
    applyAgendaMovement(living, characterId, cur);
    syncOverrideFromAgenda(characterId, cur, 'llm');
    return;
  }

  const home = getCharacterHomeRoom(characterId);
  const sleep = getCharacterSleepRoom(characterId);
  const hour = getHour(living);
  let roomId = sanitizeRoomId(raw.roomId, cur?.targetRoomId ?? home.id);
  let activity = sanitizeActivity(raw.activity);
  if (hour >= 0 && hour < 5) {
    roomId = sleep.id;
    activity = 'sleeping';
  }

  const remain =
    typeof raw.remainGameMin === 'number' && raw.remainGameMin > 0
      ? Math.min(240, Math.max(40, Math.floor(raw.remainGameMin)))
      : activity === 'sleeping' || activity === 'eat' || activity === 'bathe'
        ? 60
        : 45;

  const behavior =
    (raw.behavior || '').trim().slice(0, 28) ||
    `在${roomLabel(roomId)}${activityLabel(activity)}`;
  const reason = (raw.reason || '').trim().slice(0, 24) || behavior;

  const agenda: CharacterAgenda = {
    goal: activity,
    targetRoomId: roomId,
    activity,
    behavior,
    remainGameMin: remain,
    startedGameMin: living.gameMinutes,
    reason,
    source: 'llm',
  };
  setAgenda(living, characterId, agenda);
  applyAgendaMovement(living, characterId, agenda);
  syncOverrideFromAgenda(characterId, agenda, 'llm');

  const def = CHARACTER_MAP[characterId];
  void recordLifeNote(living, `${def?.name ?? characterId}→${roomLabel(roomId)}：${behavior}`, {
    kind: 'presence',
    characterId,
  });
}

async function askBatchAll(owned: string[], living: AiLivingSave): Promise<void> {
  const hour = getHour(living);
  const lines = owned.map((id) => {
    const def = CHARACTER_MAP[id];
    const profile = getAiProfile(id);
    const sleep = getCharacterSleepRoom(id);
    const home = getCharacterHomeRoom(id);
    const prev = getAgenda(living, id);
    const curRoom = prev?.targetRoomId ?? home.id;
    const neigh = neighborsOf(curRoom);
    const aff = getAffinity(living, id);
    const status = (living.characterStatus[id] ?? []).slice(0, 3).join('/') || '平静';
    const locked = prev?.source === 'event' && isAgendaActive(prev);
    return [
      `- id=${id} name=${def?.name ?? id}`,
      `性格:${(def?.personality ?? '').slice(0, 40)}`,
      `需求:${(profile?.coreNeeds ?? []).slice(0, 3).join('、') || '无'}`,
      `恐惧:${(profile?.fears ?? []).slice(0, 2).join('、') || '无'}`,
      `好感:${aff} 状态:${status}`,
      `卧室:${sleep.id} 据点:${home.id}`,
      `当前意图:${prev ? `${prev.reason}@${prev.targetRoomId} 剩${prev.remainGameMin}分 source=${prev.source}` : '无'}`,
      `事件锁定:${locked ? '是(勿改)' : '否'}`,
      `可参考邻房:${[curRoom, ...neigh].join(',')}`,
    ].join(' | ');
  });

  const payload = await chatJsonRouted<{
    characters?: {
      id?: string;
      roomId?: string;
      activity?: string;
      behavior?: string;
      reason?: string;
      remainGameMin?: number;
      keep?: boolean;
    }[];
  }>(
    [
      {
        role: 'system',
        content: `你是锈带纪元营地生活导演。为每位角色决定「接下来一段时间」的意图（可持续 20–120 游戏分钟）。
时间流速：${describeTimeScale()}。remainGameMin 一律按游戏分钟填写。
硬规则：
1. 事件锁定=是的角色必须 keep:true，不要改她们。
2. 已有意图且剩余≥25 的优先 keep:true。
3. 新意图要有明确目的（吃饭/睡觉/维护/玩乐/巡逻等），不要无意义乱逛。
4. roomId 必须是合法房间 id；可跨越多房，角色会自己走路过去。
5. behavior≤20字中文口语；reason≤16字说明动机。
只输出 JSON：{"characters":[{"id":"...","keep":false,"roomId":"...","activity":"idle|busy|talking|sleeping|patrol|maintain|rest|play|bathe|eat|guard","behavior":"...","reason":"...","remainGameMin":90}]}`,
      },
      {
        role: 'user',
        content: [
          `时间：${formatGameClock(living)}（小时=${hour}；${describeTimeScale()}）`,
          `合法房间：${Object.keys(CAMP_ROOM_MAP).join(',')}`,
          `角色清单：`,
          ...lines,
        ].join('\n'),
      },
    ],
    {
       channel: 'life',
      timeoutMs: 15000,
      maxTokens: 1000,
      temperature: 0.7,
    },
  );

  const byId = new Map<
    string,
    {
      roomId?: string;
      activity?: string;
      behavior?: string;
      reason?: string;
      remainGameMin?: number;
      keep?: boolean;
    }
  >();
  for (const row of payload.characters ?? []) {
    if (row.id) byId.set(row.id, row);
  }

  for (const id of owned) {
    const row = byId.get(id);
    const cur = getAgenda(living, id);
    if (!row || row.keep || isProtectedAgenda(living, cur)) {
      localAgendaTick(id, living);
      continue;
    }
    if (cur && isAgendaActive(cur) && cur.remainGameMin >= 50 && row.keep !== false && !row.roomId) {
      localAgendaTick(id, living);
      continue;
    }
    applyLlmAgendaChoice(id, living, row);
  }
}

async function tickAll(): Promise<void> {
  if (!running || !getOwnedIds || !getLiving) return;
  if (tickInFlight) return;

  const owned = getOwnedIds().slice(0, 16);
  if (!owned.length) return;

  tickInFlight = true;
  try {
    const living = getLiving();
    // 确保存档字段
    if (!living.agendas) living.agendas = {};

    if (hasLifePathApiKey() && navigator.onLine) {
      try {
        await askBatchAll(owned, living);
      } catch {
        for (const id of owned) localAgendaTick(id, living);
      }
    } else {
      for (const id of owned) localAgendaTick(id, living);
    }
    tryApplyCompanionFollows(living, owned);
    // 先落事件临时外覆，再情绪选装（避免永久皮抢在事件皮之前）
    try {
      const save = saveManager.get();
      applyEventTempSkins(save, living);
      applyBatheShowerSkins(save, living);
      tryApplyEmotionOutfits(save, living, owned);
    } catch {
      /* boot 前可忽略 */
    }
    onTick?.();
  } finally {
    tickInFlight = false;
  }
}

export function startLifePathDirector(opts: {
  getOwnedIds: () => string[];
  getLiving: () => AiLivingSave;
  onTick?: () => void;
}): void {
  getOwnedIds = opts.getOwnedIds;
  getLiving = opts.getLiving;
  onTick = opts.onTick ?? null;
  if (running) return;
  running = true;
  void tickAll();
  timer = window.setInterval(() => {
    void tickAll();
  }, LIFE_INTERVAL_MS);
}

export function stopLifePathDirector(): void {
  running = false;
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
  tickInFlight = false;
}

export function isLifePathDirectorRunning(): boolean {
  return running;
}

export function clearLifePathOverrides(): void {
  overrides.clear();
}

export function listLifePathOverrides(): Record<string, LifePathOverride> {
  const out: Record<string, LifePathOverride> = {};
  for (const [k, v] of overrides) out[k] = v;
  return out;
}

/** 无 LLM 时也可主动刷一轮议程（供事件引擎调用） */
export function refreshAgendasLocal(living: AiLivingSave, ownedIds: string[]): void {
  const ids = ownedIds.slice(0, 16);
  for (const id of ids) localAgendaTick(id, living);
  tryApplyCompanionFollows(living, ids);
  try {
    const save = saveManager.get();
    applyEventTempSkins(save, living);
    applyBatheShowerSkins(save, living);
    tryApplyEmotionOutfits(save, living, ids);
  } catch {
    /* ignore */
  }
}

/** 兼容旧调用名 */
export function localRoamOne(characterId: string, living: AiLivingSave): void {
  localAgendaTick(characterId, living);
}

export { pickNewAgenda };
