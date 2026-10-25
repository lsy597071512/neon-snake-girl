/**
 * 营地小游戏面板（五子棋 / 猜拳）——聊天页内浮层，不遮输入区，聊天照常。
 *
 * - 美术：tex/Small_game/01/parts 切图拼接（棋盘框 / 棋子 / 状态药丸 / 计时框 / 按钮）。
 * - 数据：livingService 的 UI 封装（快照 + 落子/出拳/退出），250ms 自刷计时条。
 * - 中途退出/关闭 = 判负 + 扣好感（二次确认后才执行）。
 * - 终局：胜负药丸 + stake 提示（随性奖惩，纯叙事），收起后面板隐藏。
 */
import {
  getMiniGameSnapshotForUi,
  getMiniGameStakeForUi,
  miniGameGomokuMoveNow,
  miniGameRpsThrowNow,
  quitMiniGameNow,
} from '../ai/livingService';
import type { RpsThrow } from '../game/miniGames/rps';
import { texUrl } from '../utils/texUrl';
import { playUiSound } from './uiSound';

const PARTS = './tex/Small_game/01/parts';

/** 棋盘格定位（board_frame 812×868 实测换算，i/j ∈ 0..14，% 相对棋盘容器） */
const GRID_LEFT = 11.58;
const GRID_STEP_X = 5.436;
const GRID_TOP = 16.82;
const GRID_STEP_Y = 5.02;

export type MiniGamePanelHooks = {
  appendLog: (speaker: string, text: string) => void;
};

type PanelState = {
  root: HTMLElement;
  hooks: MiniGamePanelHooks;
  /** 已手动收起的终局横幅 key（characterId|kind|result） */
  dismissKey: string | null;
  /** 退出二次确认是否已展开 */
  confirmQuit: boolean;
  /** 上一次完整渲染的结构 key（避免 250ms 计时刷新重建 DOM） */
  renderKey: string;
  timerId: number;
};

const panels = new WeakMap<HTMLElement, PanelState>();

function part(name: string): string {
  return texUrl(`${PARTS}/${name}.png`);
}

function stonePos(idx: number): { left: string; top: string } {
  const i = idx % 15;
  const j = Math.floor(idx / 15);
  return {
    left: `${(GRID_LEFT + i * GRID_STEP_X).toFixed(3)}%`,
    top: `${(GRID_TOP + j * GRID_STEP_Y).toFixed(3)}%`,
  };
}

/** 点击坐标 → 最近交叉点 idx（超出半格容差返回 -1） */
function boardIdxFromPoint(board: HTMLElement, clientX: number, clientY: number): number {
  const rect = board.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return -1;
  const px = ((clientX - rect.left) / rect.width) * 100;
  const py = ((clientY - rect.top) / rect.height) * 100;
  const i = Math.round((px - GRID_LEFT) / GRID_STEP_X);
  const j = Math.round((py - GRID_TOP) / GRID_STEP_Y);
  if (i < 0 || i > 14 || j < 0 || j > 14) return -1;
  const dx = Math.abs(px - (GRID_LEFT + i * GRID_STEP_X));
  const dy = Math.abs(py - (GRID_TOP + j * GRID_STEP_Y));
  if (dx > GRID_STEP_X * 0.5 || dy > GRID_STEP_Y * 0.5) return -1;
  return j * 15 + i;
}

function statusPill(kind: string, active: boolean, turn: string, result: string | null): { img: string; text: string } {
  if (!active && result) {
    if (result === 'player_win') return { img: part('pill_win'), text: '你赢了' };
    if (result === 'ai_win') return { img: part('pill_white'), text: '她赢了' };
    return { img: part('pill_draw'), text: '平局' };
  }
  if (turn === 'player') return { img: part('pill_turn'), text: kind === 'gomoku' ? '轮到你落子' : '轮到你出拳' };
  return { img: part('pill_thinking'), text: '她思考中…' };
}

function renderBoard(state: PanelState, snapshot: NonNullable<ReturnType<typeof getMiniGameSnapshotForUi>>): string {
  const g = snapshot.gomoku;
  if (!g) return '';
  let stones = '';
  for (let idx = 0; idx < g.board.length; idx++) {
    const v = g.board[idx];
    if (!v) continue;
    const p = stonePos(idx);
    const sprite = v === 1 ? 'stone_black' : 'stone_white';
    stones += `<img class="ai-minigame-stone" src="${part(sprite)}" style="left:${p.left};top:${p.top}" alt="" />`;
  }
  if (g.lastMove != null && g.board[g.lastMove]) {
    const p = stonePos(g.lastMove);
    stones += `<img class="ai-minigame-lastmark" src="${part('mark_last')}" style="left:${p.left};top:${p.top}" alt="" />`;
  }
  const clickable = snapshot.active && snapshot.turn === 'player';
  return `<div class="ai-minigame-board${clickable ? ' is-your-turn' : ''}" data-mg-board style="background-image:url('${part('board_frame')}')">${stones}</div>`;
}

function renderRps(snapshot: NonNullable<ReturnType<typeof getMiniGameSnapshotForUi>>): string {
  const r = snapshot.rps;
  if (!r) return '';
  const labelOf = (t: string | null) => (t === 'rock' ? '石头' : t === 'scissors' ? '剪刀' : t === 'paper' ? '布' : '—');
  const last =
    r.lastPlayerThrow && r.lastAiThrow
      ? `<p class="ai-minigame-rps-last">你出${labelOf(r.lastPlayerThrow)} · 她出${labelOf(r.lastAiThrow)}${
          r.lastRoundOutcome === 1 ? '——这局你赢' : r.lastRoundOutcome === -1 ? '——这局她赢' : '——平手'
        }</p>`
      : '<p class="ai-minigame-rps-last">三局两胜，出拳吧</p>';
  const canThrow = snapshot.active && snapshot.turn === 'player';
  return `
    <div class="ai-minigame-rps" style="background-image:url('${part('panel_dark')}')">
      <p class="ai-minigame-rps-score">第 ${r.round} 局 · 你 ${r.playerWins} : ${r.aiWins} 她</p>
      ${last}
      <div class="ai-minigame-rps-btns">
        <button type="button" data-mg-rps="rock" ${canThrow ? '' : 'disabled'}>✊ 石头</button>
        <button type="button" data-mg-rps="scissors" ${canThrow ? '' : 'disabled'}>✌️ 剪刀</button>
        <button type="button" data-mg-rps="paper" ${canThrow ? '' : 'disabled'}>🖐 布</button>
      </div>
    </div>`;
}

function renderFooter(state: PanelState, snapshot: NonNullable<ReturnType<typeof getMiniGameSnapshotForUi>>, characterId: string): string {
  if (!snapshot.active && snapshot.result) {
    const stake = getMiniGameStakeForUi(characterId);
    const hint = stake
      ? stake.winner === 'player'
        ? '你赢了——可以说一件想让她做的事（她可以选择做或不做）'
        : '她赢了——她可能会提个小要求，由你定夺'
      : snapshot.result === 'draw'
        ? '平局，意犹未尽'
        : '';
    return `
      ${hint ? `<p class="ai-minigame-stake">${hint}</p>` : ''}
      <button type="button" class="ai-minigame-pillbtn" data-mg-dismiss style="background-image:url('${part('pill_back')}')">收起</button>`;
  }
  if (state.confirmQuit) {
    return `
      <p class="ai-minigame-quitwarn">现在退出算你输，还会扣 3 点好感。确定？</p>
      <div class="ai-minigame-quitrow">
        <button type="button" class="ai-minigame-pillbtn" data-mg-quit-yes style="background-image:url('${part('pill_back')}')">确定退出</button>
        <button type="button" class="ai-minigame-pillbtn" data-mg-quit-no style="background-image:url('${part('pill_restart')}')">继续玩</button>
      </div>`;
  }
  return `<button type="button" class="ai-minigame-pillbtn" data-mg-quit style="background-image:url('${part('pill_back')}')">退出对局</button>`;
}

function fullRender(state: PanelState, characterId: string): void {
  const snapshot = getMiniGameSnapshotForUi();
  const mine = snapshot && snapshot.characterId === characterId ? snapshot : null;
  const root = state.root;

  if (!mine) {
    root.hidden = true;
    state.renderKey = '';
    return;
  }

  const finishedKey = `${mine.characterId}|${mine.kind}|${mine.result ?? ''}`;
  if (!mine.active && mine.result && state.dismissKey === finishedKey) {
    root.hidden = true;
    state.renderKey = '';
    return;
  }

  // 结构 key：对局身份 + 棋局/比分 + 回合 + 终局 + 确认态；计时条由 interval 单独刷
  const structKey = mine.active
    ? mine.kind === 'gomoku'
      ? `${characterId}|g|${mine.gomoku?.board.join('') ?? ''}|${mine.turn}|${state.confirmQuit ? 1 : 0}`
      : `${characterId}|r|${mine.rps?.round}|${mine.rps?.playerWins}|${mine.rps?.aiWins}|${mine.rps?.lastPlayerThrow}|${mine.rps?.lastAiThrow}|${mine.turn}|${state.confirmQuit ? 1 : 0}`
    : `${finishedKey}|done`;
  if (structKey === state.renderKey && !root.hidden) return;
  state.renderKey = structKey;
  root.hidden = false;

  const pill = statusPill(mine.kind, mine.active, mine.turn, mine.result);
  const title =
    mine.kind === 'gomoku'
      ? `<img class="ai-minigame-title" src="${part('title_bar')}" alt="GOMOKU" />`
      : '<p class="ai-minigame-title-text">猜拳 · 三局两胜</p>';

  root.innerHTML = `
    <button type="button" class="ai-minigame-close" data-mg-close aria-label="关闭">
      <img src="${part('btn_close')}" alt="" />
    </button>
    ${title}
    <div class="ai-minigame-status">
      <img src="${pill.img}" alt="" />
      <span>${pill.text}</span>
    </div>
    <div class="ai-minigame-timer" style="background-image:url('${part('timer_frame')}')" ${mine.active ? '' : 'hidden'}>
      <div class="ai-minigame-timer-bar" data-mg-timerbar></div>
      <span class="ai-minigame-timer-num" data-mg-timernum></span>
    </div>
    ${mine.kind === 'gomoku' ? renderBoard(state, mine) : renderRps(mine)}
    ${renderFooter(state, mine, characterId)}
  `;
  updateTimer(state);
}

function updateTimer(state: PanelState): void {
  const bar = state.root.querySelector<HTMLElement>('[data-mg-timerbar]');
  if (!bar) return;
  const snapshot = getMiniGameSnapshotForUi();
  const num = state.root.querySelector<HTMLElement>('[data-mg-timernum]');
  if (!snapshot?.active) {
    bar.style.width = '0%';
    if (num) num.textContent = '';
    return;
  }
  const pct = Math.max(0, Math.min(100, (snapshot.remainMs / 60000) * 100));
  bar.style.width = `${pct}%`;
  bar.classList.toggle('is-low', snapshot.remainMs <= 10_000);
  if (num) num.textContent = `${Math.ceil(snapshot.remainMs / 1000)}s`;
}

function handleClick(state: PanelState, ev: MouseEvent): void {
  const t = ev.target as HTMLElement;

  const rpsBtn = t.closest<HTMLButtonElement>('[data-mg-rps]');
  if (rpsBtn && !rpsBtn.disabled) {
    playUiSound('tap');
    const r = miniGameRpsThrowNow(rpsBtn.dataset.mgRps as RpsThrow);
    if (r.systemLine) state.hooks.appendLog('系统', r.systemLine);
    else if (!r.ok) state.hooks.appendLog('系统', `【系统】${r.msg}`);
    state.renderKey = '';
    fullRender(state, state.root.dataset.mgChar ?? '');
    return;
  }

  const board = t.closest<HTMLElement>('[data-mg-board]');
  if (board) {
    const snapshot = getMiniGameSnapshotForUi();
    if (!snapshot?.active || snapshot.turn !== 'player') return;
    const idx = boardIdxFromPoint(board, ev.clientX, ev.clientY);
    if (idx < 0) return;
    playUiSound('tap');
    const r = miniGameGomokuMoveNow(idx);
    if (r.systemLine) state.hooks.appendLog('系统', r.systemLine);
    else if (!r.ok) state.hooks.appendLog('系统', `【系统】${r.msg}`);
    state.renderKey = '';
    fullRender(state, state.root.dataset.mgChar ?? '');
    return;
  }

  if (t.closest('[data-mg-quit-yes]')) {
    playUiSound('tap');
    state.confirmQuit = false;
    const line = quitMiniGameNow('主动退出对局');
    if (line) state.hooks.appendLog('系统', line);
    state.renderKey = '';
    fullRender(state, state.root.dataset.mgChar ?? '');
    return;
  }
  if (t.closest('[data-mg-quit-no]')) {
    playUiSound('tap');
    state.confirmQuit = false;
    state.renderKey = '';
    fullRender(state, state.root.dataset.mgChar ?? '');
    return;
  }
  if (t.closest('[data-mg-quit]')) {
    playUiSound('tap');
    state.confirmQuit = true;
    state.renderKey = '';
    fullRender(state, state.root.dataset.mgChar ?? '');
    return;
  }
  if (t.closest('[data-mg-dismiss]')) {
    playUiSound('tap');
    const snapshot = getMiniGameSnapshotForUi();
    if (snapshot) {
      state.dismissKey = `${snapshot.characterId}|${snapshot.kind}|${snapshot.result ?? ''}`;
    }
    state.renderKey = '';
    fullRender(state, state.root.dataset.mgChar ?? '');
    return;
  }
  if (t.closest('[data-mg-close]')) {
    const snapshot = getMiniGameSnapshotForUi();
    if (snapshot?.active) {
      // 对局未结束就关面板 = 中途退出（判负 + 扣好感），先二次确认
      playUiSound('tap');
      state.confirmQuit = true;
      state.renderKey = '';
      fullRender(state, state.root.dataset.mgChar ?? '');
    } else if (snapshot) {
      playUiSound('tap');
      state.dismissKey = `${snapshot.characterId}|${snapshot.kind}|${snapshot.result ?? ''}`;
      state.renderKey = '';
      fullRender(state, state.root.dataset.mgChar ?? '');
    }
    return;
  }
}

function ensurePanel(overlay: HTMLElement, hooks: MiniGamePanelHooks): PanelState {
  let state = panels.get(overlay);
  if (state) return state;
  const stage = overlay.querySelector<HTMLElement>('.ai-immersive-stage') ?? overlay;
  const root = document.createElement('div');
  root.className = 'ai-minigame-panel';
  root.hidden = true;
  stage.appendChild(root);
  state = { root, hooks, dismissKey: null, confirmQuit: false, renderKey: '', timerId: 0 };
  root.addEventListener('click', (ev) => handleClick(state as PanelState, ev));
  state.timerId = window.setInterval(() => {
    if (!document.body.contains(overlay)) {
      unmountMiniGamePanel(overlay);
      return;
    }
    updateTimer(state as PanelState);
  }, 250);
  panels.set(overlay, state);
  return state;
}

/** 聊天页节拍调用：同步小游戏面板（创建/刷新/隐藏） */
export function syncMiniGamePanel(overlay: HTMLElement, characterId: string, hooks: MiniGamePanelHooks): void {
  const state = ensurePanel(overlay, hooks);
  state.hooks = hooks;
  if (state.root.dataset.mgChar !== characterId) {
    state.root.dataset.mgChar = characterId;
    state.dismissKey = null;
    state.confirmQuit = false;
    state.renderKey = '';
  }
  fullRender(state, characterId);
}

/** 对话页关闭时调用：清计时器并移除面板（对局结算由 overlay 的 close 另行处理） */
export function unmountMiniGamePanel(overlay: HTMLElement): void {
  const state = panels.get(overlay);
  if (!state) return;
  window.clearInterval(state.timerId);
  state.root.remove();
  panels.delete(overlay);
}
