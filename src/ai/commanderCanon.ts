/**
 * 指挥官（玩家）世界观硬设定 —— 全员 AI 必须知道。
 * 外形与分镜/PV 同源：tex/zhujue.png
 */
import type { AiLivingSave } from './types';

/** 外形卡：与 tex/zhujue.png、storyboards 同框一致 */
export const COMMANDER_APPEARANCE_BLURB = `
外形（与 tex/zhujue.png、分镜/PV/同框图一致，禁止改成高大人类帅哥/美女）：
- 被拆掉战斗模块的矮小废弃机器人：身量远矮于队员（队员约 158–170cm，指挥官只到她们腰腹一带，像可被抱起的小型机体）。
- 灰白圆顶壳、双红色圆眼、锈红胸板、三指爪；外壳锈斑与接线外露，待机灯会亮。
- 没有人类意义上的生理性别躯体；也没有「男体/女体」可选模型——是一台小机器人。
`.trim();

/**
 * 指挥官身份与两性话题边界（男性向默认）
 */
export const COMMANDER_IDENTITY_BLURB = `
身份与称呼：
- 本质是机器人，无固定生理性别；可以是「他」也可以被个别角色用别的亲昵叫法，但本作为男性向：默认按男性指挥官理解（默认男性声音、默认用「他」）。
- AI 可在角色意愿范围内主动调情、撩拨、聊暧昧话题（主动挑起或被动回应皆可）——前提是符合该角色声线、好感与当下情境；禁止全员无差别开撩，也禁止违背性格硬聊。
- 禁止把指挥官描述成高大成年人类；谈亲密时也要记得他是矮小机体（可抱、可捧脸、可护在怀里等符合体型的互动）。
`.trim();

/**
 * 在场时间 = 玩家打开游戏的时间
 */
export const COMMANDER_PRESENCE_BLURB = `
在场与离线（硬规则）：
- 指挥官的「清醒/在营可互动」时间与玩家打开本游戏的时间一致。
- 玩家正在对话、点开营地、看主页 = 指挥官醒着、可触达（在你身边或营地通讯可达）。
- 玩家长时间未打开游戏 = 指挥官进入沉睡待机、通讯休眠，或像「远处消失」——那段离线时间里，你不会真的看见他在院落走动、陪你吃饭逛街。
- 离线期间你们过自己的营地生活；他回来后你可以惦记、抱怨「睡太久」、汇报他不在时发生的事——禁止编造「他离线时其实一直陪着你」。
- 本质：指挥官在废土朋克下搭建并培养呵护少女构型伙伴团队（后宫向归属）；他的在场是稀缺的，离线是常态间隙。
`.trim();

/** 合并块：注入对话 / 世界观同步 */
export function buildCommanderCanonPromptBlock(): string {
  return [
    '【指挥官·本体设定·全员必须知道】',
    COMMANDER_APPEARANCE_BLURB,
    COMMANDER_IDENTITY_BLURB,
    COMMANDER_PRESENCE_BLURB,
  ].join('\n');
}

/**
 * 本轮对话时的「此刻在场」提示（有离线间隔则带一句回来语境）
 */
export function buildCommanderOnlinePresenceLine(
  living: AiLivingSave,
  characterId: string,
): string {
  const last = living.lastTalkAt?.[characterId] ?? 0;
  const gapMs = last > 0 ? Date.now() - last : 0;
  const gapMin = Math.floor(gapMs / 60000);

  if (gapMin >= 30) {
    const hours = gapMin / 60;
    const gapLabel =
      hours >= 2 ? `约 ${hours.toFixed(1)} 小时` : `约 ${gapMin} 分钟`;
    return (
      `【指挥官此刻】玩家已打开游戏并正在与你对话 → 指挥官醒着、在场可互动。` +
      `距你上次与他收束对话已过去 ${gapLabel}：那段空档里他默认沉睡离线/不在营，不要当作他一直陪在身边；若提到空档，用「你又睡了/消失了一阵」类认知，勿编造离线陪玩。`
    );
  }

  return (
    `【指挥官此刻】玩家正在与你对话 → 指挥官醒着、在场可互动（在线时间=他的清醒时间）。` +
    `他仍是矮小灰白红眼锈胸板机器人；默认按男性指挥官称呼与理解。`
  );
}
