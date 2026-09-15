/** 游戏 BGM：标题 / 介绍 / 废土 hub / 欢乐营地事件对话 / 战斗，交叉淡入淡出（每轨独立，避免重叠） */

import type { CoScreenGroup } from '../ai/campEvents/coScreen';
import type { AiLivingSave } from '../ai/types';

export type BgmTrack = 'title' | 'intro' | 'hub' | 'combat' | 'campFestive';

const TRACK_SRC: Record<BgmTrack, string> = {
  title: './music/kaishiyouxijiemian01.mp3',
  intro: './music/kaishiyouxijiemian02.mp3',
  hub: './music/youxizhuyinyue.mp3',
  combat: './music/zhandouchangjing.mp3',
  /** 欢乐营地事件对话曲（仅参与事件并打开角色聊天时播放） */
  campFestive: './music/yingdishijian01.mp3',
};

const ALL_TRACKS = Object.keys(TRACK_SRC) as BgmTrack[];

/** 进行中时切到营地欢乐 BGM 的事件（欢乐/派对/娱乐向） */
export const FESTIVE_CAMP_EVENT_IDS = new Set([
  'entertainment_night',
  'pool_party',
  'pool_solo_swim',
  'pool_water_play',
  'small_celebration',
  'birthday_surprise',
  'movie_night',
  'night_snack',
  'card_game',
  'sing_along',
  'pet_chase',
  'photo_session',
  'star_watch',
  'tea_break',
  'communal_meal',
  'gate_hangout',
]);

const DEFAULT_VOLUME = 0.42;
const DEFAULT_FADE_MS = 900;

let unlocked = false;
let enabled = true;
let current: BgmTrack | null = null;
let duckFactor = 1;

const players = new Map<BgmTrack, HTMLAudioElement>();
/** 逻辑音量 0–1（未乘 duck） */
const linearVol = new Map<BgmTrack, number>();
/** 每轨淡入淡出世代号，互不取消 */
const fadeGen = new Map<BgmTrack, number>();
let duckGen = 0;
/** 欢乐营地事件对话 BGM 是否覆盖主界面曲 */
let festiveCampDialogueBgm = false;
let restoreBaseBgm: (() => void) | null = null;

function bumpFade(track: BgmTrack): number {
  const next = (fadeGen.get(track) ?? 0) + 1;
  fadeGen.set(track, next);
  return next;
}

function ensurePlayer(track: BgmTrack): HTMLAudioElement {
  let audio = players.get(track);
  if (audio) return audio;
  audio = new Audio(TRACK_SRC[track]);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0;
  audio.setAttribute('playsinline', 'true');
  players.set(track, audio);
  linearVol.set(track, 0);
  fadeGen.set(track, 0);
  return audio;
}

function writeOutputVolume(track: BgmTrack): void {
  const audio = players.get(track);
  if (!audio) return;
  const linear = linearVol.get(track) ?? 0;
  audio.volume = Math.max(0, Math.min(1, linear * duckFactor));
}

function setLinear(track: BgmTrack, value: number): void {
  linearVol.set(track, Math.max(0, Math.min(1, value)));
  writeOutputVolume(track);
}

async function tryPlay(audio: HTMLAudioElement): Promise<boolean> {
  try {
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

function hardStop(track: BgmTrack): void {
  bumpFade(track);
  const audio = players.get(track);
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
  setLinear(track, 0);
}

/** 停掉除 keep 以外的所有曲目（防重叠兜底） */
function stopOthers(keep: BgmTrack | null): void {
  for (const track of ALL_TRACKS) {
    if (track === keep) continue;
    hardStop(track);
  }
}

function fadeLinear(
  track: BgmTrack,
  target: number,
  durationMs: number,
  onDone?: () => void,
): void {
  const audio = ensurePlayer(track);
  const gen = bumpFade(track);
  const from = linearVol.get(track) ?? 0;
  const to = Math.max(0, Math.min(1, target));

  if (durationMs <= 0 || Math.abs(from - to) < 0.001) {
    setLinear(track, to);
    onDone?.();
    return;
  }

  const t0 = performance.now();
  const step = (now: number) => {
    if (fadeGen.get(track) !== gen) return;
    const t = Math.min(1, (now - t0) / durationMs);
    const eased = t * t * (3 - 2 * t);
    setLinear(track, from + (to - from) * eased);
    if (t < 1) {
      requestAnimationFrame(step);
      return;
    }
    onDone?.();
  };
  void audio;
  requestAnimationFrame(step);
}

/** 用户手势 / 原生启动后解锁自动播放；已解锁时仍会尝试恢复当前曲目 */
export function unlockBgm(): void {
  const firstUnlock = !unlocked;
  unlocked = true;
  for (const track of ALL_TRACKS) ensurePlayer(track);

  void (async () => {
    if (firstUnlock) {
      for (const track of ALL_TRACKS) {
        const a = ensurePlayer(track);
        a.muted = true;
        const ok = await tryPlay(a);
        if (ok) {
          a.pause();
          a.currentTime = 0;
        }
        a.muted = false;
        setLinear(track, 0);
      }
    }
    // 只恢复当前应播曲目，并硬停其余
    if (current) {
      stopOthers(current);
      const a = ensurePlayer(current);
      setLinear(current, DEFAULT_VOLUME);
      await tryPlay(a);
    } else {
      stopOthers(null);
    }
  })();
}

export function setBgmEnabled(on: boolean): void {
  enabled = on;
  if (!on) void setBgmTrack(null, { fadeMs: 300 });
}

export function getBgmTrack(): BgmTrack | null {
  return current;
}

/** 短暂压低当前 BGM（不打断曲目切换淡入淡出） */
export function setBgmDucked(ducked: boolean, fadeMs = 500): void {
  const fromDuck = duckFactor;
  const toDuck = ducked ? 0.18 : 1;
  duckFactor = toDuck;
  const gen = ++duckGen;

  if (fadeMs <= 0 || Math.abs(fromDuck - toDuck) < 0.001) {
    for (const track of ALL_TRACKS) writeOutputVolume(track);
    return;
  }

  duckFactor = fromDuck;
  const t0 = performance.now();
  const step = (now: number) => {
    if (gen !== duckGen) return;
    const t = Math.min(1, (now - t0) / fadeMs);
    const eased = t * t * (3 - 2 * t);
    duckFactor = fromDuck + (toDuck - fromDuck) * eased;
    for (const track of ALL_TRACKS) writeOutputVolume(track);
    if (t < 1) {
      requestAnimationFrame(step);
      return;
    }
    duckFactor = toDuck;
    for (const track of ALL_TRACKS) writeOutputVolume(track);
  };
  requestAnimationFrame(step);
}

/**
 * 切换 BGM。`null` = 淡出并停止。
 * 同曲目已在播则保持；切轨时旧曲与新曲各自淡入淡出，且硬停其它轨。
 */
export async function setBgmTrack(
  track: BgmTrack | null,
  options?: { fadeMs?: number; forceRestart?: boolean },
): Promise<void> {
  if (!enabled) track = null;

  const fadeMs = options?.fadeMs ?? DEFAULT_FADE_MS;
  const forceRestart = options?.forceRestart ?? false;

  // 已是目标曲：确保在播，并清掉其它轨残留
  if (track === current && track !== null && !forceRestart) {
    stopOthers(track);
    const audio = ensurePlayer(track);
    if (audio.paused && unlocked) {
      setLinear(track, DEFAULT_VOLUME);
      await tryPlay(audio);
    } else if (!audio.paused && (linearVol.get(track) ?? 0) < DEFAULT_VOLUME * 0.5) {
      fadeLinear(track, DEFAULT_VOLUME, Math.min(fadeMs, 400));
    }
    return;
  }

  const prev = current;
  current = track;

  // 非目标轨全部纳入淡出/停止（含意外残留）
  for (const other of ALL_TRACKS) {
    if (other === track) continue;
    const otherAudio = players.get(other);
    if (!otherAudio) continue;
    if (other === prev || !otherAudio.paused || (linearVol.get(other) ?? 0) > 0.01) {
      fadeLinear(other, 0, fadeMs, () => {
        if (current !== other) hardStop(other);
      });
    } else {
      hardStop(other);
    }
  }

  if (!track) return;

  const next = ensurePlayer(track);
  if (forceRestart || next.paused) {
    next.currentTime = 0;
    setLinear(track, 0);
  }
  if (unlocked) await tryPlay(next);
  fadeLinear(track, DEFAULT_VOLUME, fadeMs);
}

/** 是否存在进行中的欢乐向营地事件（UI/玩法标记） */
export function hasActiveFestiveCampEvent(
  living: { activeCampEvents?: { phase: string; defId: string }[] } | null | undefined,
): boolean {
  return (living?.activeCampEvents ?? []).some(
    (e) => e.phase === 'active' && FESTIVE_CAMP_EVENT_IDS.has(e.defId),
  );
}

export function isFestiveCampEventDefId(defId: string): boolean {
  return FESTIVE_CAMP_EVENT_IDS.has(defId);
}

/** 角色是否正在参与进行中的欢乐营地事件 */
export function isCharacterInActiveFestiveCampEvent(
  living: AiLivingSave,
  characterId: string,
): boolean {
  return (living.activeCampEvents ?? []).some(
    (ev) =>
      ev.phase === 'active' &&
      FESTIVE_CAMP_EVENT_IDS.has(ev.defId) &&
      (ev.participants ?? []).some(
        (p) => p.characterId === characterId && (p.inCoScreen || p.arrived),
      ),
  );
}

export type FestiveCampDialogueBgmOpts = {
  /** 从营地页进入对话（主城/档案页不算参与事件） */
  fromCamp?: boolean;
};

/**
 * 是否应在本次对话中播放 yingdishijian01：
 * 必须从营地打开，且角色正参与欢乐营地事件（含同屏多人事件）。
 */
export function shouldPlayFestiveCampDialogueBgm(
  characterId: string,
  living: AiLivingSave,
  opts: FestiveCampDialogueBgmOpts,
  coGroup?: CoScreenGroup | null,
): boolean {
  if (!opts.fromCamp) return false;
  if (coGroup && coGroup.defId !== 'forced' && isFestiveCampEventDefId(coGroup.defId)) {
    return true;
  }
  return isCharacterInActiveFestiveCampEvent(living, characterId);
}

export function registerBgmBaseRestore(fn: () => void): void {
  restoreBaseBgm = fn;
}

export function isFestiveCampDialogueBgmActive(): boolean {
  return festiveCampDialogueBgm;
}

/** 打开欢乐营地事件角色聊天时调用 */
export function enterFestiveCampDialogueBgm(): void {
  if (festiveCampDialogueBgm) return;
  festiveCampDialogueBgm = true;
  void setBgmTrack('campFestive');
}

/** 关闭对话或事件结束时调用 */
export function exitFestiveCampDialogueBgm(): void {
  if (!festiveCampDialogueBgm) return;
  festiveCampDialogueBgm = false;
}

export function notifyBgmStateChanged(): void {
  restoreBaseBgm?.();
}

/** 对话仍开着但欢乐事件已结束 → 淡出回主曲 */
export function refreshFestiveCampDialogueBgm(living: AiLivingSave): void {
  if (!festiveCampDialogueBgm) return;
  const el = document.querySelector<HTMLElement>('[data-ai-dialogue][data-festive-bgm="1"]');
  if (!el) {
    exitFestiveCampDialogueBgm();
    return;
  }
  const charId = el.dataset.aiDialogueChar;
  if (!charId) {
    exitFestiveCampDialogueBgm();
    return;
  }
  const fromCamp = el.dataset.aiFromCamp === '1';
  const coDefId = el.dataset.coEventDef;
  const coGroup =
    coDefId && coDefId !== 'forced'
      ? ({ defId: coDefId } as CoScreenGroup)
      : null;
  if (!shouldPlayFestiveCampDialogueBgm(charId, living, { fromCamp }, coGroup)) {
    exitFestiveCampDialogueBgm();
  }
}

/** 根据界面状态同步 BGM（世界观介绍由 playWorldIntro 单独切 intro） */
export function syncBgmForView(view: string, inCombat: boolean): void {
  if (festiveCampDialogueBgm) {
    void setBgmTrack('campFestive');
    return;
  }
  if (inCombat) {
    void setBgmTrack('combat');
    return;
  }
  if (view === 'title') {
    void setBgmTrack('title');
    return;
  }
  void setBgmTrack('hub');
}
