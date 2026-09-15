import sceneCardsJson from '../data/lore/scene_cards.json';
import type { CampPeriod, SceneCard, WeatherId } from './types';

const CARDS = sceneCardsJson as Record<string, SceneCard>;

export function getSceneCard(id: string): SceneCard | null {
  return CARDS[id] ?? null;
}

/** 傍晚/深夜视为夜间，户外场景切 imageNight */
export function isCampNightPeriod(period: CampPeriod): boolean {
  return period === 'bangwan' || period === 'shenye';
}

/** 按时段解析场景背景路径（户外有夜间图则切换） */
export function resolveSceneCardImage(card: SceneCard, period: CampPeriod): string {
  if (card.imageNight && isCampNightPeriod(period)) return card.imageNight;
  return card.image;
}

export function resolveSceneImageById(sceneId: string, period: CampPeriod): string | null {
  const card = getSceneCard(sceneId);
  if (!card) return null;
  return resolveSceneCardImage(card, period);
}

export function listSceneCards(): SceneCard[] {
  return Object.values(CARDS);
}

export function listIndoorScenes(): SceneCard[] {
  return listSceneCards().filter((c) => c.kind === 'indoor');
}

export function listCampScenes(): SceneCard[] {
  return listSceneCards().filter((c) => c.kind === 'camp');
}

/** 根据时段与天气选择营地外景场景卡 */
export function resolveCampSceneId(period: CampPeriod, weather: WeatherId): string {
  if (weather === 'rain' && (period === 'huanghun' || period === 'bangwan')) {
    return 'camp_xiayu_huanghun';
  }
  if (period === 'qingtian') return 'camp_qingtian';
  if (period === 'qingchen') return 'camp_qingchen';
  if (period === 'zhongwu') return 'camp_zhongwu';
  if (period === 'huanghun') return 'camp_huanghun';
  if (period === 'bangwan') return 'camp_bangwan';
  if (period === 'shenye') return 'camp_shenye';
  return 'camp_qingtian';
}

export function sceneCardToPromptBlock(card: SceneCard): string {
  return [
    `【场景氛围】${card.label}——${card.atmosphere}`,
    `（仅作心情背景：可让语气更软/更累/更警觉；不要逐条复述感官清单，不要念「对话倾向」）`,
  ].join('\n');
}

/** 给对话用的极简场景提示 */
export function sceneMoodHint(card: SceneCard): string {
  return `${card.label}：${card.atmosphere.slice(0, 48)}`;
}
