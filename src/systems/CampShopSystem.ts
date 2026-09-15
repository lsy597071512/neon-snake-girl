/**
 * 营地日更商店：每日随机上架 30 件，每类至少 2–3 件；库存 1，买完即下架。
 */
import type { SaveData, CampShopOffer, CampShopState } from '../types';
import type { AiLivingSave } from '../ai/types';
import { CAMP_PROPS, type CampPropDef } from '../data/campProps';

function shelfPrice(prop: CampPropDef): number {
  if (prop.category === 'food') return 1;
  if (prop.category === 'equip') return 10;
  return Math.max(1, prop.shopPrice | 0);
}

export const CAMP_SHOP_SLOT_COUNT = 30;

/** 商店种类（保证每日货架多样） */
export const CAMP_SHOP_KINDS = [
  {
    id: 'gift',
    label: '礼物',
    match: (p: CampPropDef) => p.category === 'gift' || p.tags.includes('gift'),
  },
  {
    id: 'food',
    label: '食品',
    match: (p: CampPropDef) => p.category === 'food',
  },
  {
    id: 'parts',
    label: '机械配件',
    match: (p: CampPropDef) =>
      p.category === 'material' || p.category === 'tool' || p.category === 'consumable',
  },
  {
    id: 'entertain',
    label: '娱乐',
    match: (p: CampPropDef) => p.category === 'entertain' || p.tags.includes('entertain'),
  },
  {
    id: 'furniture',
    label: '家具',
    match: (p: CampPropDef) => p.category === 'furniture' || p.tags.includes('furniture'),
  },
  {
    id: 'equip',
    label: '义体',
    match: (p: CampPropDef) => p.category === 'equip',
  },
  {
    id: 'decor',
    label: '装饰杂项',
    match: (p: CampPropDef) =>
      p.category === 'decor' || p.category === 'container' || p.category === 'junk',
  },
] as const;

export type CampShopKindId = (typeof CAMP_SHOP_KINDS)[number]['id'];

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}

export function shopKindForProp(prop: CampPropDef): CampShopKindId {
  for (const k of CAMP_SHOP_KINDS) {
    if (k.match(prop)) return k.id;
  }
  return 'decor';
}

export function shopKindLabel(kindId: string): string {
  return CAMP_SHOP_KINDS.find((k) => k.id === kindId)?.label ?? kindId;
}

/** 生成当日 30 槽：各类至少 2，尽量 3，再补满 */
export function rollCampShopOffers(dayIndex: number): CampShopOffer[] {
  const rng = mulberry32((dayIndex + 1) * 9973 + 42);
  const used = new Set<string>();
  const picks: string[] = [];

  const takeFromKind = (kindId: CampShopKindId, n: number) => {
    const kind = CAMP_SHOP_KINDS.find((k) => k.id === kindId)!;
    const pool = CAMP_PROPS.filter((p) => kind.match(p) && !used.has(p.id));
    shuffleInPlace(pool, rng);
    for (let i = 0; i < Math.min(n, pool.length); i++) {
      const id = pool[i]!.id;
      picks.push(id);
      used.add(id);
    }
  };

  // 每类先保底 2
  for (const k of CAMP_SHOP_KINDS) takeFromKind(k.id, 2);
  // 再尽量给每类 +1 → 共约 21
  for (const k of CAMP_SHOP_KINDS) {
    if (picks.length >= CAMP_SHOP_SLOT_COUNT) break;
    takeFromKind(k.id, 1);
  }
  // 补满 30
  const rest = CAMP_PROPS.filter((p) => !used.has(p.id));
  shuffleInPlace(rest, rng);
  for (const p of rest) {
    if (picks.length >= CAMP_SHOP_SLOT_COUNT) break;
    picks.push(p.id);
    used.add(p.id);
  }

  shuffleInPlace(picks, rng);
  return picks.slice(0, CAMP_SHOP_SLOT_COUNT).map((propId) => ({ propId, sold: false }));
}

function ensureState(save: SaveData): CampShopState {
  if (!save.campShop || !Array.isArray(save.campShop.offers)) {
    save.campShop = { dayIndex: -1, offers: [] };
  }
  return save.campShop;
}

/** 按游戏日刷新货架（跨日重 roll；已购槽位仅当日有效） */
export function ensureCampShopDay(save: SaveData, living: AiLivingSave): CampShopState {
  const state = ensureState(save);
  const day = living.dayIndex | 0;
  if (state.dayIndex !== day || state.offers.length !== CAMP_SHOP_SLOT_COUNT) {
    state.dayIndex = day;
    state.offers = rollCampShopOffers(day);
  }
  return state;
}

export function listCampShopOffers(
  save: SaveData,
  living: AiLivingSave,
): { index: number; offer: CampShopOffer; prop: CampPropDef }[] {
  const state = ensureCampShopDay(save, living);
  const out: { index: number; offer: CampShopOffer; prop: CampPropDef }[] = [];
  state.offers.forEach((offer, index) => {
    const prop = CAMP_PROPS.find((p) => p.id === offer.propId);
    if (prop) out.push({ index, offer, prop });
  });
  return out;
}

export function listAvailableCampShopProps(save: SaveData, living: AiLivingSave): CampPropDef[] {
  return listCampShopOffers(save, living)
    .filter((x) => !x.offer.sold)
    .map((x) => x.prop);
}

export function isPropOnCampShopShelf(
  save: SaveData,
  living: AiLivingSave,
  propId: string,
): boolean {
  return listCampShopOffers(save, living).some(
    (x) => x.offer.propId === propId && !x.offer.sold,
  );
}

/** 标记货架槽位已售（由购买逻辑在扣款成功后调用） */
export function markCampShopSold(
  save: SaveData,
  living: AiLivingSave,
  propId: string,
): boolean {
  const state = ensureCampShopDay(save, living);
  const slot = state.offers.find((o) => o.propId === propId && !o.sold);
  if (!slot) return false;
  slot.sold = true;
  return true;
}

export function summarizeCampShopForPrompt(save: SaveData, living: AiLivingSave): string {
  const rows = listCampShopOffers(save, living).filter((x) => !x.offer.sold);
  if (!rows.length) return '（今日货架已售罄）';
  return rows
    .slice(0, 30)
    .map((x) => `${x.prop.nameZh}(${x.prop.id},${shelfPrice(x.prop)}币)`)
    .join('；');
}

export function campShopDayLabel(living: AiLivingSave): string {
  return `第${(living.dayIndex | 0) + 1}日货架`;
}
