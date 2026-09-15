/**
 * 营地道具（game_props 拆分图）
 * 图源：`tex/props/game_props/split/{01..81}.png`
 * 图鉴：`tex/props/game_props/CATALOG.md` / `catalog.json`
 *
 * 用途：商店购买、仓库堆叠、送礼、食用、放置展示、家具交互、娱乐、义体换装。
 * AI：系统提示可注入 `campPropAiHint()`；对话可填 `camp_item_action`。
 */

export type CampPropCategory =
  | 'gift'
  | 'container'
  | 'decor'
  | 'material'
  | 'tool'
  | 'consumable'
  | 'furniture'
  | 'entertain'
  | 'equip'
  | 'food'
  | 'junk';

export type CampPropAction =
  | 'gift'
  | 'consume'
  | 'place'
  | 'display'
  | 'interact'
  | 'play'
  | 'equip'
  | 'store'
  | 'buy'
  | 'sell'
  | 'dismantle'
  | 'craft_mat'
  | 'tool'
  | 'furniture'
  | 'entertain'
  | 'cook_input';

export type CampPropDef = {
  index: number;
  id: string;
  key: string;
  nameZh: string;
  /** 图上看得见的描述 */
  look: string;
  category: CampPropCategory;
  tags: readonly CampPropAction[];
  /** 营地里怎么用（给人看 / 给策划看） */
  campUse: string;
  shopPrice: number;
  stackMax: number;
  icon: string;
};

const ICON = (n: number) => `./tex/props/game_props/split/${String(n).padStart(2, '0')}.png`;

function row(
  index: number,
  key: string,
  nameZh: string,
  look: string,
  category: CampPropCategory,
  tags: CampPropAction[],
  campUse: string,
  shopPrice: number,
  stackMax: number,
): CampPropDef {
  return {
    index,
    id: `camp_prop_${String(index).padStart(2, '0')}`,
    key,
    nameZh,
    look,
    category,
    tags,
    campUse,
    shopPrice,
    stackMax,
    icon: ICON(index),
  };
}

/** 全 81 件营地道具 */
export const CAMP_PROPS: readonly CampPropDef[] = [
  row(1, 'gift_box_pink', '粉方礼盒', '粉红方盒红丝带礼盒', 'gift', ['gift', 'store', 'buy'], '通用礼物', 120, 99),
  row(2, 'gift_box_starry', '星空蓝礼盒', '蓝盒黄星青丝带', 'gift', ['gift', 'store', 'buy'], '偏科技角色礼物', 150, 99),
  row(3, 'gift_box_purple', '紫菱礼筒', '紫圆柱菱格礼盒', 'gift', ['gift', 'store', 'buy'], '高阶礼物', 220, 99),
  row(4, 'bouquet', '花束', '粉白紫花束粉包装', 'gift', ['gift', 'place', 'display'], '加好感；可插瓶展示', 80, 99),
  row(5, 'teddy_bear', '泰迪熊', '棕熊红领结', 'gift', ['gift', 'place', 'display'], '安慰礼物；床头展示', 100, 20),
  row(6, 'love_letter', '心印信封', '信封红心蜡封', 'gift', ['gift', 'interact'], '读信/告白事件', 90, 99),
  row(7, 'heart_gift_box', '心形礼盒', '粉心形丝带盒', 'gift', ['gift', 'store', 'buy'], '浪漫礼物', 160, 99),
  row(8, 'shopping_bag_star', '黄星购物袋', '黄纸袋星标白绳', 'container', ['interact', 'store', 'buy'], '打开得随机小物', 60, 99),
  row(9, 'snow_globe_castle', '城堡雪景球', '玻璃罩城堡雪球木座', 'decor', ['place', 'display', 'gift'], '房间美观展示', 180, 20),

  row(10, 'gear_rust', '锈蚀动力齿轮', '大齿锈齿轮绿心光', 'material', ['craft_mat', 'dismantle', 'gift'], '维修/合成材料', 40, 99),
  row(11, 'canister_amber', '琥珀燃料罐', '透明罐橙液螺栓箍', 'material', ['craft_mat', 'gift', 'store'], '燃料；过热系礼物', 70, 99),
  row(12, 'battery_hv', '高压电池组', '线缆电池闪电警告标', 'tool', ['tool', 'craft_mat', 'store'], '充电/扩电', 110, 99),
  row(13, 'engine_compact', '紧凑动力机组', '铜管活塞紧凑引擎', 'material', ['place', 'craft_mat'], '发电机升级件', 200, 20),
  row(14, 'gauge_pressure', '指针压力表', '圆形锈表红区针', 'tool', ['tool', 'place', 'display'], '检修工具/墙饰', 55, 99),
  row(15, 'filter_canister', '穿孔滤芯罐', '带孔金属罐红箍绿光', 'consumable', ['consume', 'craft_mat'], '滤芯耗材', 65, 99),
  row(16, 'emitter_spiked', '尖刺广播器', '带刺喇叭网罩绿光', 'entertain', ['entertain', 'place', 'tool'], '广播娱乐或警戒', 140, 20),
  row(17, 'mech_hand_rust', '锈蚀机械手', '四指锈爪绿关节', 'material', ['craft_mat', 'gift', 'display'], '义体材料/展示', 95, 99),
  row(18, 'scanner_waveform', '波形手持仪', '波形屏+绿液管', 'tool', ['tool', 'entertain', 'store'], '扫描校准小游戏', 130, 20),

  row(19, 'stove_camp', '锈厨灶台', '双灶壶锅锈灶', 'furniture', ['furniture', 'interact'], '做饭：食品→热餐', 300, 1),
  row(20, 'bed_camp', '检修床铺', '破褥绿抽屉床', 'furniture', ['furniture', 'interact', 'store'], '睡觉恢复；抽屉小仓', 350, 1),
  row(21, 'bathtub', '锈浴缸', '脏白浴缸挂巾', 'furniture', ['furniture', 'interact'], '洗浴清脏/心情', 280, 1),
  row(22, 'table_wood', '木板餐桌', '木桌杯碗瓶', 'furniture', ['furniture', 'place', 'entertain'], '聚餐社交点', 200, 1),
  row(23, 'armchair_patch', '破补丁扶手椅', '绿破旧扶手椅', 'furniture', ['furniture', 'interact'], '休息 buff', 180, 1),
  row(24, 'cabinet_green', '开敞绿柜', '锈绿柜开门露货', 'furniture', ['furniture', 'store'], '货架仓储扩容', 260, 1),
  row(25, 'fridge', '双门冰箱', '脏白双门冰箱', 'furniture', ['furniture', 'store'], '冷藏食品', 320, 1),
  row(26, 'trunk_reinforced', '加固木箱', '金属角加固木箱', 'furniture', ['furniture', 'store'], '主仓库箱', 240, 1),
  row(27, 'vanity_sink', '盥洗台', '洗手盆毛巾瓶架', 'furniture', ['furniture', 'interact'], '洗脸/药水台', 220, 1),

  row(28, 'pot_cook', '锈盖炖锅', '带盖锈锅双耳', 'tool', ['tool', 'gift', 'craft_mat'], '灶台配套提升料理', 50, 99),
  row(29, 'radio_field', '野战收音机', '天线拨盘电台', 'entertain', ['entertain', 'place', 'gift'], '听广播/音乐', 120, 20),
  row(30, 'mug_enamel', '红星搪瓷杯', '白搪瓷杯红星锈边', 'consumable', ['consume', 'gift'], '喝水小 buff', 25, 99),
  row(31, 'flashlight', '工业手电筒', '重型圆筒手电', 'tool', ['equip', 'tool', 'place'], '照明装备', 85, 20),
  row(32, 'bedroll', '绑带睡袋', '橄榄绿卷毯+枕', 'furniture', ['place', 'interact'], '临时休息点', 70, 20),
  row(33, 'canteen', '皮套水壶', '皮套金属壶', 'consumable', ['consume', 'store', 'gift'], '补水出征耗材', 45, 99),
  row(34, 'locker_rust', '锈铁储物柜', '窄高锈柜', 'furniture', ['furniture', 'store'], '个人柜扩仓', 160, 1),
  row(35, 'scrub_brush', '木柄硬刷', '木柄粗黄刷', 'tool', ['tool', 'interact'], '清洁→营地整洁度', 30, 99),
  row(36, 'toilet_paper', '卷纸', '半卷脏厕纸', 'junk', ['gift', 'store', 'buy'], '废土硬通货玩笑礼物', 15, 99),

  row(37, 'cyber_heart', '装甲义体心脏', '红心白甲管线', 'equip', ['equip', 'gift', 'display'], '核心 HP', 400, 1),
  row(38, 'cyber_lungs', '义体双肺', '粉肺白机械气管', 'equip', ['equip', 'gift'], '耐力', 360, 1),
  row(39, 'cyber_eye', '义体义眼', '蓝虹膜线缆', 'equip', ['equip', 'gift'], '侦察/命中', 380, 1),
  row(40, 'cyber_liver', '义体肝脏', '褐肝白束带', 'equip', ['equip', 'craft_mat'], '抗毒', 340, 1),
  row(41, 'cyber_spine', '义体脊椎', '白椎节绿线', 'equip', ['equip', 'craft_mat'], '承重稳定', 420, 1),
  row(42, 'cyber_arm_muscle', '肌铠义体臂', '红肌白甲臂', 'equip', ['equip', 'gift'], '力量', 390, 1),
  row(43, 'cyber_kidney', '义体肾脏', '豆形红肾白壳', 'equip', ['equip'], '滤毒冷却', 330, 1),
  row(44, 'cyber_stomach', '义体胃囊', '粉胃白支架', 'equip', ['equip'], '消化→食品效果增强', 310, 1),
  row(45, 'tissue_block', '皮层截面块', '皮肤方块露机械层', 'material', ['display', 'dismantle', 'craft_mat'], '展示/拆解材料', 200, 99),

  row(46, 'chess', '国际象棋', '木质棋盘棋子', 'entertain', ['entertain', 'place', 'gift'], '策略对弈加羁绊', 150, 20),
  row(47, 'jenga', '叠叠乐塔', '木条高塔', 'entertain', ['entertain', 'place'], '敏捷小游戏', 90, 20),
  row(48, 'poker_flush', '扑克同花顺', '五张牌展示', 'entertain', ['entertain', 'gift'], '赌博闲聊', 40, 99),
  row(49, 'go_board', '围棋套装', '棋盘黑白子罐', 'entertain', ['entertain', 'place', 'gift'], '深度对弈', 170, 20),
  row(50, 'boardgame_estate', '地产桌游', '方盘骰子代币', 'entertain', ['entertain', 'place'], '多人晚会', 160, 20),
  row(51, 'twister_mat', '扭扭垫', '彩点垫转盘', 'entertain', ['entertain', 'place'], '派对体感', 110, 20),
  row(52, 'uno_cards', 'UNO牌组', '彩色手牌UNO背', 'entertain', ['entertain', 'gift'], '轻松加好感', 70, 99),
  row(53, 'hex_settlers', '开拓者六角盘', '六角地形资源盘', 'entertain', ['entertain', 'place'], '规划主题娱乐', 180, 20),
  row(54, 'story_cards', '故事插画卡', '奇幻插画卡组', 'entertain', ['entertain', 'gift', 'interact'], '讲故事/叙事', 100, 99),

  row(55, 'burger', '芝士汉堡', '多层芝士汉堡', 'food', ['consume', 'gift', 'cook_input'], '大餐恢复', 35, 99),
  row(56, 'pizza_slice', '披萨角', '意式披萨片', 'food', ['consume', 'gift'], '派对食物', 30, 99),
  row(57, 'fries', '薯条盒', '红盒薯条', 'food', ['consume', 'gift'], '零食', 20, 99),
  row(58, 'hotdog', '芥末热狗', '热狗黄芥末', 'food', ['consume', 'gift'], '小吃', 22, 99),
  row(59, 'donut', '粉霜甜甜圈', '粉霜彩针甜甜圈', 'food', ['consume', 'gift'], '甜品礼物', 25, 99),
  row(60, 'strawberry_cake', '草莓短蛋糕', '奶油草莓切片', 'food', ['consume', 'gift'], '高阶甜品', 45, 99),
  row(61, 'chicken_leg', '炸鸡腿', '金黄炸鸡腿', 'food', ['consume', 'gift'], '高热量', 32, 99),
  row(62, 'chocolate_bar', '开封巧克力', '红包装巧克力条', 'food', ['consume', 'gift'], '心情小物', 18, 99),
  row(63, 'icecream_cone', '巧克力蛋筒', '脆筒冰淇淋坚果', 'food', ['consume', 'gift'], '夏日零食', 28, 99),

  row(64, 'armor_shoulder', '肩甲模块', '白甲肩罩露齿轮', 'equip', ['equip', 'gift', 'display'], '肩防', 210, 1),
  row(65, 'armor_forearm', '全机械前臂', '白甲机械前臂手', 'equip', ['equip', 'gift'], '臂替换', 260, 1),
  row(66, 'armor_hand_plate', '手背接口板', '手背圆盘义体', 'equip', ['equip', 'tool'], '交互辅助', 190, 1),
  row(67, 'armor_calf_back', '小腿后甲', '小腿后白甲', 'equip', ['equip'], '腿防', 180, 1),
  row(68, 'armor_lower_leg', '全机械小腿足', '膝下机械腿脚', 'equip', ['equip'], '机动', 270, 1),
  row(69, 'armor_calf_side', '小腿侧甲', '小腿侧白甲', 'equip', ['equip'], '腿防变体', 180, 1),
  row(70, 'armor_chest', '胸甲模块', '白甲胸护板', 'equip', ['equip', 'gift'], '躯干防', 300, 1),
  row(71, 'armor_abdomen', '腹腰带接口', '腹前圆口板', 'equip', ['equip'], '核心供电接口', 240, 1),
  row(72, 'armor_port', '皮下接口端口', '皮肤六边插口', 'equip', ['equip', 'tool'], '解锁高级接口', 160, 1),

  row(73, 'limb_leg_toes', '赤足式小腿', '白甲小腿裸机械趾', 'equip', ['equip', 'display'], '静音/感知向腿', 250, 1),
  row(74, 'limb_forearm_palm', '掌心朝上前臂', '前臂掌心朝上绿缝', 'equip', ['equip'], '精密操作臂', 255, 1),
  row(75, 'limb_leg_boot', '靴型小腿', '白甲封闭靴足', 'equip', ['equip'], '战斗机动腿', 265, 1),
  row(76, 'limb_thigh_side', '大腿侧视模块', '大腿侧蓝传感器', 'equip', ['equip'], '腿上段', 280, 1),
  row(77, 'limb_thigh_front', '大腿正视模块', '大腿前视蓝传感器', 'equip', ['equip'], '腿上段变体', 280, 1),
  row(78, 'limb_arm_full', '整臂总成', '肩到手完整臂', 'equip', ['equip', 'gift'], '高级臂替换', 350, 1),
  row(79, 'limb_torso_side', '女型躯干侧前', '白甲女型胸腹侧视', 'equip', ['equip', 'display'], '躯干总成', 450, 1),
  row(80, 'limb_chest_front', '胸甲正视板', '双胸甲正视绿核', 'equip', ['equip', 'display'], '胸甲替换', 320, 1),
  row(81, 'limb_torso_back', '躯干背视模块', '背脊绿段白肩胛', 'equip', ['equip', 'display'], '背部接口/散热', 340, 1),
] as const;

const byId = new Map(CAMP_PROPS.map((p) => [p.id, p]));
const byKey = new Map(CAMP_PROPS.map((p) => [p.key, p]));
const byIndex = new Map(CAMP_PROPS.map((p) => [p.index, p]));

export function getCampProp(idOrKeyOrIndex: string | number): CampPropDef | undefined {
  if (typeof idOrKeyOrIndex === 'number') return byIndex.get(idOrKeyOrIndex);
  const s = idOrKeyOrIndex.trim();
  return byId.get(s) ?? byKey.get(s) ?? byIndex.get(Number(s));
}

export function campPropsByTag(tag: CampPropAction): CampPropDef[] {
  return CAMP_PROPS.filter((p) => p.tags.includes(tag));
}

/** 注入系统提示：告诉模型营地道具可怎么用（详细经济以 buildCampEconomyPromptBlock 为准） */
export function campPropAiHint(ownedSummary?: string): string {
  return `【营地道具】食品一律 1 锈币；其它按标价。动作见 camp_item_action：buy/gift/consume/sell/check。
${ownedSummary ? `仓库摘要：${ownedSummary}\n` : ''}共 ${CAMP_PROPS.length} 件，id 形如 camp_prop_01…81。`;
}
