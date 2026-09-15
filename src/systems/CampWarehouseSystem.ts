/**
 * 营地仓库 / 商店 / 送礼 / 食用
 * 共享仓库 + 角色私房钱；食品默认 1 锈币。
 */
import type { SaveData } from '../types';
import type {
  AiLivingSave,
  ItemOfferIntent,
  ItemOfferResolution,
  LightStatusTag,
  PendingItemOffer,
} from '../ai/types';
import {
  CAMP_PROPS,
  getCampProp,
  type CampPropDef,
} from '../data/campProps';
import { CHARACTER_MAP } from '../data/characters';
import { CAMP_ROOM_MAP } from '../data/campLayout';
import { buildCampShopkeeperPromptLine } from '../data/campShopkeeper';
import { adjustAffinity, adjustRelation } from '../ai/relationship';
import { recordGiftBondFact } from '../ai/structuredFacts';
import { pushMemory, pushCampLog } from '../ai/memory';
import {
  CYBER_SHOP_PRICE,
  CYBER_HEALTH_MAX,
  isCyberProp,
  getCyberHealth,
  setCyberHealth,
  repairCyberHealth,
  penalizeCyberHelpFail,
  getCyberLoadout,
  getOpenCyberEventFor,
  resolveCyberEvent,
  buildCyberHealthPromptBlock,
  seedCyberHealthForOwned,
} from './CyberHealthSystem';
import {
  campShopDayLabel,
  ensureCampShopDay,
  isPropOnCampShopShelf,
  markCampShopSold,
  summarizeCampShopForPrompt,
} from './CampShopSystem';

export const FOOD_SHOP_PRICE = 1;
export const SELL_RATIO = 0.4;
export const DEFAULT_POCKET_GOLD = 40;
export const MAX_ROOM_PLACEMENTS = 6;

export type CampItemActionPayload = {
  item_id?: string;
  itemId?: string;
  action?: string;
  /** player | self | 角色id | warehouse */
  payer?: string;
  /** self | player | 角色id | warehouse */
  target?: string;
  reason?: string;
  qty?: number;
};

export type CampItemActionResult = {
  ok: boolean;
  msg: string;
  /** 写入对话记忆/日志 */
  log?: string;
};

function ensureWarehouse(save: SaveData): Record<string, number> {
  if (!save.campWarehouse || typeof save.campWarehouse !== 'object') {
    save.campWarehouse = {};
  }
  return save.campWarehouse;
}

function ensurePockets(living: AiLivingSave): Record<string, number> {
  if (!living.characterPockets || typeof living.characterPockets !== 'object') {
    living.characterPockets = {};
  }
  return living.characterPockets;
}

/** 食品 1 币；义体 10 币；其它用 catalog 价 */
export function getShopPrice(prop: CampPropDef): number {
  if (prop.category === 'food') return FOOD_SHOP_PRICE;
  if (prop.category === 'equip') return CYBER_SHOP_PRICE;
  return Math.max(1, prop.shopPrice | 0);
}

export function getSellPrice(prop: CampPropDef): number {
  if (prop.category === 'food') return 0;
  return Math.max(1, Math.floor(getShopPrice(prop) * SELL_RATIO));
}

export function resolvePropId(raw: string | undefined | null): CampPropDef | undefined {
  if (!raw?.trim()) return undefined;
  return getCampProp(raw.trim());
}

export function getWarehouseQty(save: SaveData, propId: string): number {
  return Math.max(0, ensureWarehouse(save)[propId] ?? 0);
}

export function addToWarehouse(save: SaveData, propId: string, qty: number): number {
  const wh = ensureWarehouse(save);
  const prop = getCampProp(propId);
  const max = prop?.stackMax ?? 99;
  const next = Math.min(max, (wh[propId] ?? 0) + qty);
  wh[propId] = next;
  if (next <= 0) delete wh[propId];
  return wh[propId] ?? 0;
}

export function removeFromWarehouse(save: SaveData, propId: string, qty: number): boolean {
  const wh = ensureWarehouse(save);
  const have = wh[propId] ?? 0;
  if (have < qty) return false;
  const next = have - qty;
  if (next <= 0) delete wh[propId];
  else wh[propId] = next;
  return true;
}

export function getCharacterPocket(living: AiLivingSave, characterId: string): number {
  const pockets = ensurePockets(living);
  if (pockets[characterId] === undefined) {
    pockets[characterId] = DEFAULT_POCKET_GOLD;
  }
  return pockets[characterId] ?? 0;
}

export function addCharacterPocket(living: AiLivingSave, characterId: string, delta: number): number {
  const pockets = ensurePockets(living);
  const cur = getCharacterPocket(living, characterId);
  pockets[characterId] = Math.max(0, cur + delta);
  return pockets[characterId];
}

function canSpendPlayer(save: SaveData, cost: number): boolean {
  if (save.settings?.debugInfiniteGold) return true;
  return (save.gold ?? 0) >= cost;
}

function spendPlayer(save: SaveData, cost: number): boolean {
  if (save.settings?.debugInfiniteGold) return true;
  if ((save.gold ?? 0) < cost) return false;
  save.gold -= cost;
  return true;
}

function resolvePayerId(
  speakerId: string,
  payerRaw: string | undefined,
): 'player' | string {
  const p = (payerRaw || 'self').trim().toLowerCase();
  if (p === 'player' || p === 'commander' || p === '玩家' || p === '指挥官') return 'player';
  if (p === 'self' || p === 'me' || p === '自己') return speakerId;
  if (CHARACTER_MAP[p]) return p;
  return speakerId;
}

function resolveTargetId(
  speakerId: string,
  targetRaw: string | undefined,
  fallback: string,
): string {
  const t = (targetRaw || fallback).trim();
  const low = t.toLowerCase();
  if (low === 'self' || low === 'me' || low === '自己') return speakerId;
  if (low === 'player' || low === 'commander' || low === '玩家' || low === '指挥官') return 'player';
  if (low === 'warehouse' || low === '仓库') return 'warehouse';
  if (CHARACTER_MAP[t]) return t;
  return fallback;
}

/** 买进仓库（玩家或角色出钱；不校验货架） */
export function buyToWarehouse(
  save: SaveData,
  living: AiLivingSave,
  propId: string,
  payer: 'player' | string,
  qty = 1,
): CampItemActionResult {
  const prop = getCampProp(propId);
  if (!prop) return { ok: false, msg: '未知道具' };
  const n = Math.max(1, Math.min(99, qty | 0));
  const unit = getShopPrice(prop);
  const cost = unit * n;
  if (payer === 'player') {
    if (!canSpendPlayer(save, cost)) return { ok: false, msg: `锈币不足（需 ${cost}）` };
    spendPlayer(save, cost);
  } else {
    if (getCharacterPocket(living, payer) < cost) {
      return { ok: false, msg: `${CHARACTER_MAP[payer]?.name ?? payer} 私房钱不足（需 ${cost}）` };
    }
    addCharacterPocket(living, payer, -cost);
  }
  addToWarehouse(save, prop.id, n);
  const who = payer === 'player' ? '指挥官' : CHARACTER_MAP[payer]?.name ?? payer;
  return {
    ok: true,
    msg: `${who} 花费 ${cost} 锈币购入 ${prop.nameZh}×${n}（入库）`,
    log: `${who} 买了 ${prop.nameZh}×${n} 进仓库`,
  };
}

/**
 * 从当日营地货架购买 1 件 → 入库并下架。
 */
export function buyFromCampShop(
  save: SaveData,
  living: AiLivingSave,
  propId: string,
  payer: 'player' | string,
  opts?: { characterIdForCyber?: string },
): CampItemActionResult {
  ensureCampShopDay(save, living);
  if (!isPropOnCampShopShelf(save, living, propId)) {
    return { ok: false, msg: '今日货架无此商品（或已售罄）' };
  }
  const prop = getCampProp(propId);
  if (!prop) return { ok: false, msg: '未知道具' };

  let result: CampItemActionResult;
  if (prop.category === 'equip' && opts?.characterIdForCyber) {
    result = buyCyberAndHeal(
      save,
      living,
      propId,
      opts.characterIdForCyber,
      payer,
      payer === 'player' || payer !== opts.characterIdForCyber,
    );
  } else {
    result = buyToWarehouse(save, living, propId, payer, 1);
  }
  if (result.ok) markCampShopSold(save, living, propId);
  return result;
}

/** 卖出仓库道具 */
export function sellFromWarehouse(
  save: SaveData,
  living: AiLivingSave,
  propId: string,
  receiver: 'player' | string,
  qty = 1,
): CampItemActionResult {
  const prop = getCampProp(propId);
  if (!prop) return { ok: false, msg: '未知道具' };
  const n = Math.max(1, Math.min(99, qty | 0));
  if (!removeFromWarehouse(save, prop.id, n)) {
    return { ok: false, msg: `仓库没有足够的 ${prop.nameZh}` };
  }
  const gain = getSellPrice(prop) * n;
  if (receiver === 'player') save.gold = (save.gold ?? 0) + gain;
  else addCharacterPocket(living, receiver, gain);
  return {
    ok: true,
    msg: `卖出 ${prop.nameZh}×${n}，得 ${gain} 锈币`,
    log: `卖出 ${prop.nameZh}×${n}`,
  };
}

/** 从仓库送礼给角色 */
function applyGiftEffects(
  save: SaveData,
  living: AiLivingSave,
  prop: CampPropDef,
  toCharacterId: string,
): CampItemActionResult {
  const oc = save.ownedCharacters.find((c) => c.characterId === toCharacterId);
  if (oc) {
    oc.giftCount = (oc.giftCount ?? 0) + 1;
    save.stats.giftsSent = (save.stats.giftsSent ?? 0) + 1;
  }
  const pref = CHARACTER_MAP[toCharacterId]?.giftPreference ?? '';
  const prefHit =
    Boolean(pref) &&
    (pref.includes(prop.nameZh) ||
      prop.nameZh.includes(pref.slice(0, 2)) ||
      prop.campUse.includes(pref.slice(0, 2)) ||
      /花|礼|糖|甜|熊|巧克力|蛋糕/.test(prop.nameZh));
  const tierBoost = prefHit ? 2 : prop.category === 'food' ? 0 : 1;
  const delta = 4 + tierBoost + (getShopPrice(prop) >= 150 ? 2 : 0);
  const score = adjustAffinity(living, toCharacterId, delta);
  recordGiftBondFact(living, toCharacterId, prop.nameZh);
  const name = CHARACTER_MAP[toCharacterId]?.name ?? toCharacterId;
  return {
    ok: true,
    msg: `将 ${prop.nameZh} 送给 ${name}（好感 ${score}${prefHit ? '·偏好命中' : ''}）`,
    log: `送礼 ${prop.nameZh} → ${name}`,
  };
}

export function giftFromWarehouse(
  save: SaveData,
  living: AiLivingSave,
  propId: string,
  toCharacterId: string,
): CampItemActionResult {
  const prop = getCampProp(propId);
  if (!prop) return { ok: false, msg: '未知道具' };
  if (!prop.tags.includes('gift') && prop.category !== 'food' && prop.category !== 'gift') {
    return { ok: false, msg: `${prop.nameZh} 不太适合当礼物` };
  }
  if (!removeFromWarehouse(save, prop.id, 1)) {
    return { ok: false, msg: `仓库没有 ${prop.nameZh}` };
  }
  return applyGiftEffects(save, living, prop, toCharacterId);
}

/** 食用：改善目标状态（不扣仓库） */
function applyConsumeEffects(
  living: AiLivingSave,
  prop: CampPropDef,
  eaterId: string,
): CampItemActionResult {
  if (eaterId !== 'player') {
    const cur = new Set(living.characterStatus[eaterId] ?? []);
    cur.delete('hunger');
    cur.delete('thirst');
    cur.add('calm' as LightStatusTag);
    living.characterStatus[eaterId] = [...cur].slice(0, 4) as LightStatusTag[];
  }
  const who = eaterId === 'player' ? '指挥官' : CHARACTER_MAP[eaterId]?.name ?? eaterId;
  return {
    ok: true,
    msg: `${who} 吃了 ${prop.nameZh}`,
    log: `${who} 食用 ${prop.nameZh}`,
  };
}

/** 食用：从仓库扣除，改善目标状态 */
export function consumeFromWarehouse(
  save: SaveData,
  living: AiLivingSave,
  propId: string,
  eaterId: string,
): CampItemActionResult {
  const prop = getCampProp(propId);
  if (!prop) return { ok: false, msg: '未知道具' };
  if (prop.category !== 'food' && !prop.tags.includes('consume')) {
    return { ok: false, msg: `${prop.nameZh} 不能吃` };
  }
  if (!removeFromWarehouse(save, prop.id, 1)) {
    return { ok: false, msg: `仓库没有 ${prop.nameZh}` };
  }
  return applyConsumeEffects(living, prop, eaterId);
}

function ensurePlacements(living: AiLivingSave): Record<string, Record<string, string>> {
  if (!living.campPlacements || typeof living.campPlacements !== 'object') {
    living.campPlacements = {};
  }
  return living.campPlacements;
}

export function summarizeRoomPlacements(living: AiLivingSave, roomId: string): string {
  const slots = ensurePlacements(living)[roomId] ?? {};
  const names = Object.values(slots)
    .map((id) => getCampProp(id)?.nameZh ?? id)
    .filter(Boolean);
  return names.join('、');
}

/** 从仓库放置到房间（Phase A：槽位列表，无坐标） */
export function placeFromWarehouse(
  save: SaveData,
  living: AiLivingSave,
  propId: string,
  roomId: string,
): CampItemActionResult {
  const prop = getCampProp(propId);
  if (!prop) return { ok: false, msg: '未知道具' };
  if (
    !prop.tags.includes('place') &&
    !prop.tags.includes('display') &&
    !prop.tags.includes('furniture') &&
    !prop.tags.includes('entertain')
  ) {
    return { ok: false, msg: `${prop.nameZh} 不宜放置` };
  }
  const room = CAMP_ROOM_MAP[roomId];
  if (!room) return { ok: false, msg: '未知房间' };
  const rooms = ensurePlacements(living);
  if (!rooms[roomId]) rooms[roomId] = {};
  const slots = rooms[roomId]!;
  if (Object.keys(slots).length >= MAX_ROOM_PLACEMENTS) {
    return { ok: false, msg: `${room.label} 已摆满（最多 ${MAX_ROOM_PLACEMENTS}）` };
  }
  if (!removeFromWarehouse(save, prop.id, 1)) {
    return { ok: false, msg: `仓库没有 ${prop.nameZh}` };
  }
  const slot = `s${Object.keys(slots).length + 1}_${prop.key}`;
  slots[slot] = prop.id;
  return {
    ok: true,
    msg: `将 ${prop.nameZh} 放到${room.label}`,
    log: `放置 ${prop.nameZh} → ${room.label}`,
  };
}

export function unplaceToWarehouse(
  save: SaveData,
  living: AiLivingSave,
  propId: string,
  roomId?: string,
): CampItemActionResult {
  const prop = getCampProp(propId);
  if (!prop) return { ok: false, msg: '未知道具' };
  const rooms = ensurePlacements(living);
  const tryRooms = roomId ? [roomId] : Object.keys(rooms);
  for (const rid of tryRooms) {
    const slots = rooms[rid];
    if (!slots) continue;
    const hit = Object.entries(slots).find(([, id]) => id === prop.id);
    if (!hit) continue;
    delete slots[hit[0]];
    addToWarehouse(save, prop.id, 1);
    const label = CAMP_ROOM_MAP[rid]?.label ?? rid;
    return {
      ok: true,
      msg: `从${label}收回 ${prop.nameZh}`,
      log: `收回 ${prop.nameZh} ← ${label}`,
    };
  }
  return { ok: false, msg: `场景里没有放置中的 ${prop.nameZh}` };
}

/** 娱乐：不消耗道具；与玩家加好感，与 NPC 加关系（不校验仓库） */
function applyPlayEffects(
  living: AiLivingSave,
  prop: CampPropDef,
  actorId: string,
  partnerId: string,
): CampItemActionResult {
  const actorName = CHARACTER_MAP[actorId]?.name ?? actorId;
  if (partnerId === 'player') {
    adjustAffinity(living, actorId, 3);
    return {
      ok: true,
      msg: `${actorName} 与指挥官玩了 ${prop.nameZh}`,
      log: `${actorName} 与指挥官娱乐：${prop.nameZh}`,
    };
  }
  if (!CHARACTER_MAP[partnerId]) {
    return { ok: false, msg: '娱乐对象无效' };
  }
  adjustRelation(living, actorId, partnerId, 4);
  const partnerName = CHARACTER_MAP[partnerId]?.name ?? partnerId;
  return {
    ok: true,
    msg: `${actorName} 与 ${partnerName} 玩了 ${prop.nameZh}`,
    log: `${actorName}↔${partnerName} 娱乐：${prop.nameZh}`,
  };
}

/** 娱乐：不消耗道具；与玩家加好感，与 NPC 加关系 */
export function playEntertainment(
  save: SaveData,
  living: AiLivingSave,
  propId: string,
  actorId: string,
  partnerId: string,
): CampItemActionResult {
  const prop = getCampProp(propId);
  if (!prop) return { ok: false, msg: '未知道具' };
  if (prop.category !== 'entertain' && !prop.tags.includes('entertain')) {
    return { ok: false, msg: `${prop.nameZh} 不是娱乐道具` };
  }
  const inWh = getWarehouseQty(save, prop.id) > 0;
  const placed = Object.values(ensurePlacements(living)).some((slots) =>
    Object.values(slots).includes(prop.id),
  );
  if (!inWh && !placed) {
    return { ok: false, msg: `没有 ${prop.nameZh}（需仓库有货或已放置）` };
  }
  if (!inWh && !placed) {
    return { ok: false, msg: `没有 ${prop.nameZh}（需仓库有货或已放置）` };
  }
  return applyPlayEffects(living, prop, actorId, partnerId);
}

/** 装备义体：叙事挂载（不扣仓库） */
function applyEquipCyberEffects(
  save: SaveData,
  living: AiLivingSave,
  prop: CampPropDef,
  characterId: string,
  alsoHeal = true,
): CampItemActionResult {
  if (!isCyberProp(prop)) return { ok: false, msg: '只能装备义体类道具' };
  if (!CHARACTER_MAP[characterId]) return { ok: false, msg: '未知角色' };
  const lo = getCyberLoadout(living, characterId);
  const prevId = lo[prop.key];
  if (prevId) addToWarehouse(save, prevId, 1);
  lo[prop.key] = prop.id;

  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  let healNote = '';
  if (alsoHeal) {
    const before = getCyberHealth(living, characterId);
    if (before < CYBER_HEALTH_MAX) {
      setCyberHealth(living, characterId, CYBER_HEALTH_MAX, `换装新义体「${prop.nameZh}」`);
      const open = getOpenCyberEventFor(living, characterId);
      if (open) resolveCyberEvent(living, open.id, `已换装 ${prop.nameZh}`);
      healNote = `，健康 ${before}→${CYBER_HEALTH_MAX}`;
    }
  }
  return {
    ok: true,
    msg: `${name} 挂载 ${prop.nameZh}（不改皮肤/战力）${healNote}`,
    log: `${name} 装备义体 ${prop.nameZh}${healNote}`,
  };
}

/** 装备义体：叙事挂载，不改皮肤/战力；健康未满时顺带回满 */
export function equipCyberFromWarehouse(
  save: SaveData,
  living: AiLivingSave,
  propId: string,
  characterId: string,
  alsoHeal = true,
): CampItemActionResult {
  const prop = getCampProp(propId);
  if (!prop || !isCyberProp(prop)) return { ok: false, msg: '只能装备义体类道具' };
  if (!CHARACTER_MAP[characterId]) return { ok: false, msg: '未知角色' };
  if (!removeFromWarehouse(save, prop.id, 1)) {
    return { ok: false, msg: `仓库没有 ${prop.nameZh}` };
  }
  return applyEquipCyberEffects(save, living, prop, characterId, alsoHeal);
}

export function unequipCyberToWarehouse(
  save: SaveData,
  living: AiLivingSave,
  propId: string,
  characterId: string,
): CampItemActionResult {
  const prop = getCampProp(propId);
  if (!prop) return { ok: false, msg: '未知道具' };
  const lo = getCyberLoadout(living, characterId);
  const hit = Object.entries(lo).find(([, id]) => id === prop.id || id === propId);
  if (!hit) return { ok: false, msg: '该角色未挂载此义体' };
  delete lo[hit[0]];
  addToWarehouse(save, prop.id, 1);
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  return {
    ok: true,
    msg: `${name} 卸下 ${prop.nameZh}`,
    log: `${name} 卸下义体 ${prop.nameZh}`,
  };
}

/** 购买义体并治疗：10 币入库 + 健康回满 */
export function buyCyberAndHeal(
  save: SaveData,
  living: AiLivingSave,
  propId: string,
  beneficiaryId: string,
  payer: 'player' | string,
  askedHelp: boolean,
): CampItemActionResult {
  let prop = getCampProp(propId);
  if (!prop || !isCyberProp(prop)) {
    const fallback = getCampProp('camp_prop_64');
    if (!prop && fallback) {
      prop = fallback;
    } else if (!prop || !isCyberProp(prop)) {
      return { ok: false, msg: '须指定义体道具' };
    }
  }

  const buy = buyToWarehouse(save, living, prop.id, payer, 1);
  if (!buy.ok) {
    if (askedHelp && payer !== beneficiaryId) {
      penalizeCyberHelpFail(living, beneficiaryId, payer, buy.msg);
    }
    return buy;
  }

  const before = getCyberHealth(living, beneficiaryId);
  setCyberHealth(living, beneficiaryId, CYBER_HEALTH_MAX, `购置新义体「${prop.nameZh}」`);
  const open = getOpenCyberEventFor(living, beneficiaryId);
  if (open) resolveCyberEvent(living, open.id, `已购置 ${prop.nameZh}`);

  let affNote = '';
  if (askedHelp || payer === 'player' || payer !== beneficiaryId) {
    if (payer === 'player') {
      adjustAffinity(living, beneficiaryId, 5);
      affNote = ' · 好感+';
    } else if (payer !== beneficiaryId) {
      adjustRelation(living, beneficiaryId, payer, 5);
      affNote = ' · 关系+';
    }
  }

  const name = CHARACTER_MAP[beneficiaryId]?.name ?? beneficiaryId;
  return {
    ok: true,
    msg: `${buy.msg}；${name}健康 ${before}→${CYBER_HEALTH_MAX}${affNote}`,
    log: `${name} 购入义体 ${prop.nameZh} 并回满健康`,
  };
}

/**
 * 解析并执行 AI camp_item_action
 */
export function applyCampItemAction(
  save: SaveData,
  living: AiLivingSave,
  speakerId: string,
  raw: CampItemActionPayload | null | undefined,
): CampItemActionResult {
  if (!raw || typeof raw !== 'object') return { ok: false, msg: '' };
  const action = String(raw.action || '')
    .trim()
    .toLowerCase();
  if (!action || action === 'none' || action === '""') return { ok: false, msg: '' };

  const prop = resolvePropId(raw.item_id || raw.itemId);
  const qty = typeof raw.qty === 'number' ? raw.qty : 1;
  const payer = resolvePayerId(speakerId, raw.payer);
  const reason = typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 80) : '';
  const askedHelp =
    payer === 'player' ||
    (payer !== speakerId && Boolean(raw.payer && String(raw.payer).toLowerCase() !== 'self'));

  if (!prop && !['check', 'inspect', 'repair'].includes(action)) {
    return { ok: false, msg: '未指定有效道具' };
  }

  let result: CampItemActionResult;

  switch (action) {
    case 'buy':
    case 'buy_to_warehouse':
    case 'purchase': {
      // 只能买当日货架未售罄的 1 件；入库后下架
      if (prop && isCyberProp(prop)) {
        const who = resolveTargetId(speakerId, raw.target, speakerId);
        const beneficiary = who === 'player' || who === 'warehouse' ? speakerId : who;
        result = buyFromCampShop(save, living, prop.id, payer, {
          characterIdForCyber: beneficiary,
        });
      } else {
        result = buyFromCampShop(save, living, prop!.id, payer);
        if (!result.ok && askedHelp) {
          penalizeCyberHelpFail(living, speakerId, payer, result.msg);
        }
      }
      break;
    }
    case 'sell': {
      const recv = resolveTargetId(speakerId, raw.target, payer);
      result = sellFromWarehouse(
        save,
        living,
        prop!.id,
        recv === 'warehouse' ? 'player' : (recv as 'player' | string),
        qty,
      );
      break;
    }
    case 'gift':
    case 'give': {
      const to = resolveTargetId(speakerId, raw.target, speakerId);
      if (to === 'player' || to === 'warehouse') {
        result = { ok: false, msg: '礼物目标须为角色' };
      } else {
        result = giftFromWarehouse(save, living, prop!.id, to);
      }
      break;
    }
    case 'consume':
    case 'eat':
    case 'drink': {
      const eater = resolveTargetId(speakerId, raw.target, speakerId);
      result = consumeFromWarehouse(
        save,
        living,
        prop!.id,
        eater === 'warehouse' ? speakerId : eater,
      );
      break;
    }
    case 'place': {
      const roomRaw = (raw.target || '').trim();
      const roomId =
        CAMP_ROOM_MAP[roomRaw]?.id ??
        Object.values(CAMP_ROOM_MAP).find((r) => r.label === roomRaw)?.id ??
        Object.values(CAMP_ROOM_MAP).find((r) => r.sceneId === roomRaw)?.id ??
        'room_1f_hall1';
      result = placeFromWarehouse(save, living, prop!.id, roomId);
      break;
    }
    case 'unplace':
    case 'take':
    case 'pickup': {
      const roomRaw = (raw.target || '').trim();
      const roomId = CAMP_ROOM_MAP[roomRaw]?.id;
      result = unplaceToWarehouse(save, living, prop!.id, roomId);
      break;
    }
    case 'play': {
      const partner = resolveTargetId(speakerId, raw.target, 'player');
      result = playEntertainment(save, living, prop!.id, speakerId, partner);
      break;
    }
    case 'equip': {
      const who = resolveTargetId(speakerId, raw.target, speakerId);
      if (who === 'player' || who === 'warehouse') {
        result = { ok: false, msg: '装备目标须为角色' };
      } else {
        result = equipCyberFromWarehouse(save, living, prop!.id, who, true);
      }
      break;
    }
    case 'unequip': {
      const who = resolveTargetId(speakerId, raw.target, speakerId);
      result = unequipCyberToWarehouse(
        save,
        living,
        prop!.id,
        who === 'warehouse' ? speakerId : who,
      );
      break;
    }
    case 'repair': {
      const who = resolveTargetId(speakerId, raw.target, speakerId);
      const beneficiary = who === 'player' || who === 'warehouse' ? speakerId : who;
      const helper = askedHelp ? payer : 'self';
      const r = repairCyberHealth(living, beneficiary, helper === beneficiary ? 'self' : helper);
      result = { ok: r.ok, msg: r.msg, log: r.log };
      if (!r.ok && askedHelp) {
        penalizeCyberHelpFail(living, beneficiary, helper, r.msg);
      }
      break;
    }
    case 'check':
    case 'inspect': {
      const gold = save.gold ?? 0;
      const pocket = getCharacterPocket(living, speakerId);
      const wh = summarizeWarehouse(save, 12);
      const hp = getCyberHealth(living, speakerId);
      result = {
        ok: true,
        msg: `库存巡视：指挥官锈币 ${gold}；你私房 ${pocket}；义体健康 ${hp}/100；仓库 ${wh || '空'}`,
      };
      break;
    }
    default:
      result = { ok: false, msg: `暂不支持动作 ${action}` };
  }

  if (result.ok && result.log) {
    pushCampLog(living, {
      text: `${result.log}${reason ? `（${reason}）` : ''}`,
      source: 'npc',
      characterIds: [speakerId],
    });
    pushMemory(living, speakerId, {
      kind: 'event',
      summary: result.log,
      importance: 5,
    });
  }
  return result;
}

export function summarizeWarehouse(save: SaveData, limit = 16): string {
  const wh = ensureWarehouse(save);
  const lines: string[] = [];
  for (const [id, qty] of Object.entries(wh)) {
    if (!qty) continue;
    const p = getCampProp(id);
    // 带 id，便于 camp_item_action 直接引用
    lines.push(`${p?.nameZh ?? id}(${id})×${qty}`);
    if (lines.length >= limit) break;
  }
  return lines.join('、');
}

/** 按品类摘要仓库，增强「看得见货」的存在感 */
export function summarizeWarehouseByCategory(save: SaveData, perCat = 4): string {
  const wh = ensureWarehouse(save);
  const buckets: Record<string, string[]> = {
    food: [],
    gift: [],
    material: [],
    tool: [],
    consumable: [],
    entertain: [],
    equip: [],
    furniture: [],
    other: [],
  };
  const label: Record<string, string> = {
    food: '食品',
    gift: '礼物',
    material: '材料',
    tool: '工具',
    consumable: '消耗品',
    entertain: '娱乐',
    equip: '义体',
    furniture: '家具',
    other: '其它',
  };
  for (const [id, qty] of Object.entries(wh)) {
    if (!qty) continue;
    const p = getCampProp(id);
    const cat = p?.category && buckets[p.category] ? p.category : 'other';
    if (buckets[cat].length >= perCat) continue;
    buckets[cat].push(`${p?.nameZh ?? id}(${id})×${qty}`);
  }
  const parts: string[] = [];
  for (const key of Object.keys(label)) {
    if (!buckets[key]?.length) continue;
    parts.push(`${label[key]}：${buckets[key].join('、')}`);
  }
  return parts.join('｜') || '';
}

export function buildCampEconomyPromptBlock(
  save: SaveData,
  living: AiLivingSave,
  characterId: string,
): string {
  seedCyberHealthForOwned(living, [characterId]);
  ensureCampShopDay(save, living);
  const gold = save.gold ?? 0;
  const pocket = getCharacterPocket(living, characterId);
  const whFlat = summarizeWarehouse(save, 18);
  const whCats = summarizeWarehouseByCategory(save, 4);
  const shopShelf = summarizeCampShopForPrompt(save, living);
  const foodEmpty = !CAMP_PROPS.some(
    (p) => p.category === 'food' && getWarehouseQty(save, p.id) > 0,
  );
  const broke = gold < 1 && pocket < 1;
  const scarcity: string[] = [];
  if (broke) scarcity.push('钱不够：禁止编造已购买成功；想买只能表达愿望/求指挥官赞助/改去做不花钱的事');
  if (foodEmpty) scarcity.push('仓库没食品：不能写「吃到了」；可提议去当日货架买（食品 1 锈币）或忍饿聊天');
  if (!whFlat) scarcity.push('仓库空空：送礼/展示/吃东西类行为要减少或改成「想去商店」');
  if (shopShelf.includes('售罄')) scarcity.push('今日货架已空：禁止再买；等明日刷新');

  const recentFail = (living.memories?.[characterId] ?? [])
    .filter((m) => typeof m.summary === 'string' && m.summary.includes('道具动作失败'))
    .slice(0, 2)
    .map((m) => m.summary)
    .join('；');

  const placeHint = summarizeRoomPlacements(living, 'room_1f_hall1');
  const agenda = living.agendas?.[characterId];
  const roomId =
    agenda && agenda.remainGameMin > 0 && agenda.targetRoomId ? agenda.targetRoomId : '';
  const atShop = roomId === 'room_1f_shop' || roomId === 'room_1f_shop_bed';
  const atStorage = roomId === 'room_1f_storage';
  const placeNudge = atShop
    ? '你人就在商店：柜台后有「商店老板娘」（古老商店机体，只会固定接待话术，勿当同伴深聊）。对白里应能看到/摸到货架商品，可随口点评缺货、推荐指挥官买、或自己掏私房钱下单（填 camp_item_action）。'
    : atStorage
      ? '你人就在仓库：对白里应能指着库存说话（吃一口、拿礼物、翻零件），用仓库里真实有的 item_id。'
      : '即使不在商店/仓库，你也知道营里货架与仓库大概有什么，也知道商店有个不会闲聊的机器人老板娘；闲聊可自然提一句「想去逛货架/仓库还有××」。';

  return `【营地经济·仓库/日更商店/私房钱】（真实存档，禁止幻觉有货/有钱）
- 指挥官锈币：${gold}
- 你的私房钱：${pocket}（可自行买「当日货架」道具进仓库；不够就别买，或填 payer=player 求指挥官出钱）
- 共享仓库分拣：${whCats || '（空）'}
- 仓库清单（含 id，动作必须用这些 id）：${whFlat || '（空）'}
- ${campShopDayLabel(living)}（仅下列可买，每件库存 1，买完即无；隔日刷新 30 件；格式 名(id,价)）：${shopShelf}
- 大厅陈设：${placeHint || '（空）'}
- 物价：食品 1 锈币；义体一律 10 锈币；其它按标价。买的东西进仓库。
- ${buildCampShopkeeperPromptLine()}
- 【存在感】${placeNudge}
- 闲聊时允许点名仓库/货架上的真实物品（用中文名即可）；真要买/送/吃/修时必须填 camp_item_action 且 item_id 与上表一致。
- camp_item_action：
  {"item_id":"camp_prop_XX","action":"buy|sell|gift|consume|place|play|equip|unequip|repair|check","payer":"player|self|角色id","target":"self|角色id|room_id|warehouse","qty":1,"reason":"短句"}
- 语义：buy=仅可买货架上未售罄的 item_id（付款入库；买义体会回满健康）；gift/consume/play 用仓库库存；repair=免费修到 100；equip=挂载义体；place=摆到房间；check=口头盘点；payer=谁出钱。
- 约束：钱/货/货架不足不能假装成功；求助失败掉好友度，成功则加。
${scarcity.length ? `- 当前紧缺提示：${scarcity.join('；')}` : '- 当前物资尚可，仍须按真实数量行动。'}
${recentFail ? `- 近期失败（勿重复硬来）：${recentFail}` : ''}
${buildCyberHealthPromptBlock(living, characterId)}`;
}

/** 新档种子：少量食品 + 角色私房钱 + 义体健康 */
export function seedCampEconomy(save: SaveData, living: AiLivingSave): void {
  const wh = ensureWarehouse(save);
  if (Object.keys(wh).length === 0) {
    addToWarehouse(save, 'camp_prop_55', 2);
    addToWarehouse(save, 'camp_prop_57', 3);
    addToWarehouse(save, 'camp_prop_62', 2);
    addToWarehouse(save, 'camp_prop_04', 1);
    addToWarehouse(save, 'camp_prop_30', 2);
  }
  const pockets = ensurePockets(living);
  for (const oc of save.ownedCharacters) {
    if (pockets[oc.characterId] === undefined) {
      pockets[oc.characterId] = DEFAULT_POCKET_GOLD;
    }
  }
  seedCyberHealthForOwned(
    living,
    save.ownedCharacters.map((c) => c.characterId),
  );
  ensureCampShopDay(save, living);
}

// ── 对话递物 escrow（P0）────────────────────────────────────────

export type ItemOfferSettlement = CampItemActionResult & { handled: boolean };

const OFFER_INTENT_LABEL: Record<ItemOfferIntent, string> = {
  gift: '收下',
  consume: '吃',
  equip: '安装',
  play: '一起玩',
  show: '看看',
};

export function resolvePropOfferIntent(prop: CampPropDef): {
  intent: ItemOfferIntent;
  label: string;
} {
  if (prop.category === 'equip') return { intent: 'equip', label: '安装' };
  if (prop.category === 'food' || prop.tags.includes('consume')) {
    return { intent: 'consume', label: '吃' };
  }
  if (
    prop.category === 'entertain' ||
    prop.tags.includes('entertain') ||
    prop.tags.includes('play')
  ) {
    return { intent: 'play', label: '一起玩' };
  }
  if (prop.category === 'gift' || prop.tags.includes('gift')) {
    return { intent: 'gift', label: '赠送' };
  }
  return { intent: 'show', label: '递给' };
}

export function isPropOfferableInDialogue(prop: CampPropDef): boolean {
  if (prop.category === 'furniture') return false;
  if (prop.category === 'junk' && !prop.tags.includes('gift')) return false;
  return true;
}

export function getPendingItemOffer(living: AiLivingSave): PendingItemOffer | null {
  return living.pendingItemOffer ?? null;
}

export function buildItemOfferPlayerMessage(
  prop: CampPropDef,
  characterId: string,
  intent: ItemOfferIntent,
): string {
  const name = CHARACTER_MAP[characterId]?.name ?? characterId;
  const label = OFFER_INTENT_LABEL[intent];
  return `（你把【${prop.nameZh}】递到${name}面前，等她决定要不要${label}）`;
}

export function buildPendingItemOfferPromptBlock(
  living: AiLivingSave,
  characterId: string,
): string {
  const pending = living.pendingItemOffer;
  if (!pending || pending.toCharacterId !== characterId) return '';
  const prop = getCampProp(pending.propId);
  if (!prop) return '';
  const intentLine =
    pending.intent === 'consume'
      ? '玩家意图：请她吃/喝'
      : pending.intent === 'equip'
        ? '玩家意图：请她安装义体'
        : pending.intent === 'play'
          ? '玩家意图：请她一起玩'
          : pending.intent === 'gift'
            ? '玩家意图：作为礼物送她'
            : '玩家意图：展示/递交，等她反应';
  return `【玩家递来物品·暂存中·尚未消耗】
- item_id：${pending.propId}
- 名称：${prop.nameZh}
- ${intentLine}
- 规则：你接受并吃掉/使用/安装/一起玩时，必须在 camp_item_action 填对应 action（consume/eat/gift/equip/play）且 item_id 必须为 ${pending.propId}，并填 item_offer_resolution=accept 或 accept_consume/accept_gift/accept_equip/accept_play。
- 若拒绝、婉拒、暂时不收：item_offer_resolution=reject 或 return，camp_item_action 留空，对白里说明退回。
- 若先拿着下轮再决定：item_offer_resolution=defer（物品仍暂存，未消耗）。
- 禁止口头收下却不填 resolution/action（系统不会扣库存）。`;
}

function looksLikeItemReject(text: string | undefined): boolean {
  if (!text?.trim()) return false;
  return /不要|不收|拒绝|还你|退回|拿回去|放着吧|不用了|下次吧|先放着|别给我|用不着|用不上|吃不下|吃不了|装不了|玩不了|先收起来|放回仓库/.test(
    text,
  );
}

export function normalizeItemOfferResolution(raw: unknown): ItemOfferResolution | undefined {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!v) return undefined;
  const map: Record<string, ItemOfferResolution> = {
    accept: 'accept',
    accept_consume: 'accept_consume',
    accept_eat: 'accept_consume',
    accept_drink: 'accept_consume',
    accept_gift: 'accept_gift',
    accept_give: 'accept_gift',
    accept_equip: 'accept_equip',
    accept_install: 'accept_equip',
    accept_play: 'accept_play',
    reject: 'reject',
    refused: 'reject',
    refuse: 'reject',
    declined: 'reject',
    return: 'return',
    give_back: 'return',
    defer: 'defer',
    hold: 'defer',
    later: 'defer',
    keep: 'defer',
  };
  return map[v];
}

function isRejectResolution(resolution: ItemOfferResolution): boolean {
  return resolution === 'reject' || resolution === 'return';
}

function inferActionFromOffer(
  resolution: ItemOfferResolution,
  intent: ItemOfferIntent,
): string {
  if (resolution === 'accept_consume') return 'consume';
  if (resolution === 'accept_gift') return 'gift';
  if (resolution === 'accept_equip') return 'equip';
  if (resolution === 'accept_play') return 'play';
  if (resolution !== 'accept') return '';
  if (intent === 'consume') return 'consume';
  if (intent === 'equip') return 'equip';
  if (intent === 'play') return 'play';
  if (intent === 'gift') return 'gift';
  return 'gift';
}

function pushOfferSettlementLog(
  living: AiLivingSave,
  speakerId: string,
  log?: string,
): void {
  if (!log) return;
  pushCampLog(living, {
    text: log,
    source: 'npc',
    characterIds: [speakerId],
  });
  pushMemory(living, speakerId, {
    kind: 'event',
    summary: log,
    importance: 5,
  });
}

/** 玩家从对话页递交：仓库 -1 → escrow */
export function offerItemFromWarehouse(
  save: SaveData,
  living: AiLivingSave,
  propId: string,
  toCharacterId: string,
  intent?: ItemOfferIntent,
): CampItemActionResult {
  releasePendingItemOffer(save, living, { silent: true });
  const prop = getCampProp(propId);
  if (!prop) return { ok: false, msg: '未知道具' };
  if (!isPropOfferableInDialogue(prop)) {
    return { ok: false, msg: `${prop.nameZh} 不适合在对话中递交` };
  }
  if (!removeFromWarehouse(save, prop.id, 1)) {
    return { ok: false, msg: `仓库没有 ${prop.nameZh}` };
  }
  const resolved = intent ?? resolvePropOfferIntent(prop).intent;
  living.pendingItemOffer = {
    propId: prop.id,
    toCharacterId,
    intent: resolved,
    offeredAtMs: Date.now(),
    offeredAtGameMin: living.gameMinutes,
  };
  const name = CHARACTER_MAP[toCharacterId]?.name ?? toCharacterId;
  pushCampLog(living, {
    text: `指挥官递交 ${prop.nameZh} → ${name}（待决定）`,
    source: 'player',
    characterIds: [toCharacterId],
  });
  return {
    ok: true,
    msg: `已将 ${prop.nameZh} 递给 ${name}（待对方决定）`,
    log: `递交 ${prop.nameZh} → ${name}`,
  };
}

/** 退回 escrow 到仓库 */
export function releasePendingItemOffer(
  save: SaveData,
  living: AiLivingSave,
  opts?: { silent?: boolean },
): CampItemActionResult {
  const pending = living.pendingItemOffer;
  if (!pending) return { ok: false, msg: '' };
  addToWarehouse(save, pending.propId, 1);
  const prop = getCampProp(pending.propId);
  living.pendingItemOffer = undefined;
  if (opts?.silent) return { ok: true, msg: '' };
  return {
    ok: true,
    msg: `${prop?.nameZh ?? pending.propId} 已退回仓库`,
    log: `退回仓库 ${prop?.nameZh ?? pending.propId}`,
  };
}

function commitEscrowedAction(
  save: SaveData,
  living: AiLivingSave,
  pending: PendingItemOffer,
  prop: CampPropDef,
  action: string,
  raw: CampItemActionPayload,
  speakerId: string,
): CampItemActionResult {
  const act = action.toLowerCase();
  if (act === 'gift' || act === 'give') {
    if (!prop.tags.includes('gift') && prop.category !== 'food' && prop.category !== 'gift') {
      return { ok: false, msg: `${prop.nameZh} 不太适合当礼物` };
    }
    return applyGiftEffects(save, living, prop, pending.toCharacterId);
  }
  if (act === 'consume' || act === 'eat' || act === 'drink') {
    const eaterRaw = resolveTargetId(speakerId, raw.target, pending.toCharacterId);
    const eater = eaterRaw === 'warehouse' ? speakerId : eaterRaw;
    if (prop.category !== 'food' && !prop.tags.includes('consume')) {
      return { ok: false, msg: `${prop.nameZh} 不能吃` };
    }
    return applyConsumeEffects(living, prop, eater);
  }
  if (act === 'equip') {
    return applyEquipCyberEffects(save, living, prop, pending.toCharacterId, true);
  }
  if (act === 'play') {
    const partner = resolveTargetId(speakerId, raw.target, 'player');
    return applyPlayEffects(living, prop, speakerId, partner);
  }
  return { ok: false, msg: `暂不支持动作 ${action}` };
}

/** 角色回应后结算 escrow */
export function settlePendingItemOffer(
  save: SaveData,
  living: AiLivingSave,
  speakerId: string,
  raw: CampItemActionPayload | null | undefined,
  dialogueText?: string,
  resolutionRaw?: ItemOfferResolution | string | null | undefined,
): ItemOfferSettlement {
  const pending = living.pendingItemOffer;
  if (!pending || pending.toCharacterId !== speakerId) {
    return { ok: false, msg: '', handled: false };
  }
  const prop = getCampProp(pending.propId);
  if (!prop) {
    addToWarehouse(save, pending.propId, 1);
    living.pendingItemOffer = undefined;
    return { ok: false, msg: '暂存道具无效，已退回仓库', handled: true };
  }

  const resolution = normalizeItemOfferResolution(resolutionRaw);

  if (resolution === 'defer') {
    return { ok: true, msg: '物品仍由角色拿着（未消耗）', handled: true };
  }

  if (resolution && isRejectResolution(resolution)) {
    const rel = releasePendingItemOffer(save, living);
    if (rel.ok && rel.log) pushOfferSettlementLog(living, speakerId, rel.log);
    return { ...rel, handled: true };
  }

  const actionFromRaw =
    raw && typeof raw === 'object' ? String(raw.action || '').trim().toLowerCase() : '';
  const rawItem = raw && typeof raw === 'object' ? raw.item_id || raw.itemId : undefined;
  const itemMatch =
    !rawItem ||
    rawItem === pending.propId ||
    rawItem === prop.id ||
    rawItem === prop.key;

  const acceptActions = ['gift', 'give', 'consume', 'eat', 'drink', 'equip', 'play'];
  let action = actionFromRaw;
  if (
    resolution &&
    (resolution === 'accept' || resolution.startsWith('accept_')) &&
    (!action || !acceptActions.includes(action))
  ) {
    action = inferActionFromOffer(resolution, pending.intent);
  }

  if (action && acceptActions.includes(action) && itemMatch) {
    const result = commitEscrowedAction(
      save,
      living,
      pending,
      prop,
      action,
      (raw && typeof raw === 'object' ? raw : {}) as CampItemActionPayload,
      speakerId,
    );
    if (result.ok) {
      living.pendingItemOffer = undefined;
      if (result.log) pushOfferSettlementLog(living, speakerId, result.log);
      return { ...result, handled: true };
    }
    addToWarehouse(save, pending.propId, 1);
    living.pendingItemOffer = undefined;
    return { ...result, handled: true };
  }

  if (resolution && (resolution === 'accept' || resolution.startsWith('accept_'))) {
    const inferred = inferActionFromOffer(resolution, pending.intent);
    if (inferred && acceptActions.includes(inferred)) {
      const result = commitEscrowedAction(
        save,
        living,
        pending,
        prop,
        inferred,
        (raw && typeof raw === 'object' ? raw : {}) as CampItemActionPayload,
        speakerId,
      );
      if (result.ok) {
        living.pendingItemOffer = undefined;
        if (result.log) pushOfferSettlementLog(living, speakerId, result.log);
        return { ...result, handled: true };
      }
      addToWarehouse(save, pending.propId, 1);
      living.pendingItemOffer = undefined;
      return { ...result, handled: true };
    }
  }

  if (looksLikeItemReject(dialogueText)) {
    const rel = releasePendingItemOffer(save, living);
    if (rel.ok && rel.log) pushOfferSettlementLog(living, speakerId, rel.log);
    return { ...rel, handled: true };
  }

  return { ok: false, msg: '', handled: false };
}

/** 营地日志里高亮道具递交/结算类条目 */
export function isCampItemLogText(text: string): boolean {
  return /递交|退回仓库|送礼|食用|娱乐：|装备义体|挂载|退回|待决定/.test(text);
}
