/**
 * P3 资源云分发 · 下载管理器（仅原生 Capacitor 生效，Web/开发环境全部 noop）
 *
 * 存储约定：
 *  - 完成文件：Directory.Data/tex-cache/<outRel>
 *  - 下载中临时文件：Directory.Data/tex-cache/<outRel>.part（断点续传，重启后 Range 续下）
 *  - 索引：Directory.Data/tex-cache/index.json（files=已完成，parts=下载中记录期望 size/sha256）
 *
 * 完整性：下载过程增量 sha256（含续传前缀），与包内 CDN 清单比对一致才转正并注册；
 * 注册后 resolveShipUrl 自动走本地 file://（见 src/utils/shipAssets.ts）。
 */

import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { sha256 } from 'js-sha256';
import {
  buildCdnUrl,
  getBundledCdnManifest,
  registerCachedAssets,
  registerCachedAsset,
  unregisterCachedAsset,
  type CdnTier,
} from '../utils/shipAssets';

const CACHE_DIR = 'tex-cache';
const INDEX_PATH = `${CACHE_DIR}/index.json`;

export type RemoteAssetEntry = {
  outRel: string;
  size: number;
  sha256: string;
  tier: CdnTier;
  url: string;
};

export type AssetDownloadState = {
  running: boolean;
  /** 本批队列汇总 */
  queueLoaded: number;
  queueTotal: number;
  queuePercent: number;
  done: number;
  failed: number;
  pending: number;
  currentFile: string | null;
};

export type AssetDownloadEvent =
  | { type: 'progress'; state: AssetDownloadState }
  | { type: 'file-done'; outRel: string; state: AssetDownloadState }
  | { type: 'file-error'; outRel: string; message: string; state: AssetDownloadState }
  | { type: 'queue-done'; failed: string[]; state: AssetDownloadState };

type IndexEntry = { size: number; sha256: string };
type CacheIndex = { files: Record<string, IndexEntry>; parts: Record<string, IndexEntry> };

const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/* ---------------- base64 工具（Filesystem 二进制约定：不传 encoding 即 base64） ---------------- */

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------------- 索引读写 ---------------- */

async function readIndex(): Promise<CacheIndex> {
  try {
    const res = await Filesystem.readFile({ path: INDEX_PATH, directory: Directory.Data, encoding: Encoding.UTF8 });
    const text = typeof res.data === 'string' ? res.data : '';
    const data = JSON.parse(text) as Partial<CacheIndex>;
    return {
      files: data.files && typeof data.files === 'object' ? data.files : {},
      parts: data.parts && typeof data.parts === 'object' ? data.parts : {},
    };
  } catch {
    return { files: {}, parts: {} };
  }
}

let indexWriteQueue: Promise<void> = Promise.resolve();
function writeIndex(index: CacheIndex): Promise<void> {
  indexWriteQueue = indexWriteQueue.then(async () => {
    try {
      await Filesystem.writeFile({
        path: INDEX_PATH,
        directory: Directory.Data,
        data: JSON.stringify(index),
        encoding: Encoding.UTF8,
        recursive: true,
      });
    } catch {
      /* 索引写失败不致命，下次启动按 .part/缺失重新对齐 */
    }
  });
  return indexWriteQueue;
}

/**
 * 索引事务：读-改-写整体串行。
 * 历史 BUG：6 个并发 worker 各自 readIndex→writeIndex，后写者用旧快照覆盖，
 * 把先完成文件的条目冲掉 → 下载显示 100% 但索引丢条目 → 下次启动/覆盖安装全量重下。
 */
let indexTx: Promise<unknown> = Promise.resolve();
function withIndex<T>(fn: (index: CacheIndex) => T | Promise<T>): Promise<T> {
  const run = indexTx.then(async () => fn(await readIndex()));
  indexTx = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function fileSize(path: string): Promise<number | null> {
  try {
    const st = await Filesystem.stat({ path, directory: Directory.Data });
    return typeof st.size === 'number' ? st.size : null;
  } catch {
    return null;
  }
}

async function removeQuiet(path: string): Promise<void> {
  try {
    await Filesystem.deleteFile({ path, directory: Directory.Data });
  } catch {
    /* 不存在则忽略 */
  }
}

async function cachedFileUrl(outRel: string): Promise<string | null> {
  try {
    const { uri } = await Filesystem.getUri({ path: `${CACHE_DIR}/${outRel}`, directory: Directory.Data });
    return Capacitor.convertFileSrc(uri);
  } catch {
    return null;
  }
}

/* ---------------- 启动恢复 ---------------- */

/** 递归枚举缓存目录里的成品文件（跳过 .part 与索引），返回 outRel → size */
async function listCacheFilesRecursive(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const walk = async (rel: string): Promise<void> => {
    let res;
    try {
      res = await Filesystem.readdir({
        path: rel ? `${CACHE_DIR}/${rel}` : CACHE_DIR,
        directory: Directory.Data,
      });
    } catch {
      return;
    }
    for (const f of res.files) {
      if (!f.name) continue;
      if (f.type === 'directory') {
        await walk(rel ? `${rel}/${f.name}` : f.name);
        continue;
      }
      if (f.name === 'index.json' || f.name.endsWith('.part')) continue;
      const outRel = rel ? `${rel}/${f.name}` : f.name;
      out.set(outRel, typeof f.size === 'number' ? f.size : ((await fileSize(`${CACHE_DIR}/${outRel}`)) ?? -1));
    }
  };
  await walk('');
  return out;
}

/**
 * 启动时恢复缓存索引：已完成的注册进 shipAssets（resolveShipUrl 立即走本地）；
 * 索引有记录但文件缺失的条目剔除；.part 留待续传。
 * 另含自愈：文件在盘但索引缺条目（历史并发写竞态丢的），按清单 size 重新采纳——
 * 成品路径只有通过 sha256 校验后才会 rename 落位，size 对齐即可信任。
 * 应在 loadShipManifest() 之后调用。
 */
export async function initAssetCache(): Promise<void> {
  if (!isNative()) return;
  const index = await readIndex();
  const entries: Record<string, string> = {};
  let dirty = false;
  for (const outRel of Object.keys(index.files)) {
    const size = await fileSize(`${CACHE_DIR}/${outRel}`);
    if (size === null) {
      delete index.files[outRel];
      dirty = true;
      continue;
    }
    const url = await cachedFileUrl(outRel);
    if (url) entries[outRel] = url;
  }
  // 自愈扫描：只在盘上存在索引未记录的成品时才有开销
  const manifest = getBundledCdnManifest();
  if (manifest) {
    const onDisk = await listCacheFilesRecursive();
    for (const [outRel, size] of onDisk) {
      if (index.files[outRel]) continue;
      const meta = manifest.files[outRel];
      if (!meta || meta.tier === 'P0' || meta.size !== size) continue;
      index.files[outRel] = { size: meta.size, sha256: meta.sha256 };
      dirty = true;
      const url = await cachedFileUrl(outRel);
      if (url) entries[outRel] = url;
    }
  }
  if (dirty) await writeIndex(index);
  if (Object.keys(entries).length) registerCachedAssets(entries);
  if (import.meta.env.DEV) {
    console.info(`[assets] cache restored: ${Object.keys(entries).length} files`);
  }
}

/**
 * 孤儿清理：删除缓存目录里不在当前生效清单中的成品文件（开发侧删除资源的下发通道）。
 *
 * 安全约束：
 *  - 只能由版本门在清单权威性确认后调用：
 *    a) 服务端 assetHash === 包内 contentHash（包内清单即最新），或
 *    b) 弱更远端清单拉取并应用成功（getBundledCdnManifest 返回的已是远端表）。
 *    服务端不可达 / 远端清单拉取失败时严禁调用，否则会用旧包内清单误杀弱更资源。
 *  - 生效清单为空表视为数据异常，直接放弃（宁可留垃圾也不清仓）。
 *  - .part 与 index.json 由 listCacheFilesRecursive 天然跳过；正在下载的目标文件
 *    必在清单内，不受影响。
 * 返回清理的文件数。
 */
export async function pruneOrphanCacheFiles(): Promise<number> {
  if (!isNative()) return 0;
  const manifest = getBundledCdnManifest();
  if (!manifest || Object.keys(manifest.files).length === 0) return 0;
  const onDisk = await listCacheFilesRecursive();
  const orphans: string[] = [];
  for (const outRel of onDisk.keys()) {
    if (!manifest.files[outRel]) orphans.push(outRel);
  }
  if (orphans.length === 0) return 0;
  for (const outRel of orphans) {
    await removeQuiet(`${CACHE_DIR}/${outRel}`);
    unregisterCachedAsset(outRel);
  }
  await withIndex((index) => {
    for (const outRel of orphans) delete index.files[outRel];
  });
  if (import.meta.env.DEV) {
    console.info(`[assets] pruned ${orphans.length} orphan file(s)`);
  }
  return orphans.length;
}

/* ---------------- 待下载清单 ---------------- */

/** 远端层（P1/P2）中尚未缓存的资源清单 */
export async function listPendingRemoteAssets(): Promise<RemoteAssetEntry[]> {
  const manifest = getBundledCdnManifest();
  if (!manifest) return [];
  const index = isNative() ? await readIndex() : { files: {} };
  const out: RemoteAssetEntry[] = [];
  for (const [outRel, meta] of Object.entries(manifest.files)) {
    if (meta.tier === 'P0') continue;
    const done = (index.files as Record<string, IndexEntry>)[outRel];
    if (done && done.sha256 === meta.sha256) continue;
    out.push({ outRel, size: meta.size, sha256: meta.sha256, tier: meta.tier, url: buildCdnUrl(outRel) });
  }
  return out;
}

/** 主页/登录页进度展示：远端层总量 vs 已缓存量 */
export async function getRemoteAssetStats(): Promise<{
  total: number;
  totalBytes: number;
  cached: number;
  cachedBytes: number;
}> {
  const manifest = getBundledCdnManifest();
  if (!manifest) return { total: 0, totalBytes: 0, cached: 0, cachedBytes: 0 };
  const index = isNative() ? await readIndex() : { files: {} };
  let total = 0;
  let totalBytes = 0;
  let cached = 0;
  let cachedBytes = 0;
  for (const [outRel, meta] of Object.entries(manifest.files)) {
    if (meta.tier === 'P0') continue;
    total += 1;
    totalBytes += meta.size;
    const done = (index.files as Record<string, IndexEntry>)[outRel];
    if (done && done.sha256 === meta.sha256) {
      cached += 1;
      cachedBytes += meta.size;
    }
  }
  return { total, totalBytes, cached, cachedBytes };
}

/* ---------------- 下载队列 ---------------- */

const state: AssetDownloadState = {
  running: false,
  queueLoaded: 0,
  queueTotal: 0,
  queuePercent: 0,
  done: 0,
  failed: 0,
  pending: 0,
  currentFile: null,
};

const listeners = new Set<(e: AssetDownloadEvent) => void>();
export function onAssetDownloadEvent(cb: (e: AssetDownloadEvent) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function emit(e: AssetDownloadEvent): void {
  for (const cb of listeners) {
    try {
      cb(e);
    } catch {
      /* listener 异常不影响下载 */
    }
  }
}

export function getAssetDownloadState(): AssetDownloadState {
  return { ...state };
}

let abortCtrl: AbortController | null = null;
const loadedByFile = new Map<string, number>();

function refreshQueueProgress(): void {
  let loaded = 0;
  for (const v of loadedByFile.values()) loaded += v;
  state.queueLoaded = loaded;
  state.queuePercent = state.queueTotal > 0 ? Math.min(100, (loaded / state.queueTotal) * 100) : 0;
}

let lastProgressEmit = 0;
function emitProgress(force = false): void {
  const now = Date.now();
  if (!force && now - lastProgressEmit < 200) return;
  lastProgressEmit = now;
  refreshQueueProgress();
  emit({ type: 'progress', state: getAssetDownloadState() });
}

/* ---------------- 看门狗参数 ---------------- */

/** 连接首字节超时：跨境链路半开连接不报错也不返回，必须主动掐断 */
const CONNECT_TIMEOUT_MS = 30_000;
/** 流式读取停滞阈值：30s 无任何数据即判停滞，抛错走续传重试 */
const READ_STALL_TIMEOUT_MS = 30_000;
/** 单文件最大尝试次数（Range 续传不丢进度） */
const MAX_ATTEMPTS = 6;
/** 队列级自动重试轮数：整批跑完后仅对失败文件自动再下，用户手动暂停不触发 */
const MAX_QUEUE_ROUNDS = 3;
const QUEUE_RETRY_DELAY_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 带超时的 fetch：超时主动 abort，错误信息带「连接超时」便于日志区分 */
async function fetchWithTimeout(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  const onParentAbort = () => ctrl.abort(signal.reason);
  signal.addEventListener('abort', onParentAbort);
  const timer = setTimeout(() => ctrl.abort(new Error(`连接超时（${CONNECT_TIMEOUT_MS / 1000}s 无响应）`)), CONNECT_TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onParentAbort);
  }
}

/** 单文件下载：Range 断点续传 + 增量 sha256 校验，失败自动重试（续传不丢进度） */
async function downloadOne(entry: RemoteAssetEntry, signal: AbortSignal): Promise<void> {
  const partPath = `${CACHE_DIR}/${entry.outRel}.part`;
  const finalPath = `${CACHE_DIR}/${entry.outRel}`;

  // 清单变了（弱更替换过资源）→ 旧 .part 作废重下（索引事务内完成读改写）
  await withIndex(async (index) => {
    const partMeta = index.parts[entry.outRel];
    if (partMeta && partMeta.sha256 !== entry.sha256) {
      await removeQuiet(partPath);
      delete index.parts[entry.outRel];
      await writeIndex(index);
    }
  });

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      let offset = (await fileSize(partPath)) ?? 0;
      if (offset > entry.size) {
        await removeQuiet(partPath);
        offset = 0;
      }

      const hasher = sha256.create();
      if (offset > 0) {
        // 续传：先把已落盘的前缀读进来喂 hash（一次性读入内存，皮肤单文件平均 ~5MB 可控）
        const res = await Filesystem.readFile({ path: partPath, directory: Directory.Data });
        if (typeof res.data !== 'string') throw new Error('读取续传缓存失败');
        hasher.update(base64ToBytes(res.data));
        loadedByFile.set(entry.outRel, offset);
      } else {
        loadedByFile.set(entry.outRel, 0);
      }
      emitProgress();

      const headers: Record<string, string> = {};
      if (offset > 0) headers.Range = `bytes=${offset}-`;
      const resp = await fetchWithTimeout(entry.url, headers, signal);
      if (!resp.ok && resp.status !== 206) throw new Error(`HTTP ${resp.status}`);

      if (offset > 0 && resp.status === 200) {
        // 服务端忽略 Range：删掉 .part 从头重下（重进一次 offset=0 的全新路径）
        await removeQuiet(partPath);
        loadedByFile.set(entry.outRel, 0);
        return downloadOne(entry, signal);
      }

      await Filesystem.mkdir({
        path: `${CACHE_DIR}/${entry.outRel.split('/').slice(0, -1).join('/')}`,
        directory: Directory.Data,
        recursive: true,
      }).catch(() => undefined);

      // 记录 part 期望元信息（供下次启动判断是否因清单变更作废；事务化防并发丢写）
      await withIndex(async (idx2) => {
        idx2.parts[entry.outRel] = { size: entry.size, sha256: entry.sha256 };
        await writeIndex(idx2);
      });

      if (!resp.body) {
        // 流不可用的兜底：整段读入一次写入（小文件场景）
        const buf = new Uint8Array(await resp.arrayBuffer());
        hasher.update(buf);
        await Filesystem.appendFile({ path: partPath, directory: Directory.Data, data: bytesToBase64(buf) });
        loadedByFile.set(entry.outRel, offset + buf.byteLength);
        emitProgress(true);
      } else {
        const reader = resp.body.getReader();
        let stallTimer: ReturnType<typeof setTimeout> | null = null;
        try {
          for (;;) {
            // 停滞看门狗：READ_STALL_TIMEOUT_MS 内无数据即抛错，走续传重试；
            // 半开 TCP 连接不会自己报错，没有这个超时队列会整体假死
            const { done, value } = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
              stallTimer = setTimeout(
                () => reject(new Error(`下载停滞（${READ_STALL_TIMEOUT_MS / 1000}s 无数据）`)),
                READ_STALL_TIMEOUT_MS,
              );
              reader.read().then(resolve, reject);
            });
            if (stallTimer) {
              clearTimeout(stallTimer);
              stallTimer = null;
            }
            if (done) break;
            if (signal.aborted) throw new DOMException('aborted', 'AbortError');
            if (value && value.byteLength) {
              hasher.update(value);
              await Filesystem.appendFile({ path: partPath, directory: Directory.Data, data: bytesToBase64(value) });
              loadedByFile.set(entry.outRel, (loadedByFile.get(entry.outRel) ?? 0) + value.byteLength);
              emitProgress();
            }
          }
        } finally {
          if (stallTimer) clearTimeout(stallTimer);
          // 停滞/异常时掐掉底层流，释放半开连接，避免占用并发位
          reader.cancel().catch(() => undefined);
        }
      }

      // 校验：大小 + sha256 双过才转正
      const finalSize = (await fileSize(partPath)) ?? 0;
      if (finalSize !== entry.size) throw new Error(`大小不符 ${finalSize}/${entry.size}`);
      const digest = hasher.hex();
      if (digest !== entry.sha256) throw new Error('sha256 校验失败');

      await removeQuiet(finalPath);
      await Filesystem.rename({ from: partPath, to: finalPath, directory: Directory.Data, toDirectory: Directory.Data });

      // 转正登记（事务化：并发完成时读改写串行，杜绝后写覆盖先写）
      await withIndex(async (idx3) => {
        idx3.files[entry.outRel] = { size: entry.size, sha256: entry.sha256 };
        delete idx3.parts[entry.outRel];
        await writeIndex(idx3);
      });

      const url = await cachedFileUrl(entry.outRel);
      if (url) registerCachedAsset(entry.outRel, url);
      return;
    } catch (err) {
      if (signal.aborted) throw err;
      lastErr = err;
      await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('下载失败');
}

const CONCURRENCY = 6;

/**
 * 启动一批远端资源下载（不传则自动取 listPendingRemoteAssets()）。
 * 已在运行时会先把现有队列取消再开新批；返回失败列表。
 */
export async function startAssetDownload(entries?: RemoteAssetEntry[]): Promise<{ failed: string[] }> {
  if (!isNative()) return { failed: [] };
  if (state.running) cancelAssetDownload();
  const list = entries ?? (await listPendingRemoteAssets());

  abortCtrl = new AbortController();
  const signal = abortCtrl.signal;
  loadedByFile.clear();
  state.running = true;
  state.queueTotal = list.reduce((s, e) => s + e.size, 0);
  state.queueLoaded = 0;
  state.queuePercent = 0;
  state.done = 0;
  state.failed = 0;
  state.pending = list.length;
  state.currentFile = null;
  emitProgress(true);

  const failed: string[] = [];
  const runBatch = async (entries: RemoteAssetEntry[]): Promise<void> => {
    let cursor = 0;
    state.pending = entries.length;
    const worker = async () => {
      while (cursor < entries.length) {
        if (signal.aborted) return;
        const entry = entries[cursor++];
        if (!entry) return;
        state.currentFile = entry.outRel;
        try {
          await downloadOne(entry, signal);
          state.done += 1;
          emitProgress(true);
          emit({ type: 'file-done', outRel: entry.outRel, state: getAssetDownloadState() });
        } catch (err) {
          if (signal.aborted) return;
          state.failed += 1;
          failed.push(entry.outRel);
          const message = err instanceof Error ? err.message : String(err);
          emit({ type: 'file-error', outRel: entry.outRel, message, state: getAssetDownloadState() });
        } finally {
          state.pending = Math.max(0, state.pending - 1);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, () => worker()));
  };

  await runBatch(list);

  // 队列级自动重试：仅对失败文件重下（.part 续传不丢进度）；用户手动暂停（abort）则不触发
  for (let round = 0; round < MAX_QUEUE_ROUNDS && failed.length > 0 && !signal.aborted; round++) {
    await sleep(QUEUE_RETRY_DELAY_MS);
    if (signal.aborted) break;
    const retrySet = new Set(failed);
    const retryList = list.filter((e) => retrySet.has(e.outRel));
    failed.length = 0;
    if (import.meta.env.DEV) {
      console.info(`[assets] auto-retry round ${round + 1}: ${retryList.length} files`);
    }
    await runBatch(retryList);
  }

  state.running = false;
  state.currentFile = null;
  emitProgress(true);
  emit({ type: 'queue-done', failed, state: getAssetDownloadState() });
  return { failed };
}

/** 取消当前批次：已落盘的 .part 保留，下次启动/重试自动续传 */
export function cancelAssetDownload(): void {
  abortCtrl?.abort();
  state.running = false;
}
