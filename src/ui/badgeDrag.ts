/**
 * 可拖动角标/提示浮层通用能力。
 * - makeBadgeDraggable(el, key)：按住即可拖动（Pointer Events，鼠标/触屏通用），
 *   位移超过阈值才算拖动，轻点仍照常触发原有 click（折叠/打开面板不受影响）；
 * - 位置按视口比例持久化到 localStorage（键前缀 rb-ui-badge-pos-），
 *   重进游戏/转屏自动恢复，并始终钳制在屏幕内。
 * 用途：资源下载提示 pill、老板娘新手引导坞——玩家可自行挪开，不再挡住面板文字。
 */

export interface BadgePos {
  /** 0..1 视口宽度比例 */
  x: number;
  /** 0..1 视口高度比例 */
  y: number;
}

const PREFIX = 'rb-ui-badge-pos-';
const DRAG_THRESHOLD_PX = 6;

export function loadBadgePos(key: string): BadgePos | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<BadgePos>;
    if (typeof v.x !== 'number' || typeof v.y !== 'number') return null;
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    return { x: v.x, y: v.y };
  } catch {
    return null;
  }
}

export function saveBadgePos(key: string, pos: BadgePos): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(pos));
  } catch {
    /* 存储不可用时只影响位置记忆，不影响拖动本身 */
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

/**
 * 把比例位置落成具体 left/top（屏幕内钳制），并用内联样式覆盖
 * CSS 默认的居中/贴边定位（如引导坞的 left:50% + translateX(-50%)）。
 */
export function applyBadgePos(el: HTMLElement, pos: BadgePos): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const rect = el.getBoundingClientRect();
  const left = clamp(pos.x * w, 0, Math.max(0, w - rect.width));
  const top = clamp(pos.y * h, 0, Math.max(0, h - rect.height));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.transform = 'none';
}

/* 转屏/窗口缩放时把已持久化的角标拉回屏幕内（顺带清理已从 DOM 摘除的元素） */
const resizeTracked: { el: HTMLElement; key: string }[] = [];
let resizeHandlerBound = false;

function handleResize(): void {
  for (let i = resizeTracked.length - 1; i >= 0; i--) {
    const t = resizeTracked[i]!;
    if (!t.el.isConnected) {
      resizeTracked.splice(i, 1);
      continue;
    }
    const pos = loadBadgePos(t.key);
    if (pos) applyBadgePos(t.el, pos);
  }
}

function suppressNextClick(e: Event): void {
  e.preventDefault();
  e.stopPropagation();
}

/**
 * 让一个 fixed 定位的小浮层可拖动。
 * 拖完立即保存位置；紧随松手的 click 会被吞掉，避免“拖动结束”误触
 * 原有的点击行为（引导坞折叠/展开、下载 pill 打开面板）。
 */
export function makeBadgeDraggable(el: HTMLElement, key: string): void {
  // 触屏上拖动角标时不让页面滚动抢走手势
  el.style.touchAction = 'none';

  if (!resizeHandlerBound) {
    resizeHandlerBound = true;
    window.addEventListener('resize', handleResize);
  }
  if (!resizeTracked.some((t) => t.el === el)) resizeTracked.push({ el, key });

  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let grabDX = 0;
  let grabDY = 0;
  let dragging = false;

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    dragging = false;
  });

  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX)
        return;
      dragging = true;
      try {
        el.setPointerCapture(pointerId);
      } catch {
        /* 个别 WebView 不支持捕获时退化为仅限元素内拖动 */
      }
      // 冻结当前视觉位置为显式 left/top（覆盖 CSS 的居中/贴边规则），
      // 之后随手势移动；记录抓取偏移让角标“跟手”而不是跳到指针左上角
      const rect = el.getBoundingClientRect();
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.top}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.transform = 'none';
      grabDX = startX - rect.left;
      grabDY = startY - rect.top;
    }
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const left = clamp(
      e.clientX - grabDX,
      0,
      Math.max(0, window.innerWidth - rect.width),
    );
    const top = clamp(
      e.clientY - grabDY,
      0,
      Math.max(0, window.innerHeight - rect.height),
    );
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  });

  const endDrag = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const wasDragging = dragging;
    pointerId = -1;
    dragging = false;
    if (!wasDragging) return;
    // 保存为视口比例：转屏/分辨率变化后按比例恢复并重新钳制
    const rect = el.getBoundingClientRect();
    const w = window.innerWidth;
    const h = window.innerHeight;
    saveBadgePos(key, {
      x: w > 0 ? rect.left / w : 0,
      y: h > 0 ? rect.top / h : 0,
    });
    // 松手后浏览器还会补发一次 click，那是“拖动结束”不是“点击”，吞掉
    el.addEventListener('click', suppressNextClick, {
      capture: true,
      once: true,
    });
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
}
