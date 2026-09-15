/**
 * 营地生活永久档案（本地，不进 Prompt → 0 token）
 *
 * - 在线心跳 / 离线归来 / 作息变化：全文写入 IndexedDB
 * - Prompt 只拿「今日短 digest」（本地滚压，不调 API）
 * - 体积过大时：旧全日文压成按日摘要，删除明细（缓慢压缩）
 */
import { CHARACTER_MAP } from '../data/characters';
import type { AiLivingSave } from './types';
import { resolvePresence } from './livingState';
import { CAMP_ROOM_MAP } from '../data/campLayout';

export type LifeEventKind =
  | 'presence'
  | 'snapshot'
  | 'camp'
  | 'offline'
  | 'npc'
  | 'skin'
  | 'gift'
  | 'combat_return'
  | 'day_digest';

export type LifeEvent = {
  id: string;
  ts: number;
  gameMinutes: number;
  dayIndex: number;
  kind: LifeEventKind;
  characterId?: string;
  roomId?: string;
  sceneId?: string;
  activity?: string;
  behavior?: string;
  /** 短正文（给人看 / 检索） */
  text: string;
  /** 一行摘要 */
  digest: string;
};

const IDB_NAME = 'rust-belt-ai-life';
const IDB_STORE = 'life_events';
const LS_FALLBACK = 'rust-belt-ai-life-archive-v1';
const LS_MAX = 4000;
/** 超过此条数触发缓慢压缩（约数百 KB～数 MB 量级文本，远低于 10GB） */
const COMPRESS_AFTER = 2500;
const KEEP_RECENT_RAW = 800;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, { keyPath: 'id' });
        store.createIndex('ts', 'ts');
        store.createIndex('dayIndex', 'dayIndex');
        store.createIndex('characterId', 'characterId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function lsLoad(): LifeEvent[] {
  try {
    const raw = localStorage.getItem(LS_FALLBACK);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LifeEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function lsSave(list: LifeEvent[]): void {
  const trimmed = list.length > LS_MAX ? list.slice(-LS_MAX) : list;
  localStorage.setItem(LS_FALLBACK, JSON.stringify(trimmed));
}

async function idbPut(entry: LifeEvent): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGetAll(): Promise<LifeEvent[]> {
  const db = await openDb();
  const all = await new Promise<LifeEvent[]>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).index('ts').getAll();
    req.onsuccess = () => resolve((req.result as LifeEvent[]) ?? []);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return all;
}

async function idbReplaceAll(entries: LifeEvent[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    store.clear();
    for (const e of entries) store.put(e);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function appendLifeEvent(
  partial: Omit<LifeEvent, 'id'> & { id?: string },
): Promise<void> {
  const full: LifeEvent = { ...partial, id: partial.id ?? uid() };
  try {
    await idbPut(full);
    void maybeCompressLifeArchive();
  } catch {
    const list = lsLoad();
    list.push(full);
    lsSave(list);
  }
}

export async function listLifeEvents(opts?: {
  characterId?: string;
  dayIndex?: number;
  limit?: number;
}): Promise<LifeEvent[]> {
  const limit = opts?.limit ?? 80;
  try {
    let all = await idbGetAll();
    if (opts?.characterId) {
      all = all.filter((e) => e.characterId === opts.characterId || e.kind === 'snapshot');
    }
    if (opts?.dayIndex != null) {
      all = all.filter((e) => e.dayIndex === opts.dayIndex);
    }
    return all.slice(-limit);
  } catch {
    let all = lsLoad();
    if (opts?.characterId) {
      all = all.filter((e) => e.characterId === opts.characterId || e.kind === 'snapshot');
    }
    return all.slice(-limit);
  }
}

/** 缓慢压缩：旧明细 → 按日 digest，保留近窗原文 */
export async function maybeCompressLifeArchive(): Promise<void> {
  try {
    const all = await idbGetAll();
    if (all.length < COMPRESS_AFTER) return;

    const recent = all.slice(-KEEP_RECENT_RAW);
    const old = all.slice(0, -KEEP_RECENT_RAW);
    const byDay = new Map<number, LifeEvent[]>();
    for (const e of old) {
      if (e.kind === 'day_digest') {
        recent.unshift(e);
        continue;
      }
      const arr = byDay.get(e.dayIndex) ?? [];
      arr.push(e);
      byDay.set(e.dayIndex, arr);
    }

    const digests: LifeEvent[] = [];
    for (const [dayIndex, events] of byDay) {
      const sample = events
        .slice(0, 12)
        .map((e) => e.digest)
        .join('；');
      digests.push({
        id: uid(),
        ts: events[0]?.ts ?? Date.now(),
        gameMinutes: events[0]?.gameMinutes ?? 0,
        dayIndex,
        kind: 'day_digest',
        text: `第${dayIndex + 1}日压缩日志（${events.length}条）`,
        digest: sample.slice(0, 280),
      });
    }

    await idbReplaceAll([...digests, ...recent].sort((a, b) => a.ts - b.ts));
  } catch {
    const all = lsLoad();
    if (all.length < COMPRESS_AFTER) return;
    lsSave(all.slice(-KEEP_RECENT_RAW));
  }
}

/** 记录全员此刻位置（心跳/进营地时）；有变化才写，省空间 */
const lastSnapKey = new Map<string, string>();

export async function recordCampLifeSnapshot(
  living: AiLivingSave,
  ownedIds: string[],
  reason: string,
): Promise<void> {
  const parts: string[] = [];
  for (const id of ownedIds.slice(0, 16)) {
    const p = resolvePresence(id, living);
    const key = `${p.roomId}|${p.activity}|${p.behavior}`;
    const prev = lastSnapKey.get(id);
    if (prev === key) continue;
    lastSnapKey.set(id, key);
    const name = CHARACTER_MAP[id]?.name ?? id;
    const room = CAMP_ROOM_MAP[p.roomId];
    const place = room
      ? room.kind === 'yard'
        ? '门口'
        : `${room.floor}楼·${room.label}`
      : p.locationId;
    const digest = `${name}@${place}：${p.behavior}`;
    parts.push(digest);
    await appendLifeEvent({
      ts: Date.now(),
      gameMinutes: living.gameMinutes,
      dayIndex: living.dayIndex,
      kind: 'presence',
      characterId: id,
      roomId: p.roomId,
      sceneId: p.locationId,
      activity: p.activity,
      behavior: p.behavior,
      text: digest,
      digest,
    });
  }

  if (!parts.length) return;
  await appendLifeEvent({
    ts: Date.now(),
    gameMinutes: living.gameMinutes,
    dayIndex: living.dayIndex,
    kind: 'snapshot',
    text: `${reason}：${parts.slice(0, 8).join(' / ')}`,
    digest: `${reason} · ${parts.length}人动线更新`,
  });
}

export async function recordLifeNote(
  living: AiLivingSave,
  text: string,
  opts?: { kind?: LifeEventKind; characterId?: string },
): Promise<void> {
  const digest = text.slice(0, 120);
  await appendLifeEvent({
    ts: Date.now(),
    gameMinutes: living.gameMinutes,
    dayIndex: living.dayIndex,
    kind: opts?.kind ?? 'camp',
    characterId: opts?.characterId,
    text,
    digest,
  });
}

/** 给 Prompt 的极薄生活要点（本地，0 API） */
export async function getLifeDigestLinesForPrompt(
  characterId: string,
  limit = 4,
): Promise<string[]> {
  const rows = await listLifeEvents({ characterId, limit: 40 });
  const digests = rows
    .filter((e) => e.kind === 'presence' || e.kind === 'day_digest' || e.kind === 'offline')
    .map((e) => e.digest)
    .filter(Boolean);
  // 去重保序
  const out: string[] = [];
  for (const d of digests) {
    if (!out.includes(d)) out.push(d);
  }
  return out.slice(-limit);
}
