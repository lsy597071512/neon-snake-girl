/** 营地随机事件公共出口 */
export { CAMP_EVENT_CATALOG, CAMP_EVENT_MAP, getCampEventDef } from './catalog';
export type { CampEventDef } from './catalog';
export {
  trySpawnCampEvent,
  tickCampEvents,
  listActiveCampEventsForUi,
  getFocusRoomIds,
  gameMinToRealSec,
} from './eventEngine';
export {
  assignReactionsOnActivate,
  describeCharacterEventStance,
  rollReaction,
  stanceLabel,
  warnBlurb,
} from './reactions';
export {
  getCoScreenGroupForCharacter,
  describeCoScreenMembers,
  refreshCoScreenMembership,
  MAX_CO_SCREEN_JOINERS,
  capCoScreenMemberIds,
  syncCoScreenParticipantWorld,
} from './coScreen';
export type { CoScreenGroup } from './coScreen';
export {
  applyBatheShowerSkins,
  applyEventTempSkins,
  applyPoolPartySwimsuits,
  clearEventTempSkinsForInstance,
  isCharacterBathing,
} from './campEventEffects';
