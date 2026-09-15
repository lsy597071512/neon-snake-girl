/**
 * 递交道具时的居中弹出图标（立绘与对话框之间，约 2s）。
 */
import { getCampProp } from '../data/campProps';
import { texUrl } from '../utils/texUrl';

const OFFER_FX_HOLD_MS = 2000;
const OFFER_FX_OUT_MS = 420;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function showDialogueItemOfferFx(overlay: HTMLElement, propId: string): void {
  const prop = getCampProp(propId);
  if (!prop) return;
  const stage = overlay.querySelector('.ai-immersive-stage');
  if (!stage) return;

  overlay.querySelectorAll('.ai-offer-fx-pop').forEach((el) => el.remove());

  const pop = document.createElement('div');
  pop.className = 'ai-offer-fx-pop';
  pop.setAttribute('role', 'img');
  pop.setAttribute('aria-label', `递交 ${prop.nameZh}`);
  pop.innerHTML = `
    <img src="${escapeHtml(texUrl(prop.icon))}" alt="" width="72" height="72" loading="eager" />
    <span class="ai-offer-fx-name">${escapeHtml(prop.nameZh)}</span>
  `;
  stage.appendChild(pop);

  window.setTimeout(() => {
    if (!pop.isConnected) return;
    pop.classList.add('is-out');
    window.setTimeout(() => pop.remove(), OFFER_FX_OUT_MS);
  }, OFFER_FX_HOLD_MS);
}
