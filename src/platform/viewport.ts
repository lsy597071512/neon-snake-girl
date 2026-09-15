/** 原生端 / 竖屏手机：用真实可视区域驱动全屏布局，消除 9:16 信箱黑边 */
export function bindViewportMetrics(): void {
  if (typeof window === 'undefined') return;

  const apply = () => {
    const vv = window.visualViewport;
    const w = vv?.width ?? window.innerWidth;
    const h = vv?.height ?? window.innerHeight;
    const root = document.documentElement;
    root.style.setProperty('--app-vw', `${w}px`);
    root.style.setProperty('--app-vh', `${h}px`);
    root.style.setProperty('--frame-w', `${w}px`);
    root.style.setProperty('--frame-h', `${h}px`);
    root.style.setProperty('--frame-unit', `${w / 360}px`);
  };

  apply();
  window.addEventListener('resize', apply);
  window.visualViewport?.addEventListener('resize', apply);
  window.visualViewport?.addEventListener('scroll', apply);
  window.addEventListener('orientationchange', () => window.setTimeout(apply, 100));
}
