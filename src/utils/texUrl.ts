import { resolveShipUrl } from './shipAssets';

/** 开发模式下为 tex 资源追加时间戳，避免 Three.js / 浏览器强缓存旧贴图 */
export function texUrl(src: string): string {
  const resolved = resolveShipUrl(src);
  if (!import.meta.env.DEV) return resolved;
  const sep = resolved.includes('?') ? '&' : '?';
  return `${resolved}${sep}t=${Date.now()}`;
}

/**
 * 供 CSS 自定义属性里的 url() 使用。
 * 相对路径若写进 --var 再被打包 CSS 的 var() 引用，会相对 CSS 文件解析（常变成 /assets/tex/... 404）。
 * 转成基于当前页面的绝对 URL 后，选图背景等在 Capacitor / 生产包上才能正确加载。
 */
export function cssAssetUrl(src: string): string {
  const path = texUrl(src);
  try {
    if (typeof window !== 'undefined' && window.location?.href) {
      return new URL(path, window.location.href).href;
    }
  } catch {
    /* fall through */
  }
  return path;
}
