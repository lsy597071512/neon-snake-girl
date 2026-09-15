/**
 * 人生时间线 L2（里程碑永久记忆）
 *
 * - 与 L1 `aiLiving.memories`（有上限）分离；存 IndexedDB，可按关键词检索
 * - Prompt 只注入检索 Top-K，不整表塞进模型
 */
import { CHARACTER_MAP } from '../data/characters';
import { tokenizeQuery } from './dialogueArchive';
import type { AiLivingSave, AiMemoryEntry } from './types';

export type LifeTimelineKind =
  | 'talk'
  | 'gift'
  | 'event'
  | 'combat_return'
  | 'outreach'
  | 'outreach_ignored'
  | 'skin'
  | 'desire'
  | 'milestone'
  | 'promise';

export type LifeTimelineEntry = {
  id: string;
  characterId: string;
  ts: number;
  gameMinutes: number;
  dayIndex: number;
  kind: LifeTimelineKind;
  summary: string;
  tags: string[];
  importance: number;
};

const IDB_NAME = 'rust-belt-ai-timeline';
const IDB_STORE = 'timeline';
const LS_FALLBACK = 'rust-belt-ai-life-timeline-v1';
const LS_MAX = 3000;
/** 同角色近窗去重：摘要极似则升 importance 而不重复插 */
const DEDUPE_WINDOW_MS = 6 * 60_000;

function uid(): string {
  return `tl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        store.createIndex('ts', 'ts');
        store.createIndex('characterId', 'characterId');
        store.createIndex('importance', 'importance');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function lsLoad(): LifeTimelineEntry[] {
  try {
    const raw = localStorage.getItem(LS_FALLBACK);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LifeTimelineEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function lsSave(list: LifeTimelineEntry[]): void {
  const trimmed = list.length > LS_MAX ? list.slice(-LS_MAX) : list;
  localStorage.setItem(LS_FALLBACK, JSON.stringify(trimmed));
}

async function idbPut(entry: LifeTimelineEntry): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGetAll(): Promise<LifeTimelineEntry[]> {
  const db = await openDb();
  const all = await new Promise<LifeTimelineEntry[]>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).index('ts').getAll();
    req.onsuccess = () => resolve((req.result as LifeTimelineEntry[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return all;
}

async function idbPutMany(entries: LifeTimelineEntry[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    for (const e of entries) store.put(e);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbDeleteByCharacter(characterId: string): Promise<void> {
  const all = await idbGetAll();
  const keep = all.filter((e) => e.characterId !== characterId);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    store.clear();
    for (const e of keep) store.put(e);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

/** 从正文抽简易标签 */
export function extractTimelineTags(summary: string, kind: string): string[] {
  const tags = new Set<string>([kind]);
  const rules: { re: RegExp; tag: string }[] = [
    { re: /泳池|泳装|戏水/, tag: '泳池' },
    { re: /商店|货架|锈币|购买/, tag: '商店' },
    { re: /武器库|擦枪|军械/, tag: '武器库' },
    { re: /睡衣|外覆|皮肤|换装/, tag: '皮肤' },
    { re: /远征|战场|清扫|撤归|战斗/, tag: '远征' },
    { re: /礼物|送礼/, tag: '礼物' },
    { re: /约定|答应|记得|答应指挥官/, tag: '约定' },
    { re: /和好|吵架|吃味|嫉妒/, tag: '关系' },
    { re: /指挥官/, tag: '指挥官' },
  ];
  for (const r of rules) {
    if (r.re.test(summary)) tags.add(r.tag);
  }
  return [...tags].slice(0, 8);
}

function normalizeKind(kind: string): LifeTimelineKind {
  const allowed: LifeTimelineKind[] = [
    'talk',
    'gift',
    'event',
    'combat_return',
    'outreach',
    'outreach_ignored',
    'skin',
    'desire',
    'milestone',
    'promise',
  ];
  return (allowed.includes(kind as LifeTimelineKind) ? kind : 'milestone') as LifeTimelineKind;
}

function summaryKey(s: string): string {
  return s.replace(/\s+/g, '').slice(0, 48);
}

/** 是否值得晋升为 L2 里程碑 */
export function shouldPromoteToTimeline(
  entry: Pick<AiMemoryEntry, 'kind' | 'summary' | 'importance'>,
): boolean {
  const s = entry.summary || '';
  if (!s.trim()) return false;
  if (/^节拍：/.test(s)) return false; // 戏剧节拍太碎，不进 L2
  if (entry.importance >= 6) return true;
  if (entry.kind === 'combat_return' && entry.importance >= 5) return true;
  if (entry.kind === 'gift' && entry.importance >= 5) return true;
  if (entry.kind === 'outreach' || entry.kind === 'outreach_ignored') {
    return entry.importance >= 5;
  }
  if (/约定|答应指挥官|记忆写入|自主换装|人生/.test(s) && entry.importance >= 5) return true;
  return false;
}

export async function appendLifeTimeline(
  partial: Omit<LifeTimelineEntry, 'id' | 'tags'> & {
    id?: string;
    tags?: string[];
  },
): Promise<LifeTimelineEntry | null> {
  const summary = partial.summary.trim().slice(0, 160);
  if (!summary || !partial.characterId) return null;

  const kind = normalizeKind(partial.kind);
  const full: LifeTimelineEntry = {
    id: partial.id ?? uid(),
    characterId: partial.characterId,
    ts: partial.ts ?? Date.now(),
    gameMinutes: partial.gameMinutes ?? 0,
    dayIndex: partial.dayIndex ?? 0,
    kind,
    summary,
    tags: partial.tags?.length ? partial.tags : extractTimelineTags(summary, kind),
    importance: Math.max(1, Math.min(10, partial.importance ?? 6)),
  };

  try {
    const recent = await listLifeTimeline({
      characterId: full.characterId,
      limit: 24,
    });
    const key = summaryKey(full.summary);
    const dup = recent.find(
      (e) =>
        summaryKey(e.summary) === key && Math.abs(e.ts - full.ts) < DEDUPE_WINDOW_MS,
    );
    if (dup) {
      const bumped: LifeTimelineEntry = {
        ...dup,
        importance: Math.max(dup.importance, full.importance),
        ts: Math.max(dup.ts, full.ts),
        tags: [...new Set([...dup.tags, ...full.tags])].slice(0, 8),
      };
      try {
        await idbPut(bumped);
      } catch {
        const list = lsLoad().map((e) => (e.id === bumped.id ? bumped : e));
        lsSave(list);
      }
      return bumped;
    }

    try {
      await idbPut(full);
    } catch {
      const list = lsLoad();
      list.push(full);
      lsSave(list);
    }
    return full;
  } catch {
    return null;
  }
}

/** 从 living 上下文写里程碑（供业务调用） */
export function recordLifeTimelineMilestone(
  living: AiLivingSave,
  characterId: string,
  opts: {
    kind: LifeTimelineKind | AiMemoryEntry['kind'] | string;
    summary: string;
    importance?: number;
    tags?: string[];
    ts?: number;
  },
): void {
  void appendLifeTimeline({
    characterId,
    ts: opts.ts ?? Date.now(),
    gameMinutes: living.gameMinutes ?? 0,
    dayIndex: living.dayIndex ?? 0,
    kind: normalizeKind(opts.kind),
    summary: opts.summary,
    importance: opts.importance ?? 6,
    tags: opts.tags,
  });
}

/** L1 pushMemory 旁路晋升 */
export function maybePromoteMemoryToTimeline(
  living: AiLivingSave,
  characterId: string,
  entry: Omit<AiMemoryEntry, 'ts'> & { ts?: number },
): void {
  if (!shouldPromoteToTimeline(entry)) return;
  recordLifeTimelineMilestone(living, characterId, {
    kind: entry.kind,
    summary: entry.summary,
    importance: entry.importance,
    ts: entry.ts,
  });
}

export async function listLifeTimeline(opts?: {
  characterId?: string;
  limit?: number;
  minImportance?: number;
}): Promise<LifeTimelineEntry[]> {
  const limit = opts?.limit ?? 40;
  const minImp = opts?.minImportance ?? 0;
  try {
    let all = await idbGetAll();
    if (opts?.characterId) all = all.filter((e) => e.characterId === opts.characterId);
    if (minImp > 0) all = all.filter((e) => e.importance >= minImp);
    return all.slice(-limit);
  } catch {
    let all = lsLoad();
    if (opts?.characterId) all = all.filter((e) => e.characterId === opts.characterId);
    if (minImp > 0) all = all.filter((e) => e.importance >= minImp);
    return all.slice(-limit);
  }
}

function scoreTimelineEntry(e: LifeTimelineEntry, tokens: string[]): number {
  if (!tokens.length) return 0;
  const blob = `${e.summary} ${e.tags.join(' ')} ${e.kind}`.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (!blob.includes(t)) continue;
    score += t.length >= 4 ? 3 : t.length >= 3 ? 2 : 1;
  }
  score += Math.min(3, Math.floor(e.importance / 3));
  return score;
}

function formatTimelineAge(ts: number): string {
  const hours = (Date.now() - ts) / 3_600_000;
  if (hours < 1) return '刚才';
  if (hours < 24) return `${Math.max(1, Math.floor(hours))}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}天前`;
  return `${Math.floor(days / 7)}周前`;
}

/**
 * 检索与当前话题相关的人生里程碑（0 API）。
 * 无命中时回退最近高重要度条目。
 */
export async function recallRelevantTimelineLines(
  characterId: string,
  query: string,
  limit = 4,
): Promise<string[]> {
  const tokens = tokenizeQuery(query);
  const all = await listLifeTimeline({ characterId, limit: 400 });
  if (!all.length) return [];

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  let picked: LifeTimelineEntry[] = [];

  if (tokens.length) {
    const scored = all
      .map((e) => ({ e, s: scoreTimelineEntry(e, tokens) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || b.e.importance - a.e.importance || b.e.ts - a.e.ts);
    picked = scored.slice(0, limit).map((x) => x.e);
  }

  if (!picked.length) {
    picked = [...all]
      .sort((a, b) => b.importance - a.importance || b.ts - a.ts)
      .slice(0, limit);
  }

  return picked.map(
    (e) =>
      `- [${formatTimelineAge(e.ts)}·日${e.dayIndex + 1}·${e.kind}] ${e.summary.slice(0, 90)}（${name}）`,
  );
}

export async function clearCharacterLifeTimeline(characterId: string): Promise<void> {
  try {
    await idbDeleteByCharacter(characterId);
  } catch {
    lsSave(lsLoad().filter((e) => e.characterId !== characterId));
  }
}

/** 批量从现有 L1 记忆回填（开档/升级时可选） */
export async function backfillTimelineFromMemories(
  living: AiLivingSave,
  characterId: string,
): Promise<number> {
  const mem = living.memories?.[characterId] ?? [];
  let n = 0;
  const batch: LifeTimelineEntry[] = [];
  for (const m of mem) {
    if (!shouldPromoteToTimeline(m)) continue;
    batch.push({
      id: uid(),
      characterId,
      ts: m.ts,
      gameMinutes: living.gameMinutes ?? 0,
      dayIndex: living.dayIndex ?? 0,
      kind: normalizeKind(m.kind),
      summary: m.summary.slice(0, 160),
      tags: extractTimelineTags(m.summary, m.kind),
      importance: m.importance,
    });
    n += 1;
  }
  if (!batch.length) return 0;
  try {
    await idbPutMany(batch);
  } catch {
    const list = lsLoad();
    list.push(...batch);
    lsSave(list);
  }
  return n;
}
