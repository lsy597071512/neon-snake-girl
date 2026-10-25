/**
 * 对话换装过程：答应 → 切「换装中」过程皮循环 → 到点过渡到目标皮 → 再按新衣说话。
 * 禁止同一拍里「等我去换」又「已经换好」，也禁止情绪/场景同步把刚换上的衣服扒掉。
 */
import {
  BATH_SOLO_SKIN_ID,
  CASUAL_FASHION_SKIN_ID,
  getCharacterSkin,
  getCharacterSkins,
  isAloneBathSkinId,
  isOutfitChangeProcessSkin,
  LIFEWEAR_SKIN_ID,
  OUTFIT_CHANGE_SKIN_ID,
  OUTFIT_CHANGE_SKIN_NAME,
  POOL_PARTY_SKIN_ID,
  resolveAloneBathSkinId,
  SHOWER_SKIN_ID,
  SLEEPWEAR_SKIN_ID,
  SPECIAL_DARE_SKIN_ID,
  XIEJIA_SKIN_ID,
} from '../data/characterSkins';
import { CHARACTER_MAP } from '../data/characters';
import type { SaveData } from '../types';
import { applyAiSkinChange } from './aiSkinChange';
import { preloadSkinAssets } from './assetPreload';
import { buildXiejiaPromptNote } from './xiejiaSkin';
import { getCampDisplaySkinId, getCampLogicalSkinId, hasCampSkinAsset } from './campOutfit';
import { isDanceActiveFor } from './danceSession';
import type { AiLivingSave, LlmDialogueResult, OutfitNarrativeHold, OutfitWearLock, PendingOutfitChange } from './types';

const CHANGE_DELAY_MS = 7200;
const WEAR_LOCK_GAME_MIN = 180;

const GOING_RE =
  /等(我|一下|会儿|一会)|稍等|去换|这就换|去穿|先换|去衣柜|去更衣室|换上给你看|我去换|马上换|这就去|去拿那套|我直接去换/;
const DONE_RE =
  /换好(了|啦|咯)?|换完|已经换上|已经穿上|穿好了|换上了|穿上了|我换了|已经换好|这套(都市)?私服|怎么样[，,。]?这套/;
/** 嘴上明确不换（与 GOING/DONE 互斥；仅看 dialogue/action，不看 inner_thought） */
const REFUSE_OUTFIT_RE =
  /没(必)?要换|不必换|不用换|不去换|先不换|暂不|不换|就这套|维持现状|没换|不必|没必要|顾不上|顾不上换|现在不换|不换衣|不换装/;

/** 角色嘴上是否在拒绝本轮换装（心里话不参与，避免「嘴上答应、心里嫌麻烦」被误拦） */
export function declinesOutfitChange(dialogue: string, action?: string): boolean {
  const mouth = `${dialogue ?? ''} ${action ?? ''}`.trim();
  if (!mouth) return false;
  if (GOING_RE.test(mouth) || DONE_RE.test(mouth)) return false;
  return REFUSE_OUTFIT_RE.test(mouth);
}

/**
 * 安抚室事件占用立绘期间：禁止一切换装排队/落装（安抚三相皮由会话唯一持有）。
 * 直接读 living.anfuSession，避免与 anfuSession 形成相互 import。
 */
function anfuHoldsOutfit(living: AiLivingSave, characterId: string): boolean {
  const s = living.anfuSession;
  return Boolean(s?.active && s.characterId === characterId);
}

export function cancelPendingOutfitChange(living: AiLivingSave, characterId: string): void {
  const { pendingOutfitChanges } = ensureOutfitChangeFields(living);
  delete pendingOutfitChanges[characterId];
  if (living.outfitNarrativeHolds?.[characterId]) {
    delete living.outfitNarrativeHolds[characterId];
  }
}

/** 玩家/对白是否在谈换装（对话引擎门闸与本地钳共用） */
export const OUTFIT_SPEECH_RE =
  /换(上|好|完|衣|装|服|一?[套件])|去换|我去换|私服|泳装|睡衣|特殊服装|性感|情趣|卸甲|轻装坦诚|那套|这套衣服/;

/**
 * 换装「中间过程」叙事：拉链卡住 / 正在脱 / 还在换 / 折腾衣服…
 * 命中期间立绘必须停在旧衣——任何背景写者不得瞬间套上终点皮肤。
 * 这是「嘴上还在脱泳装、立绘已是浴巾」一类问题的总闸门。
 */
const MID_CHANGE_RE = new RegExp(
  [
    '(正在|还在|这就|马上|先|试着|折腾|忙|搞)[^。！？；，]{0,12}(脱|换|拉|穿|整)',
    '(脱|换|拉|穿)[^。！？；，]{0,10}(泳装|泳衣|浴巾|毛巾|睡衣|私服|衣服|拉链|拉锁)',
    '(拉链|拉锁|扣子|纽扣)[^。！？；，]{0,8}(卡|锈|紧|坏|弄|拧)',
  ].join('|'),
);

/** 对白是否处于「换装中间过程」（已换好不算） */
export function isMidChangeSpeech(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  if (DONE_RE.test(t)) return false;
  return MID_CHANGE_RE.test(t);
}

const NARRATIVE_HOLD_MS = 120_000;

/** 对白出现换装中间过程 → 挂叙事锁：背景写者（时钟副作用/房间对齐）全部止步 */
export function holdOutfitForNarrative(
  living: AiLivingSave,
  characterId: string,
  reason: string,
  ms = NARRATIVE_HOLD_MS,
): void {
  if (!living.outfitNarrativeHolds) living.outfitNarrativeHolds = {};
  living.outfitNarrativeHolds[characterId] = {
    untilMs: Date.now() + ms,
    reason: reason.slice(0, 60),
  };
}

function getNarrativeHold(living: AiLivingSave, characterId: string): OutfitNarrativeHold | null {
  const hold = living.outfitNarrativeHolds?.[characterId] ?? null;
  if (!hold) return null;
  if (Date.now() >= hold.untilMs) {
    delete living.outfitNarrativeHolds![characterId];
    return null;
  }
  return hold;
}

export function ensureOutfitChangeFields(living: AiLivingSave): {
  pendingOutfitChanges: Record<string, PendingOutfitChange>;
  outfitWearLocks: Record<string, OutfitWearLock>;
} {
  if (!living.pendingOutfitChanges) living.pendingOutfitChanges = {};
  if (!living.outfitWearLocks) living.outfitWearLocks = {};
  return {
    pendingOutfitChanges: living.pendingOutfitChanges,
    outfitWearLocks: living.outfitWearLocks,
  };
}

export function getPendingOutfitChange(
  living: AiLivingSave,
  characterId: string,
): PendingOutfitChange | null {
  const { pendingOutfitChanges } = ensureOutfitChangeFields(living);
  return pendingOutfitChanges[characterId] ?? null;
}

/** 换装进行中 / 展示锁定期 / 叙事换装锁 / 独占事件（舞蹈·安抚）中：禁止自动扒皮/情绪选装与房间对齐瞬切 */
export function shouldHoldAutoOutfit(living: AiLivingSave, characterId: string): boolean {
  if (isDanceActiveFor(living, characterId)) return true;
  const { pendingOutfitChanges, outfitWearLocks } = ensureOutfitChangeFields(living);
  const pending = pendingOutfitChanges[characterId];
  if (pending?.phase === 'changing') return true;
  if (getNarrativeHold(living, characterId)) return true;
  const lock = outfitWearLocks[characterId];
  if (!lock) return false;
  return living.gameMinutes < lock.untilGameMin;
}

export function remainingOutfitChangeMs(living: AiLivingSave, characterId: string): number {
  const p = getPendingOutfitChange(living, characterId);
  if (!p || p.phase !== 'changing') return 0;
  return Math.max(0, p.readyAtMs - Date.now());
}

/** 逻辑穿着（账本；不含换装过程皮）——用于 from/target 判定 */
function logicalSkinMeta(
  living: AiLivingSave,
  characterId: string,
): { id: string | null; name: string } {
  const id = getCampLogicalSkinId(living, characterId);
  if (!id) return { id: null, name: '默认外观' };
  return { id, name: getCharacterSkin(characterId, id)?.name ?? id };
}

/** 玩家眼前立绘（换装中 → huanzhuang） */
function displaySkinMeta(
  living: AiLivingSave,
  characterId: string,
): { id: string | null; name: string } {
  const id = getCampDisplaySkinId(living, characterId);
  if (!id) return { id: null, name: '默认外观' };
  return { id, name: getCharacterSkin(characterId, id)?.name ?? id };
}

function changingLiveNote(characterId: string): string {
  const skin = getCharacterSkin(characterId, OUTFIT_CHANGE_SKIN_ID);
  return skin?.aiLiveNote || skin?.aiLookNote || '玩家所见为换装过程循环动态（遮布/衣柜/整理衣装）。';
}

function sameSkin(a: string | null, b: string | null): boolean {
  return (a ?? null) === (b ?? null);
}

/** 把模型乱填的中文/别名收成 pifu id 或 default */
export function normalizeSkinChangeWant(characterId: string, raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t || t === '""' || t === 'none' || t === 'keep' || t === 'unchanged') return null;
  if (t === 'default' || t === 'clear' || t === '原皮' || t === '默认' || t === '装甲' || t === '默认装甲') {
    return 'default';
  }
  // 过程皮不可作为换装目标
  if (isOutfitChangeProcessSkin(t) || t === '换装中' || t === '更衣中') return null;
  if (getCharacterSkin(characterId, t) && !isOutfitChangeProcessSkin(t)) return t;

  if (/生活服装|居家|日常休闲|营地休闲/.test(t)) return LIFEWEAR_SKIN_ID;
  if (/泳装|泳衣|泳池/.test(t)) return POOL_PARTY_SKIN_ID;
  if (/睡衣|星夜/.test(t)) return SLEEPWEAR_SKIN_ID;
  if (/独自泡澡|泡澡|独浴/.test(t)) return resolveAloneBathSkinId(characterId) ?? BATH_SOLO_SKIN_ID;
  if (/毛巾|浴巾|冲澡|蒸汽/.test(t)) return resolveAloneBathSkinId(characterId) ?? SHOWER_SKIN_ID;
  if (/私服|休闲|便服|街拍|都市/.test(t)) return CASUAL_FASHION_SKIN_ID;
  // pifu05 = 情趣个性造型；事件皮不映射本皮
  if (/特殊服装|调情|撩拨|展示身材|个性|时尚|造型|pifu05/.test(t)) return SPECIAL_DARE_SKIN_ID;
  // 卸甲（轻装坦诚）：玩家请求 + 角色同意后穿着
  if (/卸甲|轻装坦诚|卸下外装|卸掉外装/.test(t)) return XIEJIA_SKIN_ID;

  for (const skin of getCharacterSkins(characterId)) {
    if (skin.name && t.includes(skin.name.toLowerCase())) return skin.id;
  }
  return t;
}

function inferWantFromSpeech(characterId: string, text: string): string | null {
  if (!text.trim()) return null;
  if (/生活服装|居家装|日常休闲/.test(text)) return LIFEWEAR_SKIN_ID;
  if (/私服|休闲装|便服|街拍/.test(text)) return CASUAL_FASHION_SKIN_ID;
  if (/泳装|泳衣/.test(text)) return POOL_PARTY_SKIN_ID;
  if (/睡衣/.test(text)) return SLEEPWEAR_SKIN_ID;
  if (/独自泡澡|泡澡/.test(text)) return resolveAloneBathSkinId(characterId) ?? BATH_SOLO_SKIN_ID;
  if (/毛巾|浴巾|冲澡/.test(text)) return resolveAloneBathSkinId(characterId) ?? SHOWER_SKIN_ID;
  // 「调情/展示身材/特殊服装01」等 → pifu05
  if (/特殊服装|调情|撩拨|展示身材|个性|时尚|造型/.test(text)) return SPECIAL_DARE_SKIN_ID;
  // 卸甲（轻装坦诚）→ wuziqi
  if (/卸甲|轻装坦诚|卸下外装|卸掉外装/.test(text)) return XIEJIA_SKIN_ID;
  if (/原皮|默认装甲|换回去|换回来|战斗装甲|装甲/.test(text)) return 'default';
  return null;
}

function targetName(characterId: string, want: string): string {
  if (want === 'default') return '默认外观';
  return getCharacterSkin(characterId, want)?.name ?? want;
}

function setWearLock(living: AiLivingSave, characterId: string, skinId: string | null): void {
  const { outfitWearLocks } = ensureOutfitChangeFields(living);
  outfitWearLocks[characterId] = {
    skinId,
    untilGameMin: living.gameMinutes + WEAR_LOCK_GAME_MIN,
  };
}

/**
 * 场景/情绪对齐用的延时换装：避免一秒内连切泳装/睡衣/装甲。
 * 洗浴毛巾进浴室仍可瞬时（见 syncOutfit / processTurn）。
 */
export function schedulePresenceOutfitChange(
  living: AiLivingSave,
  characterId: string,
  want: string | null,
  delayMs = CHANGE_DELAY_MS,
): { queued: boolean; msg: string } {
  const { pendingOutfitChanges } = ensureOutfitChangeFields(living);
  if (anfuHoldsOutfit(living, characterId)) {
    delete pendingOutfitChanges[characterId];
    return { queued: false, msg: '' };
  }
  const target = want ?? 'default';
  const cur = logicalSkinMeta(living, characterId);
  const targetId = target === 'default' ? null : target;
  if (sameSkin(cur.id, targetId)) {
    delete pendingOutfitChanges[characterId];
    return { queued: false, msg: '' };
  }
  const pending = pendingOutfitChanges[characterId];
  if (
    pending?.phase === 'changing' &&
    sameSkin(pending.targetSkinId, targetId)
  ) {
    return { queued: false, msg: '' };
  }
  const q = queueChanging(living, characterId, target, delayMs);
  return {
    queued: true,
    msg: `开始换「${q.targetName}」（立绘切${OUTFIT_CHANGE_SKIN_NAME}，约 ${Math.round(delayMs / 1000)} 秒）`,
  };
}

/**
 * 事件临时外覆的「带过程」换装：先播换装过程皮，到点才把临时皮挂上。
 * 用于营地群体事件自动换装、洗浴毛巾/泡澡等（禁止瞬间切皮）。
 * 已穿着目标皮或已在排队同一目标时幂等返回（tick 反复调用安全）。
 */
export function scheduleEventTempSkinChange(
  living: AiLivingSave,
  characterId: string,
  skinId: string,
  eventInstanceId: string,
  delayMs = 2_600,
): { queued: boolean; msg: string } {
  if (anfuHoldsOutfit(living, characterId)) return { queued: false, msg: '' };
  if (!getCharacterSkin(characterId, skinId)) return { queued: false, msg: '' };
  const currentTemp = living.eventTempSkins?.[characterId];
  if (currentTemp?.skinId === skinId && currentTemp.eventInstanceId === eventInstanceId) {
    return { queued: false, msg: '' };
  }
  const pending = living.pendingOutfitChanges?.[characterId];
  if (
    pending?.phase === 'changing' &&
    pending.targetSkinId === skinId &&
    pending.applyAsTempInstanceId === eventInstanceId
  ) {
    return { queued: false, msg: '' };
  }
  const q = queueChanging(living, characterId, skinId, delayMs);
  const next = living.pendingOutfitChanges?.[characterId];
  if (next) next.applyAsTempInstanceId = eventInstanceId;
  return { queued: true, msg: `开始换「${q.targetName}」（事件临时外覆，立绘切${OUTFIT_CHANGE_SKIN_NAME}）` };
}

/**
 * 强制排队一次换装（即使目标与当前账本一致）。
 * 用于「事件散场」：舞蹈/安抚结束后先播换装过程皮，再回日常服，
 * 保证任何换皮都有可见的换衣过程，而不是瞬间硬切。
 */
export function forceScheduleOutfitChange(
  living: AiLivingSave,
  characterId: string,
  want: string | null,
  delayMs = CHANGE_DELAY_MS,
): { queued: boolean; msg: string } {
  if (anfuHoldsOutfit(living, characterId)) {
    return { queued: false, msg: '' };
  }
  const q = queueChanging(living, characterId, want ?? 'default', delayMs);
  return { queued: true, msg: `开始换「${q.targetName}」（立绘切${OUTFIT_CHANGE_SKIN_NAME}）` };
}

function queueChanging(
  living: AiLivingSave,
  characterId: string,
  want: string,
  delayMs = CHANGE_DELAY_MS,
): PendingOutfitChange {
  const { pendingOutfitChanges } = ensureOutfitChangeFields(living);
  // 若已在换装中改目标：保留最初的 from，勿把过程皮记成 from
  const prev = pendingOutfitChanges[characterId];
  const from =
    prev?.phase === 'changing'
      ? { id: prev.fromSkinId, name: prev.fromSkinName }
      : logicalSkinMeta(living, characterId);
  const pending: PendingOutfitChange = {
    targetSkinId: want === 'default' ? null : want,
    targetName: targetName(characterId, want),
    fromSkinId: from.id,
    fromSkinName: from.name,
    phase: 'changing',
    announcedAtMs: Date.now(),
    readyAtMs: Date.now() + delayMs,
  };
  pendingOutfitChanges[characterId] = pending;
  // 过程皮 + 目标皮一并预热，避免切 huanzhuang / 到点换上时黑窗
  preloadSkinAssets(characterId, OUTFIT_CHANGE_SKIN_ID);
  preloadSkinAssets(characterId, pending.targetSkinId);
  return pending;
}

export function applyPendingOutfitChangeNow(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
): { applied: boolean; msg: string } {
  const { pendingOutfitChanges } = ensureOutfitChangeFields(living);
  if (anfuHoldsOutfit(living, characterId)) {
    delete pendingOutfitChanges[characterId];
    return { applied: false, msg: '' };
  }
  const pending = pendingOutfitChanges[characterId];
  if (!pending) return { applied: false, msg: '' };
  const want = pending.targetSkinId ?? 'default';

  // 事件临时外覆：到点后只写临时层（不碰日常穿搭），保证"先换衣再显形"
  if (pending.applyAsTempInstanceId) {
    const instanceId = pending.applyAsTempInstanceId;
    const targetId = pending.targetSkinId;
    if (!targetId || !getCharacterSkin(characterId, targetId)) {
      delete pendingOutfitChanges[characterId];
      return { applied: false, msg: '' };
    }
    if (!living.eventTempSkins) living.eventTempSkins = {};
    const cur = living.eventTempSkins[characterId];
    living.eventTempSkins[characterId] = {
      skinId: targetId,
      restoreSkinId: cur?.restoreSkinId ?? getCampLogicalSkinId(living, characterId),
      eventInstanceId: instanceId,
    };
    delete pendingOutfitChanges[characterId];
    return {
      applied: true,
      msg: `已换上「${getCharacterSkin(characterId, targetId)?.name ?? targetId}」（事件临时外覆）`,
    };
  }

  const r = applyAiSkinChange(save, living, characterId, want);
  if (r.ok) {
    delete pendingOutfitChanges[characterId];
    // 回营地日常基准不算「展示新衣」：不挂展示锁，否则刚脱下的装甲会连带锁住后续换装
    if (pending.targetSkinId) setWearLock(living, characterId, pending.targetSkinId);
  }
  return { applied: r.ok, msg: r.msg };
}

/** 到点则换上；对话开场/续说前调用，保证 Prompt 与立绘已是新衣 */
export function completeDueOutfitChange(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
): { applied: boolean; msg: string } {
  const pending = getPendingOutfitChange(living, characterId);
  if (!pending || pending.phase !== 'changing') return { applied: false, msg: '' };
  if (Date.now() < pending.readyAtMs) return { applied: false, msg: '' };
  return applyPendingOutfitChangeNow(save, living, characterId);
}

export function buildOutfitChangePromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const { pendingOutfitChanges, outfitWearLocks } = ensureOutfitChangeFields(living);
  const pending = pendingOutfitChanges[characterId];
  const cur = displaySkinMeta(living, characterId);
  const lock = outfitWearLocks[characterId];
  const locked =
    Boolean(lock) && living.gameMinutes < (lock?.untilGameMin ?? 0);

  const protocol = `【换装协议·由你驱动】换衣服是你的行为，游戏只会同步玩家眼前立绘，不会替你编台词。
1) 营地默认穿「生活服装」(pifu00)。指挥官要看某套衣服、或你自己想换：本轮 dialogue 只说「等我去换/稍等」，action 写去衣柜或整理换衣布；skin_change 填目标 id（pifu00 生活服装 / pifu01 泳装 / pifu02 睡衣 / pifu04 都市私服 / pifu05 特殊服装 / default 战斗装甲）；want_continue=false。
   默认战斗装甲(default)仅在：军械库/炮塔等执勤点检、或你正在战斗相关岗上时才用；其它时候一律日常 pifu00，不要切装甲。营地装甲占比必须很低。
   想调情、撩拨、展示身材、俏皮展示个性造型时，优先 pifu05。
   事件专属皮由系统管理，不是换 pifu05。禁止 skin_change=huanzhuang（过程皮由系统自动播）。
2) 「卸甲」(id=wuziqi)：轻装坦诚外覆，只在指挥官开口请求且你愿意时穿（不可主动提议）；仅限大厅或房间、且你未参与任何事件。穿上后表现羞涩尴尬，一律用含蓄说法（卸下外装/轻装坦诚/用手臂挡着）；随时可正常换回，没有时间限制。
3) 系统还没通知「换装完成」前，立绘是「换装中」过程动态（遮布/衣柜），不是目标外覆。禁止说已经换好、禁止评价/展示新衣服。
4) 收到【世界同步·换装完成】后，才按新衣服说话。
5) 谈及衣装只能描述「玩家眼前立绘」那一套。skin_change 是「开始去换」的意向。当前外覆若有 _1/_2/_3，可用 skin_clip=1…N；禁止跨套。营地穿搭不依赖购买。`;
  const xiejiaNote = buildXiejiaPromptNote(living, characterId);

  if (pending?.phase === 'changing') {
    const leftSec = Math.max(1, Math.ceil((pending.readyAtMs - Date.now()) / 1000));
    const live = changingLiveNote(characterId);
    return `${protocol}
${xiejiaNote}

【世界同步·衣装状态=正在换衣服】
- 玩家眼前立绘（唯一真相）：「${OUTFIT_CHANGE_SKIN_NAME}」过程动态（不是「${pending.fromSkinName}」定装，也不是「${pending.targetName}」）
- 【换装过程动态】${live}
- 你正从「${pending.fromSkinName}」换成「${pending.targetName}」（id=${pending.targetSkinId ?? 'default'}），大约 ${leftSec} 秒后系统会通知完成并切到目标外覆
- 本轮 dialogue/action/inner_thought 必须对齐换装过程画面（遮布/衣柜/整理），禁止说已经换好，禁止假装完整穿着旧衣或新衣站着不动
- skin_change 填「${pending.targetSkinId ?? 'default'}」或 ""；want_continue=false`;
  }

  if (locked) {
    return `${protocol}
${xiejiaNote}

【世界同步·衣装状态=已穿上展示中】
- 玩家眼前立绘（唯一真相）：「${cur.name}」
- 对白必须按这套说；禁止再说还在换；禁止描述未穿的上一套（除非回忆）
- 除非指挥官明确要求另换，skin_change=""`;
  }

  return `${protocol}
${xiejiaNote}

【世界同步·衣装状态=日常穿着】
- 玩家眼前立绘（唯一真相）：「${cur.name}」`;
}

/** 塞进本轮 user 末尾，保证模型当回合看到最新衣装世界状态 */
export function buildOutfitLiveUserDirective(
  living: AiLivingSave,
  characterId: string,
  turnMode?: string,
): string {
  const { pendingOutfitChanges } = ensureOutfitChangeFields(living);
  const pending = pendingOutfitChanges[characterId];
  const cur = displaySkinMeta(living, characterId);

  if (turnMode === 'outfit_reveal') {
    return `【世界同步·换装完成·本轮最高优先】这不是指挥官说的话。
系统已把立绘从「换装中」换成「${cur.name}」，指挥官已经看见。
上一拍你还在换衣服。本轮必须按「${cur.name}」说话：展示、问问观感。
skin_change=""。want_continue=false。禁止再说等我去换，禁止假装仍穿着旧衣或仍在换装过程。`;
  }

  if (pending?.phase === 'changing') {
    return `【世界同步·正在换衣服·本轮最高优先】玩家眼前是「${OUTFIT_CHANGE_SKIN_NAME}」过程动态：${changingLiveNote(characterId)} 你还没换完「${pending.targetName}」（从「${pending.fromSkinName}」换来）。只许说稍等/去换/整理衣装，不许说已经换好。want_continue=false。`;
  }

  return `【世界同步·衣装】玩家眼前立绘是「${cur.name}」。dialogue 里谈到衣服必须与此一致。若要换装：先 skin_change=目标id 并说去换，立绘会切换装过程动态，等系统通知完成后再展示新衣。`;
}

export const OUTFIT_REVEAL_MOTIVE =
  '【系统】换装完成，立绘已是新衣服。按新外观说话。';

type ProcessOpts = {
  playerMessage?: string;
  dialogue: string;
  action?: string;
  inner_thought?: string;
};

/**
 * 处理本轮 skin_change：去换则排队，到点才穿上。
 * 洗浴毛巾仍允许立刻切（场景安全）。
 */
export function processTurnOutfitChange(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
  result: LlmDialogueResult,
  opts: ProcessOpts,
): { pending: boolean; applied: boolean; suppressContinue: boolean; msg: string } {
  const { pendingOutfitChanges } = ensureOutfitChangeFields(living);
  if (anfuHoldsOutfit(living, characterId)) {
    delete pendingOutfitChanges[characterId];
    return { pending: false, applied: false, suppressContinue: false, msg: '' };
  }
  const playerMsg = opts.playerMessage?.startsWith('【系统') ? '' : opts.playerMessage;
  const mouth = `${opts.dialogue} ${opts.action ?? ''}`;
  const speech = `${mouth} ${opts.inner_thought ?? ''} ${playerMsg ?? ''}`;
  const going = GOING_RE.test(mouth);
  const done = DONE_RE.test(mouth);
  const refused = declinesOutfitChange(opts.dialogue, opts.action);

  if (refused && !going && !done) {
    cancelPendingOutfitChange(living, characterId);
    return {
      pending: false,
      applied: false,
      suppressContinue: false,
      msg: '角色拒绝换装，已取消换装过程皮',
    };
  }

  const fromField = result.skin_change
    ? normalizeSkinChangeWant(characterId, result.skin_change)
    : null;
  const inferred = inferWantFromSpeech(
    characterId,
    going || done ? `${playerMsg ?? ''} ${opts.dialogue}` : opts.dialogue,
  );
  let want = fromField || (going || done ? inferred : null);
  // 嘴上说去换但未填 skin_change / 未点名套装时：有换装语境就默认特殊服装
  if (!want && (going || done) && OUTFIT_SPEECH_RE.test(speech)) {
    want = SPECIAL_DARE_SKIN_ID;
  }
  const cur = logicalSkinMeta(living, characterId);
  const pending = pendingOutfitChanges[characterId];

  // 中间过程叙事（正在脱/拉链卡住/还在换…）：挂叙事锁，压住一切背景瞬间换皮写者
  if (!done && (going || isMidChangeSpeech(speech))) {
    holdOutfitForNarrative(living, characterId, opts.dialogue.slice(0, 40));
  }

  // 独自洗浴皮：场景安全，仍瞬时
  if (isAloneBathSkinId(want)) {
    const r = applyAiSkinChange(save, living, characterId, want!);
    delete pendingOutfitChanges[characterId];
    return { pending: false, applied: r.ok, suppressContinue: false, msg: r.msg };
  }

  if (want && isOutfitChangeProcessSkin(want)) {
    return {
      pending: false,
      applied: false,
      suppressContinue: false,
      msg: '换装过程皮不可作为目标',
    };
  }

  if (pending?.phase === 'changing') {
    if (want && !sameSkin(want === 'default' ? null : want, pending.targetSkinId)) {
      queueChanging(living, characterId, want);
      return {
        pending: true,
        applied: false,
        suppressContinue: true,
        msg: `改去换「${targetName(characterId, want)}」，立绘播「${OUTFIT_CHANGE_SKIN_NAME}」`,
      };
    }
    if (done && Date.now() >= pending.readyAtMs - 400) {
      const r = applyPendingOutfitChangeNow(save, living, characterId);
      return { pending: false, applied: r.applied, suppressContinue: false, msg: r.msg };
    }
    return {
      pending: true,
      applied: false,
      suppressContinue: true,
      msg: `仍在换「${pending.targetName}」，立绘「${OUTFIT_CHANGE_SKIN_NAME}」`,
    };
  }

  if (!want) {
    // 口头去换但解析失败：仍压住续聊，避免「行。我去换」连发
    if (going || isMidChangeSpeech(speech)) {
      return {
        pending: false,
        applied: false,
        suppressContinue: true,
        msg: '口头换装但未解析到目标外覆',
      };
    }
    return { pending: false, applied: false, suppressContinue: false, msg: '' };
  }
  if (want !== 'default' && !hasCampSkinAsset(characterId, want)) {
    return { pending: false, applied: false, suppressContinue: false, msg: '无此外覆资源' };
  }

  if (sameSkin(want === 'default' ? null : want, cur.id)) {
    setWearLock(living, characterId, cur.id);
    return { pending: false, applied: false, suppressContinue: false, msg: '已是目标外观' };
  }

  // 说去换、或同一轮抢跑说换好了、或只填了 skin_change → 排队，立绘切换装过程皮
  const p = queueChanging(living, characterId, want, done && !going ? 3200 : CHANGE_DELAY_MS);
  return {
    pending: true,
    applied: false,
    suppressContinue: true,
    msg: `${CHARACTER_MAP[characterId]?.name ?? characterId}去换「${p.targetName}」，立绘切「${OUTFIT_CHANGE_SKIN_NAME}」（原「${p.fromSkinName}」）`,
  };
}
