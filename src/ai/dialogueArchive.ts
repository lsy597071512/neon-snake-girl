/**
 * 永久对话档案（本地存储）
 *
 * 全文永不删除（IndexedDB）；进 Prompt 时只按需检索相关条目，省 token。
 */

export type ArchiveLine = {
  speakerId: string; // 'player' | characterId
  speakerName: string;
  text: string;
};

export type DialogueArchiveEntry = {
  id: string;
  ts: number;
  kind: 'player' | 'npc';
  sceneId?: string;
  participantIds: string[];
  lines: ArchiveLine[];
  /** 一句话摘要（本地生成，便于检索） */
  digest: string;
};

const IDB_NAME = 'rust-belt-ai-archive';
const IDB_STORE = 'dialogues';
const LS_FALLBACK = 'rust-belt-ai-dialogue-archive-v1';
/** LS 回落硬顶；IDB 路径不裁切删除 */
const LS_MAX = 8000;

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
        store.createIndex('kind', 'kind');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function lsLoad(): DialogueArchiveEntry[] {
  try {
    const raw = localStorage.getItem(LS_FALLBACK);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DialogueArchiveEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function lsSave(list: DialogueArchiveEntry[]): void {
  const trimmed = list.length > LS_MAX ? list.slice(-LS_MAX) : list;
  localStorage.setItem(LS_FALLBACK, JSON.stringify(trimmed));
}

export async function appendDialogueArchive(
  entry: Omit<DialogueArchiveEntry, 'id'> & { id?: string },
): Promise<void> {
  const full: DialogueArchiveEntry = {
    ...entry,
    id: entry.id ?? uid(),
  };

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(full);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    const list = lsLoad();
    list.push(full);
    lsSave(list);
  }
}

/**
 * 重置存档时清空永久对话档案。
 * 不清理的话，`hydrateCharacterMemoryFromArchive` 会在新档第一次对话时
 * 把上一个档的聊天记录灌回 recentChats / memories，表现为「删档了回忆还在」。
 */
export async function purgeDialogueArchive(): Promise<void> {
  try {
    localStorage.removeItem(LS_FALLBACK);
  } catch {
    /* ignore */
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    /* IDB 不可用：LS 已清即可 */
  }
}

export async function listDialogueArchive(opts?: {
  participantId?: string;
  kind?: 'player' | 'npc';
  limit?: number;
}): Promise<DialogueArchiveEntry[]> {
  const limit = opts?.limit ?? 100;
  try {
    const db = await openDb();
    const all = await new Promise<DialogueArchiveEntry[]>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).index('ts').getAll();
      req.onsuccess = () => resolve((req.result as DialogueArchiveEntry[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return filterArchive(all, opts).slice(-limit);
  } catch {
    return filterArchive(lsLoad(), opts).slice(-limit);
  }
}

function filterArchive(
  all: DialogueArchiveEntry[],
  opts?: { participantId?: string; kind?: 'player' | 'npc' },
): DialogueArchiveEntry[] {
  return all
    .filter((e) => (opts?.kind ? e.kind === opts.kind : true))
    .filter((e) => (opts?.participantId ? e.participantIds.includes(opts.participantId) : true))
    .sort((a, b) => a.ts - b.ts);
}

/** 中文友好分词：连续汉字 2～4 字切片 + 空白英文词 */
export function tokenizeQuery(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = new Set<string>();
  for (const w of q.split(/[\s,，。.!！？?、；;：:]+/)) {
    if (w.length >= 2) tokens.add(w);
  }
  const hans = q.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of hans) {
    if (run.length >= 2) tokens.add(run);
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= run.length; i++) {
        tokens.add(run.slice(i, i + n));
      }
    }
  }
  // 去过短噪声
  return [...tokens].filter((t) => t.length >= 2).slice(0, 40);
}

function scoreArchiveEntry(e: DialogueArchiveEntry, tokens: string[]): number {
  if (!tokens.length) return 0;
  const blob = `${e.digest} ${e.lines.map((l) => l.text).join(' ')}`.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (!blob.includes(t)) continue;
    score += t.length >= 4 ? 3 : t.length >= 3 ? 2 : 1;
  }
  return score;
}

/** 本地关键词检索档案（0 API）；可按角色过滤 */
export async function searchDialogueArchive(
  query: string,
  limit = 8,
  opts?: { participantId?: string; kind?: 'player' | 'npc'; scan?: number },
): Promise<DialogueArchiveEntry[]> {
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return [];
  const all = await listDialogueArchive({
    participantId: opts?.participantId,
    kind: opts?.kind,
    limit: opts?.scan ?? 1200,
  });
  const scored = all
    .map((e) => ({ e, s: scoreArchiveEntry(e, tokens) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.e.ts - a.e.ts);
  return scored.slice(0, limit).map((x) => x.e);
}

export function makeLocalDigest(lines: ArchiveLine[]): string {
  const texts = lines.map((l) => `${l.speakerName}：${l.text}`).join(' / ');
  return texts.length > 160 ? `${texts.slice(0, 157)}…` : texts;
}

export function formatArchiveAge(ts: number, now = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - ts) / 1000));
  if (sec < 3600) return `${Math.max(1, Math.floor(sec / 60))}分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}小时前`;
  const days = Math.floor(sec / 86400);
  if (days === 1) return '昨天';
  if (days < 7) return `${days}天前`;
  return `${Math.floor(days / 7)}周前`;
}
