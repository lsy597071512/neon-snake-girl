/**
 * 对话立绘舞台：默认营地皮肤；有 emotion_pose 时柔和切到情绪动作图。
 * 皮肤↔情绪：偏柔和；情绪↔情绪：按情绪跨度快/慢。
 */
import { CHARACTER_MAP } from '../data/characters';
import {
  EMOTION_POSE_CATALOG,
  emotionPosePath,
  getEmotionPoseEntry,
  type DialogueEmotion,
} from '../data/characterEmotionPoses';
import { getCharPortraitSrc } from './uiAssets';
import {
  armSilentPortraitVideo,
  applyLivePortraitPoster,
  getLivePortraitPosterUrl,
  getLivePortraitSecondarySrcs,
  getLivePortraitSrc,
  resolveCampShowerPortraitPlayback,
  type ShowerCampPortraitPlan,
} from './livePortrait';
import { getAiLiving } from '../ai/livingService';
import { setBathIntimateIntroDone } from '../ai/bathIntimateConsent';
import { saveManager } from '../core/SaveManager';
import { texUrl } from '../utils/texUrl';

const CAMP_OPTS = { skinChannel: 'camp' as const };

/** 情绪动作图展示：最短 2s、最长 3s（commit）；preview/sticky 逻辑另算 */
export const EMOTION_POSE_HOLD_MS_MIN = 2000;
export const EMOTION_POSE_HOLD_MS_MAX = 3000;
/** 默认居中值（兼容旧引用） */
export const EMOTION_POSE_HOLD_MS = 2500;

const FAMILY_DIST: Record<DialogueEmotion, number> = {
  joy: 0,
  surprise: 1,
  thinking: 2,
  neutral: 2,
  fear: 3,
  sadness: 4,
  disgust: 5,
  anger: 6,
};

/** commit 展示时长：按情绪强弱落在 2–3s */
export function resolveEmotionPoseHoldMs(poseKey?: string | null, emotion?: string): number {
  const entry = poseKey ? getEmotionPoseEntry(poseKey) : null;
  const fam =
    entry?.dialogueEmotion ??
    (emotion && emotion in FAMILY_DIST ? (emotion as DialogueEmotion) : 'neutral');
  let ms = 2400;
  if (fam === 'anger' || fam === 'fear' || fam === 'surprise') ms = 3000;
  else if (fam === 'joy' || fam === 'sadness') ms = 2600;
  else if (fam === 'disgust') ms = 2500;
  else if (fam === 'thinking') ms = 2200;
  else ms = 2000; // neutral
  return Math.max(EMOTION_POSE_HOLD_MS_MIN, Math.min(EMOTION_POSE_HOLD_MS_MAX, ms));
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

function skinMediaHtml(characterId: string): string {
  const showerPlan = resolveCampShowerPortraitPlayback(characterId);
  const live = showerPlan?.src ?? getLivePortraitSrc(characterId, CAMP_OPTS);
  if (live) {
    const poster = getLivePortraitPosterUrl(characterId, CAMP_OPTS);
    const posterAttr = poster ? ` poster="${poster}"` : '';
    const loopAttr = showerPlan ? (showerPlan.loop ? ' loop' : '') : ' loop';
    const phaseAttr = showerPlan ? ` data-bath-phase="${showerPlan.phase}"` : '';
    return `<video class="ai-dlg-layer-media is-awaiting-play" src="${texUrl(live)}" muted${loopAttr} playsinline autoplay disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback" preload="auto"${posterAttr}${phaseAttr} data-ai-live-portrait data-skin-channel="camp" data-layer="skin"></video>`;
  }
  const def = CHARACTER_MAP[characterId];
  const src = texUrl(getCharPortraitSrc(characterId, 'front', CAMP_OPTS) || def?.icon || '');
  return `<img class="ai-dlg-layer-media" src="${src}" alt="" data-layer="skin" />`;
}

function bindShowerIntroToLoop(video: HTMLVideoElement, characterId: string): void {
  const onEnded = () => {
    video.removeEventListener('ended', onEnded);
    if (video.dataset.bathPhase !== 'intro') return;
    const living = getAiLiving();
    setBathIntimateIntroDone(living, characterId, true);
    saveManager.mutate((d) => {
      d.aiLiving = living;
    });
    const loopPlan = resolveCampShowerPortraitPlayback(characterId, living);
    if (!loopPlan || loopPlan.phase !== 'loop') return;
    const loopUrl = texUrl(loopPlan.src);
    video.dataset.bathPhase = 'loop';
    video.loop = true;
    video.onended = null;
    if (video.src !== loopUrl) {
      video.src = loopUrl;
      video.load();
    }
    void video.play().catch(() => {});
  };
  video.addEventListener('ended', onEnded);
}

function applyCampPortraitVideo(
  video: HTMLVideoElement,
  characterId: string,
  plan: ShowerCampPortraitPlan | null,
): void {
  armSilentPortraitVideo(video);
  const live = plan?.src ?? getLivePortraitSrc(characterId, CAMP_OPTS);
  if (!live) return;

  const nextUrl = texUrl(live);
  const nextPhase = plan?.phase ?? 'loop';
  const nextLoop = plan?.loop ?? true;

  if (
    video.src === nextUrl &&
    video.dataset.bathPhase === nextPhase &&
    video.loop === nextLoop &&
    (nextPhase !== 'intro' || !video.ended)
  ) {
    if (nextPhase === 'intro' && video.paused && !video.ended) {
      void video.play().catch(() => {});
    }
    return;
  }

  video.onended = null;
  video.dataset.bathPhase = nextPhase;
  video.loop = nextLoop;

  if (nextPhase === 'intro') {
    bindShowerIntroToLoop(video, characterId);
  }

  applyLivePortraitPoster(video, characterId, CAMP_OPTS);

  if (video.src !== nextUrl) {
    video.pause();
    video.src = nextUrl;
    video.load();
  }
  void video.play().catch(() => {});
}

/** 初始 HTML：双层舞台，默认显示皮肤 */

function buildDialoguePickerHtml(secondaries: string[]): string {
  return `<div class="hub-live-picker ai-dlg-live-picker" data-live-picker aria-hidden="true">
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

function readDialogueSecondaryList(stage: HTMLElement): string[] {
  const raw = stage.dataset.secondaryList;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function transitionDialogueMs(): number {
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 80;
  } catch {
    /* ignore */
  }
  return 480;
}

function syncDialogueSkinPicker(stage: HTMLElement, secondaries: string[]): void {
  const hasSecondary = secondaries.length > 0;
  stage.dataset.hasSecondary = hasSecondary ? '1' : '0';
  stage.dataset.secondaryList = hasSecondary ? encodeURIComponent(JSON.stringify(secondaries)) : '';
  stage.classList.toggle('has-secondary', hasSecondary);

  let secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
  if (hasSecondary) {
    if (!secondary) {
      const skinLayer = stage.querySelector<HTMLElement>('[data-role="skin"]');
      if (skinLayer) {
        skinLayer.insertAdjacentHTML(
          'beforeend',
          `<video class="ai-dlg-layer-media ai-dlg-skin-secondary is-awaiting-play"
                   data-role="skin-secondary"
                   data-skin-src="${secondaries[0]!}"
                   src="${texUrl(secondaries[0]!)}"
                   hidden
                   muted playsinline webkit-playsinline disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback" preload="metadata"></video>`,
        );
        secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
        if (secondary) armSilentPortraitVideo(secondary);
      }
    } else if (secondary.dataset.skinSrc !== secondaries[0]) {
      secondary.dataset.skinSrc = secondaries[0]!;
      secondary.src = texUrl(secondaries[0]!);
      secondary.load();
    }
  } else {
    secondary?.remove();
  }

  const existing = stage.querySelector('[data-live-picker]');
  if (!hasSecondary) {
    existing?.remove();
    delete stage.dataset.pickerBound;
    return;
  }
  const html = buildDialoguePickerHtml(secondaries);
  if (existing) existing.outerHTML = html;
  else stage.insertAdjacentHTML('beforeend', html);
  delete stage.dataset.pickerBound;
}

function primarySkinVideo(stage: HTMLElement): HTMLVideoElement | null {
  return stage.querySelector<HTMLVideoElement>(
    '[data-role="skin"] video[data-ai-live-portrait], [data-role="skin"] video.ai-dlg-layer-media:not([data-role="skin-secondary"])',
  );
}

async function waitVideoCanPlay(video: HTMLVideoElement, timeoutMs = 2500): Promise<void> {
  if (video.readyState >= 2) return;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('canplay', finish);
      video.removeEventListener('loadeddata', finish);
      video.removeEventListener('error', finish);
      resolve();
    };
    video.addEventListener('canplay', finish, { once: true });
    video.addEventListener('loadeddata', finish, { once: true });
    video.addEventListener('error', finish, { once: true });
    window.setTimeout(finish, timeoutMs);
  });
}

async function crossfadeDialogueToSecondary(
  stage: HTMLElement,
  secondarySrc: string,
  opts?: { sticky?: boolean },
): Promise<boolean> {
  const sticky = !!opts?.sticky;
  const primary = primarySkinVideo(stage);
  let secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
  const fx = stage.querySelector<HTMLElement>('.ai-dlg-portrait-fx');
  if (!primary) return false;
  if (!secondary) {
    syncDialogueSkinPicker(stage, readDialogueSecondaryList(stage));
    secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
  }
  if (!secondary) return false;

  const sameSrc = secondary.dataset.skinSrc === secondarySrc;
  if (!sameSrc) {
    secondary.dataset.skinSrc = secondarySrc;
    secondary.src = texUrl(secondarySrc);
    secondary.load();
  }
  armSilentPortraitVideo(secondary);
  secondary.loop = sticky;
  // 先缓冲再切层，避免 primary 已藏、secondary 未就绪 → 立绘「卡没」
  await waitVideoCanPlay(secondary);

  stage.dataset.skinPhase = 'out';
  fx?.classList.add('is-active');
  primary.classList.add('is-exiting');
  await new Promise((r) => window.setTimeout(r, transitionDialogueMs()));

  primary.pause();
  primary.classList.add('is-hidden');
  primary.classList.remove('is-exiting');

  try {
    if (!sameSrc || secondary.currentTime > 0.05) {
      secondary.currentTime = 0;
    }
  } catch {
    /* ignore seek race */
  }
  secondary.classList.add('is-entering');
  showDialogueSecondaryHard(secondary);
  stage.dataset.skinPhase = sticky ? 'discipline-sticky' : 'secondary';
  if (sticky) stage.dataset.disciplineStickyClip = secondarySrc;

  try {
    await secondary.play();
  } catch {
    fx?.classList.remove('is-active');
    primary.classList.remove('is-hidden');
    void primary.play().catch(() => {});
    stage.dataset.skinPhase = 'idle';
    delete stage.dataset.disciplineStickyClip;
    delete stage.dataset.disciplinePoseIndex;
    hideDialogueSecondaryHard(secondary);
    return false;
  }

  if (sticky) {
    secondary.classList.remove('is-entering');
    fx?.classList.remove('is-active');
    return true;
  }

  await new Promise<void>((resolve) => {
    const onEnd = () => {
      secondary!.removeEventListener('ended', onEnd);
      secondary!.removeEventListener('error', onEnd);
      resolve();
    };
    secondary.addEventListener('ended', onEnd, { once: true });
    secondary.addEventListener('error', onEnd, { once: true });
  });
  return true;
}

function hideDialogueSecondaryHard(secondary: HTMLVideoElement | null | undefined): void {
  if (!secondary) return;
  secondary.pause();
  secondary.loop = false;
  secondary.classList.remove('is-entering', 'is-exiting');
  secondary.classList.add('is-hidden');
  secondary.setAttribute('hidden', '');
  secondary.setAttribute('aria-hidden', 'true');
}

function showDialogueSecondaryHard(secondary: HTMLVideoElement): void {
  secondary.classList.remove('is-hidden', 'is-exiting');
  secondary.removeAttribute('hidden');
  secondary.setAttribute('aria-hidden', 'false');
}

/** 测试/断言用：idle 时不得与 secondary 同时可见 */
export function isDialogueSkinOverlapFree(stage: HTMLElement): boolean {
  const primary = primarySkinVideo(stage);
  const secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
  if (!secondary) return true;
  const secHidden =
    secondary.hasAttribute('hidden') ||
    secondary.classList.contains('is-hidden') ||
    secondary.getAttribute('aria-hidden') === 'true';
  if (secHidden) return true;
  // secondary 可见时 primary 必须完全让出
  if (!primary) return true;
  return primary.classList.contains('is-hidden');
}

async function crossfadeDialogueToPrimary(stage: HTMLElement): Promise<void> {
  const primary = primarySkinVideo(stage);
  const secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
  const fx = stage.querySelector<HTMLElement>('.ai-dlg-portrait-fx');
  if (!primary && !secondary) return;

  // 先清粘住标记，避免情绪图回退时把姿势再拉回来叠在 idle 上
  delete stage.dataset.disciplineStickyClip;
  delete stage.dataset.disciplinePoseIndex;
  stage.dataset.skinPhase = 'idle';

  // 立刻硬藏 secondary —— 禁止「等过渡」期间双层同显
  hideDialogueSecondaryHard(secondary);

  if (primary) {
    primary.classList.remove('is-hidden', 'is-exiting');
    primary.classList.add('is-entering');
    armSilentPortraitVideo(primary);
    try {
      primary.currentTime = 0;
    } catch {
      /* ignore */
    }
    void primary.play().catch(() => {});
  }
  fx?.classList.add('is-active');
  await new Promise((r) => window.setTimeout(r, transitionDialogueMs()));
  primary?.classList.remove('is-entering');
  fx?.classList.remove('is-active');
  hideDialogueSecondaryHard(secondary);
}

/** 播放当前营地皮肤的 _1/_2…（1-based）；仅当前穿着，禁止跨套；播完回 idle */
export async function playDialogueSkinClip(
  stage: HTMLElement,
  clip1Based: number,
): Promise<boolean> {
  if (stage.dataset.mode === 'pose') {
    await restoreDialogueSkin(stage, { softMs: 120 });
  }
  const list = readDialogueSecondaryList(stage);
  if (!list.length) return false;
  if (stage.dataset.skinBusy === '1') return false;
  const idx = Math.max(0, Math.min(list.length - 1, Math.floor(clip1Based) - 1));
  stage.dataset.skinBusy = '1';
  try {
    const ok = await crossfadeDialogueToSecondary(stage, list[idx]!);
    if (ok) await crossfadeDialogueToPrimary(stage);
    return ok;
  } finally {
    stage.dataset.skinBusy = '0';
  }
}

/**
 * 小黑屋专用：粘住姿势循环（null=回 idle 默认态）。
 * 不会在 ended 后自动回 primary。
 */
export async function setDialogueDisciplinePose(
  stage: HTMLElement,
  clip1Based: number | null,
): Promise<boolean> {
  if (stage.dataset.mode === 'pose') {
    await restoreDialogueSkin(stage, { softMs: 120 });
  }
  if (stage.dataset.skinBusy === '1') {
    // 忙碌时排队最终态，避免并发交叉淡入留下双层
    stage.dataset.disciplinePosePending =
      clip1Based == null || clip1Based <= 0 ? 'idle' : String(Math.floor(clip1Based));
    return false;
  }
  stage.dataset.skinBusy = '1';
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  stage.dataset.disciplinePoseToken = token;
  try {
    if (clip1Based == null || clip1Based <= 0) {
      // 先清标记再切层，防止情绪图回退把姿势叠回来
      delete stage.dataset.disciplinePoseIndex;
      delete stage.dataset.disciplineStickyClip;
      const secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
      hideDialogueSecondaryHard(secondary);
      if (stage.dataset.disciplinePoseToken !== token) return false;
      if (stage.dataset.skinPhase === 'discipline-sticky' || stage.dataset.skinPhase === 'out') {
        await crossfadeDialogueToPrimary(stage);
      } else {
        const primary = primarySkinVideo(stage);
        if (primary) {
          primary.classList.remove('is-hidden', 'is-exiting');
          armSilentPortraitVideo(primary);
          void primary.play().catch(() => {});
        }
        hideDialogueSecondaryHard(secondary);
        stage.dataset.skinPhase = 'idle';
      }
      if (stage.dataset.disciplinePoseToken !== token) return false;
      hideDialogueSecondaryHard(
        stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]'),
      );
      return true;
    }
    const list = readDialogueSecondaryList(stage);
    if (!list.length) return false;
    const idx = Math.max(0, Math.min(list.length - 1, Math.floor(clip1Based) - 1));
    const want = list[idx]!;
    stage.dataset.disciplinePoseIndex = String(idx + 1);
    // 已在同一粘住姿势且仍在播：禁止重 load，避免卡顿/闪没
    if (
      stage.dataset.skinPhase === 'discipline-sticky' &&
      stage.dataset.disciplineStickyClip === want
    ) {
      const secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
      if (secondary && !secondary.paused && secondary.readyState >= 2) {
        return true;
      }
      if (secondary) {
        armSilentPortraitVideo(secondary);
        secondary.loop = true;
        showDialogueSecondaryHard(secondary);
        try {
          await secondary.play();
          return true;
        } catch {
          /* fall through to full crossfade */
        }
      }
    }
    return await crossfadeDialogueToSecondary(stage, want, { sticky: true });
  } finally {
    stage.dataset.skinBusy = '0';
    const pending = stage.dataset.disciplinePosePending;
    if (pending != null) {
      delete stage.dataset.disciplinePosePending;
      queueMicrotask(() => {
        if (pending === 'idle') {
          void setDialogueDisciplinePose(stage, null);
          return;
        }
        const n = Number(pending);
        void setDialogueDisciplinePose(stage, Number.isFinite(n) && n > 0 ? n : null);
      });
    }
  }
}

/** 当前皮肤层是否已与 characterId 对齐（避免每轮对话整层重建导致 webm 卡顿） */
export function dialogueSkinMatchesCharacter(
  stage: HTMLElement,
  characterId: string,
): boolean {
  if (stage.dataset.characterId !== characterId) return false;
  const live = getLivePortraitSrc(characterId, CAMP_OPTS);
  const primary = primarySkinVideo(stage);
  if (live) {
    if (!primary) return false;
    const src = primary.currentSrc || primary.src || '';
    const rel = live.replace(/^\.\//, '');
    if (!src.includes(rel.split('/').pop() || rel)) return false;
  } else if (!stage.querySelector('[data-role="skin"] img')) {
    return false;
  }
  const wantSecs = getLivePortraitSecondarySrcs(characterId, CAMP_OPTS);
  const haveSecs = readDialogueSecondaryList(stage);
  if (wantSecs.length !== haveSecs.length) return false;
  for (let i = 0; i < wantSecs.length; i++) {
    if (wantSecs[i] !== haveSecs[i]) return false;
  }
  return true;
}

function hideDialoguePicker(stage: HTMLElement): void {
  const picker = stage.querySelector<HTMLElement>('[data-live-picker]');
  picker?.classList.remove('is-open');
  picker?.setAttribute('aria-hidden', 'true');
  stage.classList.remove('is-picking');
  stage.querySelectorAll('[data-live-opt]').forEach((el) => el.classList.remove('is-hot'));
  delete stage.dataset.hotOpt;
}

function bindDialogueHoldPicker(stage: HTMLElement): void {
  if (stage.dataset.hasSecondary !== '1') return;
  if (stage.dataset.pickerBound === '1') return;
  stage.dataset.pickerBound = '1';

  let holding = false;
  let holdTimer: number | null = null;
  let pickerVisible = false;
  let cancelled = false;
  let pointerId: number | null = null;

  const clearHoldTimer = () => {
    if (holdTimer !== null) {
      window.clearTimeout(holdTimer);
      holdTimer = null;
    }
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (stage.dataset.skinBusy === '1') return;
    if (stage.dataset.mode !== 'skin') return;
    if ((stage.dataset.skinPhase ?? 'idle') !== 'idle') return;
    if ((e.target as HTMLElement).closest('[data-live-picker]')) return;

    holding = true;
    cancelled = false;
    pointerId = e.pointerId;
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    e.preventDefault();
    clearHoldTimer();
    holdTimer = window.setTimeout(() => {
      if (!holding || cancelled) return;
      pickerVisible = true;
      const picker = stage.querySelector<HTMLElement>('[data-live-picker]');
      picker?.classList.add('is-open');
      picker?.setAttribute('aria-hidden', 'false');
      stage.classList.add('is-picking');
    }, 140);
  };

  const onMove = (e: PointerEvent) => {
    if (!holding || !pickerVisible) return;
    const opts = stage.querySelectorAll<HTMLElement>('[data-live-opt]');
    let hot: number | null = null;
    let best = Infinity;
    for (const btn of opts) {
      const r = btn.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      const d = (e.clientX - cx) ** 2 + (e.clientY - cy) ** 2;
      if (d < best) {
        best = d;
        hot = Number(btn.dataset.liveOpt);
      }
    }
    if (best > 120 * 120) hot = null;
    opts.forEach((btn) => {
      const i = Number(btn.dataset.liveOpt);
      btn.classList.toggle('is-hot', hot !== null && i === hot);
    });
    stage.dataset.hotOpt = hot === null ? '' : String(hot);
  };

  const onUp = () => {
    if (!holding) return;
    holding = false;
    clearHoldTimer();
    const hot = stage.dataset.hotOpt ? Number(stage.dataset.hotOpt) : null;
    const wasOpen = pickerVisible;
    pickerVisible = false;
    hideDialoguePicker(stage);
    if (pointerId != null) {
      try {
        stage.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
      pointerId = null;
    }
    if (wasOpen && hot != null && !cancelled) {
      void playDialogueSkinClip(stage, hot + 1);
    }
  };

  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', () => {
    cancelled = true;
    onUp();
  });
}

export function ensureDialogueHoldPicker(stage: HTMLElement): void {
  if (stage.dataset.hasSecondary !== '1') return;
  if (stage.dataset.pickerBound === '1') return;
  bindDialogueHoldPicker(stage);
}

export function bindDialoguePortraitInteractions(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-dialogue-portrait-stage]').forEach((stage) => {
    const characterId = stage.dataset.characterId;
    if (!characterId) return;
    const secondaries = getLivePortraitSecondarySrcs(characterId, CAMP_OPTS);
    syncDialogueSkinPicker(stage, secondaries);
    ensureDialogueHoldPicker(stage);
  });
}

export function buildDialoguePortraitStageHtml(characterId: string): string {
  const secondaries = getLivePortraitSecondarySrcs(characterId, CAMP_OPTS);
  const hasSecondary = secondaries.length > 0;
  const secondaryListAttr = hasSecondary ? encodeURIComponent(JSON.stringify(secondaries)) : '';
  const secondaryVideo = hasSecondary
    ? `<video class="ai-dlg-layer-media ai-dlg-skin-secondary is-awaiting-play"
                   data-role="skin-secondary"
                   data-skin-src="${secondaries[0]!}"
                   src="${texUrl(secondaries[0]!)}"
                   hidden
                   muted playsinline webkit-playsinline disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback" preload="metadata"></video>`
    : '';
  const pickerHtml = hasSecondary ? buildDialoguePickerHtml(secondaries) : '';
  return `
    <div class="ai-dlg-portrait-stage is-skin${hasSecondary ? ' has-secondary' : ''}"
         data-dialogue-portrait-stage
         data-character-id="${characterId}"
         data-mode="skin"
         data-pose=""
         data-has-secondary="${hasSecondary ? '1' : '0'}"
         data-secondary-list="${secondaryListAttr}"
         data-skin-phase="idle">
      <div class="ai-dlg-layer ai-dlg-layer-skin is-active" data-role="skin">
        ${skinMediaHtml(characterId)}
        ${secondaryVideo}
      </div>
      <div class="ai-dlg-layer ai-dlg-layer-pose" data-role="pose" aria-hidden="true">
        <img class="ai-dlg-layer-media" data-pose-img alt="" hidden />
      </div>
      <div class="ai-dlg-portrait-fx" aria-hidden="true"></div>
      ${pickerHtml}
    </div>
  `;
}

function playStageVideos(stage: HTMLElement): void {
  stage.querySelectorAll<HTMLVideoElement>('[data-ai-live-portrait]').forEach((v) => {
    const characterId = stage.dataset.characterId;
    if (characterId) {
      applyCampPortraitVideo(v, characterId, resolveCampShowerPortraitPlayback(characterId));
    } else {
      void v.play().catch(() => {});
    }
  });
}

/** 清掉互动二次层与隐藏态，避免换皮/离房后双视频叠影或立绘「消失」 */
function resetDialogueSkinVisibility(stage: HTMLElement): void {
  stage.dataset.skinBusy = '0';
  stage.dataset.skinPhase = 'idle';
  delete stage.dataset.disciplineStickyClip;
  delete stage.dataset.disciplinePoseIndex;
  const primary = primarySkinVideo(stage);
  primary?.classList.remove('is-hidden', 'is-exiting', 'is-entering');
  hideDialogueSecondaryHard(stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]'));
}

/**
 * 刷新皮肤层（换装后回到 skin 模式）。
 * 必须重建 secondary 列表并复位可见性——保留旧皮 secondary 会导致多皮肤重叠。
 */
export function refreshDialogueSkinLayer(stage: HTMLElement, characterId: string): void {
  const skin = stage.querySelector<HTMLElement>('[data-role="skin"]');
  if (!skin) return;

  clearPoseHoldTimer(stage);
  const poseLayer = stage.querySelector<HTMLElement>('[data-role="pose"]');
  const poseImg = stage.querySelector<HTMLImageElement>('[data-pose-img]');
  if (poseLayer) {
    poseLayer.classList.remove('is-active', 'is-entering');
    poseLayer.setAttribute('aria-hidden', 'true');
  }
  if (poseImg) {
    poseImg.removeAttribute('src');
    poseImg.setAttribute('hidden', '');
  }
  skin.classList.add('is-active');
  stage.classList.remove('is-pose', 'is-crossfading');
  stage.classList.add('is-skin');
  stage.dataset.mode = 'skin';
  stage.dataset.pose = '';

  resetDialogueSkinVisibility(stage);

  const secondaries = getLivePortraitSecondarySrcs(characterId, CAMP_OPTS);
  const hasSecondary = secondaries.length > 0;
  stage.classList.toggle('has-secondary', hasSecondary);
  stage.dataset.hasSecondary = hasSecondary ? '1' : '0';
  stage.dataset.secondaryList = hasSecondary
    ? encodeURIComponent(JSON.stringify(secondaries))
    : '';

  // 整层重建：旧皮 secondary / 隐藏的 primary 一并丢掉
  skin.innerHTML =
    skinMediaHtml(characterId) +
    (hasSecondary
      ? `<video class="ai-dlg-layer-media ai-dlg-skin-secondary is-awaiting-play"
                   data-role="skin-secondary"
                   data-skin-src="${secondaries[0]!}"
                   src="${texUrl(secondaries[0]!)}"
                   hidden
                   muted playsinline webkit-playsinline disablepictureinpicture controlslist="nodownload nofullscreen noremoteplayback" preload="metadata"></video>`
      : '');

  playStageVideos(stage);
  syncDialogueSkinPicker(stage, secondaries);
  ensureDialogueHoldPicker(stage);
}

export type ApplyPoseOpts = {
  /** 粗粒度 emotion，辅助切换速度 */
  emotion?: string;
  /** 强制时长 ms（调试） */
  durationMs?: number;
/**
 * commit=2–3s 自动回皮肤（默认，LLM 定稿）
 * sticky=不自动回（聆听中）
 * preview=较短 hold（ASR 即时反应）
 */
  hold?: 'commit' | 'sticky' | 'preview';
  /** 覆盖 hold 时长 */
  holdMs?: number;
};

/**
 * 根据情绪跨度决定 pose→pose 时长；skin→pose 始终偏柔和。
 */
export function resolvePoseTransitionMs(
  fromPose: string | undefined,
  toPose: string,
  mode: 'skin' | 'pose',
): number {
  if (prefersReducedMotion()) return 80;
  if (mode === 'skin' || !fromPose) return 560;
  if (fromPose === toPose) return 0;

  const a = getEmotionPoseEntry(fromPose)?.dialogueEmotion ?? 'neutral';
  const b = getEmotionPoseEntry(toPose)?.dialogueEmotion ?? 'neutral';
  const dist = Math.abs((FAMILY_DIST[a] ?? 2) - (FAMILY_DIST[b] ?? 2));

  if (a === b) return 160;
  if (dist <= 1) return 220;
  if (dist <= 2) return 320;
  if (dist <= 4) return 420;
  return 520;
}

function setStageDuration(stage: HTMLElement, ms: number): void {
  stage.style.setProperty('--ai-dlg-xfade-ms', `${ms}ms`);
}

function clearPoseHoldTimer(stage: HTMLElement): void {
  const id = stage.dataset.poseHoldTimer;
  if (id) {
    window.clearTimeout(Number(id));
    delete stage.dataset.poseHoldTimer;
  }
}

/** 展示情绪图后按 hold 策略回皮肤（新一轮会重新切过来） */
function schedulePoseHoldRevert(
  stage: HTMLElement,
  opts: {
    hold?: ApplyPoseOpts['hold'];
    holdMs?: number;
    poseKey?: string | null;
    emotion?: string;
  } = {},
): void {
  clearPoseHoldTimer(stage);
  const mode = opts.hold ?? 'commit';
  if (mode === 'sticky') {
    stage.dataset.poseHoldMode = 'sticky';
    return;
  }
  const ms =
    opts.holdMs ??
    (mode === 'preview'
      ? Math.min(EMOTION_POSE_HOLD_MS_MIN, 1400)
      : resolveEmotionPoseHoldMs(opts.poseKey, opts.emotion));
  stage.dataset.poseHoldMode = mode;
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  stage.dataset.poseHoldToken = token;
  const timer = window.setTimeout(() => {
    if (stage.dataset.poseHoldToken !== token) return;
    if (!document.body.contains(stage)) return;
    if (stage.dataset.mode !== 'pose') return;
    void restoreDialogueSkin(stage, { softMs: 280 });
  }, ms);
  stage.dataset.poseHoldTimer = String(timer);
}

/**
 * 对话回合：有 emotion_pose → 隐藏皮肤显示情绪图；无资源则保持/回到皮肤。
 * 情绪图停留 2–3 秒后自动回皮肤。
 */
export async function applyDialogueEmotionPose(
  stage: HTMLElement,
  characterId: string,
  poseKey: string | undefined | null,
  opts: ApplyPoseOpts = {},
): Promise<void> {
  if (stage.dataset.busy === '1') {
    stage.dataset.busy = '0';
  }
  stage.dataset.busy = '1';
  stage.dataset.characterId = characterId;
  clearPoseHoldTimer(stage);

  const poseLayer = stage.querySelector<HTMLElement>('[data-role="pose"]');
  const skinLayer = stage.querySelector<HTMLElement>('[data-role="skin"]');
  const poseImg = stage.querySelector<HTMLImageElement>('[data-pose-img]');
  const fx = stage.querySelector<HTMLElement>('.ai-dlg-portrait-fx');
  if (!poseLayer || !skinLayer || !poseImg) {
    stage.dataset.busy = '0';
    return;
  }

  const path = poseKey ? emotionPosePath(characterId, poseKey) : null;
  const url = path ? texUrl(path) : null;

  if (!url || !poseKey) {
    await fadeToSkin(stage, skinLayer, poseLayer, poseImg, fx);
    stage.dataset.busy = '0';
    return;
  }

  const fromPose = stage.dataset.pose || undefined;
  const mode = (stage.dataset.mode as 'skin' | 'pose') || 'skin';
  const ms =
    opts.durationMs ??
    resolvePoseTransitionMs(fromPose, poseKey, mode === 'pose' ? 'pose' : 'skin');

  const holdOpts = {
    hold: opts.hold,
    holdMs: opts.holdMs,
    poseKey,
    emotion: opts.emotion,
  };

  if (mode === 'pose' && fromPose === poseKey && poseImg.src) {
    // 同表情再触发：刷新 hold，不重切图
    schedulePoseHoldRevert(stage, holdOpts);
    stage.dataset.busy = '0';
    return;
  }

  setStageDuration(stage, Math.max(ms, 1));
  fx?.classList.add('is-active');

  const loadPose = () =>
    new Promise<void>((resolve) => {
      const fileHint = url.split('/').pop() || '';
      if (poseImg.getAttribute('src')?.includes(fileHint) && poseImg.complete) {
        resolve();
        return;
      }
      const onDone = () => {
        poseImg.removeEventListener('load', onDone);
        poseImg.removeEventListener('error', onDone);
        resolve();
      };
      poseImg.addEventListener('load', onDone, { once: true });
      poseImg.addEventListener('error', onDone, { once: true });
      poseImg.hidden = false;
      poseImg.src = url;
      if (poseImg.complete) onDone();
    });

  if (mode === 'skin') {
    await loadPose();
    stage.classList.remove('is-skin');
    stage.classList.add('is-pose', 'is-crossfading');
    poseLayer.classList.add('is-entering');
    skinLayer.classList.add('is-exiting');
    skinLayer.classList.remove('is-active');
    poseLayer.classList.add('is-active');
    poseLayer.setAttribute('aria-hidden', 'false');
    skinLayer.querySelectorAll('video').forEach((v) => v.pause());
    await sleep(ms);
    skinLayer.classList.remove('is-exiting');
    poseLayer.classList.remove('is-entering');
    stage.classList.remove('is-crossfading');
    stage.dataset.mode = 'pose';
  } else {
    // 先淡出旧情绪图，再换源淡入（同族快、跨族慢）
    const outMs = Math.min(Math.max(Math.floor(ms * 0.4), 60), 200);
    const inMs = Math.max(ms - outMs, 80);
    stage.classList.add('is-crossfading', 'is-pose-swap');
    poseImg.classList.add('is-pose-swap-out');
    await sleep(outMs);
    await loadPose();
    poseImg.classList.remove('is-pose-swap-out');
    poseImg.classList.add('is-pose-swap-in');
    await sleep(inMs);
    poseImg.classList.remove('is-pose-swap-in');
    stage.classList.remove('is-crossfading', 'is-pose-swap');
  }

  stage.dataset.pose = poseKey;
  stage.dataset.mode = 'pose';
  stage.classList.add('is-pose');
  stage.classList.remove('is-skin');
  fx?.classList.remove('is-active');
  schedulePoseHoldRevert(stage, holdOpts);
  stage.dataset.busy = '0';
}

async function fadeToSkin(
  stage: HTMLElement,
  skinLayer: HTMLElement,
  poseLayer: HTMLElement,
  poseImg: HTMLImageElement,
  fx: HTMLElement | null | undefined,
  softMs?: number,
): Promise<void> {
  clearPoseHoldTimer(stage);
  if (stage.dataset.mode === 'skin') {
    // 情绪图已关但仍可能需续播小黑屋粘住姿势
    await resumeDisciplineSkinPlayback(stage);
    return;
  }
  const ms =
    softMs ??
    (prefersReducedMotion() ? 80 : 480);
  setStageDuration(stage, ms);
  fx?.classList.add('is-active');
  stage.classList.add('is-crossfading');
  poseLayer.classList.add('is-exiting');
  poseLayer.classList.remove('is-active');
  skinLayer.classList.add('is-entering', 'is-active');
  await resumeDisciplineSkinPlayback(stage);
  await sleep(ms);
  poseLayer.classList.remove('is-exiting');
  poseLayer.setAttribute('aria-hidden', 'true');
  poseImg.hidden = true;
  poseImg.removeAttribute('src');
  skinLayer.classList.remove('is-entering');
  stage.classList.remove('is-crossfading', 'is-pose');
  stage.classList.add('is-skin');
  stage.dataset.mode = 'skin';
  stage.dataset.pose = '';
  fx?.classList.remove('is-active');
}

/**
 * 情绪图结束后回到皮肤层：若小黑屋粘住姿势仍有效则续播 secondary，否则播 idle primary。
 * 避免「情绪图盖住姿势 → 回皮肤只播 idle → 姿势卡没」。
 */
async function resumeDisciplineSkinPlayback(stage: HTMLElement): Promise<void> {
  const primary = primarySkinVideo(stage);
  const secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
  const stickySrc = stage.dataset.disciplineStickyClip || '';
  const poseIdx = Number(stage.dataset.disciplinePoseIndex || '0');

  if (stickySrc && poseIdx > 0 && secondary) {
    if (secondary.dataset.skinSrc !== stickySrc) {
      secondary.dataset.skinSrc = stickySrc;
      secondary.src = texUrl(stickySrc);
      secondary.load();
    }
    armSilentPortraitVideo(secondary);
    secondary.loop = true;
    await waitVideoCanPlay(secondary);
    primary?.classList.add('is-hidden');
    primary?.pause();
    secondary.classList.remove('is-exiting', 'is-entering');
    showDialogueSecondaryHard(secondary);
    stage.dataset.skinPhase = 'discipline-sticky';
    try {
      await secondary.play();
    } catch {
      hideDialogueSecondaryHard(secondary);
      primary?.classList.remove('is-hidden');
      if (primary) {
        armSilentPortraitVideo(primary);
        void primary.play().catch(() => {});
      }
      stage.dataset.skinPhase = 'idle';
    }
    return;
  }

  if (secondary) {
    secondary.pause();
    secondary.loop = false;
    hideDialogueSecondaryHard(secondary);
  }
  delete stage.dataset.disciplineStickyClip;
  delete stage.dataset.disciplinePoseIndex;
  stage.dataset.skinPhase = 'idle';
  if (primary) {
    primary.classList.remove('is-hidden', 'is-exiting', 'is-entering');
    armSilentPortraitVideo(primary);
    void primary.play().catch(() => {});
  } else {
    playStageVideos(stage);
  }
}

/** 关闭对话前 / 情绪超时：回到皮肤 */
export async function restoreDialogueSkin(
  stage: HTMLElement,
  opts?: { softMs?: number },
): Promise<void> {
  const skinLayer = stage.querySelector<HTMLElement>('[data-role="skin"]');
  const poseLayer = stage.querySelector<HTMLElement>('[data-role="pose"]');
  const poseImg = stage.querySelector<HTMLImageElement>('[data-pose-img]');
  const fx = stage.querySelector<HTMLElement>('.ai-dlg-portrait-fx');
  if (!skinLayer || !poseLayer || !poseImg) return;
  await fadeToSkin(stage, skinLayer, poseLayer, poseImg, fx, opts?.softMs);
}

export function findDialoguePortraitStage(
  root: ParentNode,
  characterId?: string,
): HTMLElement | null {
  if (characterId) {
    const scoped = root.querySelector<HTMLElement>(
      `[data-dialogue-portrait-stage][data-character-id="${characterId}"]`,
    );
    if (scoped) return scoped;
    const actor = root.querySelector<HTMLElement>(`[data-co-actor="${characterId}"]`);
    const inActor = actor?.querySelector<HTMLElement>('[data-dialogue-portrait-stage]');
    if (inActor) return inActor;
  }
  return root.querySelector<HTMLElement>('[data-dialogue-portrait-stage]');
}

export function characterEmotionPoseReady(characterId: string): boolean {
  return Boolean(emotionPosePath(characterId, EMOTION_POSE_CATALOG[0]!.key));
}
