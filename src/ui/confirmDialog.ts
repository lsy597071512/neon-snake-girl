import { playUiSound } from './uiSound';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMessage(message: string): string {
  return escapeHtml(message).replace(/\n/g, '<br />');
}

export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay reward-overlay';
    overlay.dataset.confirmOverlay = 'true';

    const confirmClass = options.danger ? 'btn btn-danger' : 'btn btn-primary';
    const cancelBtn = options.cancelLabel === ''
      ? ''
      : `<button class="btn btn-secondary" type="button" data-confirm-cancel>${escapeHtml(options.cancelLabel ?? '取消')}</button>`;

    overlay.innerHTML = `
      <div class="confirm-modal reward-modal card hud-card">
        <div class="modal-corner tl"></div><div class="modal-corner tr"></div>
        <div class="modal-corner bl"></div><div class="modal-corner br"></div>
        <h3>${escapeHtml(options.title)}</h3>
        <p class="confirm-message">${formatMessage(options.message)}</p>
        <div class="confirm-actions">
          ${cancelBtn}
          <button class="${confirmClass}" type="button" data-confirm-ok>${escapeHtml(options.confirmLabel ?? '确认')}</button>
        </div>
      </div>
    `;

    const close = (result: boolean) => {
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector('[data-confirm-ok]')?.addEventListener('click', () => {
      playUiSound('confirm');
      close(true);
    });
    overlay.querySelector('[data-confirm-cancel]')?.addEventListener('click', () => {
      playUiSound('cancel');
      close(false);
    });
    overlay.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).dataset.confirmOverlay) close(false);
    });

    document.body.appendChild(overlay);
  });
}

export function showAlert(title: string, message: string, confirmLabel = '知道了'): Promise<void> {
  return showConfirm({
    title,
    message,
    confirmLabel,
    cancelLabel: '',
  }).then(() => undefined);
}
