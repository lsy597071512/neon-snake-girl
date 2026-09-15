/**
 * 营地洗浴成人互动：冲澡动态立绘门控。
 * 浴室常态 = 冲澡待机（*_pifu03_idle.webm，裹浴巾）。
 * 成人动态（*_pifu03.webm）仅当「主动脱掉浴巾」：
 *   - 指挥官明确要求脱掉浴巾 / 拿开浴巾，且角色同意；或
 *   - 角色自愿脱掉浴巾。
 * 角色改口重新裹上浴巾 → 立刻回待机动态。
 * 「一起洗 / 搓背」 alone 不足以触发成人立绘（仍可裹巾同浴）。
 */
import { getAgenda, isAgendaActive } from './characterAgenda';
import { resolvePresence } from './livingState';
import type { AiLivingSave } from './types';

export function isBathingForIntimateConsent(
  living: AiLivingSave,
  characterId: string,
): boolean {
  const presence = resolvePresence(characterId, living);
  if (presence.roomId !== 'room_1f_bath') return false;
  if (presence.activity === 'bathe') return true;
  const agenda = getAgenda(living, characterId);
  if (agenda && isAgendaActive(agenda)) {
    if (agenda.activity === 'bathe' && agenda.targetRoomId === 'room_1f_bath') return true;
    if (agenda.goal === 'bathe' && agenda.targetRoomId === 'room_1f_bath') return true;
  }
  const snap = living.dialogueTurnScene?.[characterId];
  if (snap?.roomId === 'room_1f_bath') return true;
  return true;
}

export function getBathIntimateConsent(
  living: AiLivingSave | null | undefined,
  characterId: string,
): boolean {
  return Boolean(living?.bathIntimateConsent?.[characterId]);
}

export function getBathIntimateIntroDone(
  living: AiLivingSave | null | undefined,
  characterId: string,
): boolean {
  return Boolean(living?.bathIntimateIntroDone?.[characterId]);
}

export function setBathIntimateIntroDone(
  living: AiLivingSave,
  characterId: string,
  done: boolean,
): void {
  if (!living.bathIntimateIntroDone) living.bathIntimateIntroDone = {};
  if (done) {
    living.bathIntimateIntroDone[characterId] = true;
  } else {
    delete living.bathIntimateIntroDone[characterId];
  }
}

export function setBathIntimateConsent(
  living: AiLivingSave,
  characterId: string,
  consented: boolean,
): void {
  if (!living.bathIntimateConsent) living.bathIntimateConsent = {};
  if (consented) {
    living.bathIntimateConsent[characterId] = true;
  } else {
    delete living.bathIntimateConsent[characterId];
    setBathIntimateIntroDone(living, characterId, false);
  }
}

/** 出浴室 / 非洗浴时清除同意，避免待机/成人动态串戏 */
export function clearBathIntimateConsentIfNotBathing(
  living: AiLivingSave,
  characterId: string,
): void {
  if (!living.bathIntimateConsent?.[characterId]) return;
  if (!isBathingForIntimateConsent(living, characterId)) {
    setBathIntimateConsent(living, characterId, false);
  }
}

export function clearAllStaleBathIntimateConsent(living: AiLivingSave): void {
  const map = living.bathIntimateConsent;
  if (!map) return;
  for (const id of Object.keys(map)) {
    clearBathIntimateConsentIfNotBathing(living, id);
  }
}

/** 解析 LLM 字段 bath_intimate_consent；undefined=本轮不改 */
export function parseBathIntimateConsentField(raw: unknown): boolean | undefined {
  if (raw === true || raw === false) return raw;
  if (typeof raw !== 'string') return undefined;
  const v = raw.trim().toLowerCase();
  if (!v || v === '""' || v === 'none' || v === 'null' || v === 'unchanged') {
    return undefined;
  }
  if (
    v === 'true' ||
    v === '1' ||
    v === 'yes' ||
    v === '同意' ||
    v === '允许' ||
    v === '脱掉' ||
    v === '脱了' ||
    v === '答应'
  ) {
    return true;
  }
  if (
    v === 'false' ||
    v === '0' ||
    v === 'no' ||
    v === '拒绝' ||
    v === '不同意' ||
    v === '不行' ||
    v === '裹上' ||
    v === '穿回'
  ) {
    return false;
  }
  return undefined;
}

/** 指挥官明确要求「脱掉浴巾」类（不含单纯一起洗/搓背） */
const PLAYER_ASKS_UNDRESS =
  /脱(?:下|掉|了)?(?:你的|妳的)?(?:浴巾|毛巾)|(?:浴巾|毛巾).{0,6}(?:脱|解|拿开|扯)|解开.{0,4}(?:浴巾|毛巾)|拿开.{0,4}(?:浴巾|毛巾)|别裹(?:着)?(?:了)?|不要裹|让我看(?:看)?(?:你|妳)?(?:的)?身子|把浴巾.{0,4}(?:拿|扯|解)/;

/** 角色自愿脱掉浴巾 */
const AI_VOLUNTARY_UNDRESS =
  /(?:我)?(?:把)?(?:浴巾|毛巾)(?:给)?(?:你)?(?:脱|解|拿|扯)|(?:脱掉|解开|拿开)(?:了)?(?:浴巾|毛巾)|(?:浴巾|毛巾)(?:掉了|滑落|松开)|不裹了|不裹着|给你看(?:看)?(?:身子|全貌)|敞(?:开|着)/;

/** 角色仍强调裹着浴巾（与成人立绘矛盾 → 禁止切成人） */
const AI_STILL_WRAPPED =
  /裹着(?:浴巾|毛巾)|裹紧.{0,6}(?:浴巾|毛巾)|(?:浴巾|毛巾)裹|还(?:在)?裹|穿着浴巾|围着浴巾|没什么好看的/;

/** 重新裹上 / 收回 */
const AI_PUT_TOWEL_BACK =
  /重新裹|裹回去|裹上(?:浴巾|毛巾)|穿上(?:浴巾|毛巾)|把(?:浴巾|毛巾)裹好|盖上(?:浴巾|毛巾)|收回/;

const AI_REFUSES_UNDRESS =
  /不(行|要|能|给)|拒绝|滚|别过来|做梦|变态|不许看|别脱|不准脱|才不脱|不要脱/;

const AI_AGREES_UNDRESS =
  /行吧|好吧|那就脱|脱给你|解开了|拿开了|既然要看|看就看|随你看|脱了吧|解开吧/;

/**
 * 从本轮对白推断「是否脱掉浴巾」：
 * - true：明确脱巾（玩家要求且同意，或角色自愿）
 * - false：拒绝脱巾 / 仍强调裹着 / 重新裹上
 * - undefined：本轮未谈脱巾（不改状态；一起洗/搓背不算）
 */
export function inferBathIntimateConsentFromTurn(opts: {
  playerMessage: string;
  dialogue: string;
  action?: string;
  bathing: boolean;
}): boolean | undefined {
  if (!opts.bathing) return undefined;
  const player = opts.playerMessage.trim();
  const ai = `${opts.dialogue} ${opts.action ?? ''}`.trim();
  if (!player && !ai) return undefined;

  if (AI_PUT_TOWEL_BACK.test(ai)) return false;
  if (AI_STILL_WRAPPED.test(ai) && !AI_VOLUNTARY_UNDRESS.test(ai)) return false;
  if (AI_REFUSES_UNDRESS.test(ai) && PLAYER_ASKS_UNDRESS.test(player)) return false;

  if (AI_VOLUNTARY_UNDRESS.test(ai) && !AI_STILL_WRAPPED.test(ai)) return true;

  const playerAsks = PLAYER_ASKS_UNDRESS.test(player);
  if (playerAsks && AI_AGREES_UNDRESS.test(ai) && !AI_STILL_WRAPPED.test(ai)) return true;
  if (playerAsks && AI_VOLUNTARY_UNDRESS.test(ai)) return true;

  return undefined;
}

/** 对白是否明确在浴室/洗浴亲密语境（用于补齐 presence 误判） */
export function isBathIntimateDialogueContext(
  playerMessage: string,
  dialogue: string,
  action?: string,
): boolean {
  const t = `${playerMessage} ${dialogue} ${action ?? ''}`;
  return /浴室|洗澡|冲澡|浴巾|搓背|擦背|洗浴|同浴|脱掉.*巾/.test(t);
}

/**
 * 合并 LLM 字段 + 对白启发式；仅营地洗浴中可 true。
 * 若 LLM 填 true 但对白仍强调裹浴巾 → 以对白为准，不切成人立绘。
 */
export function applyBathIntimateConsentFromAi(
  living: AiLivingSave,
  characterId: string,
  raw: unknown,
  turn?: { playerMessage: string; dialogue: string; action?: string },
): { changed: boolean; consented: boolean; source: 'llm' | 'infer' | 'none' } {
  const bathing = isBathingForIntimateConsent(living, characterId);
  let parsed = parseBathIntimateConsentField(raw);
  let source: 'llm' | 'infer' | 'none' = parsed !== undefined ? 'llm' : 'none';

  const speech = turn
    ? `${turn.playerMessage} ${turn.dialogue} ${turn.action ?? ''}`
    : '';
  const stillWrapped = turn
    ? AI_STILL_WRAPPED.test(`${turn.dialogue} ${turn.action ?? ''}`) &&
      !AI_VOLUNTARY_UNDRESS.test(`${turn.dialogue} ${turn.action ?? ''}`)
    : false;
  const putBack = turn ? AI_PUT_TOWEL_BACK.test(speech) : false;

  if (parsed === true && (stillWrapped || putBack)) {
    parsed = false;
    source = 'infer';
  }

  if (parsed === undefined && turn && bathing) {
    const inferred = inferBathIntimateConsentFromTurn({
      playerMessage: turn.playerMessage,
      dialogue: turn.dialogue,
      action: turn.action,
      bathing: true,
    });
    if (inferred !== undefined) {
      parsed = inferred;
      source = 'infer';
    }
  }

  const prev = getBathIntimateConsent(living, characterId);

  if (parsed === undefined) {
    if (!bathing && prev) {
      setBathIntimateConsent(living, characterId, false);
      return { changed: true, consented: false, source: 'none' };
    }
    return { changed: false, consented: prev, source: 'none' };
  }

  if (parsed === true && !bathing) {
    setBathIntimateConsent(living, characterId, false);
    return { changed: prev === true, consented: false, source };
  }

  setBathIntimateConsent(living, characterId, parsed);
  return { changed: prev !== parsed, consented: parsed, source };
}

/** @deprecated 使用 isBathingForIntimateConsent */
export function isBathingNow(living: AiLivingSave, characterId: string): boolean {
  return isBathingForIntimateConsent(living, characterId);
}
