/** 游戏 BGM：标题 / 介绍 / 废土 hub / 欢乐营地事件对话 / 战斗，交叉淡入淡出（每轨独立，避免重叠） */

import type { CoScreenGroup } from '../ai/campEvents/coScreen';
import type { AiLivingSave } from '../ai/types';

export type BgmTrack =
  | 'title'
  | 'intro'
  | 'hub'
  | 'combat'
  | 'campFestive'
  | 'anfu'
  | 'storyCalm'
  | 'storyCalm2'
  | 'storyTense'
  | 'storyTruth';

const TRACK_SRC: Record<BgmTrack, string> = {
  title: './music/kaishiyouxijiemian01.mp3',
  intro: './music/kaishiyouxijiemian02.mp3',
  hub: './music/youxizhuyinyue.mp3',
  combat: './music/zhandouchangjing.mp3',
  /** 欢乐营地事件对话曲（仅参与事件并打开角色聊天时播放） */
  campFestive: './music/yingdishijian01.mp3',
  /** 安抚室专用 BGM（负一层棉花游戏；进出安抚会话交叉淡入淡出，优先级高于营地欢乐曲） */
  anfu: './music/anwushi_bgm.mp3',
  /** 剧情情绪轨：平和（开场/温情）、平和2（旅途/营地）、紧张（危机/Boss 前）、真相（揭露/章末） */
  storyCalm: './music/pinghe.mp3',
  storyCalm2: './music/pinghe02.mp3',
  storyTense: './music/jinzhang.mp3',
  storyTruth: './music/zhenxiang.mp3',
};

/** 剧情 beat 可用的情绪档（storyBeats.ts 的 StoryBeatDef.bgm） */
export type StoryBgmMood = 'calm' | 'calm2' | 'tense' | 'truth';

const STORY_BGM_TRACK: Record<StoryBgmMood, BgmTrack> = {
  calm: 'storyCalm',
  calm2: 'storyCalm2',
  tense: 'storyTense',
  truth: 'storyTruth',
};

export function getStoryBgmTrack(mood: StoryBgmMood): BgmTrack {
  return STORY_BGM_TRACK[mood];
}

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
/** 安抚室 BGM 淡入淡出（比普通切曲更长，过渡更自然） */
const ANFU_BGM_FADE_MS = 1400;

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
/** 安抚室 BGM 覆盖标记（优先级最高：进入安抚会话即切曲，离开后回落） */
let anfuBgmActive = false;
let restoreBaseBgm: (() => void) | null = null;

// ── 舞蹈 BGM：music/dance 三首，随机起点 → 顺序播完循环，单元素串播防重叠 ──
const DANCE_TRACKS = [
  './music/dance/A_Quiet_Hour_Inside.mp3',
  './music/dance/Sunday_at_the_Shelter.mp3',
  './music/dance/Sunlight_on_the_Keys.mp3',
];
const DANCE_VOLUME = 0.5;
let danceAudio: HTMLAudioElement | null = null;
let danceIdx = 0;
let danceBgmActive = false;

function ensureDanceAudio(): HTMLAudioElement {
  if (danceAudio) return danceAudio;
  const a = new Audio();
  a.preload = 'auto';
  a.volume = DANCE_VOLUME;
  a.setAttribute('playsinline', 'true');
  a.addEventListener('ended', () => {
    if (!danceBgmActive) return;
    danceIdx = (danceIdx + 1) % DANCE_TRACKS.length;
    void playDanceTrack();
  });
  danceAudio = a;
  return a;
}

async function playDanceTrack(): Promise<void> {
  const a = ensureDanceAudio();
  const want = DANCE_TRACKS[danceIdx]!;
  if (a.dataset.danceIdx !== String(danceIdx)) {
    a.dataset.danceIdx = String(danceIdx);
    a.src = want;
  }
  a.volume = DANCE_VOLUME;
  try {
    await a.play();
  } catch {
    /* 未解锁/被拒：下次心跳会再尝试 */
  }
}

/** 角色真正起舞（pifu10/pifu11 正视）时调用：随机起点起播，同时让主 BGM 淡出避免叠音 */
export function enterDanceBgm(): void {
  if (danceBgmActive) {
    // 已被拒播（未解锁/浏览器拦截）时每秒心跳重试，保证最终能响
    const a = danceAudio;
    if (a && a.paused) void playDanceTrack();
    return;
  }
  danceBgmActive = true;
  danceIdx = Math.floor(Math.random() * DANCE_TRACKS.length);
  void setBgmTrack(null, { fadeMs: 600 });
  void playDanceTrack();
}

/** 待机/结束/关闭/离开大厅：立即停舞曲并交回主 BGM */
export function exitDanceBgm(): void {
  if (!danceBgmActive) return;
  danceBgmActive = false;
  const a = danceAudio;
  if (a) {
    a.pause();
    a.currentTime = 0;
  }
  restoreBaseBgm?.();
}

export function isDanceBgmActive(): boolean {
  return danceBgmActive;
}

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
  if (!on) {
    exitDanceBgm();
    void setBgmTrack(null, { fadeMs: 300 });
  }
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

/**
 * 进入安抚室：切安抚专用曲。
 * 淡入淡出比默认更长（1.4s），避免和营地欢乐曲/主曲硬切产生叠音冲突；
 * 进入时先让旧曲淡出到静音再抬新曲，同一时刻最多一条轨在响（setBgmTrack 已保证）。
 */
export function enterAnfuBgm(): void {
  if (anfuBgmActive) {
    void setBgmTrack('anfu', { fadeMs: ANFU_BGM_FADE_MS });
    return;
  }
  anfuBgmActive = true;
  void setBgmTrack('anfu', { fadeMs: ANFU_BGM_FADE_MS });
}

export function exitAnfuBgm(): void {
  if (!anfuBgmActive) return;
  anfuBgmActive = false;
  // 不在此处直接选曲：交回 syncBgmForView / 欢乐曲逻辑决定回落目标，避免和别处抢轨
  restoreBaseBgm?.();
}

/** 安抚 BGM 是否正在覆盖（UI/状态层判断用） */
export function isAnfuBgmActive(): boolean {
  return anfuBgmActive;
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
  // 剧情播片期间只播剧情 BGM：任何 render/sync 触发的切歌都跳过，避免主 BGM 抢回混播
  if (typeof document !== 'undefined' && document.querySelector('.story-overlay')) return;
  // 舞蹈 BGM 独占期间：不许任何界面同步把主曲抢回来（否则与舞曲叠音）
  if (danceBgmActive) return;
  // 安抚室优先级最高：正戏期间任何界面同步都不得把安抚曲抢回主曲
  if (anfuBgmActive) {
    void setBgmTrack('anfu', { fadeMs: ANFU_BGM_FADE_MS });
    return;
  }
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
