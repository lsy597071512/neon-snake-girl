/**
 * 营地商店老板娘（非 AI 角色）
 * 仅固定话术 UI + 正/背面立绘；不进入对话引擎。
 */

export const CAMP_SHOPKEEPER_ID = 'camp_shopkeeper';
export const CAMP_SHOPKEEPER_NAME = '商店老板娘';

/** 正面：接待 / 聊天 UI；背面：拿货 */
export const CAMP_SHOPKEEPER_ART = {
  front: './tex/shangdianlaobanniang01.png',
  back: './tex/shangdianlaobanniang02.png',
} as const;

export type CampShopkeeperPhase = 'arrive' | 'browse' | 'done';

/** 开店固定两句（顺序播放，不随机） */
export const CAMP_SHOPKEEPER_WELCOME_SCRIPT = [
  '欢迎光临。',
  '今天想购买什么？',
] as const;

/**
 * 默认十二句：三种状态各四句，运行时按状态随机一条。
 * 1 arrive 刚来购买 · 2 browse 选购等待 · 3 done 购买结束
 */
export const CAMP_SHOPKEEPER_LINES: Record<CampShopkeeperPhase, readonly string[]> = {
  arrive: [
    '欢迎光临。锈币备好，今日货架已刷新。',
    '检测到顾客。请选择商品。',
    '……请进。店内禁试射，步枪仅作陈列。',
    '今日货架三十槽。每件库存一，售完即下架。',
  ],
  browse: [
    '请慢慢选。本机待机中。',
    '需要分类可点上方标签。正在等待选购。',
    '库存各一。点「买」后本机转身取货。',
    '……仍在选吗。不急。时钟走得很慢。',
  ],
  done: [
    '交易完成。货物已入仓库。',
    '谢谢惠顾。明日货架会再随机上架。',
    '已记账。请核对锈币余额。',
    '拿货完毕。如需继续，请再点选。',
  ],
};

export function pickShopkeeperLine(
  phase: CampShopkeeperPhase,
  exclude?: string,
): string {
  const pool = CAMP_SHOPKEEPER_LINES[phase];
  const candidates = exclude ? pool.filter((l) => l !== exclude) : [...pool];
  const list = candidates.length ? candidates : [...pool];
  return list[Math.floor(Math.random() * list.length)]!;
}

/** 写入角色 Prompt：知道她存在，但不可当 AI 同伴深聊 */
export function buildCampShopkeeperPromptLine(): string {
  return `【营地商店·老板娘】店内常驻「${CAMP_SHOPKEEPER_NAME}」：锈带遗留的商店型古老机器人，外覆精致少女义体皮肤，柜台后持陈列用步枪。她没有智能闲聊 AI，只会固定接待话术（欢迎/请选购/结账拿货），不会主动找你叙情、不会进对话窗当同伴。你可向她买货、点头致意、吐槽货价，勿把她写成可长聊的同伴，勿编造她有复杂情感或私人约会。`;
}
