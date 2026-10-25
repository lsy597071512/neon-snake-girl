import { playUiSound } from './uiSound';
import { CHARACTER_MAP } from '../data/characters';
import { WEAPON_MAP, GIFT_PRICES } from '../data/weapons';
import { getCharacterPower } from '../core/formulas';
import { getCharacterPosters } from '../data/characterPosters';
import {
  getCharacterSkins,
  getHubPurchasableSkins,
  type CharacterSkinDef,
} from '../data/characterSkins';
import { getCharacterLore, hasCharacterLore } from '../data/characterLore';
import {
  applyCharacterSkin,
  clearCharacterSkin,
  getActiveCharacterSkinId,
  isCharacterSkinUnlocked,
  unlockCharacterSkin,
} from '../systems/CharacterSkinSystem';
import { sendGift } from '../systems/AchievementSystem';
import { saveManager } from '../core/SaveManager';
import {
  getCharPortraitSeries,
  hasPortraitSeriesSwitch,
  rarityFrame,
  renderCharPortrait,
} from './uiAssets';
import { cyclePortraitSeriesIndex, getPortraitSeriesIndex } from './characterPortraitRuntime';
import { texUrl } from '../utils/texUrl';
import { showAiDialogue } from './aiDialogueOverlay';
import { peekAffinity, recordGiftBond } from '../ai/livingService';
import { describeAffinity } from '../ai/relationship';
import { relationshipArcLabelZh } from '../ai/relationshipArc';
import {
  getSkinUnlockPrice,
  listBondContentUnlocks,
} from '../systems/AffinityGameplay';
import { showCampWarehousePanel } from './campWarehousePanel';
import { CAMP_PROPS } from '../data/campProps';
import { getWarehouseQty, isPropOfferableInDialogue } from '../systems/CampWarehouseSystem';
import type { SaveData } from '../types';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type PosterOrient = 'portrait' | 'landscape';

export type CharacterDetailOptions = {
  onChanged?: () => void;
  /** 新手引导一句话说明（首次打开时展示一次） */
  guideHint?: string;
};

function openCharacterPosterViewer(characterId: string, characterName: string): void {
  const posters = getCharacterPosters(characterId);
  if (!posters) return;

  let orient: PosterOrient = 'portrait';
  const overlay = document.createElement('div');
  overlay.className = 'char-poster-overlay';
  overlay.dataset.charPosterOverlay = 'true';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${characterName} 角色海报`);

  const render = () => {
    const src = texUrl(orient === 'portrait' ? posters.portrait : posters.landscape);
    overlay.innerHTML = `
      <div class="char-poster-stage ${orient === 'landscape' ? 'is-landscape' : 'is-portrait'}">
        <div class="char-poster-topbar">
          <button type="button" class="btn btn-secondary" data-poster-orient>
            ${orient === 'portrait' ? '横屏' : '竖屏'}
          </button>
          <button type="button" class="btn btn-secondary" data-poster-close>关闭</button>
        </div>
        <img class="char-poster-img" src="${src}" alt="${escapeHtml(characterName)} 海报" draggable="false" />
      </div>
    `;

    overlay.querySelector('[data-poster-orient]')?.addEventListener('click', () => {
      playUiSound('tap');
      orient = orient === 'portrait' ? 'landscape' : 'portrait';
      render();
    });
    overlay.querySelector('[data-poster-close]')?.addEventListener('click', () => {
      playUiSound('confirm');
      overlay.remove();
    });
  };

  overlay.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).dataset.charPosterOverlay) {
      playUiSound('cancel');
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
  render();
  playUiSound('tap');
}

function renderLoreParagraphs(detailedBio: string): string {
  return detailedBio
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('');
}

function openCharacterLoreViewer(characterId: string, characterName: string): void {
  const lore = getCharacterLore(characterId);
  if (!lore) return;

  const overlay = document.createElement('div');
  overlay.className = 'char-lore-overlay';
  overlay.dataset.charLoreOverlay = 'true';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${characterName} 详细背景`);

  const coreNeedsHtml = lore.coreNeeds
    .map((need) => `<span class="char-lore-chip">${escapeHtml(need)}</span>`)
    .join('');

  overlay.innerHTML = `
    <div class="char-lore-panel card hud-card">
      <div class="modal-corner tl"></div><div class="modal-corner tr"></div>
      <div class="modal-corner bl"></div><div class="modal-corner br"></div>
      <div class="char-lore-topbar">
        <h3 class="char-lore-title">角色详细背景介绍</h3>
        <button type="button" class="btn btn-secondary" data-lore-close>关闭</button>
      </div>
      <p class="char-lore-subtitle">${escapeHtml(characterName)}</p>
      <div class="char-lore-meta">
        <div class="char-lore-meta-row">
          <span class="char-lore-meta-label">所属区域</span>
          <span class="char-lore-chip char-lore-chip-accent">${escapeHtml(lore.homeRegion)}</span>
        </div>
        <div class="char-lore-meta-row">
          <span class="char-lore-meta-label">说话风格</span>
          <span class="char-lore-chip">${escapeHtml(lore.speechStyle)}</span>
        </div>
        <div class="char-lore-meta-row">
          <span class="char-lore-meta-label">情绪基线</span>
          <span class="char-lore-chip">${escapeHtml(lore.emotionalBaseline)}</span>
        </div>
        <div class="char-lore-meta-row">
          <span class="char-lore-meta-label">日常节律</span>
          <span class="char-lore-chip">${escapeHtml(lore.dailyRhythm)}</span>
        </div>
        ${
          lore.coreNeeds.length
            ? `<div class="char-lore-meta-row char-lore-meta-row-needs">
                 <span class="char-lore-meta-label">核心需求</span>
                 <div class="char-lore-chips">${coreNeedsHtml}</div>
               </div>`
            : ''
        }
      </div>
      <div class="char-lore-scroll">
        ${renderLoreParagraphs(lore.detailedBio)}
      </div>
    </div>
  `;

  overlay.querySelector('[data-lore-close]')?.addEventListener('click', () => {
    playUiSound('confirm');
    overlay.remove();
  });
  overlay.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).dataset.charLoreOverlay) {
      playUiSound('cancel');
      overlay.remove();
    }
  });

  document.body.appendChild(overlay);
  playUiSound('tap');
}

function openCharacterSkinViewer(
  characterId: string,
  characterName: string,
  opts?: CharacterDetailOptions & { onClose?: () => void },
): void {
  const skins = getHubPurchasableSkins(characterId);
  if (!skins.length) return;

  let skinIndex = 0;
  let statusMsg = '';
  let dirty = false;
  const overlay = document.createElement('div');
  overlay.className = 'char-poster-overlay char-skin-overlay';
  overlay.dataset.charSkinOverlay = 'true';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${characterName} 看板娘皮肤`);

  const currentSkin = (): CharacterSkinDef => skins[skinIndex] ?? skins[0]!;

  const closeViewer = () => {
    overlay.remove();
    if (dirty) opts?.onClose?.();
  };

  const render = () => {
    const save = saveManager.get();
    const skin = currentSkin();
    const unlocked = isCharacterSkinUnlocked(save, characterId, skin.id);
    const activeId = getActiveCharacterSkinId(save, characterId);
    const applied = activeId === skin.id;
    const previewSrc = texUrl(skin.preview);
    const pricing = getSkinUnlockPrice(save, characterId, skin.id);
    const priceLabel =
      pricing.discount > 0 && pricing.listPrice > 0
        ? `${pricing.payPrice} 锈币（原价 ${pricing.listPrice}）`
        : `${pricing.listPrice} 锈币`;

    overlay.innerHTML = `
      <div class="char-poster-stage is-portrait char-skin-stage">
        <div class="char-poster-topbar">
          ${
            skins.length > 1
              ? `<button type="button" class="btn btn-secondary" data-skin-prev>上一个</button>
                 <button type="button" class="btn btn-secondary" data-skin-next>下一个</button>`
              : ''
          }
          <button type="button" class="btn btn-secondary" data-skin-close>关闭</button>
        </div>
        <img class="char-poster-img char-skin-img${unlocked ? '' : ' is-locked'}"
             src="${previewSrc}"
             alt="${escapeHtml(characterName)} ${escapeHtml(skin.name)}"
             draggable="false" />
        <div class="char-skin-panel">
          <div class="char-skin-title">
            <strong>${escapeHtml(skin.name)}</strong>
            <span>${
              unlocked
                ? applied
                  ? '已应用 · 看板娘'
                  : '已解锁 · 看板娘'
                : `未解锁 · ${priceLabel}`
            }</span>
          </div>
          <p class="char-skin-status">仅影响主页看板娘展示；营地穿着由情境决定，无需在此购买。</p>
          ${statusMsg ? `<p class="char-skin-status">${escapeHtml(statusMsg)}</p>` : ''}
          <div class="char-skin-actions">
            ${
              unlocked
                ? `<button type="button" class="btn btn-primary" data-skin-apply${applied ? ' disabled' : ''}>
                    ${applied ? '使用中' : '应用'}
                   </button>`
                : `<button type="button" class="btn btn-primary" data-skin-unlock>解锁（${pricing.payPrice}）</button>`
            }
          </div>
        </div>
      </div>
    `;

    overlay.querySelector('[data-skin-prev]')?.addEventListener('click', () => {
      playUiSound('tap');
      skinIndex = (skinIndex - 1 + skins.length) % skins.length;
      statusMsg = '';
      render();
    });
    overlay.querySelector('[data-skin-next]')?.addEventListener('click', () => {
      playUiSound('tap');
      skinIndex = (skinIndex + 1) % skins.length;
      statusMsg = '';
      render();
    });
    overlay.querySelector('[data-skin-close]')?.addEventListener('click', () => {
      playUiSound('confirm');
      closeViewer();
    });
    overlay.querySelector('[data-skin-unlock]')?.addEventListener('click', () => {
      playUiSound('tap');
      let result = { ok: false, msg: '' };
      saveManager.mutate((d) => {
        result = unlockCharacterSkin(d, characterId, skin.id);
      });
      statusMsg = result.msg;
      if (result.ok) {
        dirty = true;
        playUiSound('confirm');
        opts?.onChanged?.();
      }
      render();
    });
    overlay.querySelector('[data-skin-apply]')?.addEventListener('click', () => {
      if (applied) return;
      playUiSound('tap');
      let result = { ok: false, msg: '' };
      saveManager.mutate((d) => {
        result = applyCharacterSkin(d, characterId, skin.id);
      });
      statusMsg = result.msg;
      if (result.ok) {
        dirty = true;
        playUiSound('confirm');
        opts?.onChanged?.();
      }
      render();
    });
  };

  overlay.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).dataset.charSkinOverlay) {
      playUiSound('cancel');
      closeViewer();
    }
  });

  document.body.appendChild(overlay);
  render();
  playUiSound('tap');
}

export function showCharacterDetail(
  characterId: string,
  save: SaveData,
  opts?: CharacterDetailOptions,
): void {
  const c = CHARACTER_MAP[characterId];
  if (!c) return;

  const owned = save.ownedCharacters.find((o) => o.characterId === characterId);
  const weapon = owned?.weaponId ? WEAPON_MAP[owned.weaponId] : null;
  const power = owned ? getCharacterPower(characterId, owned.weaponId, save) : c.basePower;
  const posters = getCharacterPosters(characterId);
  const skins = getHubPurchasableSkins(characterId);
  const loreAvailable = hasCharacterLore(characterId);
  const activeSkinId = getActiveCharacterSkinId(save, characterId);
  const portraitBg = posters ? texUrl(posters.portrait) : '';
  const portraitSeries = getCharPortraitSeries(characterId);
  const canSwitchPortrait = hasPortraitSeriesSwitch(characterId);
  const portraitIdx = getPortraitSeriesIndex(characterId) % Math.max(1, portraitSeries.length);
  const affScore = owned ? peekAffinity(characterId) : 0;
  const affLabel = owned ? describeAffinity(affScore) : '';
  const arcLabel = owned ? relationshipArcLabelZh(affScore) : '';
  const bondHtml = owned
    ? `<ul class="char-detail-bond-list">${listBondContentUnlocks(affScore)
        .map(
          (r) =>
            `<li class="${r.unlocked ? 'is-on' : 'is-off'}">${r.unlocked ? '✓' : '·'} ${escapeHtml(r.label)}${
              r.unlocked ? '' : `（需好感 ${r.needAffinity}）`
            }</li>`,
        )
        .join('')}</ul>`
    : '';

  const overlay = document.createElement('div');
  overlay.className = 'char-detail-overlay reward-overlay';
  overlay.dataset.charDetailOverlay = 'true';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${c.name} 档案`);

  overlay.innerHTML = `
    <div class="char-detail-modal reward-modal card hud-card${portraitBg ? ' has-poster-bg' : ''}">
      ${
        portraitBg
          ? `<img class="char-detail-poster-bg" src="${portraitBg}" alt="" aria-hidden="true" draggable="false" />`
          : ''
      }
      <div class="char-detail-poster-veil" aria-hidden="true"></div>
      <div class="modal-corner tl"></div><div class="modal-corner tr"></div>
      <div class="modal-corner bl"></div><div class="modal-corner br"></div>
      <div class="char-detail-toolbar">
        ${
          opts?.guideHint
            ? `<p class="char-detail-guide-hint">${escapeHtml(opts.guideHint)} <span>（仅提示一次）</span></p>`
            : ''
        }
        ${
          posters
            ? `<button class="btn btn-secondary char-detail-poster-btn" type="button" data-char-poster>角色海报</button>`
            : ''
        }
        ${
          skins.length
            ? `<button class="btn btn-secondary char-detail-poster-btn" type="button" data-char-skin>看板娘皮肤</button>`
            : ''
        }
        ${
          loreAvailable
            ? `<button class="btn btn-secondary char-detail-poster-btn" type="button" data-char-lore>详细背景</button>`
            : ''
        }
        ${
          activeSkinId
            ? `<button class="btn btn-secondary char-detail-poster-btn" type="button" data-char-skin-default>切换为默认皮肤</button>`
            : ''
        }
      </div>
      <div class="char-detail-top">
        <div class="char-detail-portrait">
          <span class="rarity char-detail-rarity ${c.rarity}">${c.rarity}</span>
          <img class="char-frame-bg" src="${rarityFrame(c.rarity)}" alt="" />
          ${renderCharPortrait(characterId, 'front', 'char-portrait-img char-detail-portrait-img', 'char-icon-frame', '', { skinChannel: 'player' })}
          ${
            canSwitchPortrait
              ? `<button class="btn btn-secondary char-detail-portrait-switch" type="button" data-char-portrait-switch>
                   切换立绘 ${portraitIdx + 1}/${portraitSeries.length}
                 </button>`
              : ''
          }
        </div>
        <div class="char-detail-heading">
          <h3 class="char-detail-name">${escapeHtml(c.name)}</h3>
          <p class="char-detail-tag">${escapeHtml(c.tag)}</p>
          <p class="char-detail-power">战力 ${power}</p>
          ${
            activeSkinId
              ? `<p class="char-detail-skin-badge">皮肤：${escapeHtml(
                  getCharacterSkins(characterId).find((s) => s.id === activeSkinId)?.name ?? activeSkinId,
                )}</p>`
              : ''
          }
        </div>
      </div>
      <dl class="char-detail-meta">
        <div><dt>年纪</dt><dd>${escapeHtml(c.age)}</dd></div>
        <div><dt>身高</dt><dd>${escapeHtml(c.height)}</dd></div>
        <div><dt>三围</dt><dd>${escapeHtml(c.measurements)}</dd></div>
        <div><dt>性格</dt><dd>${escapeHtml(c.personality)}</dd></div>
        <div><dt>武装</dt><dd>${weapon ? escapeHtml(`${weapon.icon}${weapon.name}`) : '未装备'}</dd></div>
        ${
          c.skillName
            ? `<div><dt>技能</dt><dd><strong>${escapeHtml(c.skillName)}</strong>${c.skillDesc ? `<span>${escapeHtml(c.skillDesc)}</span>` : ''}</dd></div>`
            : ''
        }
      </dl>
      <div class="char-detail-bio">
        <h4>背景故事</h4>
        <p>${escapeHtml(c.bio)}</p>
      </div>
      ${
        owned
          ? `<div class="char-detail-living">
              <p class="char-detail-aff">好感 ${affScore}（${escapeHtml(affLabel)}）· 关系弧「${escapeHtml(arcLabel)}」· 礼物偏好：${escapeHtml(c.giftPreference)}</p>
              <div class="char-detail-bond">
                <p class="char-detail-bond-title">羁绊兑现</p>
                ${bondHtml}
              </div>
              <div class="char-detail-gift-row">
                <button class="btn btn-secondary" type="button" data-char-talk>对话</button>
                <button class="btn btn-secondary" type="button" data-char-wh>仓库商店</button>
                ${GIFT_PRICES.map(
                  (price, i) =>
                    `<button class="btn btn-secondary" type="button" data-char-gift="${i}">送礼 ${price}</button>`,
                ).join('')}
                <button class="btn btn-primary" type="button" data-char-gift-prop>仓库礼物</button>
                <button class="btn btn-secondary" type="button" data-char-feed>投喂食品</button>
              </div>
              <p class="char-detail-gift-msg" data-gift-msg></p>
            </div>`
          : ''
      }
      <div class="confirm-actions">
        <button class="btn btn-primary" type="button" data-char-detail-close>关闭</button>
      </div>
    </div>
  `;

  const close = () => {
    overlay.remove();
  };

  const refreshDetail = () => {
    close();
    showCharacterDetail(characterId, saveManager.get(), opts);
  };

  overlay.querySelector('[data-char-detail-close]')?.addEventListener('click', () => {
    playUiSound('confirm');
    close();
  });
  overlay.querySelector('[data-char-portrait-switch]')?.addEventListener('click', () => {
    playUiSound('tap');
    cyclePortraitSeriesIndex(characterId, portraitSeries.length);
    opts?.onChanged?.();
    refreshDetail();
  });
  overlay.querySelector('[data-char-poster]')?.addEventListener('click', () => {
    playUiSound('tap');
    openCharacterPosterViewer(characterId, c.name);
  });
  overlay.querySelector('[data-char-skin]')?.addEventListener('click', () => {
    playUiSound('tap');
    openCharacterSkinViewer(characterId, c.name, {
      onChanged: () => opts?.onChanged?.(),
      onClose: () => {
        opts?.onChanged?.();
        refreshDetail();
      },
    });
  });
  overlay.querySelector('[data-char-lore]')?.addEventListener('click', () => {
    playUiSound('tap');
    openCharacterLoreViewer(characterId, c.name);
  });
  overlay.querySelector('[data-char-skin-default]')?.addEventListener('click', () => {
    playUiSound('tap');
    saveManager.mutate((d) => {
      clearCharacterSkin(d, characterId);
    });
    opts?.onChanged?.();
    refreshDetail();
  });
  overlay.querySelector('[data-char-talk]')?.addEventListener('click', () => {
    playUiSound('confirm');
    close();
    showAiDialogue(characterId, { onClose: () => opts?.onChanged?.() });
  });
  overlay.querySelector('[data-char-wh]')?.addEventListener('click', () => {
    playUiSound('tap');
    showCampWarehousePanel({
      characterId,
      onChanged: () => {
        opts?.onChanged?.();
        refreshDetail();
      },
    });
  });
  overlay.querySelector('[data-char-gift-prop]')?.addEventListener('click', () => {
    const save = saveManager.get();
    const giftables = CAMP_PROPS.filter(
      (p) =>
        getWarehouseQty(save, p.id) > 0 &&
        isPropOfferableInDialogue(p) &&
        (p.tags.includes('gift') || p.category === 'gift' || p.category === 'food'),
    );
    const msgEl = overlay.querySelector<HTMLElement>('[data-gift-msg]');
    if (!giftables.length) {
      playUiSound('cancel');
      if (msgEl) msgEl.textContent = '仓库没有可送的礼物/食品，请先去商店购买';
      return;
    }
    playUiSound('confirm');
    if (msgEl) msgEl.textContent = '打开对话，从仓库递交礼物…';
    close();
    showAiDialogue(characterId, {
      onClose: () => opts?.onChanged?.(),
      openItemPicker: true,
      itemPickerTab: 'gift',
    });
  });
  overlay.querySelector('[data-char-feed]')?.addEventListener('click', () => {
    const save = saveManager.get();
    const foods = CAMP_PROPS.filter(
      (p) => p.category === 'food' && getWarehouseQty(save, p.id) > 0 && isPropOfferableInDialogue(p),
    );
    const msgEl = overlay.querySelector<HTMLElement>('[data-gift-msg]');
    if (!foods.length) {
      playUiSound('cancel');
      if (msgEl) msgEl.textContent = '仓库没有食品（商店食品 1 锈币）';
      return;
    }
    playUiSound('confirm');
    if (msgEl) msgEl.textContent = '打开对话，递交食品…';
    close();
    showAiDialogue(characterId, {
      onClose: () => opts?.onChanged?.(),
      openItemPicker: true,
      itemPickerTab: 'food',
    });
  });
  overlay.querySelectorAll('[data-char-gift]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tier = Number((btn as HTMLElement).dataset.charGift ?? 0) as 0 | 1 | 2;
      const price = GIFT_PRICES[tier] ?? GIFT_PRICES[0];
      let result = { ok: false, msg: '' };
      saveManager.mutate((d) => {
        result = sendGift(d, characterId, price);
      });
      const msgEl = overlay.querySelector<HTMLElement>('[data-gift-msg]');
      if (result.ok) {
        playUiSound('confirm');
        const score = recordGiftBond(characterId, c.giftPreference, tier);
        if (msgEl) msgEl.textContent = `${result.msg} · 好感 ${score}`;
        opts?.onChanged?.();
      } else {
        playUiSound('cancel');
        if (msgEl) msgEl.textContent = result.msg;
      }
    });
  });
  overlay.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).dataset.charDetailOverlay) {
      playUiSound('cancel');
      close();
    }
  });

  document.body.appendChild(overlay);
  playUiSound('tap');
}
