/**
 * 营地小游戏事件会话：五子棋 / 猜拳（石头剪刀布·三局两胜）。
 *
 * - 地点：娱乐间（room_2f_yule）或大厅（1F 大厅1/大厅2、2F 西大厅/中庭/南大厅）；
 *   其他房间的角色发起/应邀时自动叫到娱乐间（身体锚点 + 议程），保证三通道（按钮/打字/语音）等效。
 * - 邀请制：指挥官按钮 / 打字 / 语音等效；角色也可主动邀请（出确认条）；可拒绝（活人定律）。
 * - 独立事件：进行中与其它事件互斥；其它事件也不得打断它。
 * - 计时：每手 60s（TURN_LIMIT_MS），超时方判负；AI 行棋延迟 2–6s（“思考中”）。
 * - 落子/出拳由本地引擎计算（gomoku/rps），LLM 只负责聊天与情绪，不出坐标。
 * - 中途退出/关闭对话 → 退出方判负；玩家退出额外 adjustAffinity(-3) + 记忆“中途离场”。
 * - 输赢轻微影响心情（applyMoodImpulse event up/down）；记忆只记输赢与心情，不记棋谱。
 * - 赛后 stake（随性，4 回合窗）：玩家赢→玩家说一件营地事件范畴的“惩罚”，AI 选做/不做；
 *   AI 赢→AI 提个小要求（礼物/营地事件），玩家可应可拒。纯叙事层，不做机械强制。
 *
 * 见 docs/ai-first-principle.md 与 src/ai/danceSession.ts（同构会话模板）。
 */
import { CHARACTER_MAP } from '../data/characters';
import { CAMP_ROOM_MAP } from '../data/campLayout';
import type { SaveData } from '../types';
import {
  aiChooseGomokuMove,
  checkGomokuWin,
  createGomokuBoard,
  GOMOKU_AI,
  GOMOKU_PLAYER,
  gomokuBoardFull,
  gomokuCoordName,
  gomokuSituation,
} from '../game/miniGames/gomoku';
import {
  aiChooseRpsThrow,
  resolveRpsRound,
  rpsMatchResult,
  rpsThrowLabel,
  type RpsThrow,
} from '../game/miniGames/rps';
import { isAnfuActiveFor } from './anfuSession';
import { isBathAssistActiveFor } from './bathAssistSession';
import { clearAgenda, getAgenda, setAgenda } from './characterAgenda';
import { isDanceActiveFor } from './danceSession';
import { isDisciplineActiveFor } from './disciplineSession';
import { recordPlayerActivityRequest } from './activityFatigue';
import { resolvePresence } from './livingState';
import { pushMemory, pushRecentChat } from './memory';
import { applyMoodImpulse } from './moodContinuum';
import { adjustAffinity } from './relationship';
import { isInSleepSystem, leaveSleepSystem, sleepWakeDifficulty } from './sleepSystem';
import type { AiLivingSave, CharacterActivity } from './types';

/** 允许小游戏的房间：娱乐间 + 各大厅 */
export const MINIGAME_ROOM_IDS = [
  'room_2f_yule',
  'room_1f_hall1',
  'room_1f_hall2',
  'room_2f_hall_west',
  'room_2f_atrium',
  'room_2f_lounge',
];

export function isMiniGameRoom(roomId: string | null | undefined): boolean {
  return !!roomId && MINIGAME_ROOM_IDS.includes(roomId);
}

/** 每手限时（超时方判负） */
export const TURN_LIMIT_MS = 60_000;
/** AI 行棋思考延迟区间（“思考中”） */
export const AI_THINK_MIN_MS = 2_000;
export const AI_THINK_MAX_MS = 6_000;
/** 玩家中途退出的好感惩罚 */
export const MINIGAME_QUIT_AFFINITY = -3;
/** 赛后 stake 有效回合数 */
export const STAKE_TURNS = 4;
/** stake 挂起兜底过期（无对话时自动失效） */
export const STAKE_EXPIRE_MS = 30 * 60_000;

export type MiniGameKind = 'gomoku' | 'rps';
export type MiniGameResult = 'player_win' | 'ai_win' | 'draw';
export type MiniGameEntrySource = 'player_button' | 'player_chat' | 'character_invite' | 'recover';

export type MiniGameGomokuState = {
  board: number[];
  /** 落子顺序（最新在尾） */
  history: number[];
  lastMove: number | null;
};

export type MiniGameRpsState = {
  round: number;
  playerWins: number;
  aiWins: number;
  lastPlayerThrow?: RpsThrow | null;
  lastAiThrow?: RpsThrow | null;
  lastRoundOutcome?: 1 | 0 | -1 | null;
};

export type MiniGameSessionState = {
  active: boolean;
  characterId: string;
  kind: MiniGameKind;
  /** 当前应手方 */
  turn: 'player' | 'ai';
  startedAt: number;
  entrySource: MiniGameEntrySource;
  /** 当前手截止时间（超时判负） */
  turnDeadlineMs: number;
  /** 五子棋 AI 落子时刻（思考延迟） */
  aiMoveAtMs?: number;
  gomoku?: MiniGameGomokuState;
  rps?: MiniGameRpsState;
  result?: MiniGameResult | null;
  resultReason?: string;
  justEntered?: boolean;
  justLeft?: boolean;
  justLeftTurnsLeft?: number;
  settling?: boolean;
};

/** 指挥官提出小游戏后，等待角色本轮回应 */
export type MiniGamePlayerAskPending = {
  characterId: string;
  kind: MiniGameKind;
  proposedAt: number;
};

/** 角色主动邀请（待指挥官确认） */
export type MiniGameInvitePending = {
  characterId: string;
  kind: MiniGameKind;
  proposedAt: number;
  dayIndex: number;
  preview: string;
};

/** 赛后奖惩窗（随性 stake） */
export type MiniGameStakeState = {
  characterId: string;
  winner: 'player' | 'ai';
  kind: MiniGameKind;
  proposedAt: number;
  turnsLeft: number;
};

export function miniGameKindLabel(kind: MiniGameKind): string {
  return kind === 'gomoku' ? '五子棋' : '猜拳';
}

export function getMiniGameSession(living: AiLivingSave): MiniGameSessionState | null {
  const s = living.miniGameSession;
  if (!s?.active || !s.characterId) return null;
  return s;
}

export function isMiniGameActiveFor(living: AiLivingSave, characterId: string): boolean {
  const s = getMiniGameSession(living);
  return !!s && s.characterId === characterId;
}

/** 该角色当前是否可发起小游戏（无互斥事件/无互斥待定） */
export function canPlayMiniGame(living: AiLivingSave, characterId: string): boolean {
  if (!CHARACTER_MAP[characterId]) return false;
  if (isDanceActiveFor(living, characterId)) return false;
  if (isAnfuActiveFor(living, characterId)) return false;
  if (isBathAssistActiveFor(living, characterId)) return false;
  if (isDisciplineActiveFor(living, characterId)) return false;
  const cur = getMiniGameSession(living);
  if (cur && cur.characterId !== characterId) return false;
  return true;
}

/** 聊天页小游戏按钮显示条件：在对局中（可退出）或可发起（无互斥事件）。
 *  不再限制房间——不在娱乐间/大厅的角色发起时会被自动叫到娱乐间。 */
export function canShowMiniGameButtons(living: AiLivingSave, characterId: string): boolean {
  if (isMiniGameActiveFor(living, characterId)) return true;
  if (!canPlayMiniGame(living, characterId)) return false;
  const room = resolvePresence(characterId, living).roomId;
  return !!room;
}

function miniGameBehavior(kind: MiniGameKind): string {
  return kind === 'gomoku' ? '与指挥官下五子棋' : '与指挥官猜拳';
}

function lockAgenda(living: AiLivingSave, characterId: string, kind: MiniGameKind): void {
  const room = resolvePresence(characterId, living).roomId;
  const activity: CharacterActivity = 'play';
  setAgenda(living, characterId, {
    goal: 'minigame',
    targetRoomId: room || 'room_2f_yule',
    activity,
    behavior: miniGameBehavior(kind),
    remainGameMin: 120,
    startedGameMin: living.gameMinutes,
    reason: `来一局${miniGameKindLabel(kind)}`,
    source: 'social',
  });
}

function unlockAgenda(living: AiLivingSave, characterId: string): void {
  const a = getAgenda(living, characterId);
  if (a?.goal === 'minigame') clearAgenda(living, characterId);
}

function randomThinkMs(): number {
  return AI_THINK_MIN_MS + Math.floor(Math.random() * (AI_THINK_MAX_MS - AI_THINK_MIN_MS));
}

/**
 * 对局事实写入 AI 对话历史（与安抚室 anfuSession 的「系统事实」同构）。
 * 出拳/落子/终局此前只进 UI 日志（appendLog/miniGameUiFlash），LLM 完全看不见——
 * 这是"她不知道自己出过什么/不知道自己赢了/终局后还催促出拳"的直接根因。
 * recentChats 是跨回合持久的，比 justLeft 的 2 回合衰减窗可靠。
 */
function pushGameFact(living: AiLivingSave, characterId: string, text: string): void {
  pushRecentChat(living, characterId, 'user', `【系统事实·已生效】${text}`);
}

export type MiniGameEnterResult = { ok: boolean; msg: string; systemLine?: string };

/** 进入小游戏会话（不换皮；不在娱乐间/大厅的角色自动叫到娱乐间开局） */
export function enterMiniGameSession(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  kind: MiniGameKind,
  entrySource: MiniGameEntrySource = 'player_button',
): MiniGameEnterResult {
  if (!CHARACTER_MAP[characterId]) return { ok: false, msg: '角色不存在' };
  if (isDanceActiveFor(living, characterId)) return { ok: false, msg: '正在跳舞，无法同时玩小游戏' };
  if (isAnfuActiveFor(living, characterId)) return { ok: false, msg: '正在安抚室，无法同时玩小游戏' };
  if (isBathAssistActiveFor(living, characterId)) return { ok: false, msg: '正在冲澡/浴室互动中，无法玩小游戏' };
  if (isDisciplineActiveFor(living, characterId)) return { ok: false, msg: '当前事件中无法玩小游戏' };

  const existing = getMiniGameSession(living);
  if (existing) {
    if (existing.characterId !== characterId) return { ok: false, msg: '另一名角色正在对局中' };
    return { ok: true, msg: '已经在对局中' };
  }

  let room = resolvePresence(characterId, living).roomId;
  let relocated = false;
  if (!isMiniGameRoom(room)) {
    // 她在别的房间：自动叫到娱乐间开局（身体锚点让位置/场景立即切换，议程锁定期间不被作息表拉走）
    room = 'room_2f_yule';
    relocated = true;
    if (!living.bodyAnchors) living.bodyAnchors = {};
    const prevAnchor = living.bodyAnchors[characterId];
    living.bodyAnchors[characterId] = {
      roomId: room,
      activity: 'play',
      behavior: miniGameBehavior(kind),
      atGameMin: living.gameMinutes,
      seq: (prevAnchor?.seq ?? 0) + 1,
    };
  }

  if (isInSleepSystem(living, characterId)) {
    const diff = sleepWakeDifficulty(living, characterId);
    if (!diff.wakeable) {
      return { ok: false, msg: '她睡得太沉，叫不醒——改天再玩吧' };
    }
    leaveSleepSystem(living, characterId, { reason: `被指挥官叫去玩${miniGameKindLabel(kind)}`, completed: false });
  }

  const now = Date.now();
  const session: MiniGameSessionState = {
    active: true,
    characterId,
    kind,
    turn: 'player',
    startedAt: now,
    entrySource,
    turnDeadlineMs: now + TURN_LIMIT_MS,
    result: null,
    justEntered: true,
    justLeft: false,
    justLeftTurnsLeft: 0,
  };
  if (kind === 'gomoku') {
    session.gomoku = { board: createGomokuBoard(), history: [], lastMove: null };
  } else {
    session.rps = { round: 1, playerWins: 0, aiWins: 0, lastPlayerThrow: null, lastAiThrow: null, lastRoundOutcome: null };
  }
  living.miniGameSession = session;

  lockAgenda(living, characterId, kind);
  living.pendingMiniGameInvite = undefined;
  clearPlayerMiniGameAsk(living, characterId);

  // 重复活动厌倦：今天第 N 次拉她玩小游戏（超耐心阈值会打厌倦脉冲）
  recordPlayerActivityRequest(living, characterId, 'minigame');

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const label = miniGameKindLabel(kind);
  const place = CAMP_ROOM_MAP[room]?.label ?? '娱乐间';
  const relocateNote = relocated ? `你把她叫到了${place}，` : '';
  const rule =
    kind === 'gomoku'
      ? '指挥官执黑先手，轮流落子，先连成五子者胜'
      : '三局两胜，双方同时出拳';
  const systemLine = `【系统】${name}答应来一局${label}（${place}）：${relocateNote}${rule}；每手限时 60 秒，超时判负。`;
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `${name}与指挥官开始玩${label}（${place}${relocated ? '，临时叫过来' : ''}，来源：${entrySource}）`,
    importance: 5,
  });
  pushRecentChat(
    living,
    characterId,
    'user',
    `【系统事实·已生效】${name}已经答应玩${label}，此刻对局开始（${rule}；每手限时 60 秒）。禁止说还没答应/在做别的事；棋着与出拳由系统播报，你只负责聊天、情绪与反应。`,
  );
  return { ok: true, msg: `对局开始：${label}`, systemLine };
}

/** 结算对局：心情/记忆/stake/系统行，并收尾会话 */
function settleGame(
  save: SaveData,
  living: AiLivingSave,
  result: MiniGameResult,
  reason: string,
): void {
  const s = getMiniGameSession(living);
  if (!s || s.settling) return;
  s.settling = true;
  const characterId = s.characterId;
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const label = miniGameKindLabel(s.kind);

  s.result = result;
  s.resultReason = reason;

  // 心情：输赢轻微直接影响（draw 不动）
  if (result === 'ai_win') applyMoodImpulse(living, characterId, { kind: 'event', tone: 'up' });
  else if (result === 'player_win') applyMoodImpulse(living, characterId, { kind: 'event', tone: 'down' });

  // 记忆：只记输赢与心情，不记棋谱
  const moodNote =
    result === 'ai_win' ? '她赢了，心情不错' : result === 'player_win' ? '她输了，有点不服气' : '平局，意犹未尽';
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `与指挥官玩${label}：${moodNote}（${reason}）`,
    importance: 4,
  });

  // stake 窗（平局不产生）
  if (result !== 'draw') {
    living.miniGameStake = {
      characterId,
      winner: result === 'player_win' ? 'player' : 'ai',
      kind: s.kind,
      proposedAt: Date.now(),
      turnsLeft: STAKE_TURNS,
    };
  }

  const resultText =
    result === 'player_win' ? '指挥官获胜' : result === 'ai_win' ? `${name}获胜` : '平局';
  living.miniGameUiFlash = `【系统】${label}对局结束：${resultText}（${reason}）。`;
  // 终局事实写入对话历史：所有结束路径（终胜/超时/退出/离场/认输）都经此处，
  // 保证她下一回合一定知道自己赢了/输了，不再催促出拳。
  const scoreNote =
    s.kind === 'rps' && s.rps ? `，最终比分 指挥官 ${s.rps.playerWins} : ${s.rps.aiWins} ${name}` : '';
  pushGameFact(
    living,
    characterId,
    `${label}对局已结束：${resultText}（${reason}${scoreNote}）。对局已终结：禁止再催促出拳/落子、禁止描写棋局仍在进行，只对结果做情绪反应。`,
  );

  finishSession(living, s);
}

/** 会话收尾（幂等）：解锁议程、留 justLeft 供 Prompt */
function finishSession(living: AiLivingSave, s: MiniGameSessionState): void {
  unlockAgenda(living, s.characterId);
  living.miniGameSession = {
    ...s,
    active: false,
    settling: false,
    justEntered: false,
    justLeft: true,
    justLeftTurnsLeft: 2,
    aiMoveAtMs: undefined,
  };
}

/** 玩家中途退出/关闭对话：判负 + 扣好感 + 记“中途离场”（强制结算，任何场景都必须走通） */
export function quitMiniGameByPlayer(
  save: SaveData,
  living: AiLivingSave,
  reason: string,
): MiniGameEnterResult {
  const s = getMiniGameSession(living);
  if (!s) return { ok: false, msg: '未在对局中' };
  // 历史会话若残留 settling=true（异常中断），会令一切结算静默失效 —— 强制清掉
  s.settling = false;
  const characterId = s.characterId;
  settleGame(save, living, 'ai_win', `指挥官中途离场（${reason}）`);
  adjustAffinity(living, characterId, MINIGAME_QUIT_AFFINITY);
  // 被晾在半局：虽按规则"她赢"，真实情绪是扫兴/被敷衍 → 心情 down 覆盖结算的 up
  applyMoodImpulse(living, characterId, { kind: 'event', tone: 'down' });
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `指挥官玩到一半离开了（${reason}），${name}有点扫兴`,
    importance: 5,
  });
  return { ok: true, msg: '已中途退出：判负并结算', systemLine: living.miniGameUiFlash };
}

/** 角色认输/不想玩了（minigame_action=quit）：玩家胜，不扣好感 */
export function aiQuitMiniGame(save: SaveData, living: AiLivingSave): MiniGameEnterResult {
  const s = getMiniGameSession(living);
  if (!s) return { ok: false, msg: '未在对局中' };
  settleGame(save, living, 'player_win', '她认输离场');
  return { ok: true, msg: '她认输了', systemLine: living.miniGameUiFlash };
}

// ——— 对局操作 ———

export type MiniGameMoveResult = { ok: boolean; msg: string; systemLine?: string };

/** 玩家落子（五子棋） */
export function playerGomokuMove(save: SaveData, living: AiLivingSave, idx: number): MiniGameMoveResult {
  const s = getMiniGameSession(living);
  if (!s || s.kind !== 'gomoku' || !s.gomoku) return { ok: false, msg: '不在五子棋对局中' };
  if (s.turn !== 'player') return { ok: false, msg: '还没轮到你' };
  if (idx < 0 || idx >= s.gomoku.board.length || s.gomoku.board[idx] !== 0) {
    return { ok: false, msg: '这个位置不能落子' };
  }
  const now = Date.now();
  s.gomoku.board[idx] = GOMOKU_PLAYER;
  s.gomoku.history.push(idx);
  s.gomoku.lastMove = idx;
  const name = CHARACTER_MAP[s.characterId]?.name ?? s.characterId;
  const coord = gomokuCoordName(idx);

  if (checkGomokuWin(s.gomoku.board, idx)) {
    settleGame(save, living, 'player_win', `指挥官在 ${coord} 连成五子`);
    return { ok: true, msg: '你赢了', systemLine: living.miniGameUiFlash };
  }
  if (gomokuBoardFull(s.gomoku.board)) {
    settleGame(save, living, 'draw', '棋盘下满');
    return { ok: true, msg: '平局', systemLine: living.miniGameUiFlash };
  }
  // 对局继续才写"轮到她"：致胜/终局落子只写终局事实，避免"该我了"式过期指令
  pushGameFact(living, s.characterId, `五子棋：指挥官落子 ${coord}，轮到${name}。`);
  s.turn = 'ai';
  s.aiMoveAtMs = now + randomThinkMs();
  s.turnDeadlineMs = now + TURN_LIMIT_MS;
  return { ok: true, msg: `已落子 ${coord}`, systemLine: `【系统】你落子 ${coord}，轮到${name}。` };
}

/** 玩家出拳（猜拳） */
export function playerRpsThrow(save: SaveData, living: AiLivingSave, playerThrow: RpsThrow): MiniGameMoveResult {
  const s = getMiniGameSession(living);
  if (!s || s.kind !== 'rps' || !s.rps) return { ok: false, msg: '不在猜拳对局中' };
  if (s.turn !== 'player') return { ok: false, msg: '还没轮到你' };
  const now = Date.now();
  const aiThrow = aiChooseRpsThrow(s.characterId);
  const outcome = resolveRpsRound(playerThrow, aiThrow);
  const r = s.rps;
  r.lastPlayerThrow = playerThrow;
  r.lastAiThrow = aiThrow;
  r.lastRoundOutcome = outcome;
  if (outcome === 1) r.playerWins++;
  else if (outcome === -1) r.aiWins++;
  if (outcome !== 0) r.round++;

  const name = CHARACTER_MAP[s.characterId]?.name ?? s.characterId;
  const roundText = `你出${rpsThrowLabel(playerThrow)}，${name}出${rpsThrowLabel(aiThrow)}——${
    outcome === 1 ? '这局你赢' : outcome === -1 ? '这局她赢' : '平手，再来'
  }`;
  // 出拳事实写入对话历史：她必须知道自己刚出了什么、当前比分（用名字不用"你"，避免模型混淆指代）
  pushGameFact(
    living,
    s.characterId,
    `猜拳：指挥官出${rpsThrowLabel(playerThrow)}，${name}出${rpsThrowLabel(aiThrow)}——${
      outcome === 1 ? '这局指挥官赢' : outcome === -1 ? `这局${name}赢` : '平手，这局不计分'
    }；当前比分 指挥官 ${r.playerWins} : ${r.aiWins} ${name}。`,
  );

  const winner = rpsMatchResult(r.playerWins, r.aiWins);
  if (winner) {
    settleGame(save, living, winner === 'player' ? 'player_win' : 'ai_win', `猜拳 ${r.playerWins}:${r.aiWins}`);
    return { ok: true, msg: roundText, systemLine: `【系统】${roundText}。${living.miniGameUiFlash ?? ''}` };
  }
  s.turnDeadlineMs = now + TURN_LIMIT_MS;
  return {
    ok: true,
    msg: roundText,
    systemLine: `【系统】${roundText}（当前 ${r.playerWins}:${r.aiWins}）。`,
  };
}

/**
 * 推进小游戏会话（世界 tick / 对话页 1s 节拍调用）：
 * - 超时判负（当前应手方时间耗尽）
 * - 五子棋 AI 思考到点 → 引擎落子
 * - 角色被挪出游戏室/大厅 → 视为她中途离场（玩家胜）
 * - stake 挂起过期清理
 */
export function tickMiniGameSession(save: SaveData, living: AiLivingSave, now = Date.now()): void {
  // stake 过期兜底
  const stake = living.miniGameStake;
  if (stake && (stake.turnsLeft <= 0 || now - stake.proposedAt > STAKE_EXPIRE_MS)) {
    living.miniGameStake = undefined;
  }

  const s = getMiniGameSession(living);
  if (!s) return;

  // 她不在游戏房间了 → 她中途离场
  const room = resolvePresence(s.characterId, living).roomId;
  if (room && !isMiniGameRoom(room)) {
    settleGame(save, living, 'player_win', '她中途离开了对局');
    return;
  }

  // 超时判负
  if (now >= s.turnDeadlineMs) {
    if (s.turn === 'player') {
      settleGame(save, living, 'ai_win', '指挥官超时未出手（60 秒）');
    } else {
      settleGame(save, living, 'player_win', '她超时未落子（60 秒）');
    }
    return;
  }

  // 五子棋 AI 思考到点
  if (s.kind === 'gomoku' && s.gomoku && s.turn === 'ai' && s.aiMoveAtMs && now >= s.aiMoveAtMs) {
    const idx = aiChooseGomokuMove(s.gomoku.board);
    if (idx < 0) {
      settleGame(save, living, 'draw', '无子可下');
      return;
    }
    s.aiMoveAtMs = undefined;
    s.gomoku.board[idx] = GOMOKU_AI;
    s.gomoku.history.push(idx);
    s.gomoku.lastMove = idx;
    const coord = gomokuCoordName(idx);
    const name = CHARACTER_MAP[s.characterId]?.name ?? s.characterId;
    if (checkGomokuWin(s.gomoku.board, idx)) {
      settleGame(save, living, 'ai_win', `${name}在 ${coord} 连成五子`);
      return;
    }
    if (gomokuBoardFull(s.gomoku.board)) {
      settleGame(save, living, 'draw', '棋盘下满');
      return;
    }
    s.turn = 'player';
    s.turnDeadlineMs = now + TURN_LIMIT_MS;
    living.miniGameUiFlash = `【系统】${name}落子 ${coord}，轮到你。`;
    pushGameFact(living, s.characterId, `五子棋：${name}落子 ${coord}，轮到指挥官。`);
  }
}

/** 读档/异常恢复：按玩家中途离场结算（含好感惩罚，用户定稿规则） */
export function recoverStaleMiniGameSession(save: SaveData, living: AiLivingSave): boolean {
  const s = getMiniGameSession(living);
  if (!s) return false;
  quitMiniGameByPlayer(save, living, '读档/异常自动结算');
  return true;
}

// ——— 对白检测（文本/语音等效） ———

export const PLAYER_ASKS_GOMOKU = /五子棋|下盘棋|下盘五子棋|来盘棋|下(?:一局|一盘)棋|来下棋|陪我下棋/;
// 语音/打字触发修复：必须覆盖「剪刀石头布」——最常用说法，与「石头剪刀布」字序不同。
// 此前缺失导致语音说"开始剪刀石头布"完全不登记邀请（角色只口头答应、事件从未挂起）。
export const PLAYER_ASKS_RPS = /猜拳|石头剪刀布|剪刀石头布|石头剪子布|剪刀剪子布|剪子包袱锤|包剪锤/;
export const AI_PROPOSES_GOMOKU = /五子棋|下盘棋|来盘棋|陪你下棋|杀一盘/;
export const AI_PROPOSES_RPS = /猜拳|石头剪刀布|石头剪子布|剪刀石头布/;
// 同意判定修复：LLM 常不复述游戏名，只说"那我们开始吧"——补"开始吧/来一局/开一局"，
// 并允许同意词免 topical（见 resolvePlayerMiniGameAskFromTurn）
export const AI_AGREES_MINIGAME = /好的?|好啊|行啊?|可以|没问题|来吧|来就(?:来|谁怕谁)|那就|陪你|嗯+|同意|当然|乐意|答应|谁怕谁|开始吧|来一局|开一局|我们开始/;
export const AI_REFUSES_MINIGAME = /不(?:行|要|想|玩)|拒绝|改天|下次|现在不行|先别|没空|累了|不想玩/;
export const AI_HEDGES_MINIGAME =
  /先.*(处理|忙|准备|收拾|看看|把手头|换|整理|交代|收尾)|等一下|稍等|等我把|等我先|过一会儿|待会儿|等会儿|回头|再说|还没(?:好|准备)/;
const MINIGAME_TOPIC = /五子棋|下棋|棋|猜拳|石头剪刀布|对局|来一局|玩一(?:局|盘)|输赢/;

export function detectPlayerMiniGameKind(text: string): MiniGameKind | null {
  const t = text || '';
  if (PLAYER_ASKS_GOMOKU.test(t)) return 'gomoku';
  if (PLAYER_ASKS_RPS.test(t)) return 'rps';
  return null;
}

export function detectAiMiniGamePropose(text: string): MiniGameKind | null {
  const t = text || '';
  if (AI_PROPOSES_GOMOKU.test(t)) return 'gomoku';
  if (AI_PROPOSES_RPS.test(t)) return 'rps';
  return null;
}

export function detectAiAgreesMiniGame(text: string): boolean {
  const t = text || '';
  if (!t.trim()) return false;
  if (AI_REFUSES_MINIGAME.test(t) && !AI_AGREES_MINIGAME.test(t)) return false;
  return AI_AGREES_MINIGAME.test(t);
}

export function detectAiRefusesMiniGame(text: string): boolean {
  const t = text || '';
  if (!t.trim()) return false;
  return AI_REFUSES_MINIGAME.test(t) && !/但是|不过|虽然/.test(t.slice(0, 12));
}

/** minigame_action 字段：propose_gomoku|propose_rps|start_gomoku|start_rps|quit|accept_stake|refuse_stake */
export function parseMiniGameActionField(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  if (!v || v === '""' || v === 'none' || v === 'null') return undefined;
  const valid = [
    'propose_gomoku',
    'propose_rps',
    'start_gomoku',
    'start_rps',
    'quit',
    'accept_stake',
    'refuse_stake',
  ];
  if (valid.includes(v)) return v;
  if (v === '认输' || v === '不玩了') return 'quit';
  if (v.includes('propose') && v.includes('gomoku')) return 'propose_gomoku';
  if (v.includes('propose') && v.includes('rps')) return 'propose_rps';
  if (v.includes('start') && v.includes('gomoku')) return 'start_gomoku';
  if (v.includes('start') && v.includes('rps')) return 'start_rps';
  if (v.includes('accept')) return 'accept_stake';
  if (v.includes('refuse')) return 'refuse_stake';
  return undefined;
}

// ——— 指挥官提出（按钮/打字/语音同一路径），等角色本轮回应 ———

export function setPlayerMiniGameAsk(
  living: AiLivingSave,
  characterId: string,
  kind: MiniGameKind,
): MiniGamePlayerAskPending | null {
  if (!canPlayMiniGame(living, characterId)) return null;
  if (getMiniGameSession(living)?.characterId === characterId) return null;

  const pending: MiniGamePlayerAskPending = {
    characterId,
    kind,
    proposedAt: Date.now(),
  };
  living.pendingPlayerMiniGameAsk = pending;
  if (living.pendingMiniGameInvite?.characterId === characterId) {
    living.pendingMiniGameInvite = undefined;
  }
  return pending;
}

export function clearPlayerMiniGameAsk(living: AiLivingSave, characterId?: string): void {
  const p = living.pendingPlayerMiniGameAsk;
  if (!p) return;
  if (characterId && p.characterId !== characterId) return;
  living.pendingPlayerMiniGameAsk = undefined;
}

export function getPlayerMiniGameAsk(
  living: AiLivingSave,
  characterId?: string,
): MiniGamePlayerAskPending | null {
  const p = living.pendingPlayerMiniGameAsk;
  if (!p) return null;
  if (characterId && p.characterId !== characterId) return null;
  return p;
}

/**
 * 角色愿意玩 → 只登记「待指挥官确认」的邀请条，不直接开局。
 */
export function offerMiniGameInviteFromTurn(
  living: AiLivingSave,
  characterId: string,
  kind: MiniGameKind,
): MiniGameInvitePending | null {
  if (isMiniGameActiveFor(living, characterId)) return null;
  if (!canPlayMiniGame(living, characterId)) return null;
  if (living.pendingMiniGameInvite?.characterId === characterId) {
    return living.pendingMiniGameInvite;
  }
  if (living.pendingPlayerMiniGameAsk?.characterId) return null;
  if (living.pendingDanceInvite?.characterId) return null;
  if (living.pendingDisciplineInvite?.characterId) return null;
  if (living.pendingBathAssistInvite?.characterId) return null;
  if (living.pendingAnfuInvite?.characterId) return null;
  if (living.pendingPlayerDanceAsk?.characterId) return null;
  if (living.pendingPlayerAnfuAsk?.characterId) return null;
  if (living.pendingPlayerBathAssistAsk?.characterId) return null;

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const label = miniGameKindLabel(kind);
  const pending: MiniGameInvitePending = {
    characterId,
    kind,
    proposedAt: Date.now(),
    dayIndex: living.dayIndex,
    preview: `${name}愿意和你来一局${label}，现在开始吗？`,
  };
  living.pendingMiniGameInvite = pending;
  return pending;
}

/** 角色本轮回应指挥官邀请 */
export function resolvePlayerMiniGameAskFromTurn(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  opts: { minigameAction?: string; dialogue: string; action?: string },
): MiniGameEnterResult | null {
  const pending = getPlayerMiniGameAsk(living, characterId);
  if (!pending) return null;

  const speech = `${opts.dialogue} ${opts.action ?? ''}`;
  const action = opts.minigameAction;
  const startMatch =
    (pending.kind === 'gomoku' && action === 'start_gomoku') ||
    (pending.kind === 'rps' && action === 'start_rps');
  const proposeMatch =
    (pending.kind === 'gomoku' && action === 'propose_gomoku') ||
    (pending.kind === 'rps' && action === 'propose_rps');
  const refused = action === 'quit' || detectAiRefusesMiniGame(speech);
  const hedged = AI_HEDGES_MINIGAME.test(speech);
  const topical =
    MINIGAME_TOPIC.test(speech) || detectAiMiniGamePropose(speech) === pending.kind;
  // 语音/打字触发修复：邀请挂起时提示块就是让她回答"愿不愿意玩"，她的回复天然是对邀请的
  // 答复。此前必须复述游戏关键词（topical）才算同意，但 LLM 常只说"那我们开始吧"，
  // 导致口头答应了、事件却从未挂起（用户实测主诉）。
  // 现在：fresh 窗口（邀请发出 5 分钟内）明确同意词免 topical；过窗后仍需 topical 防误触。
  const askFresh = Date.now() - pending.proposedAt < 5 * 60_000;
  const softAgree =
    askFresh &&
    !refused &&
    !hedged &&
    speech.trim().length > 0 &&
    speech.trim().length <= 24 &&
    /好的?|好啊?|行啊?|可以|来吧|来嘛|来一局|开一局|开始吧|我们开始|嗯+|奉陪|谁怕谁|试试|比划?一下/.test(speech);
  const agreed =
    !refused &&
    !hedged &&
    (startMatch ||
      softAgree ||
      (topical &&
        (proposeMatch || detectAiAgreesMiniGame(speech) || detectAiMiniGamePropose(speech) === pending.kind)));

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const label = miniGameKindLabel(pending.kind);

  if (refused && !startMatch) {
    clearPlayerMiniGameAsk(living, characterId);
    return {
      ok: false,
      msg: `${name}婉拒了「${label}」。`,
      systemLine: `【系统】${name}婉拒了「${label}」。`,
    };
  }
  if (!agreed) {
    if (hedged) {
      clearPlayerMiniGameAsk(living, characterId);
      return {
        ok: true,
        msg: `${name}还没答应，要先处理手头的事。`,
        systemLine: `【系统】${name}还没答应玩${label}——她要先处理手头的事，稍后再邀请一次。`,
      };
    }
    return null;
  }

  clearPlayerMiniGameAsk(living, characterId);
  return enterMiniGameSession(save, living, characterId, pending.kind, 'player_chat');
}

export function playerAffirmsMiniGameInvite(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (/不(?:行|要|玩)|拒绝|算了|下次/.test(t)) return false;
  return (
    /^(好|好的|行|嗯+|来|可以|来吧|开始|走起)([。.!！~～…]*)$/i.test(t) ||
    /来一局|开始吧|那就来|好啊/.test(t)
  );
}

export function playerRejectsMiniGameInvite(text: string): boolean {
  const t = (text || '').trim();
  return /不(?:行|要|玩)|拒绝|算了|下次再说|先不/.test(t);
}

// ——— 角色主动邀请 ———

export function maybeProposeMiniGameInvite(
  living: AiLivingSave,
  characterId: string,
  dialogue: string,
  kindHint?: MiniGameKind | null,
): MiniGameInvitePending | null {
  if (isMiniGameActiveFor(living, characterId)) return null;
  if (!canPlayMiniGame(living, characterId)) return null;
  if (living.pendingMiniGameInvite?.characterId === characterId) return null;
  if (living.pendingPlayerMiniGameAsk?.characterId) return null;
  if (living.pendingDanceInvite?.characterId) return null;
  if (living.pendingDisciplineInvite?.characterId) return null;
  if (living.pendingBathAssistInvite?.characterId) return null;
  if (living.pendingAnfuInvite?.characterId) return null;
  if (living.pendingPlayerDanceAsk?.characterId) return null;
  if (living.pendingPlayerAnfuAsk?.characterId) return null;
  if (living.pendingPlayerBathAssistAsk?.characterId) return null;

  const cool = living.miniGameInviteCooldownDay?.[characterId];
  if (cool != null && cool === living.dayIndex) return null;

  const kind = kindHint ?? detectAiMiniGamePropose(dialogue);
  if (!kind) return null;

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const label = miniGameKindLabel(kind);
  const pending: MiniGameInvitePending = {
    characterId,
    kind,
    proposedAt: Date.now(),
    dayIndex: living.dayIndex,
    preview: `${name}想和你来一局${label}，现在开始吗？`,
  };
  living.pendingMiniGameInvite = pending;
  return pending;
}

export function acceptMiniGameInvite(save: SaveData, living: AiLivingSave): MiniGameEnterResult {
  const pending = living.pendingMiniGameInvite;
  if (!pending) return { ok: false, msg: '没有待确认的小游戏邀请' };
  const characterId = pending.characterId;
  const kind = pending.kind;
  living.pendingMiniGameInvite = undefined;
  if (!living.miniGameInviteCooldownDay) living.miniGameInviteCooldownDay = {};
  living.miniGameInviteCooldownDay[characterId] = living.dayIndex;
  return enterMiniGameSession(save, living, characterId, kind, 'character_invite');
}

export function rejectMiniGameInvite(living: AiLivingSave): void {
  const pending = living.pendingMiniGameInvite;
  if (!pending) return;
  living.pendingMiniGameInvite = undefined;
  if (!living.miniGameInviteCooldownDay) living.miniGameInviteCooldownDay = {};
  living.miniGameInviteCooldownDay[pending.characterId] = living.dayIndex;
}

export function consumeMiniGameJustEntered(living: AiLivingSave, characterId: string): boolean {
  const s = getMiniGameSession(living);
  if (!s || s.characterId !== characterId || !s.justEntered) return false;
  s.justEntered = false;
  return true;
}

/** stake 应答：接受/拒绝一次后关闭 stake 窗 */
export function resolveMiniGameStake(
  living: AiLivingSave,
  characterId: string,
  accepted: boolean,
): string | null {
  const stake = living.miniGameStake;
  if (!stake || stake.characterId !== characterId) return null;
  living.miniGameStake = undefined;
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  if (stake.winner === 'player') {
    const line = accepted
      ? `【系统】${name}答应了赢家的小要求——愿赌服输。`
      : `【系统】${name}婉拒了那个“惩罚”——耍赖也是玩游戏的一部分。`;
    pushMemory(living, characterId, {
      kind: 'event',
      summary: accepted
        ? `玩${miniGameKindLabel(stake.kind)}输了，愿赌服输答应了指挥官的要求`
        : `玩${miniGameKindLabel(stake.kind)}输了，但耍赖没答应指挥官的要求`,
      importance: 4,
    });
    return line;
  }
  pushMemory(living, characterId, {
    kind: 'event',
    summary: `玩${miniGameKindLabel(stake.kind)}赢了，向指挥官提了个小要求`,
    importance: 4,
  });
  return null;
}

// ——— Prompt 块 ———

export function buildMiniGameActivePromptBlock(living: AiLivingSave, characterId: string): string {
  const s = getMiniGameSession(living);
  if (!s || s.characterId !== characterId) return '';
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const label = miniGameKindLabel(s.kind);
  const leftSec = Math.max(0, Math.ceil((s.turnDeadlineMs - Date.now()) / 1000));

  if (s.kind === 'gomoku' && s.gomoku) {
    const moves = s.gomoku.history.slice(-3).map(gomokuCoordName).join('、') || '（尚未落子）';
    const situation = gomokuSituation(s.gomoku.board);
    const turnText = s.turn === 'player' ? '轮到指挥官落子' : '轮到你落子（系统正在替你“思考”，马上自动落子）';
    return `【世界同步·五子棋对局中·最高优先】
你正与指挥官下五子棋（你执白，指挥官执黑）。
- 当前：${turnText}；本手剩余约 ${leftSec} 秒（每手 60 秒，超时判负）。
- 最近几手：${moves}；形势：${situation}。
- 落子由系统执行并播报：禁止说“我下到/你下到某坐标”，你只能对播报的棋着做情绪反应（得意/紧张/懊恼/放狠话）。
- 最近棋着与形势，以聊天记录里最近的【系统事实】为准；若事实已播报终局，立即停止催促落子，转为对结果做反应。
- 可以边下边聊：闲聊、垃圾话、求饶、耍赖都行；正常语音与情绪表达不受影响。
- 不想玩了填 minigame_action=quit（视为你认输离场，对局结束）。
- 【互斥】对局期间不得答应任何其它场馆活动（跳舞/安抚/浴室/调教），也不得描写自己在做别的事。`.trim();
  }

  const r = s.rps;
  const score = r ? `${r.playerWins}:${r.aiWins}` : '0:0';
  const last =
    r?.lastPlayerThrow && r?.lastAiThrow
      ? `上一局：指挥官出${rpsThrowLabel(r.lastPlayerThrow)}，你出${rpsThrowLabel(r.lastAiThrow)}（${
          r.lastRoundOutcome === 1 ? '指挥官赢' : r.lastRoundOutcome === -1 ? '你赢' : '平手'
        }）`
      : '（尚未出拳）';
  return `【世界同步·猜拳对局中·最高优先】
你正与指挥官猜拳（石头剪刀布，三局两胜）。
- 当前比分 ${score}，第 ${r?.round ?? 1} 局，等指挥官出拳；本手剩余约 ${leftSec} 秒（60 秒不出判负）。
- ${last}。
- 出拳由系统执行并播报：禁止预先宣布你要出什么，只能对播报结果做情绪反应（得意/不服/要求再来）。
- 每局双方出什么、当前比分，以聊天记录里最近的【系统事实】为准；对局是否结束也以它为准——若事实已播报终局，立即停止催促出拳，转为对结果做反应。
- 可以边玩边聊：闲聊、挑衅、撒娇都行；正常语音与情绪表达不受影响。
- 不想玩了填 minigame_action=quit（视为你认输离场，对局结束）。
- 【互斥】对局期间不得答应任何其它场馆活动（跳舞/安抚/浴室/调教），也不得描写自己在做别的事。`.trim();
}

export function buildPlayerMiniGameAskPromptBlock(living: AiLivingSave, characterId: string): string {
  const p = getPlayerMiniGameAsk(living, characterId);
  if (!p) return '';
  const label = miniGameKindLabel(p.kind);
  const start = p.kind === 'gomoku' ? 'start_gomoku' : 'start_rps';
  return `【世界同步·待你回应小游戏邀请】
指挥官提出「来一局${label}」（按钮/打字/语音等效；规则：${p.kind === 'gomoku' ? '轮流落子先连五子者胜' : '三局两胜'}，每手限时 60 秒，超时判负）。
- 若愿意：对白明确答应，并填 minigame_action=${start}；系统会立刻开局并播报棋着/出拳。
- 若不愿，或你正在跳舞/安抚室/浴室/调教等其它事件中：对白说明原因并婉拒，minigame_action 填 ""。
- 未表态前禁止假装已经在玩。`.trim();
}

export function buildMiniGameJustLeftPromptBlock(living: AiLivingSave, characterId: string): string {
  const s = living.miniGameSession;
  if (!s || s.characterId !== characterId || !s.justLeft) return '';
  const left = s.justLeftTurnsLeft ?? 0;
  if (left <= 0) {
    s.justLeft = false;
    return '';
  }
  s.justLeftTurnsLeft = left - 1;
  if (s.justLeftTurnsLeft <= 0) s.justLeft = false;
  const label = miniGameKindLabel(s.kind);
  const result = s.result;
  const resultText =
    result === 'player_win' ? '指挥官赢了' : result === 'ai_win' ? '你赢了' : '平局';
  return `【世界同步·${label}刚结束】刚才的对局已结束：${resultText}（${s.resultReason ?? '正常结束'}）。对局已终结：禁止继续描写棋局进行、禁止再催促指挥官出拳/落子（如"别发呆""该你了"之类一律不许说），只对输赢结果做情绪反应；聊天记录里最近一条【系统事实】是唯一权威的对局状态。`.trim();
}

/** 赛后 stake 窗（每场对话回合注入时消耗 1 回合） */
export function buildMiniGameStakePromptBlock(living: AiLivingSave, characterId: string): string {
  const stake = living.miniGameStake;
  if (!stake || stake.characterId !== characterId || stake.turnsLeft <= 0) return '';
  stake.turnsLeft -= 1;
  if (stake.turnsLeft <= 0) living.miniGameStake = undefined;
  const label = miniGameKindLabel(stake.kind);
  if (stake.winner === 'player') {
    return `【世界同步·愿赌服输】刚才的${label}你输了。指挥官（赢家）可以说一件想让你做的事（营地事件范畴：跳支舞、去安抚室、换身衣服、帮你冲澡之类）。
- 若指挥官提出了：愿意就答应并照做，填 minigame_action=accept_stake；不愿意就撒娇/耍赖婉拒，填 minigame_action=refuse_stake——这是随性的玩笑惩罚，你有权说不。
- 指挥官没提就不用主动提起。`.trim();
  }
  return `【世界同步·你赢了】刚才的${label}你赢了！可以向指挥官提一个小要求（送你个小礼物、陪你做件营地的事之类），在对白里自然提出；TA 可以答应也可以拒绝，不许强求。
- 提与不提随你心情；提了这回合之后不再重提。`.trim();
}

export const MINIGAME_PROTOCOL = `【小游戏事件 · minigame_action】
- 只在娱乐间（2F）或大厅发生；指挥官点「游戏」按钮、打字或语音提出，效果相同；你也可以主动邀请（propose_gomoku / propose_rps，系统弹确认条，指挥官同意后才开局）。
- 两种玩法：五子棋（你执白后手，先连五子者胜）/ 猜拳（石头剪刀布，三局两胜）。
- 每手限时 60 秒，超时方判负；中途离场视为认输（指挥官离场还会掉好感）。
- 棋着与出拳由系统执行并播报：你永远不决定坐标与出拳，只对播报结果做情绪反应。
- 游戏中可以正常聊天：闲聊、垃圾话、撒娇、耍赖都可以。
- 有输赢：赢了你心情会变好，输了会有点不服气（轻微、真实）。
- 赛后随性奖惩：你输了→指挥官可以说一件想让你做的事，你用 accept_stake 答应照做或 refuse_stake 耍赖拒绝；你赢了→你可以向指挥官提一个小要求（TA 可应可拒）。
- 不想玩了填 minigame_action=quit（你认输离场，对局结束）。
- 【互斥·现实规则】人不可能同时做两件事：对局进行中不得答应跳舞/安抚/浴室/调教等其它活动；你正在其它事件中时，指挥官约你玩也必须婉拒并说明「等这边结束」。
- 非小游戏事件时 minigame_action 填 ""。`.trim();
