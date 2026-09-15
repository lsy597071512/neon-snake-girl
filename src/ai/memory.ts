/**
 * Token 友好的工作记忆 + 永久档案召回：
 * - recentChats：最近缓冲（进 Prompt）
 * - chatDigests：更早对话压成短要点（进 Prompt）
 * - memories：分槽保护 talk/event（进 Prompt）
 * - dialogueArchive：全文永久；按关键词检索相关旧对话再注入
 */
import type { AiLivingSave, AiMemoryEntry, CampLogEntry } from './types';
import {
  appendDialogueArchive,
  formatArchiveAge,
  listDialogueArchive,
  makeLocalDigest,
  searchDialogueArchive,
  type ArchiveLine,
  type DialogueArchiveEntry,
} from './dialogueArchive';
import {
  backfillTimelineFromMemories,
  maybePromoteMemoryToTimeline,
} from './lifeTimeline';
import { CHARACTER_MAP } from '../data/characters';

/** 发给模型的最近原句轮数 */
export const PROMPT_RECENT_TURNS = 8;
/** recent 缓冲略大于 prompt 窗口 */
const MAX_RECENT_BUFFER = 20;
const MAX_DIGESTS = 64;
/** talk / event 分槽，避免营地事件挤掉对话事实 */
const MAX_TALK_MEMORIES = 24;
const MAX_EVENT_MEMORIES = 16;
const MAX_OTHER_MEMORIES = 8;
const MAX_LOG = 60;

function isTalkMemory(kind: AiMemoryEntry['kind']): boolean {
  return kind === 'talk' || kind === 'gift' || kind === 'outreach' || kind === 'outreach_ignored';
}

function isEventMemory(kind: AiMemoryEntry['kind']): boolean {
  return kind === 'event' || kind === 'combat_return';
}

function trimMemoriesBucketed(list: AiMemoryEntry[]): AiMemoryEntry[] {
  const sorted = [...list].sort((a, b) => b.importance - a.importance || b.ts - a.ts);
  const talk = sorted.filter((m) => isTalkMemory(m.kind)).slice(0, MAX_TALK_MEMORIES);
  const events = sorted.filter((m) => isEventMemory(m.kind)).slice(0, MAX_EVENT_MEMORIES);
  const other = sorted
    .filter((m) => !isTalkMemory(m.kind) && !isEventMemory(m.kind))
    .slice(0, MAX_OTHER_MEMORIES);
  return [...talk, ...events, ...other].sort(
    (a, b) => b.importance - a.importance || b.ts - a.ts,
  );
}

/**
 * 从永久档案灌回工作记忆（0 token）。
 * 关游戏再开后，IndexedDB 全文仍在 → 重建 digests / 近窗 / memories。
 */
export async function hydrateCharacterMemoryFromArchive(
  living: AiLivingSave,
  characterId: string,
): Promise<void> {
  if (!living.chatDigests) living.chatDigests = {};
  if (!living.recentChats) living.recentChats = {};
  if (!living.memories) living.memories = {};

  const rows = await listDialogueArchive({ participantId: characterId, limit: 240 });
  if (!rows.length) return;

  const archiveDigests = rows.map((r) => (r.kind === 'npc' ? `[角色间] ${r.digest}` : r.digest));
  const merged = [...archiveDigests];
  for (const d of living.chatDigests[characterId] ?? []) {
    if (!merged.includes(d)) merged.push(d);
  }
  living.chatDigests[characterId] = merged.slice(-MAX_DIGESTS);

  const playerRows = rows.filter((r) => r.kind === 'player').slice(-8);
  const rebuilt: { role: 'user' | 'assistant'; text: string }[] = [];
  for (const e of playerRows) {
    for (const line of e.lines) {
      rebuilt.push({
        role: line.speakerId === 'player' ? 'user' : 'assistant',
        text: line.text,
      });
    }
  }
  const current = living.recentChats[characterId] ?? [];
  if (!current.length || rebuilt.length >= current.length) {
    living.recentChats[characterId] = rebuilt.slice(-MAX_RECENT_BUFFER);
  }

  const mem = living.memories[characterId] ?? [];
  const existingSummaries = new Set(mem.map((m) => m.summary));
  // 优先灌玩家问答（含问号/关键陈述）提高 importance
  const prefer = [...rows].reverse().slice(0, 40);
  for (const r of prefer) {
    const summary = r.digest.slice(0, 100);
    if (!summary || existingSummaries.has(summary)) continue;
    const playerAsk = r.lines.find((l) => l.speakerId === 'player')?.text ?? '';
    const looksFact =
      /[?？]|还记得|上次|昨天|之前|名字|喜欢|讨厌|害怕|生日|约定/.test(playerAsk) ||
      /[?？]/.test(summary);
    mem.push({
      ts: r.ts,
      kind: r.kind === 'npc' ? 'event' : 'talk',
      summary,
      importance: looksFact ? 6 : 4,
    });
    existingSummaries.add(summary);
  }
  living.memories[characterId] = trimMemoriesBucketed(mem);
  // 开档灌回时，把高重要度 L1 回填进人生时间线 L2（幂等去重）
  void backfillTimelineFromMemories(living, characterId);
}

export function pushMemory(
  living: AiLivingSave,
  characterId: string,
  entry: Omit<AiMemoryEntry, 'ts'> & { ts?: number },
): void {
  const full = { ...entry, ts: entry.ts ?? Date.now() };
  const list = living.memories[characterId] ?? [];
  list.push(full);
  living.memories[characterId] = trimMemoriesBucketed(list);
  // 重要里程碑晋升人生时间线 L2（异步，不挡主流程）
  maybePromoteMemoryToTimeline(living, characterId, full);
}

export function getMemoryLines(living: AiLivingSave, characterId: string, limit = 8): string[] {
  const list = living.memories[characterId] ?? [];
  return list.slice(0, limit).map((m) => {
    const age = formatArchiveAge(m.ts);
    return `- (${m.kind}·${age}) ${m.summary}`;
  });
}

export function getChatDigestLines(living: AiLivingSave, characterId: string, limit = 10): string[] {
  const list = living.chatDigests?.[characterId] ?? [];
  return list.slice(-limit).map((d) => `- ${d}`);
}

/** 把溢出的旧对话滚成 digest（0 token）；保留更长文本以免丢关键事实 */
function rollOverflowIntoDigest(living: AiLivingSave, characterId: string): void {
  if (!living.chatDigests) living.chatDigests = {};
  const list = living.recentChats[characterId] ?? [];
  while (list.length > MAX_RECENT_BUFFER) {
    const a = list.shift();
    const b = list[0]?.role === 'assistant' ? list.shift() : undefined;
    const parts: string[] = [];
    if (a) parts.push(`${a.role === 'user' ? '玩家' : '角色'}：${a.text.slice(0, 80)}`);
    if (b) parts.push(`${b.role === 'user' ? '玩家' : '角色'}：${b.text.slice(0, 80)}`);
    if (parts.length) {
      const digests = living.chatDigests[characterId] ?? [];
      digests.push(parts.join(' → '));
      living.chatDigests[characterId] = digests.slice(-MAX_DIGESTS);
    }
  }
  living.recentChats[characterId] = list;
}

export function pushRecentChat(
  living: AiLivingSave,
  characterId: string,
  role: 'user' | 'assistant',
  text: string,
  extra?: { action?: string; innerThought?: string },
): void {
  if (!living.recentChats) living.recentChats = {};
  const list = living.recentChats[characterId] ?? [];
  const turn: { role: 'user' | 'assistant'; text: string; action?: string; innerThought?: string } = {
    role,
    text,
  };
  if (role === 'assistant') {
    if (extra?.action?.trim()) turn.action = extra.action.trim().slice(0, 48);
    if (extra?.innerThought?.trim()) turn.innerThought = extra.innerThought.trim().slice(0, 60);
  }
  list.push(turn);
  living.recentChats[characterId] = list;
  if (role === 'user') {
    living.totalUserDialogueTurns = (living.totalUserDialogueTurns ?? 0) + 1;
  }
  rollOverflowIntoDigest(living, characterId);
}

export function getRecentChatsForPrompt(
  living: AiLivingSave,
  characterId: string,
  limit = PROMPT_RECENT_TURNS,
): { role: 'user' | 'assistant'; text: string }[] {
  const list = living.recentChats?.[characterId] ?? [];
  return list.slice(-limit).map((m) => ({ role: m.role, text: m.text }));
}

export function getRecentChats(
  living: AiLivingSave,
  characterId: string,
): { role: 'user' | 'assistant'; text: string; action?: string; innerThought?: string }[] {
  return [...(living.recentChats?.[characterId] ?? [])];
}

export function getRecentChatLines(living: AiLivingSave, characterId: string): string[] {
  return getRecentChats(living, characterId).map(
    (m) => `${m.role === 'user' ? '玩家' : '角色'}：${m.text}`,
  );
}

export function normalizeAsk(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[？?！!。.\s…~～]+/g, '')
    .replace(/(还)+/g, '还');
}

export function findRepeatedAsk(
  living: AiLivingSave,
  characterId: string,
  playerMessage: string,
): { hit: boolean; prevReply?: string; askCount: number } {
  const norm = normalizeAsk(playerMessage);
  if (!norm) return { hit: false, askCount: 0 };
  const chats = getRecentChats(living, characterId);
  const digests = living.chatDigests?.[characterId] ?? [];
  let askCount = 0;
  let prevReply: string | undefined;
  for (let i = 0; i < chats.length; i++) {
    const m = chats[i];
    if (m.role !== 'user') continue;
    const n = normalizeAsk(m.text);
    if (n === norm || (norm.length >= 2 && (n.includes(norm) || norm.includes(n)))) {
      askCount += 1;
      const next = chats[i + 1];
      if (next?.role === 'assistant') prevReply = next.text;
    }
  }
  for (const d of digests) {
    if (normalizeAsk(d).includes(norm) && norm.length >= 2) askCount += 1;
  }
  return { hit: askCount > 0, prevReply, askCount };
}

export function describeTimeSinceTalk(
  living: AiLivingSave,
  characterId: string,
  now = Date.now(),
): string {
  const last = living.lastTalkAt?.[characterId];
  if (!last) return '这是你们这段时间第一次开口聊';
  const sec = Math.max(0, Math.floor((now - last) / 1000));
  if (sec < 60) return `你们大约 ${sec} 秒前刚说过话（对话可能刚关掉又打开）`;
  if (sec < 3600) return `你们大约 ${Math.floor(sec / 60)} 分钟前聊过`;
  if (sec < 86400) return `你们大约 ${Math.floor(sec / 3600)} 小时前聊过`;
  const days = Math.floor(sec / 86400);
  if (days === 1) return '你们昨天聊过';
  return `你们大约 ${days} 天前聊过`;
}

export function pushCampLog(
  living: AiLivingSave,
  entry: Omit<CampLogEntry, 'ts' | 'gameMinutes'> & { ts?: number; gameMinutes?: number },
): void {
  living.campLog.unshift({
    ts: entry.ts ?? Date.now(),
    gameMinutes: entry.gameMinutes ?? living.gameMinutes,
    text: entry.text,
    source: entry.source,
    characterIds: entry.characterIds,
  });
  living.campLog = living.campLog.slice(0, MAX_LOG);
}

function formatRecallEntry(e: DialogueArchiveEntry): string {
  const age = formatArchiveAge(e.ts);
  const player = e.lines.find((l) => l.speakerId === 'player')?.text?.slice(0, 60);
  const reply = e.lines.find((l) => l.speakerId !== 'player')?.text?.slice(0, 60);
  if (player && reply) return `- (${age}) 玩家：「${player}」→「${reply}」`;
  return `- (${age}) ${e.digest.slice(0, 100)}`;
}

/**
 * 从永久档案检索与本轮相关的旧对话（0 API）。
 * 有命中则优先；无命中时回退「该角色较旧但不在近窗」的几条，避免跨天完全失忆。
 */
export async function recallRelevantArchiveLines(
  characterId: string,
  playerMessage: string,
  limit = 4,
): Promise<string[]> {
  const hits = await searchDialogueArchive(playerMessage, limit, {
    participantId: characterId,
    kind: 'player',
    scan: 1500,
  });
  if (hits.length) return hits.map(formatRecallEntry);

  // 无关键词命中：仍给「昨天/更早」的备份事实（排除最近几条，避免与近窗重复）
  const recent = await listDialogueArchive({ participantId: characterId, kind: 'player', limit: 30 });
  if (recent.length <= 3) return [];
  const older = recent.slice(0, Math.max(0, recent.length - 3)).slice(-limit);
  return older.map(formatRecallEntry);
}

/** 永久写入档案（异步，不阻塞对话） */
export function archivePlayerTurn(
  characterId: string,
  playerMessage: string,
  reply: string,
  sceneId: string,
): void {
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const lines: ArchiveLine[] = [
    { speakerId: 'player', speakerName: '玩家', text: playerMessage },
    { speakerId: characterId, speakerName: name, text: reply },
  ];
  void appendDialogueArchive({
    ts: Date.now(),
    kind: 'player',
    sceneId,
    participantIds: ['player', characterId],
    lines,
    digest: makeLocalDigest(lines),
  });
}

export function archiveNpcTurn(
  a: string,
  b: string,
  lines: { characterId: string; dialogue: string }[],
  sceneId: string,
  summary: string,
): void {
  const archiveLines: ArchiveLine[] = lines.map((l) => ({
    speakerId: l.characterId,
    speakerName: CHARACTER_MAP[l.characterId]?.name ?? l.characterId,
    text: l.dialogue,
  }));
  void appendDialogueArchive({
    ts: Date.now(),
    kind: 'npc',
    sceneId,
    participantIds: [a, b],
    lines: archiveLines,
    digest: summary || makeLocalDigest(archiveLines),
  });
}
