/**
 * 安抚室·喘息声（三级循环，WebAudio 双轨交叉淡入实现无缝过渡）
 *
 * 触发规则（与 anfuSession 的安抚值同拍）：
 * - 进入安抚状态（soothing）：播放 1 级
 * - 安抚值 ≥ 35：切 2 级
 * - 安抚值 ≥ 70：切 3 级
 * - 安抚值满 100 → 播疲惫动画：退回 1 级（仍在安抚室，不循环涨值）
 * - 离开安抚室：彻底停止（重进从 1 级重新开始）
 *
 * 静音门（临时 duck，不改变档位）：
 * - 角色回复语音播放中（isVoiceSpeaking）
 * - 玩家正在录音/语音输入中（不是打字）
 * 语音结束后按当前档位淡回。
 *
 * 命名说明：对外一律称「喘息声」，资源路径亦用 breath 命名，
 * 不使用过于直白的词汇（市场模式合规）。
 */
import { CHARACTER_MAP } from '../data/characters';
import { texUrl } from '../utils/texUrl';

export type AnfuBreathLevel = 1 | 2 | 3;

/** 各档阈值（安抚值 ≥ 阈值即切档） */
export const ANFU_BREATH_THRESHOLDS: Record<Exclude<AnfuBreathLevel, 1>, number> = {
  2: 35,
  3: 70,
};

/** 资源目录（breath 命名） */
const BREATH_DIR = './tex/audio/anfu-breath';

function breathSrc(characterId: string, level: AnfuBreathLevel): string | null {
  if (!CHARACTER_MAP[characterId]) return null;
  return `${BREATH_DIR}/${characterId}/${characterId}_breath_s${level}_loop.wav`;
}

/** 由安抚值 + 相位推导应播放档位；null = 不播 */
export function resolveAnfuBreathLevel(
  phase: string | null | undefined,
  value: number,
): AnfuBreathLevel | null {
  if (phase !== 'soothing' && phase !== 'exhausted') return null;
  // 疲惫态（值满 100）回到 1 级
  if (phase === 'exhausted') return 1;
  if (value >= ANFU_BREATH_THRESHOLDS[3]) return 3;
  if (value >= ANFU_BREATH_THRESHOLDS[2]) return 2;
  return 1;
}

const BASE_VOLUME = 0.34;
const CROSSFADE_MS = 700;
const DUCK_MS = 260;
const UNDUCK_MS = 420;

type Deck = {
  audio: HTMLAudioElement;
  level: AnfuBreathLevel;
  volume: number;
};

let characterId: string | null = null;
let level: AnfuBreathLevel | null = null;
let decks: Deck[] = [];
/** 目标音量： ducked 时为 0，否则 BASE_VOLUME */
let targetVolume = BASE_VOLUME;
let ducked = false;
let stopped = true;
let rafId = 0;
let fadeGen = 0;
/** 是否已被用户手势解锁（移动端 WebView 无手势时 play() 会被拒，喘息声永远不响） */
let unlocked = false;
/** play() 被拒时保留的目标档位，供后续重试 */
let pendingLevel: AnfuBreathLevel | null = null;

/**
 * 用户手势时调用：预热播放权限。
 * 不预热的话，移动端/内嵌浏览器首次 audio.play() 直接 reject，
 * 而 switchTo 的 catch 会静默丢弃轨道 —— 表现就是「完全没有喘息声」。
 */
export function unlockAnfuBreathAudio(): void {
  if (unlocked) return;
  unlocked = true;
  try {
    const probe = new Audio();
    probe.muted = true;
    probe.volume = 0;
    void probe
      .play()
      .then(() => {
        probe.pause();
        probe.src = '';
      })
      .catch(() => {
        /* 仍可能被拒：后续真实播放再试一次即可 */
      });
  } catch {
    /* ignore */
  }
}

function writeVolumes(): void {
  for (const d of decks) {
    d.audio.volume = Math.max(0, Math.min(1, d.volume * targetVolume));
  }
}

function fadeTo(deck: Deck, target: number, ms: number): void {
  const from = deck.volume;
  if (ms <= 0 || Math.abs(from - target) < 0.001) {
    deck.volume = target;
    writeVolumes();
    return;
  }
  const t0 = performance.now();
  const step = (now: number) => {
    // 只依赖 deck 是否还在队列里；不要再借用全局 fadeGen（那是总音量 duck 的令牌，
    // 两边共用会互相取消，出现淡入淡到一半停住的"叠音感"）。
    if (!decks.includes(deck)) return;
    const t = Math.min(1, (now - t0) / ms);
    deck.volume = from + (target - from) * (t * t * (3 - 2 * t));
    writeVolumes();
    if (t < 1) {
      requestAnimationFrame(step);
    }
  };
  requestAnimationFrame(step);
}

function retireDeck(deck: Deck): void {
  deck.audio.pause();
  deck.audio.src = '';
  deck.audio.load?.();
}

/** 交叉淡入到新档位：旧轨淡出停止，新轨淡入；两轨短暂并存实现无缝 */
async function switchTo(nextLevel: AnfuBreathLevel): Promise<void> {
  const cid = characterId;
  if (!cid) return;
  const src = breathSrc(cid, nextLevel);
  if (!src) return;

  // 已在该档且有存活轨 → 只做音量修正
  const alive = decks.filter((d) => d.level === nextLevel);
  if (alive.length && level === nextLevel) {
    for (const d of alive) fadeTo(d, 1, CROSSFADE_MS);
    return;
  }

  // 该档已有轨（例如两次 sync 在 play() await 期间并发）→ 复用，绝不重复起轨
  const existing = decks.find((d) => d.level === nextLevel);
  if (existing) {
    for (const d of decks) if (d !== existing) fadeTo(d, 0, CROSSFADE_MS);
    fadeTo(existing, 1, CROSSFADE_MS);
    level = nextLevel;
    stopped = false;
    return;
  }

  const audio = new Audio(texUrl(src));
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0;
  audio.setAttribute('playsinline', 'true');
  const next: Deck = { audio, level: nextLevel, volume: 0 };
  decks.push(next);

  try {
    await audio.play();
  } catch {
    decks = decks.filter((d) => d !== next);
    retireDeck(next);
    // 播放被拒（多为自动播放策略）：保留目标档位并标记待重试，
    // 下一次 sync 或用户手势解锁后会重新拉起，而不是永久无声。
    pendingLevel = nextLevel;
    level = nextLevel;
    stopped = true;
    return;
  }

  const old = decks.filter((d) => d !== next);
  fadeTo(next, 1, CROSSFADE_MS);
  for (const d of old) fadeTo(d, 0, CROSSFADE_MS);
  window.setTimeout(() => {
    // 只退休旧轨；新轨留在 decks 管理队列里，否则下一拍 sync 会认为没在播而再起一条
    // 同档音频 —— 表现就是多轨叠加、越听越糊。
    for (const d of old) retireDeck(d);
    decks = decks.filter((d) => !old.includes(d));
  }, CROSSFADE_MS + 120);

  level = nextLevel;
  stopped = false;
}

function applyVolumeTarget(ms: number): void {
  const to = ducked ? 0 : BASE_VOLUME;
  const from = targetVolume;
  targetVolume = to;
  if (ms <= 0 || Math.abs(from - to) < 0.001) {
    writeVolumes();
    return;
  }
  const gen = ++fadeGen;
  const t0 = performance.now();
  const step = (now: number) => {
    if (gen !== fadeGen) return;
    const t = Math.min(1, (now - t0) / ms);
    targetVolume = from + (to - from) * (t * t * (3 - 2 * t));
    writeVolumes();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * 按安抚会话状态同步喘息声（对话页每轮 / 攻击 / 被动涨幅后调用）。
 * phase 为 null 或非安抚相 → 停止。
 */
export function syncAnfuBreathAudio(
  cid: string | null | undefined,
  phase: string | null | undefined,
  value: number,
): void {
  const want = cid ? resolveAnfuBreathLevel(phase, value) : null;
  if (!cid || want == null) {
    stopAnfuBreathAudio();
    return;
  }
  if (characterId === cid && level === want && !stopped && decks.length) {
    // 修复「安抚状态下喘息声丢失」：Android WebView 退后台/锁屏会把 HTMLAudioElement
    // 暂停，回前台后不会自动恢复。此时模块状态一切正常（decks 在、stopped=false），
    // 早退分支直接 return，喘息声就永远无声了。这里检测到暂停轨时主动 resume。
    for (const d of decks) {
      if (d.audio.paused) {
        void d.audio
          .play()
          .then(() => {
            // 恢复后落回当前应有音量（play 会重置部分实现的时间轴但不清音量）
            writeVolumes();
          })
          .catch(() => {
            /* 仍被拒：保留状态，下一拍 sync（1s 心跳）继续重试 */
          });
      }
    }
    return;
  }
  // 上一轮被自动播放策略拒绝：这里无条件重试一次（此时通常已过用户手势）
  const retry = pendingLevel === want && characterId === cid;
  if (characterId !== cid) {
    stopAnfuBreathAudio();
  }
  characterId = cid;
  pendingLevel = null;
  level = retry ? null : level;
  if (retry) {
    // 重试时 decks 已空，强制走完整建轨流程
    level = null;
    stopped = true;
  }
  void switchTo(want);
}

/** 静音来源（多个可同时存在，任一存在即静音） */
export type AnfuBreathDuckReason = 'voice' | 'mic';

const duckReasons = new Set<AnfuBreathDuckReason>();

/** 语音/录音期间临时静音（不清档位）。多来源互不覆盖，全部解除后才淡回 */
export function setAnfuBreathDucked(reason: AnfuBreathDuckReason, on: boolean): void {
  if (on) duckReasons.add(reason);
  else duckReasons.delete(reason);
  const want = duckReasons.size > 0;
  if (ducked === want) return;
  ducked = want;
  applyVolumeTarget(want ? DUCK_MS : UNDUCK_MS);
}

export function isAnfuBreathDucking(): boolean {
  return ducked;
}

/** 彻底停止（离开安抚室 / 关页 / 读档恢复） */
export function stopAnfuBreathAudio(): void {
  if (!decks.length && stopped) {
    characterId = null;
    level = null;
    return;
  }
  fadeGen++;
  for (const d of decks) retireDeck(d);
  decks = [];
  characterId = null;
  level = null;
  pendingLevel = null;
  stopped = true;
  ducked = false;
  duckReasons.clear();
  targetVolume = BASE_VOLUME;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

export function getAnfuBreathState(): {
  characterId: string | null;
  level: AnfuBreathLevel | null;
  ducked: boolean;
  playing: boolean;
} {
  return {
    characterId,
    level,
    ducked,
    playing: decks.length > 0 && !stopped,
  };
}