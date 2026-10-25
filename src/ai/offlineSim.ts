/**
 * 离线规则模拟（0 token）：玩家离线期间角色照常过日子。
 *
 * 覆盖：睡眠/作息推进、营地事件（生成+结算+好感）、主动留言、电力恢复。
 * 不调用任何 LLM；输出聚合摘要，供 offlineSummary 写入横幅/日志/记忆。
 *
 * 设计取舍：
 * - 以真实 20 分钟为步长推进（睡眠时长本身就是"现实 6 小时"）；
 * - 事件为轻量合成（按目录定义与标签结算好感），不逐条跑完整事件引擎，避免日志/记忆爆炸；
 * - 每人最多 3 次睡眠、全局最多 8 起事件、2 条留言；
 * - 随机使用确定性哈希（角色 id + 步序号），同一次离线重放结果稳定。
 */
import { CAMP_EVENT_CATALOG } from './campEvents/catalog';
import { adjustAffinity } from './relationship';
import {
  ensureSleepFields,
  getSleepState,
  SLEEP_PREPARE_REAL_MS,
  SLEEP_REAL_DURATION_MS,
} from './sleepSystem';
import { getCyberHealth, setCyberHealth, CYBER_HEALTH_MAX } from '../systems/CyberHealthSystem';
import { CHARACTER_MAP } from '../data/characters';
import type { AiLivingSave, LightStatusTag } from './types';

const STEP_MS = 20 * 60 * 1000;
/** 离线模拟上限：最多推进 7 个真实日，防止极端离线把存档撑爆 */
const MAX_STEPS = 7 * 24 * 3;
const MAX_SLEEPS_PER_CHAR = 3;
const MAX_EVENTS = 8;
const MAX_MESSAGES = 2;
/** 离线时无对话：现实 1 分钟 ≈ 游戏 5 分钟 */
const GAME_MIN_PER_REAL_MS = 5 / 60_000;

type Interval = { startMs: number; endMs: number };

type CharSim = {
  characterId: string;
  intervals: Interval[];
  wakes: number;
  completedSleepMin: number;
};

type SimEvent = {
  defId: string;
  name: string;
  participantIds: string[];
  conflict: boolean;
};

type SimMessage = {
  characterId: string;
  text: string;
};

export type OfflineSimResult = {
  simulatedRealMs: number;
  endedAtMs: number;
  truncated: boolean;
  byCharacter: Record<string, CharSim>;
  events: SimEvent[];
  messages: SimMessage[];
};

function hash01(characterId: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < characterId.length; i++) h = (h * 31 + characterId.charCodeAt(i)) >>> 0;
  return (h % 10_000) / 10_000;
}

function gameHourAt(living: AiLivingSave, fromMs: number, ms: number): number {
  const gm = living.gameMinutes + (ms - fromMs) * GAME_MIN_PER_REAL_MS;
  return ((Math.floor(gm / 60) % 24) + 24) % 24;
}

function asleepAt(sim: CharSim | undefined, ms: number): boolean {
  if (!sim) return false;
  return sim.intervals.some((i) => ms >= i.startMs && ms < i.endMs);
}

const MESSAGE_TEMPLATES = [
  '在吗？营地今天有点安静，想跟你说句话。',
  '你什么时候回来呀？我把手头的事忙完了。',
  '刚才想起你，顺手给你留个话——别熬太晚。',
  '没什么事，就是想让你知道我在。',
];

function clearFatigue(living: AiLivingSave, characterId: string): void {
  const cur = living.characterStatus[characterId] ?? [];
  living.characterStatus[characterId] = cur.filter((t) => t !== 'fatigue') as LightStatusTag[];
}

/**
 * 模拟 [fromMs, toMs] 的真实时间窗口。必须在 advanceWorldClock 之后调用，
 * 它会按时间线结算睡眠状态到 toMs（含准备入睡的补偿）。
 */
export function simulateOffline(
  living: AiLivingSave,
  ownedIds: string[],
  fromMs: number,
  toMs: number,
): OfflineSimResult {
  ensureSleepFields(living);
  const totalMs = Math.max(0, toMs - fromMs);
  const steps = Math.min(MAX_STEPS, Math.ceil(totalMs / STEP_MS));
  const truncated = Math.ceil(totalMs / STEP_MS) > MAX_STEPS;
  const byCharacter: Record<string, CharSim> = {};

  for (const id of ownedIds) {
    const st = getSleepState(living, id);
    const sim: CharSim = { characterId: id, intervals: [], wakes: 0, completedSleepMin: 0 };
    let t = fromMs;

    if (st.phase === 'asleep' || st.phase === 'disturbed') {
      const until = st.sleepUntilMs ?? fromMs + SLEEP_REAL_DURATION_MS;
      if (until > fromMs) {
        sim.intervals.push({ startMs: fromMs, endMs: Math.min(until, toMs) });
        if (until <= toMs) {
          sim.wakes += 1;
          sim.completedSleepMin += Math.max(0, (until - fromMs) / 60_000);
        }
        t = Math.min(until, toMs);
      }
    } else if (st.phase === 'preparing') {
      // 准备入睡的补偿：离线期间该睡着的时间点照算（不再回来重新准备）
      const fell = Math.min((st.prepareStartedAtMs ?? fromMs) + SLEEP_PREPARE_REAL_MS, toMs);
      const until = fell + SLEEP_REAL_DURATION_MS;
      sim.intervals.push({ startMs: fell, endMs: Math.min(until, toMs) });
      if (until <= toMs) {
        sim.wakes += 1;
        sim.completedSleepMin += (until - fell) / 60_000;
      }
      t = Math.min(until, toMs);
    }

    let sleeps = sim.intervals.length;
    let step = 0;
    while (t < toMs && step < steps) {
      step += 1;
      const hour = gameHourAt(living, fromMs, t);
      const night = hour >= 21 || hour < 5;
      // 每 20 分钟入睡概率：夜里高，白天低；已睡满一段后概率衰减
      const p = sleeps >= MAX_SLEEPS_PER_CHAR ? 0 : night ? 0.06 : 0.008;
      const roll = hash01(id, Math.floor(t / STEP_MS) + sleeps * 977);
      if (roll < p) {
        const fell = t + SLEEP_PREPARE_REAL_MS;
        if (fell >= toMs) {
          t = toMs;
          break;
        }
        const until = fell + SLEEP_REAL_DURATION_MS;
        sim.intervals.push({ startMs: fell, endMs: Math.min(until, toMs) });
        sleeps += 1;
        if (until <= toMs) {
          sim.wakes += 1;
          sim.completedSleepMin += SLEEP_REAL_DURATION_MS / 60_000;
        }
        t = Math.min(until, toMs);
        continue;
      }
      t += STEP_MS;
    }
    byCharacter[id] = sim;
  }

  // 结算最终睡眠相位（已睡满的记为自然醒；仍在睡的保留到点自然醒）
  for (const id of ownedIds) {
    const sim = byCharacter[id];
    const st = getSleepState(living, id);
    const covering = sim.intervals.find((i) => toMs > i.startMs && toMs <= i.endMs);
    if (covering) {
      st.phase = 'asleep';
      st.prepareStartedAtMs = undefined;
      st.disturbedAtMs = undefined;
      st.asleepStartedAtMs = Math.max(covering.startMs, fromMs);
      st.sleepUntilMs = covering.endMs;
    } else if (st.phase !== 'awake') {
      st.phase = 'awake';
      st.prepareStartedAtMs = undefined;
      st.asleepStartedAtMs = undefined;
      st.sleepUntilMs = undefined;
      st.disturbedAtMs = undefined;
      st.lastWakeReason = '离线期间睡到自然醒';
      st.lastWakeAtMs = toMs;
    }
    if (sim.completedSleepMin > 0) {
      clearFatigue(living, id);
      if (sim.completedSleepMin >= 360) st.lastCompletedDayIndex = living.dayIndex;
      const cur = getCyberHealth(living, id);
      const full = Math.max(12, Math.round((CYBER_HEALTH_MAX - cur) * 0.45));
      const gain = Math.max(1, Math.round(full * Math.min(1, sim.completedSleepMin / 360)));
      setCyberHealth(living, id, Math.min(CYBER_HEALTH_MAX, cur + gain), '离线睡眠恢复电力');
    }
  }

  // 轻量营地事件：按目录与标签结算好感
  const events: SimEvent[] = [];
  let eventSteps = 0;
  for (let t = fromMs + STEP_MS; t < toMs && events.length < MAX_EVENTS && eventSteps < steps; t += STEP_MS) {
    eventSteps += 1;
    const roll = hash01('camp-event', Math.floor(t / STEP_MS));
    if (roll >= 0.05) continue;
    const awake = ownedIds.filter((id) => !asleepAt(byCharacter[id], t));
    if (awake.length < 2) continue;
    const def = CAMP_EVENT_CATALOG[Math.floor(roll * 10_000) % CAMP_EVENT_CATALOG.length];
    if (!def) continue;
    const cap = Math.min(awake.length, Math.max(2, Math.min(def.maxJoiners ?? 3, 4)));
    const ids = awake.slice(0, cap);
    const conflict = def.tags.includes('conflict');
    for (const id of ids) adjustAffinity(living, id, conflict ? -1 : 1);
    events.push({ defId: def.id, name: def.name, participantIds: ids, conflict });
  }

  // 离线留言（回来后以「刚收到」的形式投递）
  const messages: SimMessage[] = [];
  for (let t = fromMs + STEP_MS; t < toMs && messages.length < MAX_MESSAGES; t += STEP_MS) {
    for (const id of ownedIds) {
      const roll = hash01(`msg:${id}`, Math.floor(t / STEP_MS));
      if (roll >= 0.012) continue;
      if (asleepAt(byCharacter[id], t)) continue;
      if (messages.some((m) => m.characterId === id)) continue;
      const idx = Math.floor(roll * 10_000) % MESSAGE_TEMPLATES.length;
      messages.push({ characterId: id, text: MESSAGE_TEMPLATES[idx] });
      if (messages.length >= MAX_MESSAGES) break;
    }
  }

  return {
    simulatedRealMs: Math.min(totalMs, MAX_STEPS * STEP_MS),
    endedAtMs: toMs,
    truncated,
    byCharacter,
    events,
    messages,
  };
}

/** 给单个角色写一条「离线期间我做了什么」的事实（无 token） */
export function describeOfflineForCharacter(
  sim: OfflineSimResult,
  characterId: string,
): string | null {
  const me = sim.byCharacter[characterId];
  if (!me) return null;
  const bits: string[] = [];
  if (me.completedSleepMin > 0) {
    bits.push(`睡了约 ${(me.completedSleepMin / 60).toFixed(1)} 小时（电力恢复）`);
  }
  const inBed = me.intervals.some((i) => i.endMs >= sim.endedAtMs - 1000);
  if (inBed) bits.push('现在还在睡');
  const myEvents = sim.events.filter((e) => e.participantIds.includes(characterId));
  if (myEvents.length) {
    bits.push(
      `参加了 ${myEvents.length} 次营地活动（${myEvents.map((e) => e.name).join('、')}）`,
    );
  }
  const myMsg = sim.messages.find((m) => m.characterId === characterId);
  if (myMsg) bits.push(`给指挥官留过话：「${myMsg.text}」`);
  if (!bits.length) return null;
  return `${CHARACTER_MAP[characterId]?.name ?? characterId}：${bits.join('；')}。`;
}
