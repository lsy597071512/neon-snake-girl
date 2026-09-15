/**
 * 成人事件总包装：把「浴室亲密 / 脱浴巾」与「小黑屋调教」并入同一成人事件层，
 * 并挂载身体敏感点（bodySensitivity）。
 *
 * 底层会话机仍由 bathIntimateConsent / disciplineSession 驱动；
 * 本模块负责：场景判定、Prompt 统一门闩、刺激字段解析与落盘。
 */
import type { AiLivingSave } from './types';
import {
  applySensitivityStim,
  buildBodySensitivityPromptBlock,
  decayBodySensitivity,
  parseOilDischarge,
  parseStimDuration,
  parseStimIntensity,
  parseStimTarget,
  parseStimZonesField,
  type SensitivityApplyResult,
} from './bodySensitivity';
import {
  getBathIntimateConsent,
  isBathIntimateDialogueContext,
  isBathingForIntimateConsent,
} from './bathIntimateConsent';
import { isDisciplineActiveFor } from './disciplineSession';

/** 成人事件场景标签（Prompt / 日志用） */
export type AdultEventScene =
  | 'bath_intimate'
  | 'discipline'
  | 'discipline_commander'
  | 'adult_dialogue'
  | 'none';

export type AdultEventContext = {
  scene: AdultEventScene;
  /** 是否应注入敏感点 + 成人字段 */
  active: boolean;
  reasons: string[];
};

const ADULT_TOPIC_RE =
  /(成人|色情|性爱|做爱|性交|口交|手交|足交|自慰|高潮|射精|精液|机油|敏感液|敏感点|乳头|阴道|会阴|小管道|脱浴巾|一起洗澡|共浴|调教|小黑屋|捆绑|道具|刺激|爱抚|揉胸|舔|插入)/i;

/** 角色主导刺激指挥官（小管道等） */
const GIRL_LEADS_CMD_RE =
  /(调教(你|指挥官)|玩(你|指挥官)|摸(你的)?小管道|刺激(你的)?管道|帮(你|指挥官).{0,8}(射|排|泄)|给你.{0,6}(手活|口)|骑(上|着)(你|指挥官))/i;

/**
 * 判定本轮是否处在成人事件上下文（浴室亲密 / 调教 / 成人话题对话）。
 */
export function detectAdultEventContext(opts: {
  living: AiLivingSave;
  characterId: string;
  userText?: string;
  assistantText?: string;
  /** 用户明确点了成人话题或敏感描写 */
  forceAdultTopic?: boolean;
}): AdultEventContext {
  const { living, characterId, userText = '', assistantText = '', forceAdultTopic } = opts;
  const reasons: string[] = [];
  let scene: AdultEventScene = 'none';

  const bathing = isBathingForIntimateConsent(living, characterId);
  const intimateOn = getBathIntimateConsent(living, characterId);
  const bathSpeech = isBathIntimateDialogueContext(userText, assistantText);
  if (bathing && (intimateOn || bathSpeech || /脱浴巾|拿开浴巾|脱掉.*巾/.test(userText))) {
    scene = 'bath_intimate';
    reasons.push(
      intimateOn ? '浴室已脱巾亲密' : bathSpeech ? '浴室亲密对白' : '浴室脱巾话题',
    );
  }

  if (isDisciplineActiveFor(living, characterId)) {
    const blob = `${userText}\n${assistantText}`;
    const girlLeads = GIRL_LEADS_CMD_RE.test(blob);
    scene = girlLeads ? 'discipline_commander' : 'discipline';
    reasons.push(girlLeads ? '小黑屋·角色调教指挥官' : '小黑屋调教');
  }

  const blob = `${userText}\n${assistantText}`;
  if (forceAdultTopic || ADULT_TOPIC_RE.test(blob)) {
    if (scene === 'none') scene = 'adult_dialogue';
    reasons.push('成人话题/敏感描写触发');
  }

  return {
    scene,
    active: scene !== 'none',
    reasons,
  };
}

/** 成人事件总则（短）：与浴室/调教细则叠加，不替代后者 */
export function buildAdultEventPreamble(scene: AdultEventScene): string {
  const sceneLine =
    scene === 'bath_intimate'
      ? '当前成人事件：浴室共同洗澡 / 脱浴巾亲密。遵循浴室同意链；敏感点描写要贴合湿热与肌肤接触。'
      : scene === 'discipline'
        ? '当前成人事件：小黑屋调教（指挥官主导）。遵循调教会话与纪律；敏感点与异样情绪要写进动作与身体反应。'
        : scene === 'discipline_commander'
          ? '当前成人事件：小黑屋调教（你调教指挥官）。可刺激指挥官「小管道」；其排出机油=敏感液高潮信号。'
          : '当前成人事件：成人话题对话。可自然推进爱抚/刺激，但须角色声线；无同意勿跳过界。';

  return [
    '【成人事件】脱浴巾亲密与小黑屋调教同属成人事件层；身体敏感点在本层生效。',
    sceneLine,
    '异样情绪与调教复杂情绪同源，可矛盾并存；长刺激或高潮可排出机油（敏感液）。',
  ].join('\n');
}

/** 拼进 system/user 动态块：成人事件 + 敏感点快照 */
export function buildAdultEventPromptBlock(opts: {
  living: AiLivingSave;
  characterId: string;
  ctx: AdultEventContext;
}): string {
  if (!opts.ctx.active) return '';
  return [
    buildAdultEventPreamble(opts.ctx.scene),
    buildBodySensitivityPromptBlock(opts.living, opts.characterId),
  ]
    .filter(Boolean)
    .join('\n');
}

export type AdultLlmStimFields = {
  stim_target?: unknown;
  stim_zones?: unknown;
  stim_intensity?: unknown;
  stim_duration?: unknown;
  adult_odd_mood?: unknown;
  oil_discharge?: unknown;
};

/**
 * 从 LLM 扁平字段应用身体刺激；非成人上下文则衰减。
 */
export function applyAdultEventFromLlm(opts: {
  living: AiLivingSave;
  characterId: string;
  ctx: AdultEventContext;
  fields: AdultLlmStimFields;
  now?: number;
}): SensitivityApplyResult | { applied: false; msg: string } {
  const { living, characterId, ctx, fields, now = Date.now() } = opts;

  if (!ctx.active) {
    decayBodySensitivity(living, characterId, 6);
    return { applied: false, msg: '' };
  }

  const target = parseStimTarget(fields.stim_target);
  const zones = parseStimZonesField(fields.stim_zones);
  const hasMood =
    typeof fields.adult_odd_mood === 'string' &&
    fields.adult_odd_mood.trim() &&
    fields.adult_odd_mood.trim() !== '""';
  const oil = parseOilDischarge(fields.oil_discharge);

  if (!target && !zones.length && !hasMood && !oil) {
    return { applied: false, msg: '' };
  }

  return applySensitivityStim(
    living,
    characterId,
    {
      target: target ?? (zones.includes('commander_pipe') ? 'commander' : 'self'),
      zones,
      intensity: parseStimIntensity(fields.stim_intensity),
      duration: parseStimDuration(fields.stim_duration),
      oddMood: hasMood ? String(fields.adult_odd_mood) : undefined,
      oilDischarge: oil || undefined,
    },
    now,
  );
}
