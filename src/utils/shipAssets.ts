/**
 * P1 运行时：把代码里的 ./tex/*.png 映射到 ship 产物（多为 .webp）。
 * 无 manifest 时原样返回，开发读源 tex/ 不受影响。
 *
 * P3 资源云分发：原生（Capacitor）环境下按分层清单解析——
 *  解析优先级：本地已下载缓存（file://）→ P0 包内（./tex/）→ 远端层 CDN URL。
 *  - P0：APK 内置，直接走包内路径；若本地缓存有更新副本（弱更补丁）则缓存优先。
 *  - P1/P2：未下载时回退 CDN URL 在线加载（不会黑图，只影响加载时机）；
 *    下载管理器完成后注册进缓存集，之后走本地 file://。
 * Web/开发环境行为不变（始终返回本地映射路径）。
 */

import { Capacitor } from '@capacitor/core';

type ShipManifest = {
  version: number;
  map: Record<string, string>;
};

export type CdnTier = 'P0' | 'P1' | 'P2';
export type CdnFileMeta = { size: number; sha256: string; tier: CdnTier };
export type CdnManifest = {
  version: number;
  policy: string;
  contentHash: string;
  mergeRemoteTiers: boolean;
  generatedAt: string;
  files: Record<string, CdnFileMeta>;
};

/**
 * 资源 CDN 基址（末尾带 /，拼接产物相对路径）。
 * 默认走自定义域名（workers.dev 在大陆网络下不稳定，与网关 GATEWAY_URLS 排序同理）；
 * 可用 import.meta.env.VITE_ASSET_CDN_BASE 或 localStorage 'rb-asset-cdn-base' 覆盖（调试/换域名免重打包，与网关 override 同款）。
 */
const DEFAULT_ASSET_CDN_BASE = 'https://license.youziligames.com/assets/tex/';
const ASSET_CDN_OVERRIDE_KEY = 'rb-asset-cdn-base';

export function getAssetCdnBase(): string {
  try {
    const o = localStorage.getItem(ASSET_CDN_OVERRIDE_KEY);
    if (o && /^https?:\/\//.test(o)) return o.endsWith('/') ? o : `${o}/`;
  } catch {
    /* ignore */
  }
  const env = import.meta.env.VITE_ASSET_CDN_BASE as string | undefined;
  const base = env && /^https?:\/\//.test(env) ? env : DEFAULT_ASSET_CDN_BASE;
  return base.endsWith('/') ? base : `${base}/`;
}

/** 产物相对路径 → CDN 完整 URL（encodeURI 兜底非 ASCII 路径） */
export function buildCdnUrl(outRel: string): string {
  return `${getAssetCdnBase()}${encodeURI(outRel)}`;
}

let shipMap: Record<string, string> | null = null;
let cdnFiles: Record<string, CdnFileMeta> | null = null;
let cdnManifestMeta: Omit<CdnManifest, 'files'> | null = null;
let loadPromise: Promise<void> | null = null;

/** 本地已下载缓存：outRel → 可直接给 <img>/<video>/loader 用的 file URL。由下载管理器注册。 */
const cachedAssets = new Map<string, string>();

const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/** 规范化为相对 tex/ 的 key，如 juese/SR01_2.png */
export function texRelKey(src: string): string | null {
  if (!src) return null;
  let s = src.trim();
  // 去掉 query/hash
  s = s.split('#')[0]?.split('?')[0] ?? s;
  s = s.replace(/\\/g, '/');
  const markers = ['./tex/', '/tex/', 'tex/'];
  for (const m of markers) {
    const idx = s.indexOf(m);
    if (idx >= 0) {
      return s.slice(idx + m.length).replace(/^\/+/, '');
    }
  }
  return null;
}

function applyMap(src: string): string {
  if (!shipMap) return src;
  const key = texRelKey(src);
  if (!key) return src;
  const mapped = shipMap[key];
  if (!mapped || mapped === key) return src;
  // 保留 ./tex/ 前缀风格
  if (src.includes('./tex/')) return `./tex/${mapped}`;
  if (src.includes('/tex/')) {
    const i = src.indexOf('/tex/');
    return `${src.slice(0, i)}/tex/${mapped}`;
  }
  if (src.startsWith('tex/')) return `tex/${mapped}`;
  return `./tex/${mapped}`;
}

/** 同步解析（manifest 加载前返回原路径） */
export function resolveShipUrl(src: string): string {
  const mapped = applyMap(src);
  // Web/开发环境：保持原有本地行为，缓存与 CDN 只在原生包内生效
  if (!isNative() || !cdnFiles) return mapped;

  const key = texRelKey(mapped);
  if (!key) return mapped;

  // 1) 本地已下载缓存（含 P0 弱更补丁副本）
  const cached = cachedAssets.get(key);
  if (cached) return cached;

  // 2) P0 / 未入清单：走包内路径
  const meta = cdnFiles[key];
  if (!meta || meta.tier === 'P0') return mapped;

  // 3) 远端层未下载：回退 CDN 在线加载
  return buildCdnUrl(key);
}

export async function loadShipManifest(): Promise<void> {
  if (shipMap) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    // rename map（所有环境都需要）
    try {
      const url = new URL('./tex/ship-manifest.json', window.location.href).href;
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) {
        shipMap = {};
      } else {
        const data = (await res.json()) as ShipManifest;
        shipMap = data?.map && typeof data.map === 'object' ? data.map : {};
      }
    } catch {
      shipMap = {};
    }
    // 分层清单（包内置一份；原生端用于缓存/CDN 路由，Web 端加载也无害）
    try {
      const url = new URL('./tex/ship-manifest-cdn.json', window.location.href).href;
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) {
        const data = (await res.json()) as CdnManifest;
        if (data?.files && typeof data.files === 'object') {
          cdnFiles = data.files;
          const { files: _files, ...meta } = data;
          cdnManifestMeta = meta;
        }
      }
    } catch {
      /* 无分层清单：保持本地行为 */
    }
    if (import.meta.env.DEV) {
      console.info(
        `[ship] manifest loaded: ${Object.keys(shipMap).length} remaps, ${cdnFiles ? Object.keys(cdnFiles).length : 0} cdn entries`,
      );
    }
  })();
  return loadPromise;
}

export function getShipMapSize(): number {
  return shipMap ? Object.keys(shipMap).length : 0;
}

/** 包内置分层清单（版本门/下载管理器用）；未加载或不存在返回 null */
export function getBundledCdnManifest(): (Omit<CdnManifest, 'files'> & { files: Record<string, CdnFileMeta> }) | null {
  if (!cdnFiles || !cdnManifestMeta) return null;
  return { ...cdnManifestMeta, files: cdnFiles };
}

/** 产物层元信息（outRel 为 tex/ 相对路径，如 juese/pifu/dama/X_sticker.webm） */
export function getCdnFileMeta(outRel: string): CdnFileMeta | null {
  return cdnFiles?.[outRel] ?? null;
}

/**
 * 弱更：采用远端分层清单（版本门探测到 contentHash 变化后调用）。
 * 只替换内存中的 files 表；P0 包内文件不受影响（resolveShipUrl 依旧本地优先）。
 * 返回是否真正发生了切换（hash 相同则不重复应用）。
 */
export function applyRemoteCdnManifest(data: CdnManifest): boolean {
  if (!data?.files || typeof data.files !== 'object') return false;
  if (cdnManifestMeta?.contentHash && cdnManifestMeta.contentHash === data.contentHash) return false;
  cdnFiles = data.files;
  const { files: _files, ...meta } = data;
  cdnManifestMeta = meta;
  if (import.meta.env.DEV) {
    console.info(`[ship] remote cdn manifest applied: ${data.contentHash}, ${Object.keys(data.files).length} entries`);
  }
  return true;
}

/** 下载管理器注册：某产物已有本地缓存副本，之后 resolveShipUrl 走本地 file URL */
export function registerCachedAsset(outRel: string, fileUrl: string): void {
  cachedAssets.set(outRel, fileUrl);
}

/** 批量注册（启动时下载管理器恢复索引用） */
export function registerCachedAssets(entries: Record<string, string>): void {
  for (const [rel, url] of Object.entries(entries)) cachedAssets.set(rel, url);
}

/** 缓存失效（弱更替换/清理后调用） */
export function unregisterCachedAsset(outRel: string): void {
  cachedAssets.delete(outRel);
}

export function getCachedAssetCount(): number {
  return cachedAssets.size;
}
