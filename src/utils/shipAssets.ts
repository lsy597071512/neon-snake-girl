/**
 * P1 运行时：把代码里的 ./tex/*.png 映射到 ship 产物（多为 .webp）。
 * 无 manifest 时原样返回，开发读源 tex/ 不受影响。
 */

type ShipManifest = {
  version: number;
  map: Record<string, string>;
};

let shipMap: Record<string, string> | null = null;
let loadPromise: Promise<void> | null = null;

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
  return applyMap(src);
}

export async function loadShipManifest(): Promise<void> {
  if (shipMap) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const url = new URL('./tex/ship-manifest.json', window.location.href).href;
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) {
        shipMap = {};
        return;
      }
      const data = (await res.json()) as ShipManifest;
      shipMap = data?.map && typeof data.map === 'object' ? data.map : {};
      if (import.meta.env.DEV) {
        console.info(`[ship] manifest loaded: ${Object.keys(shipMap).length} remaps`);
      }
    } catch {
      shipMap = {};
    }
  })();
  return loadPromise;
}

export function getShipMapSize(): number {
  return shipMap ? Object.keys(shipMap).length : 0;
}
