/** 开始页海报：每次冷启动在两张候选间轮换 */

export const TITLE_POSTER_CANDIDATES = [
  './tex/game-poster-v2-ridge.png',
  './tex/game-poster-v5-judgment.png',
] as const;

const STORAGE_KEY = 'rbe:titlePosterIndex';

let sessionPoster: string | null = null;

/**
 * 同一次打开进程内固定；下次冷启动切换到另一张。
 */
export function pickTitlePoster(): string {
  if (sessionPoster) return sessionPoster;

  let next = 0;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const last = raw == null ? -1 : Number.parseInt(raw, 10);
    next = Number.isFinite(last) ? (last + 1) % TITLE_POSTER_CANDIDATES.length : 0;
    localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    next = Math.floor(Math.random() * TITLE_POSTER_CANDIDATES.length);
  }

  sessionPoster = TITLE_POSTER_CANDIDATES[next]!;
  return sessionPoster;
}
