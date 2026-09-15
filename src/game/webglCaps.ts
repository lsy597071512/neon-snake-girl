export interface WebGLCaps {
  /** ANGLE / SwiftShader / 真实 GPU 型号 */
  renderer: string;
  /** 是否为 SwiftShader 等 CPU 软渲染 */
  softwareRenderer: boolean;
  /** 页面当前是否被浏览器标记为不可见（后台标签 / 未聚焦面板会严重降帧） */
  pageHidden: boolean;
  /** 是否像 Electron / IDE 内嵌预览 */
  embeddedPreview: boolean;
}

let cachedCaps: WebGLCaps | null = null;

function probeWebGLRenderer(): string {
  if (typeof document === 'undefined') return 'n/a';
  const canvas = document.createElement('canvas');
  const gl =
    canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) ??
    canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true }) ??
    canvas.getContext('webgl2') ??
    canvas.getContext('webgl');
  if (!gl) return 'no-webgl';

  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  if (!dbg) return 'unknown';
  return gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string;
}

function isSoftwareRendererString(renderer: string): boolean {
  const r = renderer.toLowerCase();
  return (
    r.includes('swiftshader') ||
    r.includes('llvmpipe') ||
    r.includes('softpipe') ||
    r.includes('microsoft basic render') ||
    r.includes('software')
  );
}

function isEmbeddedPreview(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/Electron|Cursor/i.test(ua)) return true;
  if (typeof (window as Window & { chrome?: { runtime?: unknown } }).chrome?.runtime !== 'undefined') {
    return false;
  }
  // IDE 内嵌预览常见：页面可见但 hasFocus 为 false
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** 读取 WebGL / 页面环境能力（结果缓存） */
export function getWebGLCaps(): WebGLCaps {
  if (cachedCaps) return cachedCaps;
  const renderer = probeWebGLRenderer();
  cachedCaps = {
    renderer,
    softwareRenderer: isSoftwareRendererString(renderer),
    pageHidden: typeof document !== 'undefined' && document.hidden,
    embeddedPreview: isEmbeddedPreview(),
  };
  return cachedCaps;
}

export function refreshWebGLPageState(): Pick<WebGLCaps, 'pageHidden' | 'embeddedPreview'> {
  const caps = getWebGLCaps();
  caps.pageHidden = document.hidden;
  caps.embeddedPreview = isEmbeddedPreview();
  return caps;
}

export function abbreviateRenderer(renderer: string): string {
  if (renderer === 'no-webgl') return 'NO-GL';
  if (renderer === 'unknown' || renderer === 'n/a') return '?';
  if (/swiftshader/i.test(renderer)) return 'SwiftShader';
  const nvidia = renderer.match(/NVIDIA[^,\)]*/i);
  if (nvidia) return nvidia[0].replace(/\s+/g, ' ').trim();
  const amd = renderer.match(/AMD[^,\)]*/i);
  if (amd) return amd[0].replace(/\s+/g, ' ').trim();
  if (renderer.length > 28) return `${renderer.slice(0, 26)}…`;
  return renderer;
}
