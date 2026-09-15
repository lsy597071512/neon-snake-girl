import { CHARACTER_MAP } from '../data/characters';
import {
  armSilentPortraitVideo,
  applyLivePortraitPoster,
  canPlayLivePortrait,
  getLivePortraitPosterUrl,
  getLivePortraitSecondarySrcs,
  getLivePortraitSrc,
} from './livePortrait';
import { getCharPortraitSrc } from './uiAssets';
import { texUrl } from '../utils/texUrl';

/** 主页看板娘：跟玩家已应用皮肤同步（与营地 AI 穿搭分离） */
const HUB_PORTRAIT_OPTS = { skinChannel: 'player' as const };

function staticHubPortrait(charId: string, imgClass: string, emojiClass: string): string {
  const c = CHARACTER_MAP[charId];
  const src = getCharPortraitSrc(charId, 'front', HUB_PORTRAIT_OPTS);
  if (src) return `<img class="${imgClass}" src="${texUrl(src)}" alt="" />`;
  return `<span class="${emojiClass}">${c?.icon ?? '?'}</span>`;
}

export function clearVideoPoster(video: HTMLVideoElement): void {
  video.removeAttribute('poster');
  video.poster = '';
}

function buildPickerHtml(secondaries: string[]): string {
  return `<div class="hub-live-picker" data-live-picker aria-hidden="true">
        <div class="hub-live-picker-ring" aria-hidden="true"></div>
        <div class="hub-live-picker-list">
          ${secondaries
            .map(
              (_, i) =>
                `<button type="button" class="hub-live-picker-opt" data-live-opt="${i}" tabindex="-1">${i + 1}</button>`,
            )
            .join('')}
        </div>
        <p class="hub-live-picker-hint">按住滑动选择 · 松手播放</p>
      </div>`;
}

type StagePhase = 'idle' | 'out' | 'secondary' | 'in';

const TRANSITION_MS = 480;
const REDUCED_MS = 80;
const HOLD_SHOW_MS = 140;

function transitionMs(): number {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return REDUCED_MS;
  }
  return TRANSITION_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** 主页大立绘舞台：一级循环 + 按住弹出互动选项（松手执行） */
export function renderHubPortraitStage(charId: string, imgClass: string, emojiClass: string): string {
  const primary = getLivePortraitSrc(charId, HUB_PORTRAIT_OPTS);
  if (!primary || !canPlayLivePortrait(primary)) {
    return staticHubPortrait(charId, imgClass, emojiClass);
  }

  const secondaries = getLivePortraitSecondarySrcs(charId, HUB_PORTRAIT_OPTS);
  const hasSecondary = secondaries.length > 0;
  const secondaryListAttr = hasSecondary ? encodeURIComponent(JSON.stringify(secondaries)) : '';
  const pickerHtml = hasSecondary ? buildPickerHtml(secondaries) : '';
  const poster = getLivePortraitPosterUrl(charId, HUB_PORTRAIT_OPTS);
  const posterAttr = poster ? ` poster="${poster}"` : '';

  return `
    <div class="hub-portrait-stage${hasSecondary ? ' has-secondary' : ' has-primary-only'}"
         data-hub-portrait
         data-char-id="${charId}"
         data-has-secondary="${hasSecondary ? '1' : '0'}"
         data-secondary-list="${secondaryListAttr}"
         role="button"
         tabindex="0"
         aria-label="${hasSecondary ? '按住选择互动动画' : '角色立绘'}">
      <div class="hub-portrait-fx" aria-hidden="true"></div>
      <div class="hub-portrait-shimmer" aria-hidden="true"></div>
      <video class="${imgClass} hub-portrait-primary is-awaiting-play"
             data-role="primary"
             data-char-id="${charId}"
             src="${texUrl(primary)}"
             autoplay muted loop playsinline webkit-playsinline disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback" preload="auto"${posterAttr}></video>
      ${
        hasSecondary
          ? `<video class="${imgClass} hub-portrait-secondary is-awaiting-play"
                   data-role="secondary"
                   data-skin-src="${secondaries[0]!}"
                   src="${texUrl(secondaries[0]!)}"
                   hidden
                   muted playsinline webkit-playsinline disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback" preload="metadata"></video>`
          : ''
      }
      ${pickerHtml}
    </div>
  `;
}

function bindPrimaryVideo(video: HTMLVideoElement, charId: string): void {
  if (video.dataset.hubPrimaryBound === '1') return;
  video.dataset.hubPrimaryBound = '1';
  armSilentPortraitVideo(video);
  applyLivePortraitPoster(video, charId, HUB_PORTRAIT_OPTS);

  const fallbackToStatic = () => {
    if (video.dataset.liveFallback === '1') return;
    video.dataset.liveFallback = '1';
    const png = getCharPortraitSrc(charId, 'front', HUB_PORTRAIT_OPTS);
    if (!png) return;
    const img = document.createElement('img');
    img.className = video.className
      .replace(/\s*char-live-portrait\s*/g, ' ')
      .replace(/\s*is-awaiting-play\s*/g, ' ')
      .trim();
    img.src = texUrl(png);
    img.alt = '';
    video.replaceWith(img);
  };

  const tryPlay = () => {
    void video.play().catch(fallbackToStatic);
  };

  video.addEventListener('playing', () => clearVideoPoster(video));
  video.addEventListener('error', fallbackToStatic, { once: true });
  video.addEventListener('canplay', tryPlay, { once: true });
  video.addEventListener('loadeddata', tryPlay);
  tryPlay();
}

/** 交互动画播放中 / 过渡中 / 按住选片时，禁止切角色 */
export function isHubPortraitInteractionLocked(root: ParentNode = document): boolean {
  const stages = root.querySelectorAll<HTMLElement>('[data-hub-portrait]');
  for (const stage of stages) {
    if (stage.dataset.busy === '1') return true;
    const phase = stage.dataset.phase ?? 'idle';
    if (phase !== 'idle') return true;
    if (stage.classList.contains('is-picking')) return true;
  }
  return false;
}

/** 切人/切皮后重置叠层状态，避免静帧+动态叠影 */
export function resetHubPortraitStage(stage: HTMLElement): void {
  stage.dataset.phase = 'idle';
  stage.dataset.busy = '0';
  delete stage.dataset.hotOpt;
  delete stage.dataset.swipeCancel;
  stage.classList.remove('is-picking');

  const primary = stage.querySelector<HTMLVideoElement>('[data-role="primary"]');
  const secondary = stage.querySelector<HTMLVideoElement>('[data-role="secondary"]');
  primary?.classList.remove('is-hidden', 'is-exiting', 'is-entering');
  secondary?.classList.remove('is-exiting', 'is-entering');
  if (secondary) {
    secondary.pause();
    secondary.currentTime = 0;
    secondary.setAttribute('hidden', '');
  }

  stage.querySelector('.hub-portrait-fx')?.classList.remove('is-active');
  stage.querySelector('.hub-portrait-shimmer')?.classList.remove('is-active');
  hidePicker(stage);
}

/** 就地换源时同步互动选项（dataset + 圆盘 DOM） */
export function syncHubPortraitPicker(stage: HTMLElement, secondaries: string[]): void {
  const hasSecondary = secondaries.length > 0;
  stage.dataset.hasSecondary = hasSecondary ? '1' : '0';
  stage.dataset.secondaryList = hasSecondary ? encodeURIComponent(JSON.stringify(secondaries)) : '';
  stage.classList.toggle('has-secondary', hasSecondary);
  stage.classList.toggle('has-primary-only', !hasSecondary);
  stage.setAttribute('aria-label', hasSecondary ? '按住选择互动动画' : '角色立绘');

  const existing = stage.querySelector('[data-live-picker]');
  if (!hasSecondary) {
    existing?.remove();
    delete stage.dataset.pickerBound;
    return;
  }
  delete stage.dataset.pickerBound;
  const html = buildPickerHtml(secondaries);
  if (existing) {
    existing.outerHTML = html;
  } else {
    stage.insertAdjacentHTML('beforeend', html);
  }
}

/** 首次有互动项时补绑按住选择（静态→动态或切到有互动的角色） */
export function ensureHubHoldPicker(stage: HTMLElement): void {
  if (stage.dataset.hasSecondary !== '1') return;
  if (stage.dataset.pickerBound === '1') return;
  bindHoldPicker(stage);
  stage.dataset.pickerBound = '1';
}

function readSecondaryList(stage: HTMLElement): string[] {
  const raw = stage.dataset.secondaryList;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

async function crossfadeToSecondary(stage: HTMLElement, secondarySrc: string): Promise<boolean> {
  const primary = stage.querySelector<HTMLVideoElement>('[data-role="primary"]');
  const secondary = stage.querySelector<HTMLVideoElement>('[data-role="secondary"]');
  const fx = stage.querySelector<HTMLElement>('.hub-portrait-fx');
  const shimmer = stage.querySelector<HTMLElement>('.hub-portrait-shimmer');
  if (!primary || !secondary) return false;

  if (secondary.dataset.skinSrc !== secondarySrc) {
    secondary.dataset.skinSrc = secondarySrc;
    secondary.src = texUrl(secondarySrc);
    secondary.load();
  }

  armSilentPortraitVideo(secondary);

  stage.dataset.phase = 'out';
  fx?.classList.add('is-active');
  shimmer?.classList.add('is-active');
  primary.classList.add('is-exiting');

  await sleep(transitionMs());

  primary.pause();
  primary.classList.add('is-hidden');
  primary.classList.remove('is-exiting');

  secondary.currentTime = 0;
  secondary.classList.add('is-entering');
  secondary.removeAttribute('hidden');
  stage.dataset.phase = 'secondary';

  try {
    await secondary.play();
  } catch {
    fx?.classList.remove('is-active');
    shimmer?.classList.remove('is-active');
    primary.classList.remove('is-hidden');
    void primary.play();
    stage.dataset.phase = 'idle';
    return false;
  }

  await new Promise<void>((resolve) => {
    const onEnd = () => {
      secondary.removeEventListener('ended', onEnd);
      secondary.removeEventListener('error', onEnd);
      resolve();
    };
    secondary.addEventListener('ended', onEnd, { once: true });
    secondary.addEventListener('error', onEnd, { once: true });
  });

  return true;
}

async function crossfadeToPrimary(stage: HTMLElement): Promise<void> {
  const primary = stage.querySelector<HTMLVideoElement>('[data-role="primary"]');
  const secondary = stage.querySelector<HTMLVideoElement>('[data-role="secondary"]');
  const fx = stage.querySelector<HTMLElement>('.hub-portrait-fx');
  const shimmer = stage.querySelector<HTMLElement>('.hub-portrait-shimmer');
  if (!primary || !secondary) return;

  stage.dataset.phase = 'in';
  secondary.classList.add('is-exiting');
  secondary.classList.remove('is-entering');
  fx?.classList.add('is-active');
  shimmer?.classList.add('is-active');

  await sleep(transitionMs());

  secondary.pause();
  secondary.classList.remove('is-exiting', 'is-entering');
  secondary.setAttribute('hidden', '');

  primary.classList.remove('is-hidden');
  primary.classList.add('is-entering');
  primary.currentTime = 0;
  void primary.play();

  await sleep(transitionMs());

  primary.classList.remove('is-entering');
  fx?.classList.remove('is-active');
  shimmer?.classList.remove('is-active');
  stage.dataset.phase = 'idle';
}

async function playSecondaryAt(stage: HTMLElement, index: number): Promise<void> {
  const list = readSecondaryList(stage);
  if (!list.length) return;
  if (stage.dataset.busy === '1') return;
  const phase = (stage.dataset.phase ?? 'idle') as StagePhase;
  if (phase !== 'idle') return;

  const idx = Math.max(0, Math.min(list.length - 1, index));
  stage.dataset.busy = '1';
  try {
    const ok = await crossfadeToSecondary(stage, list[idx]!);
    if (ok) await crossfadeToPrimary(stage);
  } finally {
    stage.dataset.busy = '0';
  }
}

function setHotOption(stage: HTMLElement, index: number | null): void {
  stage.querySelectorAll<HTMLElement>('[data-live-opt]').forEach((btn) => {
    const i = Number(btn.dataset.liveOpt);
    btn.classList.toggle('is-hot', index !== null && i === index);
  });
  stage.dataset.hotOpt = index === null ? '' : String(index);
}

function hitTestOption(stage: HTMLElement, clientX: number, clientY: number): number | null {
  const opts = stage.querySelectorAll<HTMLElement>('[data-live-opt]');
  for (const btn of opts) {
    const r = btn.getBoundingClientRect();
    const pad = 10;
    if (
      clientX >= r.left - pad &&
      clientX <= r.right + pad &&
      clientY >= r.top - pad &&
      clientY <= r.bottom + pad
    ) {
      return Number(btn.dataset.liveOpt);
    }
  }
  // 最近邻：按住滑到附近也算选中
  let best: number | null = null;
  let bestDist = Infinity;
  for (const btn of opts) {
    const r = btn.getBoundingClientRect();
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    const d = (clientX - cx) ** 2 + (clientY - cy) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = Number(btn.dataset.liveOpt);
    }
  }
  return bestDist < 120 * 120 ? best : null;
}

function showPicker(stage: HTMLElement): void {
  const picker = stage.querySelector<HTMLElement>('[data-live-picker]');
  if (!picker) return;
  picker.classList.add('is-open');
  picker.setAttribute('aria-hidden', 'false');
  stage.classList.add('is-picking');
}

function hidePicker(stage: HTMLElement): void {
  const picker = stage.querySelector<HTMLElement>('[data-live-picker]');
  if (!picker) return;
  picker.classList.remove('is-open');
  picker.setAttribute('aria-hidden', 'true');
  stage.classList.remove('is-picking');
  setHotOption(stage, null);
}

function bindHoldPicker(stage: HTMLElement): void {
  if (stage.dataset.hasSecondary !== '1') return;
  if (stage.dataset.pickerBound === '1') return;
  stage.dataset.pickerBound = '1';

  let holding = false;
  let holdTimer: number | null = null;
  let pickerVisible = false;
  let cancelled = false;
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;

  const clearHoldTimer = () => {
    if (holdTimer !== null) {
      window.clearTimeout(holdTimer);
      holdTimer = null;
    }
  };

  const cancelHold = () => {
    cancelled = true;
    holding = false;
    clearHoldTimer();
    pickerVisible = false;
    hidePicker(stage);
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (stage.dataset.busy === '1') return;
    const phase = stage.dataset.phase ?? 'idle';
    if (phase !== 'idle') return;

    holding = true;
    cancelled = false;
    delete stage.dataset.swipeCancel;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();

    holdTimer = window.setTimeout(() => {
      if (!holding || cancelled) return;
      pickerVisible = true;
      showPicker(stage);
      setHotOption(stage, hitTestOption(stage, e.clientX, e.clientY) ?? 0);
    }, HOLD_SHOW_MS);
  };

  const onMove = (e: PointerEvent) => {
    if (!holding || cancelled) return;
    if (pointerId !== null && e.pointerId !== pointerId) return;

    // 横向滑动切角色时，取消按住互动
    if (stage.dataset.swipeCancel === '1') {
      cancelHold();
      return;
    }
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!pickerVisible && Math.abs(dx) >= 56 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      cancelHold();
      return;
    }

    if (!pickerVisible) return;
    setHotOption(stage, hitTestOption(stage, e.clientX, e.clientY));
  };

  const onUp = (e: PointerEvent) => {
    if (!holding && !cancelled) return;
    if (pointerId !== null && e.pointerId !== pointerId) return;

    const wasCancelled = cancelled || stage.dataset.swipeCancel === '1';
    const hot = stage.dataset.hotOpt;
    const selected = hot === '' || hot == null ? null : Number(hot);
    const wasVisible = pickerVisible;

    holding = false;
    clearHoldTimer();
    pickerVisible = false;
    hidePicker(stage);
    delete stage.dataset.swipeCancel;

    try {
      if (pointerId !== null) stage.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    pointerId = null;
    cancelled = false;

    if (!wasCancelled && wasVisible && selected !== null && Number.isFinite(selected)) {
      void playSecondaryAt(stage, selected);
    }
  };

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('lostpointercapture', onUp);

  // 阻止默认 click，避免松手后误触
  stage.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
}

/** 绑定主页立绘舞台：按住选互动动画 */
export function bindHubPortraitStages(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-hub-portrait]').forEach((stage) => {
    if (stage.dataset.hubBound === '1') return;
    stage.dataset.hubBound = '1';
    stage.dataset.phase = 'idle';

    const charId = stage.dataset.charId!;
    const primary = stage.querySelector<HTMLVideoElement>('[data-role="primary"]');
    if (primary) bindPrimaryVideo(primary, charId);

    ensureHubHoldPicker(stage);
    primary?.classList.add('is-interactive');
  });
}
