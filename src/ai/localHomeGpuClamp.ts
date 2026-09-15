/**

 * 本机家里 GPU 旁路：只钳换装相关系统字段，绝不改写角色台词 / 心声 / want_continue。

 */

import { resolvePresence } from './livingState';

import type { AiLivingSave, DialogueRequest, LlmDialogueResult } from './types';



const OUTFIT_ASK_RE =

  /换(衣|装|服|一?[套件])|穿上|脱掉|泳装|泳衣|睡衣|私服|便服|装甲|默认外观|那套|这套衣服|换一套|性感|情趣|特殊服装|浴后|浴巾|脱巾/;



const OUTFIT_SPEECH_RE =

  /换(上|好|完|衣|装|服|一?[套件])|去换|我去换|私服|泳装|睡衣|特殊服装|性感|情趣|那套|这套衣服/;



const GOING_HINT_RE =

  /等(我|一下|会儿|一会)|稍等|去换|我去换|这就换|去衣柜|去拿那套|我直接去换/;



export function clampLocalHomeGpuDialogueResult(

  living: AiLivingSave,

  req: DialogueRequest,

  result: LlmDialogueResult,

): LlmDialogueResult {

  const turn = req.turnMode ?? 'reply';

  const presence = resolvePresence(req.characterId, living);

  const speech = `${result.dialogue ?? ''}${result.action ?? ''}${req.playerMessage ?? ''}`;

  const playerAskedOutfit = OUTFIT_ASK_RE.test(req.playerMessage || '');

  const speechOutfit =

    OUTFIT_SPEECH_RE.test(speech) ||

    GOING_HINT_RE.test(`${result.dialogue ?? ''}${result.action ?? ''}`);

  // 玩家点名换装、或本轮嘴上已在去换：保留 skin_change

  const allowSkinChange = turn === 'outfit_reveal' || playerAskedOutfit || speechOutfit;



  let skin_change = result.skin_change?.trim() || '';

  if (!allowSkinChange) {

    skin_change = '';

  } else if (presence.activity === 'bathe' || presence.roomId === 'room_1f_bath') {

    if (skin_change && !/^pifu03$/i.test(skin_change) && skin_change !== '""') {

      skin_change = '';

    }

  }



  let world_intent = result.world_intent;

  if (world_intent && typeof world_intent === 'object') {

    world_intent = {

      ...world_intent,

      outfit_action: allowSkinChange ? world_intent.outfit_action : undefined,

      target_skin: allowSkinChange ? world_intent.target_skin : '',

    };

  }



  return {

    ...result,

    skin_change: skin_change || undefined,

    world_intent,

  };

}


