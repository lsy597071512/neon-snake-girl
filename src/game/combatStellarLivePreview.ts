import { createDefaultSave } from '../core/SaveManager';
import { getSquadShotDamageMap, getTeamTcp } from '../core/formulas';
import { STAGE_MAP } from '../data/stages';
import { normalStageId } from './combatBalance';
import { startCombat } from './Game';
import '../style.css';
import '../sub-ui.css';

const root = document.querySelector<HTMLDivElement>('#combat-preview-root');
if (!root) throw new Error('combat preview root missing');

const style = document.createElement('style');
style.textContent = `
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #05070d; }
  #combat-preview-root { position: fixed; inset: 0; background: #05070d; }
  #combat-preview-root > .combat-preview-info { position: fixed; z-index: 20; top: max(10px, env(safe-area-inset-top)); left: 12px; right: 12px; display: flex; justify-content: space-between; gap: 8px; pointer-events: none; font: 12px/1.35 system-ui, sans-serif; color: #e9edf7; text-shadow: 0 1px 3px #000; }
  .combat-preview-info span { padding: 6px 9px; border: 1px solid #e7b94b88; background: #080d18bb; }
  #combat-preview-root > .combat-preview-retry { position: fixed; z-index: 30; left: 50%; bottom: max(18px, env(safe-area-inset-bottom)); transform: translateX(-50%); min-height: 42px; padding: 0 16px; border: 1px solid #e7b94b; background: #121b2d; color: #ffe29a; font: 700 14px system-ui, sans-serif; }
`;
document.head.appendChild(style);

const info = document.createElement('div');
info.className = 'combat-preview-info';
info.innerHTML = '<span>实机战斗测试 · 1-12 Boss</span><span>UR03 光轮·天音</span>';
root.appendChild(info);

const combatHost = document.createElement('div');
combatHost.id = 'combat-host';
combatHost.style.cssText = 'position:absolute;inset:0;';
root.appendChild(combatHost);

const retry = document.createElement('button');
retry.className = 'combat-preview-retry';
retry.type = 'button';
retry.textContent = '重新开始战斗';
retry.addEventListener('click', () => window.location.reload());
root.appendChild(retry);

const save = createDefaultSave();
save.ownedCharacters.push({
  characterId: 'stellar',
  weaponId: null,
  giftCount: 0,
  shardPowerBonus: 0,
});
save.squad = ['stellar'];

const stage = STAGE_MAP[normalStageId(1, 12)];
if (!stage) throw new Error('Boss stage 1-12 missing');

startCombat(combatHost, {
  stage,
  tcp: Math.max(stage.recommendedTcp, getTeamTcp(save, stage.id)),
  squadIds: ['stellar'],
  squadDamage: getSquadShotDamageMap(save, ['stellar']),
  autoMode: false,
  stageWasCleared: false,
  onComplete: () => undefined,
});

