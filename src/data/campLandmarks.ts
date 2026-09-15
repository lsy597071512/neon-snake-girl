/**
 * 营地院落地标功能说明（给 AI / 事件 / Prompt 共用）
 * 与平面图房间 id 对齐：room_yard / room_1f_pool / room_1f_tower / room_1f_shop / room_1f_armory
 */

export type CampLandmarkDef = {
  roomId: string;
  label: string;
  /** 与游戏系统的对应关系 */
  systemBind: string;
  /** 硬规则（角色不可违反的认知） */
  hardRules: string[];
  /** 可发生的行为 / 话题 */
  activities: string[];
  /** 可触发的事件主题关键词 */
  eventThemes: string[];
};

export const CAMP_LANDMARKS: CampLandmarkDef[] = [
  {
    roomId: 'room_1f_pool',
    label: '泳池',
    systemBind: '院落休闲地标；有「泳池派对」皮肤资源的角色可在此换泳装外覆',
    hardRules: [
      '可单人/组队游泳、玩水、清洗泳池',
      '泳池派对活动中：有泳装皮肤资源的角色应切换为泳池派对外覆；无专属资源者也能参加，以行为表达戏水',
      '勿把泳池写成室外远征或危险战区',
    ],
    activities: ['游泳', '玩水', '清洗泳池', '泳池派对', '晒干/擦水', '闲聊'],
    eventThemes: ['泳池派对', '独泳', '玩水', '清洗泳池'],
  },
  {
    roomId: 'room_1f_tower',
    label: '警卫塔',
    systemBind: '瞭望与安静社交地标',
    hardRules: [
      '特点安静：适合低声叙情、远眺，而非喧闹派对',
      '可查看/议论当前营地天气与沙尘状况（以游戏内时钟天气为准）',
      '可多人聊天，但语气偏静、偏望远',
    ],
    activities: ['看远处', '多人低声聊天', '叙情', '观天/读天气', '守望'],
    eventThemes: ['远眺', '塔上叙情', '读天气'],
  },
  {
    roomId: 'room_1f_shop',
    label: '商店',
    systemBind:
      '对应营地「日更商店」面板；店内常驻「商店老板娘」（古老商店型机器人+少女义体，仅固定接待话术，无闲聊 AI）',
    hardRules: [
      '角色可在此买到修理营地与自身装备所需的道具（概念 consumable）及日更货架商品',
      '每次角色自助购买按货架标价扣锈币；老板娘只负责固定欢迎/选购/结账话术与拿货',
      '也可只逛不买；可向老板娘短接洽，勿把她当成可长聊的同伴或编造她有复杂情感',
      '勿把商店写成城外商队',
    ],
    activities: ['自助购修装/修营道具', '逛店', '向老板娘短接洽/结账', '盘点货架', '闲聊物价与缺货（同伴之间）'],
    eventThemes: ['自助采购', '逛商店', '店内短接洽'],
  },
  {
    roomId: 'room_1f_shop_bed',
    label: '商店卧室',
    systemBind: '商店附属休息间',
    hardRules: ['属商店侧私密休息区，可小憩或换装准备，非主楼卧室编制'],
    activities: ['小憩', '整理随身物', '与店事相关的低声交谈'],
    eventThemes: ['店后休息'],
  },
  {
    roomId: 'room_1f_armory',
    label: '武器库',
    systemBind: '对应游戏「武器库/军械」界面在营地中的地标',
    hardRules: [
      '玩家与角色都可来此查看武器装备',
      '可逛库、擦拭、基于库内资源触发战争/械斗/远征回忆话题',
      '勿把武器库写成可自由出营作战的出口',
    ],
    activities: ['查看武器', '逛库', '擦枪/点检', '战争话题对话与思考'],
    eventThemes: ['点检武装', '战争夜话', '逛武器库'],
  },
  {
    roomId: 'room_yard',
    label: '营地大门',
    systemBind: '营地内外分界；日常活动不得走出大门（远征/战斗玩法除外）',
    hardRules: [
      '除远征与战斗外，角色不应走出营地大门到「远处」',
      '可在门内沙地维修大门、逛耍、闲聊、触发「外出冲动/外出思考」但不真正离营',
      '沙尘暴/警戒等门口事件仍在门内处理',
    ],
    activities: ['守门', '维修大门', '逛耍', '闲聊', '外出思考（不离营）', '清沙'],
    eventThemes: ['外出思考', '修门', '门前闲逛'],
  },
];

export const CAMP_LANDMARK_BY_ROOM = Object.fromEntries(
  CAMP_LANDMARKS.map((l) => [l.roomId, l]),
) as Record<string, CampLandmarkDef>;

/** 注入 Prompt：让所有角色知道地标功能与硬规则 */
export function buildCampLandmarkPromptBlock(): string {
  const blocks = CAMP_LANDMARKS.map((l) => {
    const rules = l.hardRules.map((r) => `  · ${r}`).join('\n');
    const acts = l.activities.join('、');
    return `【${l.label}】（${l.roomId}）\n绑定：${l.systemBind}\n可做：${acts}\n规则：\n${rules}`;
  }).join('\n\n');
  return `【营地院落地标·功能与硬规则】（所有角色共享认知）
${blocks}
角色说话与行动必须符合所在/提及地标的规则；禁止编造「已走出大门远征」的日常。`;
}
