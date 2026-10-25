/**
 * 亲密氛围总包装：把「浴室亲近 / 解巾」等并入同一亲密氛围层，
 * 并挂载亲近区（bodySensitivity）。
 *
 * 底层会话机仍由 bathIntimateConsent 等驱动；
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
import { getBathAssistSession, isBathAssistActiveFor } from './bathAssistSession';
import { isDisciplineActiveFor } from './disciplineSession';

/** 亲密氛围场景标签（Prompt / 日志用） */
export type AdultEventScene =
  | 'bath_intimate'
  | 'bath_help_wash'
  | 'bath_co_bath'
  | 'discipline'
  | 'discipline_commander'
  | 'adult_dialogue'
  | 'none';

export type AdultEventContext = {
  scene: AdultEventScene;
  /** 是否应注入亲近区字段 */
  active: boolean;
  reasons: string[];
};

const ADULT_TOPIC_RE =
  /(亲密|暧昧|调情|撩|贴近|解巾|浴巾|共浴|一起洗|敏感|心跳|脸颊发热|拥抱|牵着|靠肩|耳语|气息)/i;

/** 角色主导的亲近/撩拨 */
const GIRL_LEADS_CMD_RE =
  /(逗(你|指挥官)|撩(你|指挥官)|调情|贴近(你|指挥官)|靠(向|近)(你|指挥官)|牵着(你|指挥官))/i;

/**
 * 判定本轮是否处在亲密氛围上下文（浴室亲近 / 暧昧话题对话）。
 */
export function detectAdultEventContext(opts: {
  living: AiLivingSave;
  characterId: string;
  userText?: string;
  assistantText?: string;
  /** 用户明确点了暧昧话题或亲近描写 */
  forceAdultTopic?: boolean;
}): AdultEventContext {
  const { living, characterId, userText = '', assistantText = '', forceAdultTopic } = opts;
  const reasons: string[] = [];
  let scene: AdultEventScene = 'none';

  const bathing = isBathingForIntimateConsent(living, characterId);
  const intimateOn = getBathIntimateConsent(living, characterId);
  const bathSpeech = isBathIntimateDialogueContext(userText, assistantText);
  const assist = getBathAssistSession(living);
  if (assist?.active && assist.characterId === characterId) {
    scene = assist.mode === 'help_wash' ? 'bath_help_wash' : 'bath_co_bath';
    reasons.push(assist.mode === 'help_wash' ? '帮指挥官清洗中' : '一同泡澡中');
  } else if (bathing && (intimateOn || bathSpeech || /解浴巾|拿开浴巾|解下.*巾/.test(userText))) {
    scene = 'bath_intimate';
    reasons.push(
      intimateOn ? '浴室已解巾亲近' : bathSpeech ? '浴室亲密对白' : '浴室解巾话题',
    );
  }

  if (isDisciplineActiveFor(living, characterId)) {
    const blob = `${userText}\n${assistantText}`;
    const girlLeads = GIRL_LEADS_CMD_RE.test(blob);
    scene = girlLeads ? 'discipline_commander' : 'discipline';
    reasons.push(girlLeads ? '角色主动亲近' : '亲近氛围');
  }

  const blob = `${userText}\n${assistantText}`;
  if (forceAdultTopic || ADULT_TOPIC_RE.test(blob)) {
    if (scene === 'none') scene = 'adult_dialogue';
    reasons.push('亲密话题/亲近描写触发');
  }

  return {
    scene,
    active: scene !== 'none',
    reasons,
  };
}

/** 亲密氛围总则（短）：与浴室细则叠加，不替代后者 */
export function buildAdultEventPreamble(scene: AdultEventScene): string {
  const sceneLine =
    scene === 'bath_intimate'
      ? '当前亲密氛围：共浴 / 解巾后的亲近。遵循浴室同意链；可写湿热、水汽、心跳与贴近的张力，点到即止。'
      : scene === 'bath_help_wash'
        ? '当前亲密氛围：帮指挥官清洗。你在冲淋/搓洗指挥官；描写贴合湿热与手部动作。'
        : scene === 'bath_co_bath'
          ? '当前亲密氛围：一同泡澡。共浴湿热与贴近；以氛围和情绪为主。'
          : scene === 'discipline'
        ? '当前场景：安静室内的陪伴氛围。'
        : scene === 'discipline_commander'
          ? '当前场景：角色主动引导的陪伴氛围。'
          : '当前亲密氛围：暧昧话题对话。可主动调情、撩拨、展示身材，但须贴合角色声线，点到即止、留白为妙。';

  return [
    '【亲密氛围】解巾后的亲近、帮洗/共浴同属亲密氛围层；以情绪与氛围为主，描写点到即止。',
    sceneLine,
    '情绪起伏与复杂心思可矛盾并存；含蓄处理，不做露骨描写。',
  ].join('\n');
}

/** 拼进 system/user 动态块：亲密氛围 + 亲近区快照 */
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
 * 从 LLM 扁平字段应用亲近刺激；非亲密上下文则衰减。
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
      target: target ?? (zones.includes('commander_core') ? 'commander' : 'self'),
      zones,
      intensity: parseStimIntensity(fields.stim_intensity),
      duration: parseStimDuration(fields.stim_duration),
      oddMood: hasMood ? String(fields.adult_odd_mood) : undefined,
      oilDischarge: oil || undefined,
    },
    now,
  );
}
