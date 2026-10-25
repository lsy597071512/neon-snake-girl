import { pushCampLog, pushMemory } from './memory';
import { advanceWorldClock, formatGameClock } from './worldClock';
import { recordCampLifeSnapshot, recordLifeNote } from './lifeArchive';
import { resolvePresence } from './livingState';
import { describeOfflineForCharacter, simulateOffline, type OfflineSimResult } from './offlineSim';
import { enqueueOfflineOutreach, expireMessagesWhileOffline } from './playerOutreach';
import { CHARACTER_MAP } from '../data/characters';
import type { AiLivingSave } from './types';
import { applyCyberAgingByDayIndex, seedCyberHealthForOwned } from '../systems/CyberHealthSystem';

const OFFLINE_THRESHOLD_MS = 30 * 60 * 1000; // 离线超过 30 分钟才给摘要
const SIM_THRESHOLD_MS = 10 * 60 * 1000; // 超过 10 分钟才跑离线模拟（0 token 规则）
/** 摘要注入 Prompt 的有效期（现实） */
export const OFFLINE_DIGEST_PROMPT_TTL_MS = 6 * 60 * 60 * 1000;

function periodLabel(gameMinuteOfDay: number): string {
  const h = Math.floor((((gameMinuteOfDay % 1440) + 1440) % 1440) / 60);
  if (h < 5) return '深夜';
  if (h < 8) return '清晨';
  if (h < 11) return '上午';
  if (h < 14) return '中午';
  if (h < 18) return '下午';
  if (h < 21) return '傍晚';
  return '夜里';
}

function buildDigest(
  living: AiLivingSave,
  ownedIds: string[],
  opts: {
    realHours: number;
    gameHours: number;
    dayDelta: number;
    sim: OfflineSimResult | null;
  },
): string {
  const { realHours, gameHours, dayDelta, sim } = opts;
  const lines: string[] = [];
  lines.push(
    `你离线约 ${realHours.toFixed(1)} 小时；营地时间走过约 ${gameHours.toFixed(1)} 小时` +
      `${dayDelta > 0 ? `（跨了 ${dayDelta} 个游戏日）` : ''}，现在是${periodLabel(living.gameMinutes)}（${formatGameClock(living)}）。`,
  );
  lines.push('这段时间指挥官不在场（离开或睡着），大家按各自作息过日子，没有人在原地空等。');

  const charLines: string[] = [];
  for (const id of ownedIds.slice(0, 8)) {
    const fromSim = sim ? describeOfflineForCharacter(sim, id) : null;
    if (fromSim) {
      charLines.push(`- ${fromSim}`);
      continue;
    }
    const p = resolvePresence(id, living);
    charLines.push(`- ${CHARACTER_MAP[id]?.name ?? id}：此刻${p.behavior || p.label}。`);
  }
  if (charLines.length) lines.push('角色近况：', ...charLines);

  if (sim?.events.length) {
    const grouped = new Map<string, string[]>();
    for (const ev of sim.events) {
      const names = ev.participantIds
        .map((id) => CHARACTER_MAP[id]?.name ?? id)
        .join('、');
      const list = grouped.get(ev.name) ?? [];
      list.push(names);
      grouped.set(ev.name, list);
    }
    const eventLines = [...grouped.entries()].map(
      ([name, groups]) => `- ${name}：${groups.join('；')}`,
    );
    lines.push(`离线期间发生了 ${sim.events.length} 起营地活动：`, ...eventLines);
  } else {
    lines.push('离线期间营地很平静，没有发生需要你参与的活动。');
  }

  if (sim?.messages.length) {
    const msgLines = sim.messages.map(
      (m) => `- ${CHARACTER_MAP[m.characterId]?.name ?? m.characterId}：「${m.text}」`,
    );
    lines.push('有人给你留了话：', ...msgLines);
  }

  const activeEvents = (living.activeCampEvents ?? []).filter((e) => e.phase === 'active');
  if (activeEvents.length) {
    lines.push(`还有 ${activeEvents.length} 个营地活动在进行/等收尾，你可以去看看。`);
  }
  if (sim?.truncated) {
    lines.push('（离线时间很长，模拟只覆盖了最近约 7 个真实日，更早的部分按日常略过。）');
  }
  return lines.join('\n');
}

/**
 * 离线归来：
 * 1) 推进时钟（真实时间 → 游戏时间）
 * 2) 0 token 规则模拟：睡眠/作息/营地事件/留言
 * 3) 先结算睡眠与离线消息，再生成摘要（摘要里的状态与日志一致）
 * 4) 摘要同步：横幅 + 营地日志 + 生活档案 + 每个角色的记忆 + Prompt（有效期 6 小时）
 */
export async function processOfflineReturn(
  living: AiLivingSave,
  ownedIds: string[],
  now = Date.now(),
): Promise<string | null> {
  const prevDay = living.dayIndex;
  const prevGameMin = living.gameMinutes;
  const prevRealTs = living.lastRealTs ?? now;
  const elapsed = advanceWorldClock(living, now);
  const gameMinutesDelta = living.gameMinutes - prevGameMin;
  const dayDelta = living.dayIndex - prevDay;
  seedCyberHealthForOwned(living, ownedIds);
  if (dayDelta > 0) {
    applyCyberAgingByDayIndex(living, ownedIds);
  }
  await recordCampLifeSnapshot(living, ownedIds, '离线归来');

  const sim = elapsed >= SIM_THRESHOLD_MS
    ? simulateOffline(living, ownedIds, prevRealTs, now)
    : null;

  // 离线期间过期的留言：不扣好感（指挥官不在场）
  expireMessagesWhileOffline(living, now);

  if (elapsed < OFFLINE_THRESHOLD_MS) return null;
  if (now - living.lastOfflineSummaryAt < OFFLINE_THRESHOLD_MS) return null;

  const realHours = elapsed / 3_600_000;
  const gameHours = Math.max(0, gameMinutesDelta) / 60;
  living.lastOfflineSummaryAt = now;

  // 离线留言以「刚收到」形式投递（之后按正常 TTL 处理）
  if (sim) {
    for (const m of sim.messages) {
      enqueueOfflineOutreach(living, m.characterId, m.text, now);
    }
  }

  const text = buildDigest(living, ownedIds, { realHours, gameHours, dayDelta, sim });
  living.pendingOfflineSummary = text;
  living.offlineDigestForPrompt = text;
  living.offlineDigestExpiresAtMs = now + OFFLINE_DIGEST_PROMPT_TTL_MS;
  pushCampLog(living, { text, source: 'offline' });
  await recordLifeNote(living, text, { kind: 'offline' });

  // 每个角色记忆里都留下「离线期间」的事实（含自己睡了多久/参加了什么/留了什么话）
  for (const id of ownedIds) {
    const personal = sim ? describeOfflineForCharacter(sim, id) : null;
    pushMemory(living, id, {
      kind: 'event',
      summary: `离线期间（指挥官不在场）：${personal ?? text}`,
      importance: personal ? 4 : 2,
    });
  }
  return text;
}

export function consumeOfflineSummary(living: AiLivingSave): string | null {
  const s = living.pendingOfflineSummary;
  living.pendingOfflineSummary = null;
  return s;
}

/** Prompt 用：离线摘要（有效期 6 现实小时；过期自动不注入；长度截断防占上下文） */
export function buildOfflineDigestPromptBlock(living: AiLivingSave, now = Date.now()): string {
  const text = living.offlineDigestForPrompt;
  if (!text) return '';
  if (living.offlineDigestExpiresAtMs && now > living.offlineDigestExpiresAtMs) return '';
  const clipped = text.length > 700 ? `${text.slice(0, 700)}…（略）` : text;
  return `【你离线期间发生了什么（指挥官不在场）】\n${clipped}`;
}
