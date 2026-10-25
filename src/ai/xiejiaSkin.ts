/**
 * 卸甲皮肤（轻装坦诚态）门控与提示词。
 *
 * 触发宗旨：玩家请求 → 角色同意 → 走正常换装协议切换。
 * 约束：
 * - 仅大厅（hall）/ 房间（bedroom）等日常场所可穿；
 * - 与事件互斥：调教/帮洗/舞蹈/安抚/小游戏对局/营地群体事件进行中一律不可；
 * - 无时间限制，随时可换回（skin_change=pifu00 / default）；
 * - 表现含蓄（卸下外装/轻装坦诚/以手臂遮掩），不直白描写。
 */
import { CAMP_ROOM_MAP } from '../data/campLayout';
import { getAffinity } from './relationship';
import { resolvePresence } from './livingState';
import { isCharacterInActiveCampEvent } from './campEvents/campEventEffects';
import type { AiLivingSave } from './types';

/** 卸甲亲密度硬门槛（低于此值提示词直接要求害羞拒绝；日常/小游戏/对弈统一生效） */
export const XIEJIA_AFFINITY_GATE = 80;

/** 是否处于允许卸甲的日常场所（大厅 / 房间） */
function inXiejiaAllowedPlace(living: AiLivingSave, characterId: string): boolean {
  const p = resolvePresence(characterId, living);
  const kind = CAMP_ROOM_MAP[p.roomId]?.kind;
  return kind === 'hall' || kind === 'bedroom';
}

/** 事件互斥检查（调教/帮洗/舞蹈/安抚由 aiSkinChange 前置拦截，这里全量兜底） */
function inBlockingEvent(living: AiLivingSave, characterId: string): string | null {
  const mg = living.miniGameSession;
  if (mg?.active && mg.characterId === characterId) return '对局进行中';
  if (isCharacterInActiveCampEvent(living, characterId)) return '营地群体事件中';
  const anfu = living.anfuSession;
  if (anfu?.active && anfu.characterId === characterId) return '安抚室事件中';
  return null;
}

/**
 * 硬门控：位置 + 事件（不含好感度——好感度走提示词软门控，
 * 避免「AI 已答应、系统又扒掉」的违和）。
 */
export function canWearXiejiaSkin(
  living: AiLivingSave,
  characterId: string,
): { ok: boolean; msg: string } {
  if (!inXiejiaAllowedPlace(living, characterId)) {
    return { ok: false, msg: '卸甲只在大厅或房间等日常场所才可以' };
  }
  const ev = inBlockingEvent(living, characterId);
  if (ev) return { ok: false, msg: `卸甲与事件互斥（${ev}）` };
  return { ok: true, msg: '' };
}

/**
 * 动态提示词行：注入换装协议，驱动 LLM 在玩家请求卸甲时给出符合门控的回应。
 * - 亲密度不足 / 场所不符 / 事件中 → 明确要求害羞拒绝；
 * - 条件允许 → 「第一次多半推脱、诚恳多问才可能松口」的软概率（触发概率偏低）。
 */
export function buildXiejiaPromptNote(living: AiLivingSave, characterId: string): string {
  const gate = canWearXiejiaSkin(living, characterId);
  if (!gate.ok) {
    return `【卸甲·当前不可】现在不满足卸甲条件（${gate.msg}）。若指挥官提出，你要害羞而坚定地推脱，并说明现在的场合不合适；禁止 skin_change=wuziqi。`;
  }
  const affinity = getAffinity(living, characterId);
  if (affinity < XIEJIA_AFFINITY_GATE) {
    return `【卸甲·当前不可】你与指挥官还没到那一步（信赖不足，亲密度未达「信赖」）。被请求时必须害羞拒绝、转移话题；无论日常闲聊、还是对弈小游戏输了被提议，都一样拒绝；禁止 skin_change=wuziqi。`;
  }
  return `【卸甲·可以斟酌】当前场所与状态允许卸甲，你与指挥官已足够亲近（≥信赖）。若指挥官诚恳请求：第一次多半害羞推脱、多问几次且你今天心情不错才可能松口；对弈或小游戏你刚输了被提议时，愿赌服输更难拒绝。答应后 skin_change=wuziqi 并照常走换装过程；穿上后一律用含蓄说法（卸下外装/轻装坦诚/用手臂挡着），表现羞涩尴尬。`;
}
