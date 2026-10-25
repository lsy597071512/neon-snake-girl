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
import {
  getBathIntimateIntroDone,
  setBathIntimateIntroDone,
} from '../ai/bathIntimateConsent';
import { getCharacterSkin } from '../data/characterSkins';
import { getRuntimeActiveSkinId } from './characterSkinRuntime';
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

function readDialogueSecondaryLoopList(stage: HTMLElement): (string | null)[] {
  const raw = stage.dataset.secondaryLoopList;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((x) => (typeof x === 'string' && x ? x : null));
  } catch {
    return [];
  }
}

function writeDialogueSecondaryLoopList(
  stage: HTMLElement,
  loops: (string | null | undefined)[] | undefined,
): void {
  if (!loops?.length) {
    delete stage.dataset.secondaryLoopList;
    return;
  }
  stage.dataset.secondaryLoopList = encodeURIComponent(
    JSON.stringify(loops.map((x) => (typeof x === 'string' && x ? x : null))),
  );
}

function syncDialogueSecondaryLoopsFromSkin(stage: HTMLElement, characterId: string): void {
  const skinId = getRuntimeActiveSkinId(characterId, 'camp');
  const skin = skinId ? getCharacterSkin(characterId, skinId) : null;
  writeDialogueSecondaryLoopList(stage, skin?.portraitLiveSecondaryLoops);
}

/** 共浴交互02：intro(_2) → loop(_2_loop)；无 loop 则整段粘住 _2 */
function resolveBathCoClip2Playback(
  stage: HTMLElement,
  characterId: string,
): { intro: string; loop: string; needIntro: boolean } | null {
  const list = readDialogueSecondaryList(stage);
  const intro = list[1];
  if (!intro) return null;
  const loops = readDialogueSecondaryLoopList(stage);
  const loop = loops[1] || intro;
  const living = getAiLiving();
  const needIntro = loop !== intro && !getBathIntimateIntroDone(living, characterId);
  return { intro, loop, needIntro };
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

/**
 * 同 secondary 视频原地切 src（脱巾前奏 → loop）。
 * 不露 primary idle，避免闪默认泡澡皮。
 */
async function swapSecondarySrcInPlace(
  secondary: HTMLVideoElement,
  nextSrc: string,
  opts?: { loop?: boolean },
): Promise<boolean> {
  const loop = !!opts?.loop;
  const nextUrl = texUrl(nextSrc);
  secondary.dataset.skinSrc = nextSrc;
  secondary.loop = loop;
  armSilentPortraitVideo(secondary);
  if (secondary.src !== nextUrl) {
    secondary.pause();
    secondary.src = nextUrl;
    secondary.load();
  }
  await waitVideoCanPlay(secondary);
  try {
    secondary.currentTime = 0;
  } catch {
    /* ignore */
  }
  showDialogueSecondaryHard(secondary);
  try {
    await secondary.play();
    return true;
  } catch {
    return false;
  }
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
  // 共浴脱巾粘住时：播完回粘住层，不回 primary idle
  const returnSticky =
    stage.dataset.bathCoStickyClip &&
    Number(stage.dataset.bathCoStickyClip) >= 1
      ? Number(stage.dataset.bathCoStickyClip)
      : null;
  const list = readDialogueSecondaryList(stage);
  if (!list.length) return false;
  if (stage.dataset.skinBusy === '1') return false;
  const idx = Math.max(0, Math.min(list.length - 1, Math.floor(clip1Based) - 1));
  stage.dataset.skinBusy = '1';
  try {
    const ok = await crossfadeDialogueToSecondary(stage, list[idx]!);
    if (ok) {
      if (returnSticky != null && returnSticky !== clip1Based) {
        await setDialogueBathCoSticky(stage, returnSticky);
      } else if (returnSticky === clip1Based) {
        // 已是目标粘住剪辑，保持 secondary 循环
        stage.dataset.skinPhase = 'bath-co-sticky';
        stage.dataset.bathCoStickyClip = String(returnSticky);
      } else {
        await crossfadeDialogueToPrimary(stage);
      }
    }
    return ok;
  } finally {
    stage.dataset.skinBusy = '0';
  }
}

/**
 * 共浴专用：粘住交互循环（null=回共浴 idle）。
 * 交互02：先播 _2 脱巾前奏（一次），再粘住 _2_loop 无巾循环；重新裹巾或结束事件时清掉。
 */
export async function setDialogueBathCoSticky(
  stage: HTMLElement,
  clip1Based: number | null,
): Promise<boolean> {
  if (stage.dataset.mode === 'pose') {
    await restoreDialogueSkin(stage, { softMs: 120 });
  }
  if (stage.dataset.skinBusy === '1') {
    stage.dataset.bathCoStickyPending =
      clip1Based == null || clip1Based <= 0 ? 'idle' : String(Math.floor(clip1Based));
    return false;
  }
  stage.dataset.skinBusy = '1';
  try {
    if (clip1Based == null || clip1Based <= 0) {
      delete stage.dataset.bathCoStickyClip;
      delete stage.dataset.bathCoStickySrc;
      const secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
      hideDialogueSecondaryHard(secondary);
      if (stage.dataset.skinPhase === 'bath-co-sticky' || stage.dataset.skinPhase === 'out') {
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
      hideDialogueSecondaryHard(
        stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]'),
      );
      return true;
    }
    const list = readDialogueSecondaryList(stage);
    if (!list.length) return false;
    const idx = Math.max(0, Math.min(list.length - 1, Math.floor(clip1Based) - 1));
    stage.dataset.bathCoStickyClip = String(idx + 1);

    const characterId = stage.dataset.characterId ?? '';
    const clip2 =
      idx === 1 && characterId ? resolveBathCoClip2Playback(stage, characterId) : null;

    if (clip2?.needIntro) {
      const secondaryNow = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
      // 已在播前奏：等它播完再原地接 loop，禁止提前 return 导致永远不进 loop
      if (
        stage.dataset.skinPhase === 'bath-co-sticky' &&
        stage.dataset.bathCoStickySrc === clip2.intro &&
        secondaryNow &&
        !secondaryNow.paused &&
        !secondaryNow.ended
      ) {
        await new Promise<void>((resolve) => {
          const onEnd = () => {
            secondaryNow.removeEventListener('ended', onEnd);
            secondaryNow.removeEventListener('error', onEnd);
            resolve();
          };
          secondaryNow.addEventListener('ended', onEnd, { once: true });
          secondaryNow.addEventListener('error', onEnd, { once: true });
        });
      } else {
        stage.dataset.bathCoStickySrc = clip2.intro;
        const introOk = await crossfadeDialogueToSecondary(stage, clip2.intro, { sticky: false });
        if (!introOk) return false;
        stage.dataset.skinPhase = 'bath-co-sticky';
      }
      const living = getAiLiving();
      setBathIntimateIntroDone(living, characterId, true);
      saveManager.mutate((d) => {
        d.aiLiving = living;
      });
      const secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
      if (!secondary) return false;
      // 原地切 loop：不二次 crossfade、不闪 primary idle
      const loopOk = await swapSecondarySrcInPlace(secondary, clip2.loop, { loop: true });
      if (loopOk) {
        stage.dataset.skinPhase = 'bath-co-sticky';
        stage.dataset.bathCoStickySrc = clip2.loop;
      }
      return loopOk;
    }

    const want = clip2?.loop ?? list[idx]!;
    if (
      stage.dataset.skinPhase === 'bath-co-sticky' &&
      stage.dataset.bathCoStickySrc === want
    ) {
      const secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
      if (secondary && !secondary.paused) return true;
    }
    const ok = await crossfadeDialogueToSecondary(stage, want, { sticky: true });
    if (ok) {
      stage.dataset.skinPhase = 'bath-co-sticky';
      stage.dataset.bathCoStickySrc = want;
    }
    return ok;
  } finally {
    stage.dataset.skinBusy = '0';
    const pending = stage.dataset.bathCoStickyPending;
    if (pending) {
      delete stage.dataset.bathCoStickyPending;
      const n = pending === 'idle' ? null : Number(pending);
      void setDialogueBathCoSticky(stage, Number.isFinite(n as number) ? (n as number) : null);
    }
  }
}

/**
 * 独舞无缝链式循环：在 secondary 层按序 [主, _1, _2 …] 首尾相接播放。
 * 机制：下一段预加载（新 src → canplay），上一段 ended 时切换；不经过 primary idle，
 * 画面看起来一直在跳。仅独舞演出态调用；返回 false 或中断时由 overlay timer 恢复。
 */
export async function playDialogueDanceSoloLoop(
  stage: HTMLElement,
  srcs: string[],
  opts?: { startIndex?: number; signal?: AbortSignal },
): Promise<boolean> {
  const primary = primarySkinVideo(stage);
  let secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
  if (!primary || !secondary || srcs.length === 0) return false;
  if (opts?.signal?.aborted) return false;
  if (stage.dataset.mode === 'pose') {
    await restoreDialogueSkin(stage, { softMs: 120 });
  }
  if (stage.dataset.skinBusy === '1') return false;
  stage.dataset.skinBusy = '1';
  try {
    const start = Math.max(0, Math.min(srcs.length - 1, opts?.startIndex ?? 0));
    armSilentPortraitVideo(secondary);
    secondary.dataset.skinSrc = srcs[start]!;
    secondary.src = texUrl(srcs[start]!);
    secondary.loop = false;
    secondary.load();
    await waitVideoCanPlay(secondary);

    stage.dataset.skinPhase = 'out';
    primary.classList.add('is-hidden');
    primary.pause();
    secondary.classList.remove('is-hidden');
    secondary.classList.add('is-entering');
    stage.dataset.skinPhase = 'dance-solo-loop';
    stage.dataset.danceSoloIdx = String(start);
    stage.dataset.danceSoloCount = String(srcs.length);
    try {
      secondary.currentTime = 0;
    } catch {
      /* ignore */
    }
    try {
      await secondary.play();
    } catch {
      stage.dataset.skinPhase = 'idle';
      delete stage.dataset.danceSoloIdx;
      delete stage.dataset.danceSoloCount;
      primary.classList.remove('is-hidden');
      void primary.play().catch(() => {});
      return false;
    }
    secondary.classList.remove('is-entering');

    // 链式：每次 ended → 下一段。同一 secondary 原地换 src，无 primary 闪屏。
    const chain = async () => {
      for (;;) {
        if (opts?.signal?.aborted) return;
        if (stage.dataset.skinPhase !== 'dance-solo-loop') return;
        await new Promise<void>((resolve) => {
          const cur = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
          const finish = () => {
            cur?.removeEventListener('ended', finish);
            cur?.removeEventListener('error', finish);
            resolve();
          };
          if (!cur || cur.paused || cur.ended) return resolve();
          cur.addEventListener('ended', finish, { once: true });
          cur.addEventListener('error', finish, { once: true });
        });
        if (opts?.signal?.aborted) return;
        if (stage.dataset.skinPhase !== 'dance-solo-loop') return;
        const next = (Number(stage.dataset.danceSoloIdx ?? '0') + 1) % srcs.length;
        const ok = await swapSecondarySrcInPlace(secondary, srcs[next]!, { loop: false });
        if (!ok) return;
        stage.dataset.danceSoloIdx = String(next);
        stage.dataset.skinPhase = 'dance-solo-loop';
      }
    };
    void chain();
    return true;
  } finally {
    stage.dataset.skinBusy = '0';
  }
}

/** 停止独舞链式循环（不碰 primary，由 overlay 后续刷新决定画面） */
export function stopDialogueDanceSoloLoop(stage: HTMLElement): void {
  if (stage.dataset.skinPhase === 'dance-solo-loop') {
    stage.dataset.skinPhase = 'idle';
  }
  delete stage.dataset.danceSoloIdx;
  delete stage.dataset.danceSoloCount;
}

/**
 * 安抚过程：切到指定片段并循环（sticky），带柔和过渡。
 * 与独舞链式不同：只播当前段、不自动推进；推进由攻击按钮（clipIndex+1）驱动。
 * 必须最后调用（refreshDialogueSkinLayer 会复位可见性）。
 */
export async function playDialogueAnfuClip(
  stage: HTMLElement,
  src: string,
  clipIndex: number,
): Promise<boolean> {
  // 安抚片段独占一层：绝不复用通用 secondary。
  // 通用 secondary 会被「换皮刷新 / 长按选段 / AI skin_clip / 情绪图回退」同时争抢，
  // 共用时必然出现「点了攻击不换段 / 换段后又跳回第一段」的竞态。
  if (stage.dataset.skinBusy === '1') {
    // 忙碌不丢请求：排队最后一次目标（攻击连点时以最新片段为准）
    stage.dataset.anfuPendingSrc = src;
    stage.dataset.anfuPendingIdx = String(clipIndex);
    return false;
  }
  if (
    stage.dataset.anfuClipSrc === src &&
    stage.dataset.anfuClipIdx === String(clipIndex) &&
    isAnfuLayerShowing(stage)
  ) {
    // 幂等：同一段正在播且层可见 → 不重置 currentTime
    //（否则表现为「每轮对话都把安抚片段从头重播」）
    return true;
  }
  stage.dataset.skinBusy = '1';
  try {
    if (stage.dataset.mode === 'pose') {
      await restoreDialogueSkin(stage, { softMs: 120 });
    }
    const ok = await crossfadeToAnfuLayer(stage, src);
    if (!ok) return false;
    stage.dataset.skinPhase = 'anfu-clip';
    stage.dataset.anfuClipIdx = String(clipIndex);
    stage.dataset.anfuClipSrc = src;
    return true;
  } finally {
    stage.dataset.skinBusy = '0';
    const pendSrc = stage.dataset.anfuPendingSrc;
    if (pendSrc) {
      delete stage.dataset.anfuPendingSrc;
      const pendIdx = Number(stage.dataset.anfuPendingIdx || '0');
      delete stage.dataset.anfuPendingIdx;
      void playDialogueAnfuClip(stage, pendSrc, Number.isFinite(pendIdx) ? pendIdx : 0);
    }
  }
}

/** 安抚层当前是否真的可见且在播（换皮刷新会藏层但保留 dataset，判定必须看真实可见性） */
function isAnfuLayerShowing(stage: HTMLElement): boolean {
  const v = stage.querySelector<HTMLVideoElement>('[data-role="anfu-clip"]');
  if (!v) return false;
  if (v.hasAttribute('hidden') || v.classList.contains('is-hidden')) return false;
  return !v.paused;
}

/** 确保安抚专用层存在（独立于通用 secondary 与 primary，换皮刷新后需重建） */
function ensureAnfuLayer(stage: HTMLElement): HTMLVideoElement | null {
  const skin = stage.querySelector<HTMLElement>('[data-role="skin"]');
  if (!skin) return null;
  let v = stage.querySelector<HTMLVideoElement>('[data-role="anfu-clip"]');
  if (!v) {
    skin.insertAdjacentHTML(
      'beforeend',
      `<video class="ai-dlg-layer-media ai-dlg-anfu-clip is-awaiting-play"
               data-role="anfu-clip"
               hidden
               muted playsinline webkit-playsinline disablepictureinpicture
               controlslist="nodownload nofullscreen noremoteplayback" preload="auto"></video>`,
    );
    v = stage.querySelector<HTMLVideoElement>('[data-role="anfu-clip"]');
  }
  if (!v) return null;
  armSilentPortraitVideo(v);
  return v;
}

/**
 * 交叉淡入安抚专用层：所有其他层让位，片段循环播放。
 * 失败时回滚到 primary，绝不留空白。
 */
async function crossfadeToAnfuLayer(stage: HTMLElement, src: string): Promise<boolean> {
  const primary = primarySkinVideo(stage);
  const secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
  const anfu = ensureAnfuLayer(stage);
  const fx = stage.querySelector<HTMLElement>('.ai-dlg-portrait-fx');
  if (!anfu) return false;

  const sameSrc = anfu.dataset.skinSrc === src;
  if (!sameSrc) {
    anfu.dataset.skinSrc = src;
    anfu.src = texUrl(src);
    anfu.load();
  }
  armSilentPortraitVideo(anfu);
  anfu.loop = true;
  await waitVideoCanPlay(anfu);

  stage.dataset.skinPhase = 'out';
  fx?.classList.add('is-active');
  primary?.classList.add('is-exiting');
  await new Promise((r) => window.setTimeout(r, transitionDialogueMs()));

  primary?.pause();
  primary?.classList.add('is-hidden');
  primary?.classList.remove('is-exiting');
  hideDialogueSecondaryHard(secondary);

  if (!sameSrc) {
    try {
      anfu.currentTime = 0;
    } catch {
      /* ignore seek race */
    }
  }
  showDialogueSecondaryHard(anfu);
  try {
    await anfu.play();
  } catch {
    fx?.classList.remove('is-active');
    anfu.classList.add('is-hidden');
    anfu.setAttribute('hidden', '');
    primary?.classList.remove('is-hidden');
    void primary?.play().catch(() => {});
    stage.dataset.skinPhase = 'idle';
    return false;
  }
  fx?.classList.remove('is-active');
  return true;
}

/** 停止安抚片段：隐藏安抚层，交回 primary（由 overlay 后续刷新决定画面） */
export function stopDialogueAnfuClip(stage: HTMLElement): void {
  clearAnfuPoseOverlay(stage);
  const anfu = stage.querySelector<HTMLVideoElement>('[data-role="anfu-clip"]');
  if (anfu) {
    anfu.pause();
    hideDialogueSecondaryHard(anfu);
  }
  if (stage.dataset.skinPhase === 'anfu-clip') {
    stage.dataset.skinPhase = 'idle';
  }
  delete stage.dataset.anfuClipIdx;
  delete stage.dataset.anfuClipSrc;
  delete stage.dataset.anfuPendingSrc;
  delete stage.dataset.anfuPendingIdx;
}

/** 播放一次事件收束片段，结束后切入待机并回调状态层。 */
export async function playDialogueDisciplineClimax(
  stage: HTMLElement,
  climaxSrc: string,
  aftercareSrc: string,
  onComplete?: () => void,
): Promise<boolean> {
  const secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
  const primary = primarySkinVideo(stage);
  if (!secondary) return false;
  secondary.pause();
  secondary.dataset.skinSrc = climaxSrc;
  secondary.src = texUrl(climaxSrc);
  secondary.loop = false;
  secondary.load();
  primary?.classList.add('is-hidden');
  primary?.pause();
  secondary.classList.remove('is-hidden', 'is-exiting', 'is-entering');
  stage.dataset.skinPhase = 'discipline-climax';
  await waitVideoCanPlay(secondary);
  const finish = () => {
    secondary.removeEventListener('ended', finish);
    secondary.dataset.skinSrc = aftercareSrc;
    secondary.src = texUrl(aftercareSrc);
    secondary.loop = true;
    secondary.load();
    void secondary.play().catch(() => {});
    stage.dataset.skinPhase = 'discipline-aftercare';
    onComplete?.();
  };
  secondary.addEventListener('ended', finish, { once: true });
  try {
    await secondary.play();
    return true;
  } catch {
    secondary.removeEventListener('ended', finish);
    return false;
  }
}

/**
 * 事件专用：粘住姿势循环（null=回 idle 默认态）。
 * 不会在 ended 后自动回 primary。
 */
export async function setDialogueDisciplinePose(
  stage: HTMLElement,
  clip1Based: number | null,
  clipSrc?: string,
): Promise<boolean> {
  // Never trust a stale secondary list after a character/event skin switch.
  // Re-resolve from the stage character before translating the pose index to a clip.
  const characterId = stage.dataset.characterId;
  if (characterId) {
    syncDialogueSkinPicker(stage, getLivePortraitSecondarySrcs(characterId, CAMP_OPTS));
  }
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
    const want = clipSrc || list[idx]!;
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
    // 事件动作必须严格串行：丢弃过期排队。
    delete stage.dataset.disciplinePosePending;
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
    // 双指捏合进行中：长按选段让位
    if (stage.dataset.pinchZoom === '1') return;

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
      if (stage.dataset.pinchZoom === '1') return;
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

/* ===== 双指捏合缩放（聊天页立绘/皮肤） =====
 * 最大 1.3 倍，双指离开后弹回原尺寸；
 * 手势只挂在立绘舞台上，不会与底部聊天输入框冲突。
 */
const PINCH_MAX_SCALE = 1.3;

function bindDialoguePinchZoom(stage: HTMLElement): void {
  if (stage.dataset.pinchBound === '1') return;
  stage.dataset.pinchBound = '1';

  let baseDist = 0;
  let curScale = 1;

  const touchDist = (t1: Touch, t2: Touch): number =>
    Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

  const applyScale = (s: number, origin?: { x: number; y: number }): void => {
    if (origin) {
      const r = stage.getBoundingClientRect();
      stage.style.transformOrigin = `${origin.x - r.left}px ${origin.y - r.top}px`;
    }
    stage.style.transform = `scale(${s})`;
  };

  /** 双指离开：柔和弹回原尺寸 */
  const springBack = (): void => {
    stage.style.transition = 'transform 0.32s cubic-bezier(0.22, 0.61, 0.36, 1)';
    stage.style.transform = 'scale(1)';
    curScale = 1;
    window.setTimeout(() => {
      stage.style.transition = '';
    }, 340);
  };

  stage.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 2) return;
      // 第二指落下：进入捏合，取消长按选段，避免二者抢手势
      stage.dataset.pinchZoom = '1';
      hideDialoguePicker(stage);
      baseDist = touchDist(e.touches[0]!, e.touches[1]!);
      curScale = 1;
      const mid = {
        x: (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2,
        y: (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2,
      };
      stage.style.transition = '';
      applyScale(1, mid);
      e.preventDefault();
    },
    { passive: false },
  );

  stage.addEventListener(
    'touchmove',
    (e) => {
      if (stage.dataset.pinchZoom !== '1' || e.touches.length < 2) return;
      const dist = touchDist(e.touches[0]!, e.touches[1]!);
      if (baseDist > 0) {
        curScale = Math.max(1, Math.min(PINCH_MAX_SCALE, dist / baseDist));
        applyScale(curScale);
      }
      e.preventDefault();
    },
    { passive: false },
  );

  const endPinch = (e: TouchEvent): void => {
    if (stage.dataset.pinchZoom !== '1') return;
    if (e.touches.length >= 2) return;
    delete stage.dataset.pinchZoom;
    springBack();
  };
  stage.addEventListener('touchend', endPinch);
  stage.addEventListener('touchcancel', endPinch);
}

export function bindDialoguePortraitInteractions(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-dialogue-portrait-stage]').forEach((stage) => {
    const characterId = stage.dataset.characterId;
    if (!characterId) return;
    const secondaries = getLivePortraitSecondarySrcs(characterId, CAMP_OPTS);
    syncDialogueSkinPicker(stage, secondaries);
    syncDialogueSecondaryLoopsFromSkin(stage, characterId);
    ensureDialogueHoldPicker(stage);
    bindDialoguePinchZoom(stage);
  });
}

export function buildDialoguePortraitStageHtml(characterId: string): string {
  const secondaries = getLivePortraitSecondarySrcs(characterId, CAMP_OPTS);
  const hasSecondary = secondaries.length > 0;
  const secondaryListAttr = hasSecondary ? encodeURIComponent(JSON.stringify(secondaries)) : '';
  const skinId = getRuntimeActiveSkinId(characterId, 'camp');
  const skin = skinId ? getCharacterSkin(characterId, skinId) : null;
  const loops = skin?.portraitLiveSecondaryLoops;
  const secondaryLoopAttr =
    loops && loops.length
      ? encodeURIComponent(JSON.stringify(loops.map((x) => (typeof x === 'string' && x ? x : null))))
      : '';
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
         ${secondaryLoopAttr ? `data-secondary-loop-list="${secondaryLoopAttr}"` : ''}
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
  // 安抚层也要复位：否则换皮/离房后安抚片段仍盖在新皮肤上（表现为「莫名切服装」）
  hideDialogueSecondaryHard(stage.querySelector<HTMLVideoElement>('[data-role="anfu-clip"]'));
}

/**
 * 刷新皮肤层（换装后回到 skin 模式）。
 * 必须重建 secondary 列表并复位可见性——保留旧皮 secondary 会导致多皮肤重叠。
 * 冲澡/换皮：优先原地换 primary src + 淡入淡出，避免整层销毁造成黑屏闪一下。
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

  const keepBathSticky =
    stage.dataset.bathCoStickyClip && Number(stage.dataset.bathCoStickyClip) >= 1
      ? Number(stage.dataset.bathCoStickyClip)
      : null;
  const keepStickySrc = stage.dataset.bathCoStickySrc || '';
  // 安抚片段：换皮刷新会整层重建，必须记住当前段并在重建后恢复，
  // 否则每轮对话都掉回待机 / 回到第一段（历史上「播一段停住又跳回第一段」的根因之一）。
  const keepAnfuClipSrc = stage.dataset.anfuClipSrc || '';
  const keepAnfuClipIdx = stage.dataset.anfuClipIdx || '';

  const secondaries = getLivePortraitSecondarySrcs(characterId, CAMP_OPTS);
  const hasSecondary = secondaries.length > 0;
  stage.classList.toggle('has-secondary', hasSecondary);
  stage.dataset.hasSecondary = hasSecondary ? '1' : '0';
  stage.dataset.secondaryList = hasSecondary
    ? encodeURIComponent(JSON.stringify(secondaries))
    : '';
  syncDialogueSecondaryLoopsFromSkin(stage, characterId);

  const showerPlan = resolveCampShowerPortraitPlayback(characterId);
  const nextLive = showerPlan?.src ?? getLivePortraitSrc(characterId, CAMP_OPTS);
  const existingPrimary = primarySkinVideo(stage);

  // 软切：已有视频 primary 且目标仍是视频 → 原地换 src + 淡入，不黑屏整层重建
  if (existingPrimary && nextLive) {
    const nextUrl = texUrl(nextLive);
    const srcChanged = existingPrimary.src !== nextUrl;
    resetDialogueSkinVisibility(stage);
    if (keepBathSticky != null) {
      stage.dataset.bathCoStickyClip = String(keepBathSticky);
      if (keepStickySrc) stage.dataset.bathCoStickySrc = keepStickySrc;
    }
    if (srcChanged) {
      existingPrimary.classList.add('is-exiting');
      window.setTimeout(() => {
        applyCampPortraitVideo(existingPrimary, characterId, showerPlan);
        existingPrimary.classList.remove('is-exiting', 'is-awaiting-play');
        existingPrimary.classList.add('is-entering');
        window.setTimeout(() => existingPrimary.classList.remove('is-entering'), transitionDialogueMs());
      }, Math.min(220, transitionDialogueMs()));
    } else {
      applyCampPortraitVideo(existingPrimary, characterId, showerPlan);
    }
    // 同步 secondary 壳（列表可能变）
    let secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
    if (hasSecondary) {
      if (!secondary) {
        skin.insertAdjacentHTML(
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
    } else {
      secondary?.remove();
    }
    syncDialogueSkinPicker(stage, secondaries);
    ensureDialogueHoldPicker(stage);
    if (keepBathSticky != null) {
      void setDialogueBathCoSticky(stage, keepBathSticky);
    } else if (keepAnfuClipSrc) {
      const idx = Number(keepAnfuClipIdx || '0');
      void playDialogueAnfuClip(stage, keepAnfuClipSrc, Number.isFinite(idx) ? idx : 0);
    }
    return;
  }

  resetDialogueSkinVisibility(stage);
  if (keepBathSticky != null) {
    stage.dataset.bathCoStickyClip = String(keepBathSticky);
    if (keepStickySrc) stage.dataset.bathCoStickySrc = keepStickySrc;
  }
  if (keepAnfuClipSrc) {
    stage.dataset.anfuClipSrc = keepAnfuClipSrc;
    if (keepAnfuClipIdx) stage.dataset.anfuClipIdx = keepAnfuClipIdx;
  }

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
  if (keepBathSticky != null) {
    void setDialogueBathCoSticky(stage, keepBathSticky);
  } else if (keepAnfuClipSrc) {
    const idx = Number(keepAnfuClipIdx || '0');
    void playDialogueAnfuClip(stage, keepAnfuClipSrc, Number.isFinite(idx) ? idx : 0);
  }
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

/** 清除安抚期间的叠层表情（不碰安抚片段层本身） */
function clearAnfuPoseOverlay(stage: HTMLElement): void {
  stage.classList.remove('is-anfu-pose');
  delete stage.dataset.anfuPoseToken;
  const poseLayer = stage.querySelector<HTMLElement>('[data-role="pose"]');
  const poseImg = stage.querySelector<HTMLImageElement>('[data-pose-img]');
  if (poseLayer) {
    poseLayer.classList.remove('is-active', 'is-entering', 'is-exiting');
    poseLayer.setAttribute('aria-hidden', 'true');
  }
  if (poseImg) poseImg.hidden = true;
}

function scheduleAnfuPoseClear(stage: HTMLElement, ms: number): void {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  stage.dataset.anfuPoseToken = token;
  window.setTimeout(() => {
    if (stage.dataset.anfuPoseToken !== token) return;
    if (!document.body.contains(stage)) return;
    // 已离开安抚相：交给常规皮肤/表情逻辑，别误清别层
    if (stage.dataset.skinPhase !== 'anfu-clip' && !stage.dataset.anfuClipSrc) return;
    clearAnfuPoseOverlay(stage);
  }, Math.max(700, ms));
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

  // 安抚片段进行中：情绪图不再整层替换皮肤（会把片段藏掉），
  // 改为叠在片段层上方短暂显示，到点自动淡出，片段继续播。

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

  // 安抚片段播放中：表情图叠在片段上方短暂显示（非整层替换）
  if (stage.dataset.skinPhase === 'anfu-clip' || stage.dataset.anfuClipSrc) {
    if (!url || !poseKey) {
      clearAnfuPoseOverlay(stage);
      stage.dataset.busy = '0';
      return;
    }
    const anfuPoseLayer = stage.querySelector<HTMLElement>('[data-role="pose"]');
    const anfuPoseImg = stage.querySelector<HTMLImageElement>('[data-pose-img]');
    if (!anfuPoseLayer || !anfuPoseImg) {
      stage.dataset.busy = '0';
      return;
    }
    await new Promise<void>((resolve) => {
      const fileHint = url.split('/').pop() || '';
      if (anfuPoseImg.getAttribute('src')?.includes(fileHint) && anfuPoseImg.complete) {
        resolve();
        return;
      }
      const onDone = () => {
        anfuPoseImg.removeEventListener('load', onDone);
        anfuPoseImg.removeEventListener('error', onDone);
        resolve();
      };
      anfuPoseImg.addEventListener('load', onDone, { once: true });
      anfuPoseImg.addEventListener('error', onDone, { once: true });
      anfuPoseImg.hidden = false;
      anfuPoseImg.src = url;
      if (anfuPoseImg.complete) onDone();
    });
    stage.classList.add('is-anfu-pose');
    anfuPoseLayer.classList.add('is-active');
    anfuPoseLayer.setAttribute('aria-hidden', 'false');
    scheduleAnfuPoseClear(
      stage,
      opts.holdMs ?? resolveEmotionPoseHoldMs(poseKey, opts.emotion),
    );
    stage.dataset.busy = '0';
    return;
  }

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
    // 情绪图已关但仍可能需续播事件粘住姿势
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
 * 情绪图结束后回到皮肤层：若事件粘住姿势仍有效则续播 secondary，否则播 idle primary。
 * 避免「情绪图盖住姿势 → 回皮肤只播 idle → 姿势卡没」。
 */
async function resumeDisciplineSkinPlayback(stage: HTMLElement): Promise<void> {
  const primary = primarySkinVideo(stage);
  const secondary = stage.querySelector<HTMLVideoElement>('[data-role="skin-secondary"]');
  const stickySrc = stage.dataset.disciplineStickyClip || '';
  const poseIdx = Number(stage.dataset.disciplinePoseIndex || '0');

  if (stage.dataset.skinPhase === 'discipline-aftercare' && secondary) {
    secondary.loop = true;
    secondary.classList.remove('is-hidden', 'is-exiting', 'is-entering');
    primary?.classList.add('is-hidden');
    primary?.pause();
    armSilentPortraitVideo(secondary);
    void secondary.play().catch(() => {});
    return;
  }

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
