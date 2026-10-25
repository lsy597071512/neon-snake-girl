/**
 * P3 资源分层：决定 tex-ship 产物哪些进 APK 首包（P0），哪些走云端分发（P1/P2）。
 *
 * 层级定义：
 *  - P0  首包内置：代码壳 + UI + 登录/标题/主页 + 新手引导全链路资源。
 *        第一原则：必须完整覆盖引导链路（g_hello→…→g_camp），引导零打断。
 *  - P1  登录激活页开始批量下载（有进度 UI，主页可查进度）。
 *  - P2  按需懒加载（进对应玩法前下载）。
 *
 * 测试期：MERGE_REMOTE_TIERS = true，P1+P2 合并为一个远端包；发售再区分。
 *
 * 注意：pattern 匹配的是 tex-ship 产物相对路径（outRel，位图多为 .webp），
 * 与源 tex/ 路径只在扩展名上有差异。
 */

export const TIER_P0 = 'P0';
export const TIER_P1 = 'P1';
export const TIER_P2 = 'P2';

/** 测试期合并远端层：P1/P2 都进同一个远端批，登录后开始下载 */
export const MERGE_REMOTE_TIERS = true;

/**
 * —— P1（登录后批量下载）——
 * 角色皮肤整体 2.5GB，为包体大头。
 * ⚠ 待核对项：若引导链路（如 g_shop 商店展示皮肤、主页看板娘默认皮肤在 pifu 内）
 * 引用到 pifu 资源，需把对应子路径下沉到 P0 白名单（见 P0_EXTRA_PATTERNS）。
 * 当前依据：filter 侧 dama 打码版已就位；引导审计结果出来前按整体远端处理。
 */
const P1_PATTERNS = [
  /^juese\/pifu(\/|$)/i,
];

/**
 * —— P2（按需懒加载）——
 * 画廊为通关后功能，引导链路不经过；体积小，作为懒加载链路的先行验证对象。
 */
const P2_PATTERNS = [
  /^gallery(\/|$)/i,
];

/**
 * —— P0 追加白名单（引导审计结论）——
 * 营地默认穿生活服装 pifu00（LIFEWEAR_SKIN_ID，见 src/data/characterSkins.ts），
 * g_camp 引导步与主页看板娘都会用到；整个 shenghuofuzhuang00 目录仅 ~17.5MB，
 * 全角色一并进首包，避免营地首屏等网络。
 * @type {RegExp[]}
 */
const P0_EXTRA_PATTERNS = [
  /^juese\/pifu\/shenghuofuzhuang00(\/|$)/i,
];

/**
 * 判定 tex-ship 产物的分层。
 * @param {string} rel 产物相对 tex-ship/ 的路径（正斜杠）
 * @returns {'P0'|'P1'|'P2'}
 */
export function tierForShipRel(rel) {
  const r = rel.replace(/\\/g, '/');
  if (P0_EXTRA_PATTERNS.some((rx) => rx.test(r))) return TIER_P0;
  if (P1_PATTERNS.some((rx) => rx.test(r))) return TIER_P1;
  if (P2_PATTERNS.some((rx) => rx.test(r))) return TIER_P2;
  return TIER_P0;
}

/** 该层是否属于「远端分发」（测试期合并时 P1/P2 均为远端） */
export function isRemoteTier(tier) {
  if (MERGE_REMOTE_TIERS) return tier !== TIER_P0;
  return tier === TIER_P1 || tier === TIER_P2;
}
