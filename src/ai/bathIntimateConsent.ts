/**
 * 营地洗浴成人互动：独自泡澡/冲澡动态立绘门控。
 * 浴室常态 = 独自泡澡裹巾（pifu09 `_solo.webm`，无则 pifu03 idle）。
 * 成人动态（`_solo_1.webm` / pifu03 intimate）仅当「主动脱掉浴巾」：
 *   - 指挥官明确要求脱掉浴巾 / 拿开浴巾，且角色同意；或
 *   - 角色自愿脱掉浴巾。
 * 角色改口重新裹上浴巾 → 立刻回待机动态。
 * 「一起洗 / 搓背」 alone 不足以触发成人立绘（仍可裹巾同浴）。
 * 共浴(pifu08)进行中本门控改驱动共浴 clip2，不切独自泡澡 intimate。
 */
import { isAloneBathSkinId } from '../data/characterSkins';
import { getAgenda, isAgendaActive } from './characterAgenda';
import { getCampDisplaySkinId, getCampLogicalSkinId } from './campOutfit';
import { resolvePresence } from './livingState';
import type { AiLivingSave } from './types';

export function isBathingForIntimateConsent(
  living: AiLivingSave,
  characterId: string,
): boolean {
  const presence = resolvePresence(characterId, living);
  const anchor = living.bodyAnchors?.[characterId];
  const scene = living.dialogueTurnScene?.[characterId];
  const inBathRoom =
    presence.roomId === 'room_1f_bath' ||
    anchor?.roomId === 'room_1f_bath' ||
    scene?.roomId === 'room_1f_bath';
  if (!inBathRoom) return false;
  if (presence.activity === 'bathe' || anchor?.activity === 'bathe') return true;
  const agenda = getAgenda(living, characterId);
  if (agenda && isAgendaActive(agenda)) {
    if (agenda.activity === 'bathe' && agenda.targetRoomId === 'room_1f_bath') return true;
    if (agenda.goal === 'bathe' && agenda.targetRoomId === 'room_1f_bath') return true;
  }
  const snap = living.dialogueTurnScene?.[characterId];
  if (snap?.roomId === 'room_1f_bath') return true;
  // No room evidence means the character is not bathing. Returning true here
  // leaks the temporary bath skin into the hall during ordinary dialogue.
  return false;
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
export const PLAYER_ASKS_UNDRESS =
  /脱(?:下|掉|了)?(?:你的|妳的)?(?:浴巾|毛巾)|(?:浴巾|毛巾).{0,6}(?:脱|解|拿开|扯)|解开.{0,4}(?:浴巾|毛巾)|拿开.{0,4}(?:浴巾|毛巾)|别裹(?:着)?(?:了)?|不要裹|让我看(?:看)?(?:你|妳)?(?:的)?身子|把浴巾.{0,4}(?:拿|扯|解)/;

/** 聊天记录可见：独自泡澡时指挥官口头/按钮请求脱巾（无字段名；与语音等效） */
export function buildSoloBathUndressPlayerMessage(): string {
  return '把浴巾脱下来好不好？我想看看你。';
}

/** 聊天记录可见：请角色重新裹巾 */
export function buildSoloBathWrapPlayerMessage(): string {
  return '把浴巾重新裹上吧。';
}

/** 独自泡澡（pifu09/03）且可脱巾时，显示「脱下浴巾」按钮；已脱巾则无效 */
export function canShowSoloBathUndressButton(
  living: AiLivingSave,
  characterId: string,
): boolean {
  const assist = living.bathAssistSession;
  if (assist?.active && assist.characterId === characterId) return false;
  if (!isBathingForIntimateConsent(living, characterId)) return false;
  if (!isAloneBathSkinId(getCampDisplaySkinId(living, characterId) ?? getCampLogicalSkinId(living, characterId))) return false;
  if (getBathIntimateConsent(living, characterId)) return false;
  return true;
}

/** 已脱巾时可显示「裹上浴巾」 */
export function canShowSoloBathWrapButton(
  living: AiLivingSave,
  characterId: string,
): boolean {
  const assist = living.bathAssistSession;
  if (assist?.active && assist.characterId === characterId) return false;
  if (!isBathingForIntimateConsent(living, characterId)) return false;
  if (!isAloneBathSkinId(getCampLogicalSkinId(living, characterId))) return false;
  return getBathIntimateConsent(living, characterId);
}

/** 角色自愿脱掉浴巾 */
const AI_VOLUNTARY_UNDRESS =
  /(?:我)?(?:把)?(?:浴巾|毛巾)(?:给)?(?:你)?(?:脱|解|拿|扯)|(?:脱掉|解开|拿开|脱下|解下)(?:了)?(?:你的|妳的)?(?:浴巾|毛巾)?|(?:浴巾|毛巾)(?:掉了|滑落|松开)|不裹了|不裹着|给你看(?:看)?(?:身子|全貌)|敞(?:开|着)|那就(?:我)?(?:就)?脱|我脱(?:下|掉|了)|脱给你看/;

/** 角色仍强调裹着浴巾（与成人立绘矛盾 → 禁止切成人） */
const AI_STILL_WRAPPED =
  /裹着(?:浴巾|毛巾)|裹紧.{0,6}(?:浴巾|毛巾)|(?:浴巾|毛巾)裹|还(?:在)?裹|穿着浴巾|围着浴巾|没什么好看的/;

/** 重新裹上 / 收回 */
const AI_PUT_TOWEL_BACK =
  /重新裹|裹回去|裹上(?:浴巾|毛巾)|穿上(?:浴巾|毛巾)|把(?:浴巾|毛巾)裹好|盖上(?:浴巾|毛巾)|收回/;

const AI_REFUSES_UNDRESS =
  /拒绝|滚|别过来|做梦|变态|不许看|别脱|不准脱|才不脱|不要脱|不行|不给|不要(?!脱)|不能(?!不脱)|(?<![能会])不脱/;

const AI_AGREES_UNDRESS =
  /行吧|好吧|那就脱|脱给你|解开了|解下了|脱下了|拿开了|既然要看|看就看|随你看|脱了吧|脱掉吧|解开吧|解下浴巾|脱下浴巾|那我就脱|脱下来|怎么能不脱|怎么能不|看好了|看仔细|不许后悔|脱给你看|那就脱下来|既然.{0,8}脱/;
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
