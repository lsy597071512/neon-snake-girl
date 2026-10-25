/** 引导目标注册表：以后改高光位置只改这里，不再逐个修 if。 */
export interface GuideTargetDef {
  id: string;
  pages: string[];
  selector: string;
  kind: 'tap' | 'look';
}
export const GUIDE_TARGETS: Record<string, GuideTargetDef> = {
  'nav-squad': { id: 'nav-squad', pages: ['hub'], selector: '[data-goto="squad"]', kind: 'tap' },
  'nav-map': { id: 'nav-map', pages: ['hub'], selector: '[data-goto="map"]', kind: 'tap' },
  'nav-tasks': { id: 'nav-tasks', pages: ['hub'], selector: '[data-goto="tasks"]', kind: 'tap' },
  'nav-shop': { id: 'nav-shop', pages: ['hub'], selector: '[data-goto="shop"]', kind: 'tap' },
  'nav-camp': { id: 'nav-camp', pages: ['hub'], selector: '[data-goto="camp"]', kind: 'tap' },
  'nav-weapons': { id: 'nav-weapons', pages: ['hub'], selector: '[data-goto="weapons"]', kind: 'tap' },
  'hub-commander': { id: 'hub-commander', pages: ['hub'], selector: '[data-hub-commander]', kind: 'look' },
  'squad-pick-ashcrow': { id: 'squad-pick-ashcrow', pages: ['squad'], selector: '[data-squad-pick="ashcrow"]', kind: 'tap' },
  'squad-slot-0': { id: 'squad-slot-0', pages: ['squad'], selector: '[data-squad-slot="0"]', kind: 'tap' },
  'squad-pick-heartforge': { id: 'squad-pick-heartforge', pages: ['squad'], selector: '[data-squad-pick="heartforge"]', kind: 'tap' },
  'squad-slot-1': { id: 'squad-slot-1', pages: ['squad'], selector: '[data-squad-slot="1"]', kind: 'tap' },
  'open-box': { id: 'open-box', pages: ['shop'], selector: '[data-action="open-box"]', kind: 'tap' },
  'open-recruit': { id: 'open-recruit', pages: ['shop'], selector: '[data-action="open-recruit"]', kind: 'tap' },
  'equip-heartforge': { id: 'equip-heartforge', pages: ['weapons'], selector: '[data-equip-btn="heartforge"]', kind: 'tap' },
  'fight-btn': { id: 'fight-btn', pages: ['map'], selector: '[data-action="fight"]', kind: 'tap' },
  'claim-t1': { id: 'claim-t1', pages: ['tasks'], selector: '[data-claim-task="t1_stage"]', kind: 'tap' },
  'back-hub': { id: 'back-hub', pages: ['squad', 'tasks', 'shop', 'weapons', 'map'], selector: '[data-back-hub]', kind: 'tap' },
  'combat-skill': { id: 'combat-skill', pages: ['combat'], selector: '[data-skill="ashcrow"]', kind: 'tap' },
};
export function resolveGuideTarget(id: string): GuideTargetDef | null {
  return GUIDE_TARGETS[id] ?? null;
}
