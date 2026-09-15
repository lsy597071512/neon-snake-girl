/**
 * 对话页迷你仓库：与营地仓库同步，仅递交道具（escrow）。
 */
import { saveManager } from '../core/SaveManager';
import { CAMP_PROPS, type CampPropDef } from '../data/campProps';
import {
  getPendingItemOffer,
  getWarehouseQty,
  isPropOfferableInDialogue,
  resolvePropOfferIntent,
} from '../systems/CampWarehouseSystem';
import { getAiLiving } from '../ai/livingService';
import { texUrl } from '../utils/texUrl';
import { playUiSound } from './uiSound';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PICKER_TABS: { id: string; label: string; filter: (p: CampPropDef) => boolean }[] = [
  {
    id: 'gift',
    label: '礼物',
    filter: (p) => p.category === 'gift' || p.tags.includes('gift'),
  },
  { id: 'food', label: '食品', filter: (p) => p.category === 'food' },
  {
    id: 'parts',
    label: '机械配件',
    filter: (p) =>
      p.category === 'material' || p.category === 'tool' || p.category === 'consumable',
  },
  {
    id: 'entertain',
    label: '娱乐',
    filter: (p) => p.category === 'entertain' || p.tags.includes('entertain'),
  },
  { id: 'equip', label: '义体', filter: (p) => p.category === 'equip' },
  {
    id: 'other',
    label: '其它',
    filter: (p) =>
      p.category === 'decor' || p.category === 'container' || p.category === 'junk',
  },
  { id: 'all', label: '全部', filter: () => true },
];

export type DialogueItemPickerOpts = {
  overlay: HTMLElement;
  characterId: string;
  /** 打开时默认分类 tab */
  initialTab?: string;
  onOffer: (propId: string) => void;
};

function rowHtml(p: CampPropDef, qty: number): string {
  const { label } = resolvePropOfferIntent(p);
  return `<button type="button" class="ai-item-picker-card" data-offer-prop="${escapeHtml(p.id)}">
    <img src="${escapeHtml(texUrl(p.icon))}" alt="" width="48" height="48" loading="lazy" />
    <span class="ai-item-picker-meta">
      <b>${escapeHtml(p.nameZh)}</b>
      <span>×${qty} · ${escapeHtml(label)}</span>
    </span>
  </button>`;
}

export function closeDialogueItemPicker(overlay: HTMLElement): void {
  overlay.querySelector('[data-ai-item-picker]')?.remove();
  overlay.classList.remove('has-item-picker');
}

export function showDialogueItemPicker(opts: DialogueItemPickerOpts): void {
  closeDialogueItemPicker(opts.overlay);
  let tab = opts.initialTab && PICKER_TABS.some((t) => t.id === opts.initialTab) ? opts.initialTab! : 'all';

  const shell = document.createElement('div');
  shell.className = 'ai-item-picker';
  shell.dataset.aiItemPicker = '1';
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-label', '从仓库递交物品');

  const render = () => {
    const save = saveManager.get();
    const living = getAiLiving();
    const pending = getPendingItemOffer(living);
    const tabDef = PICKER_TABS.find((t) => t.id === tab) ?? PICKER_TABS[PICKER_TABS.length - 1]!;
    const rows = CAMP_PROPS.filter(
      (p) =>
        getWarehouseQty(save, p.id) > 0 &&
        isPropOfferableInDialogue(p) &&
        tabDef.filter(p),
    )
      .map((p) => rowHtml(p, getWarehouseQty(save, p.id)))
      .join('');

    const tabBtns = PICKER_TABS.map(
      (t) =>
        `<button type="button" class="ai-item-picker-tab${t.id === tab ? ' is-on' : ''}" data-picker-tab="${t.id}">${t.label}</button>`,
    ).join('');

    const pendingHint = pending
      ? `<p class="ai-item-picker-pending">待对方决定：${escapeHtml(
          CAMP_PROPS.find((x) => x.id === pending.propId)?.nameZh ?? pending.propId,
        )}</p>`
      : '';

    shell.innerHTML = `
      <div class="ai-item-picker-head">
        <b>仓库 · 递给角色</b>
        <button type="button" class="ai-item-picker-close" data-picker-close aria-label="关闭">×</button>
      </div>
      ${pendingHint}
      <div class="ai-item-picker-tabs">${tabBtns}</div>
      <div class="ai-item-picker-grid">${rows || '<p class="ai-item-picker-empty">仓库没有可递交的物品</p>'}</div>
      <p class="ai-item-picker-hint">递交后由角色决定是否收下；未使用将自动退回仓库。</p>
    `;

    shell.querySelector('[data-picker-close]')?.addEventListener('click', () => {
      playUiSound('cancel');
      closeDialogueItemPicker(opts.overlay);
    });

    shell.querySelectorAll<HTMLElement>('[data-picker-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tab = btn.dataset.pickerTab || 'all';
        playUiSound('tap');
        render();
      });
    });

    shell.querySelectorAll<HTMLElement>('[data-offer-prop]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.offerProp;
        if (!id) return;
        playUiSound('confirm');
        closeDialogueItemPicker(opts.overlay);
        opts.onOffer(id);
      });
    });
  };

  const dock = opts.overlay.querySelector('.ai-immersive-dock');
  if (dock) dock.appendChild(shell);
  else opts.overlay.appendChild(shell);
  opts.overlay.classList.add('has-item-picker');
  render();
}
