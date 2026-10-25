/**
 * 五子棋引擎（15×15，纯本地计算，不走 LLM）。
 * 玩家执黑先手（1），AI 执白（2）。
 * AI 为启发式评分：连五 > 活四 > 冲四/堵四 > 活三 > 位置分，加少量随机扰动。
 */

export const GOMOKU_SIZE = 15;
export const GOMOKU_EMPTY = 0;
export const GOMOKU_PLAYER = 1;
export const GOMOKU_AI = 2;

export type GomokuBoard = number[]; // 长度 225，行优先

export function createGomokuBoard(): GomokuBoard {
  return new Array(GOMOKU_SIZE * GOMOKU_SIZE).fill(GOMOKU_EMPTY);
}

export function gomokuIdx(row: number, col: number): number {
  return row * GOMOKU_SIZE + col;
}

export function gomokuRow(idx: number): number {
  return Math.floor(idx / GOMOKU_SIZE);
}

export function gomokuCol(idx: number): number {
  return idx % GOMOKU_SIZE;
}

/** 坐标名：列 A–O（跳过 I 免混淆），行 1–15，如 "H8" */
export function gomokuCoordName(idx: number): string {
  const col = gomokuCol(idx);
  const row = gomokuRow(idx);
  const letter = String.fromCharCode(65 + col + (col >= 8 ? 1 : 0));
  return `${letter}${row + 1}`;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

function inBoard(row: number, col: number): boolean {
  return row >= 0 && row < GOMOKU_SIZE && col >= 0 && col < GOMOKU_SIZE;
}

/** 从最后一手出发检查是否连五 */
export function checkGomokuWin(board: GomokuBoard, idx: number): boolean {
  const side = board[idx];
  if (!side) return false;
  const r0 = gomokuRow(idx);
  const c0 = gomokuCol(idx);
  for (const [dr, dc] of DIRS) {
    let count = 1;
    for (const sgn of [1, -1] as const) {
      for (let k = 1; k < 5; k++) {
        const r = r0 + dr * k * sgn;
        const c = c0 + dc * k * sgn;
        if (!inBoard(r, c) || board[gomokuIdx(r, c)] !== side) break;
        count++;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

export function gomokuBoardFull(board: GomokuBoard): boolean {
  return board.every((v) => v !== GOMOKU_EMPTY);
}

/**
 * 评估某点若落 side 棋子的「线分」：统计四个方向连子数与两端开放度。
 * 返回该点最大单线得分。
 */
function scorePoint(board: GomokuBoard, idx: number, side: number): number {
  if (board[idx] !== GOMOKU_EMPTY) return -1;
  const r0 = gomokuRow(idx);
  const c0 = gomokuCol(idx);
  let best = 0;
  for (const [dr, dc] of DIRS) {
    let count = 1;
    let open = 0;
    for (const sgn of [1, -1] as const) {
      let k = 1;
      for (; k < 5; k++) {
        const r = r0 + dr * k * sgn;
        const c = c0 + dc * k * sgn;
        if (!inBoard(r, c)) break;
        const v = board[gomokuIdx(r, c)];
        if (v !== side) break;
        count++;
      }
      // 该方向端点
      const er = r0 + dr * k * sgn;
      const ec = c0 + dc * k * sgn;
      if (inBoard(er, ec) && board[gomokuIdx(er, ec)] === GOMOKU_EMPTY) open++;
    }
    let line: number;
    if (count >= 5) line = 1_000_000;
    else if (count === 4) line = open === 2 ? 120_000 : 15_000; // 活四 / 冲四
    else if (count === 3) line = open === 2 ? 4_000 : 500; // 活三 / 眠三
    else if (count === 2) line = open === 2 ? 300 : 60;
    else line = open === 2 ? 20 : 4;
    best = Math.max(best, line);
  }
  return best;
}

/** 位置分：越靠中心越高（开局不至于下边角） */
function positionScore(idx: number): number {
  const r = gomokuRow(idx) - 7;
  const c = gomokuCol(idx) - 7;
  return 60 - (r * r + c * c);
}

/**
 * AI 选点：进攻分（自己落）与防守分（堵玩家）取加权最大，加少量随机。
 * 只评估已有棋子周围两格内的空点，控制计算量。
 */
export function aiChooseGomokuMove(board: GomokuBoard, rng: () => number = Math.random): number {
  const candidates = new Set<number>();
  let hasAny = false;
  for (let i = 0; i < board.length; i++) {
    if (board[i] === GOMOKU_EMPTY) continue;
    hasAny = true;
    const r0 = gomokuRow(i);
    const c0 = gomokuCol(i);
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (inBoard(r, c) && board[gomokuIdx(r, c)] === GOMOKU_EMPTY) {
          candidates.add(gomokuIdx(r, c));
        }
      }
    }
  }
  if (!hasAny) return gomokuIdx(7, 7); // 空盘下天元（不会触发：玩家先手）

  let bestIdx = -1;
  let bestScore = -Infinity;
  for (const idx of candidates) {
    const atk = scorePoint(board, idx, GOMOKU_AI);
    const def = scorePoint(board, idx, GOMOKU_PLAYER);
    // 防守略重于进攻（堵玩家连五优先于自己冲四，但自己连五永远最大）
    const score = Math.max(atk, def * 0.92) + positionScore(idx) + rng() * 30;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

/** 形势一句话（供 Prompt/面板）：基于双方最佳着点分粗判 */
export function gomokuSituation(board: GomokuBoard): string {
  let aiBest = 0;
  let playerBest = 0;
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== GOMOKU_EMPTY) continue;
    const a = scorePoint(board, i, GOMOKU_AI);
    const p = scorePoint(board, i, GOMOKU_PLAYER);
    if (a > aiBest) aiBest = a;
    if (p > playerBest) playerBest = p;
  }
  if (aiBest >= 15_000 && aiBest > playerBest) return '她攻势已成，指挥官危险了';
  if (playerBest >= 15_000 && playerBest > aiBest) return '指挥官攻势很猛，她得全力防守';
  if (aiBest >= 4_000 && aiBest > playerBest * 1.5) return '她略占上风';
  if (playerBest >= 4_000 && playerBest > aiBest * 1.5) return '指挥官略占上风';
  return '局势胶着';
}
