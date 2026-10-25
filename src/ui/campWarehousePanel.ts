/**
 * 营地仓库 / 日更商店面板
 * 仓库：礼物·食品·机械配件·娱乐等库存（有数量）
 * 商店：每日 30 件货架 + 老板娘固定话术立绘（非 AI）
 */
import { saveManager } from '../core/SaveManager';
import { CAMP_PROPS, type CampPropDef } from '../data/campProps';
import {
  CAMP_SHOPKEEPER_ART,
  CAMP_SHOPKEEPER_NAME,
  CAMP_SHOPKEEPER_WELCOME_SCRIPT,
  pickShopkeeperLine,
} from '../data/campShopkeeper';
import { getAiLiving } from '../ai/livingService';
import {
  buyFromCampShop,
  sellFromWarehouse,
  consumeFromWarehouse,
  placeFromWarehouse,
  playEntertainment,
  equipCyberFromWarehouse,
  getCharacterPocket,
  getShopPrice,
  getSellPrice,
  getWarehouseQty,
  seedCampEconomy,
} from '../systems/CampWarehouseSystem';
import {
  campShopDayLabel,
  ensureCampShopDay,
  listCampShopOffers,
  shopKindForProp,
  shopKindLabel,
  CAMP_SHOP_KINDS,
} from '../systems/CampShopSystem';
import {
  getCyberHealth,
  repairCyberHealth,
  CYBER_SHOP_PRICE,
} from '../systems/CyberHealthSystem';
import { texUrl } from '../utils/texUrl';
import { playUiSound } from './uiSound';
import { showRecruitPage, preloadRecruitCutscene, RECRUIT_BG_SRC } from './recruitPage';
import { GACHA_PITY } from '../data/characters';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 仓库分类（消耗品向） */
const WH_TABS: { id: string; label: string; filter: (p: CampPropDef) => boolean }[] = [
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
  {
    id: 'furniture',
    label: '家具',
    filter: (p) => p.category === 'furniture' || p.tags.includes('furniture'),
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

export type CampWarehousePanelOpts = {
  characterId?: string;
  /** 打开时默认页 */
  initialMode?: 'warehouse' | 'shop';
  onChanged?: () => void;
};

/** 老板娘页上的招募入口（与商城页同一视觉语汇的图标徽记按钮） */
function recruitEntryHtml(): string {
  const s = saveManager.get();
  return `
    <button type="button" class="recruit-entry recruit-entry--keeper" data-action="open-recruit" aria-label="前往唤醒协议招募">
      <img class="recruit-entry-bg" src="${texUrl(RECRUIT_BG_SRC)}" alt="" aria-hidden="true" />
      <span class="recruit-entry-veil" aria-hidden="true"></span>
      <span class="recruit-entry-sigil" aria-hidden="true">
        <svg viewBox="0 0 64 64" fill="none">
          <polygon points="32,3 58,18 58,46 32,61 6,46 6,18" stroke="currentColor" stroke-width="2.5" />
          <polygon points="32,11 51,22 51,42 32,53 13,42 13,22" stroke="currentColor" stroke-width="1.2" opacity="0.65" />
          <circle cx="32" cy="32" r="8" stroke="currentColor" stroke-width="2.5" />
          <circle cx="32" cy="32" r="3.2" fill="currentColor" />
          <path d="M32 3v8M32 53v8M6 18l7 4M51 42l7 4M58 18l-7 4M13 42l-7 4" stroke="currentColor" stroke-width="2" />
        </svg>
      </span>
      <span class="recruit-entry-body">
        <strong>唤醒协议 · 构装体招募</strong>
        <small>保底 ${GACHA_PITY}（当前 ${s.gachaPity}）</small>
      </span>
      <span class="recruit-entry-go">进入 ❯</span>
    </button>`;
}

export function showCampWarehousePanel(opts: CampWarehousePanelOpts = {}): void {
  document.querySelector('[data-camp-wh-panel]')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'camp-living-overlay camp-wh-overlay';
  overlay.dataset.campWhPanel = '1';

  let whTab = 'all';
  let shopKind = 'all';
  let mode: 'warehouse' | 'shop' = opts.initialMode ?? 'warehouse';

  /** 老板娘 UI 状态（跨 render 保留） */
  let shopPose: 'front' | 'back' = 'front';
  let shopBubble = '';
  let welcomeDone = false;
  const shopTimers: number[] = [];

  const clearShopTimers = () => {
    while (shopTimers.length) {
      const id = shopTimers.pop();
      if (id != null) window.clearTimeout(id);
    }
  };

  const scheduleShop = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    shopTimers.push(id);
    return id;
  };

  const paintShopkeeper = () => {
    const img = overlay.querySelector<HTMLImageElement>('[data-shop-keeper-art]');
    const bub = overlay.querySelector<HTMLElement>('[data-shop-keeper-bubble]');
    const nextSrc = texUrl(shopPose === 'back' ? CAMP_SHOPKEEPER_ART.back : CAMP_SHOPKEEPER_ART.front);
    const nextAlt = shopPose === 'back' ? `${CAMP_SHOPKEEPER_NAME}·拿货` : `${CAMP_SHOPKEEPER_NAME}·接待`;
    if (img) {
      const swap = () => {
        img.src = nextSrc;
        img.alt = nextAlt;
        img.classList.remove('is-fading-out');
        img.classList.add('is-fading-in');
        void img.offsetWidth;
        requestAnimationFrame(() => {
          img.classList.remove('is-fading-in');
          img.classList.add('is-visible');
        });
      };
      if (img.getAttribute('src') && img.src && !img.src.includes(nextSrc.split('/').pop() || '')) {
        img.classList.add('is-fading-out');
        img.classList.remove('is-visible');
        window.setTimeout(swap, 220);
      } else {
        img.src = nextSrc;
        img.alt = nextAlt;
        img.classList.add('is-visible');
      }
    }
    if (bub) bub.textContent = shopBubble;
    overlay.querySelector('[data-camp-wh-inner]')?.classList.toggle('is-fetching', shopPose === 'back');
  };

  const startBrowseIdle = () => {
    clearShopTimers();
    const tick = () => {
      if (mode !== 'shop' || !document.body.contains(overlay) || shopPose === 'back') return;
      shopBubble = pickShopkeeperLine('browse', shopBubble);
      paintShopkeeper();
      scheduleShop(tick, 12000 + Math.floor(Math.random() * 4000));
    };
    scheduleShop(tick, 10000);
  };

  const runWelcomeSequence = () => {
    if (welcomeDone || mode !== 'shop') return;
    clearShopTimers();
    shopPose = 'front';
    shopBubble = CAMP_SHOPKEEPER_WELCOME_SCRIPT[0]!;
    paintShopkeeper();
    scheduleShop(() => {
      if (mode !== 'shop' || !document.body.contains(overlay)) return;
      shopBubble = CAMP_SHOPKEEPER_WELCOME_SCRIPT[1]!;
      paintShopkeeper();
      scheduleShop(() => {
        if (mode !== 'shop' || !document.body.contains(overlay)) return;
        welcomeDone = true;
        shopBubble = pickShopkeeperLine('arrive');
        paintShopkeeper();
        startBrowseIdle();
      }, 1500);
    }, 1400);
  };

  const beginFetchPose = (doneLine: string) => {
    clearShopTimers();
    shopPose = 'back';
    shopBubble = doneLine;
    paintShopkeeper();
    scheduleShop(() => {
      if (!document.body.contains(overlay) || mode !== 'shop') return;
      shopPose = 'front';
      shopBubble = pickShopkeeperLine('browse');
      paintShopkeeper();
      startBrowseIdle();
    }, 1600);
  };

  const closePanel = () => {
    clearShopTimers();
    playUiSound('cancel');
    overlay.remove();
    opts.onChanged?.();
  };

  const render = () => {
    const save = saveManager.get();
    const living = getAiLiving();
    seedCampEconomy(save, living);
    ensureCampShopDay(save, living);
    const payer: 'player' | string = opts.characterId ?? 'player';
    const gold = save.gold ?? 0;
    const pocket = opts.characterId ? getCharacterPocket(living, opts.characterId) : null;
    const cyberHp = opts.characterId ? getCyberHealth(living, opts.characterId) : null;

    const whFilter = WH_TABS.find((t) => t.id === whTab) ?? WH_TABS[WH_TABS.length - 1]!;
    const ownedRows = CAMP_PROPS.filter(
      (p) => getWarehouseQty(save, p.id) > 0 && whFilter.filter(p),
    )
      .map((p) => propRowHtml(p, getWarehouseQty(save, p.id), opts.characterId))
      .join('');

    const offers = listCampShopOffers(save, living);
    const shopRows = offers
      .filter((x) => shopKind === 'all' || shopKindForProp(x.prop) === shopKind)
      .map((x) => shopOfferRowHtml(x.prop, x.offer.sold))
      .join('');

    const available = offers.filter((x) => !x.offer.sold).length;
    const whTabBtns = WH_TABS.map(
      (t) =>
        `<button type="button" class="cl-tab${t.id === whTab ? ' is-on' : ''}" data-wh-tab="${t.id}">${t.label}</button>`,
    ).join('');
    const shopKindBtns = [
      `<button type="button" class="cl-tab${shopKind === 'all' ? ' is-on' : ''}" data-shop-kind="all">全部</button>`,
      ...CAMP_SHOP_KINDS.map(
        (k) =>
          `<button type="button" class="cl-tab${shopKind === k.id ? ' is-on' : ''}" data-shop-kind="${k.id}">${k.label}</button>`,
      ),
    ].join('');

    const keeperArt = texUrl(
      shopPose === 'back' ? CAMP_SHOPKEEPER_ART.back : CAMP_SHOPKEEPER_ART.front,
    );
    const bubbleText = shopBubble || (mode === 'shop' ? '……' : '');

    overlay.classList.toggle('is-shop-mode', mode === 'shop');
    overlay.innerHTML = `
      <div class="camp-living-panel cl-panel-wide${mode === 'shop' ? ' is-shop' : ''}" data-camp-wh-inner${
        shopPose === 'back' ? ' data-fetching="1"' : ''
      }>
        <header class="camp-living-head">
          <div>
            <h2>${mode === 'warehouse' ? '营地仓库' : '营地商店'}</h2>
            <p class="camp-living-hint">指挥官锈币 ${gold}${
              pocket != null ? ` · 角色私房 ${pocket}` : ''
            }${
              cyberHp != null ? ` · 义体健康 ${cyberHp}/100` : ''
            } · 食品 1 币 · 义体 ${CYBER_SHOP_PRICE} 币</p>
          </div>
          <div class="camp-wh-head-actions">
            <button class="btn btn-secondary" type="button" data-wh-close>关闭</button>
          </div>
        </header>
        <p class="camp-wh-toast" data-wh-toast hidden></p>
        <div class="cl-tabs">
          <button type="button" class="cl-tab${mode === 'warehouse' ? ' is-on' : ''}" data-wh-mode="warehouse">仓库库存</button>
          <button type="button" class="cl-tab${mode === 'shop' ? ' is-on' : ''}" data-wh-mode="shop">日更商店</button>
        </div>
        ${
          mode === 'warehouse'
            ? `<section class="cl-sec">
                <div class="cl-tabs camp-wh-subtabs">${whTabBtns}</div>
                <div class="camp-wh-grid">${ownedRows || '<p class="camp-living-hint">仓库空空 — 去日更商店购买，或让角色对话自行采购</p>'}</div>
                <p class="camp-living-hint">仓库存放礼物 / 食品 / 机械配件 / 娱乐品等，AI 可按数量消耗、送礼、娱乐。</p>
              </section>`
            : `<section class="cl-sec camp-shop-split" data-camp-shop-stage>
                <aside class="camp-shop-keeper-col" aria-label="${escapeHtml(CAMP_SHOPKEEPER_NAME)}">
                  <div class="camp-shop-keeper-bubble" data-shop-keeper-bubble role="status">${escapeHtml(bubbleText)}</div>
                  <div class="camp-shop-keeper-figure">
                    <img class="camp-shop-keeper-art" data-shop-keeper-art src="${escapeHtml(keeperArt)}" alt="${escapeHtml(CAMP_SHOPKEEPER_NAME)}" />
                  </div>
                  ${recruitEntryHtml()}
                </aside>
                <div class="camp-shop-shelf">
                  <p class="camp-living-hint">${campShopDayLabel(living)} · 在售 ${available}/30 · 每件库存 1，买完即下架 · 隔日刷新</p>
                  <div class="cl-tabs camp-wh-subtabs">${shopKindBtns}</div>
                  <div class="camp-wh-grid camp-shop-grid">${shopRows || '<p class="camp-living-hint">无</p>'}</div>
                </div>
              </section>`
        }
      </div>
    `;

    overlay.querySelector('[data-action="open-recruit"]')?.addEventListener('click', () => {
      playUiSound('tap');
      preloadRecruitCutscene();
      showRecruitPage({ onExit: () => render() });
    });
    if (mode === 'shop') preloadRecruitCutscene();
    overlay.querySelector('[data-wh-close]')?.addEventListener('click', closePanel);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closePanel();
    });

    overlay.querySelectorAll<HTMLElement>('[data-wh-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.dataset.whMode === 'shop' ? 'shop' : 'warehouse';
        if (next === mode) return;
        playUiSound('tap');
        if (next === 'warehouse') {
          clearShopTimers();
          welcomeDone = false;
          shopPose = 'front';
          shopBubble = '';
        }
        mode = next;
        render();
        if (mode === 'shop') runWelcomeSequence();
      });
    });

    overlay.querySelectorAll<HTMLElement>('[data-wh-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        whTab = btn.dataset.whTab || 'all';
        playUiSound('tap');
        render();
      });
    });

    overlay.querySelectorAll<HTMLElement>('[data-shop-kind]').forEach((btn) => {
      btn.addEventListener('click', () => {
        shopKind = btn.dataset.shopKind || 'all';
        playUiSound('tap');
        if (mode === 'shop' && welcomeDone && shopPose === 'front') {
          shopBubble = pickShopkeeperLine('browse', shopBubble);
        }
        render();
        if (mode === 'shop') paintShopkeeper();
      });
    });

    overlay.querySelector('[data-wh-repair]')?.addEventListener('click', () => {
      const cid = opts.characterId;
      if (!cid) return;
      let msg = '';
      saveManager.mutate((d) => {
        const liv = d.aiLiving ?? living;
        const r = repairCyberHealth(liv as typeof living, cid, 'player');
        msg = r.msg;
        d.aiLiving = liv as typeof d.aiLiving;
      });
      playUiSound(msg.includes('已满') || msg.includes('无需') ? 'cancel' : 'confirm');
      opts.onChanged?.();
      render();
      toast(overlay, msg);
    });

    overlay.querySelectorAll<HTMLElement>('[data-wh-buy]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.hasAttribute('disabled')) return;
        const id = btn.dataset.whBuy!;
        let msg = '';
        let ok = false;
        saveManager.mutate((d) => {
          const liv = d.aiLiving ?? living;
          const r = buyFromCampShop(d, liv as typeof living, id, payer, {
            characterIdForCyber: opts.characterId,
          });
          msg = r.msg;
          ok = r.ok;
          d.aiLiving = liv as typeof d.aiLiving;
        });
        const fail =
          msg.includes('不足') || msg.includes('售罄') || msg.includes('无此') || !ok;
        playUiSound(fail ? 'cancel' : 'confirm');
        opts.onChanged?.();
        if (!fail) {
          const doneLine = pickShopkeeperLine('done');
          beginFetchPose(doneLine);
        }
        render();
        toast(overlay, msg);
        if (!fail) paintShopkeeper();
      });
    });

    overlay.querySelectorAll<HTMLElement>('[data-wh-sell]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.whSell!;
        let msg = '';
        saveManager.mutate((d) => {
          const liv = d.aiLiving ?? living;
          const r = sellFromWarehouse(d, liv as typeof living, id, 'player', 1);
          msg = r.msg;
          d.aiLiving = liv as typeof d.aiLiving;
        });
        playUiSound(msg.includes('没有') ? 'cancel' : 'confirm');
        opts.onChanged?.();
        render();
        toast(overlay, msg);
      });
    });

    overlay.querySelectorAll<HTMLElement>('[data-wh-eat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.whEat!;
        const eater = opts.characterId ?? 'player';
        let msg = '';
        saveManager.mutate((d) => {
          const liv = d.aiLiving ?? living;
          const r = consumeFromWarehouse(d, liv as typeof living, id, eater);
          msg = r.msg;
          d.aiLiving = liv as typeof d.aiLiving;
        });
        playUiSound(msg.includes('没有') || msg.includes('不能') ? 'cancel' : 'confirm');
        opts.onChanged?.();
        render();
        toast(overlay, msg);
      });
    });

    overlay.querySelectorAll<HTMLElement>('[data-wh-equip]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.whEquip!;
        const cid = opts.characterId;
        if (!cid) return;
        let msg = '';
        saveManager.mutate((d) => {
          const liv = d.aiLiving ?? living;
          const r = equipCyberFromWarehouse(d, liv as typeof living, id, cid, true);
          msg = r.msg;
          d.aiLiving = liv as typeof d.aiLiving;
        });
        playUiSound(msg.includes('没有') || msg.includes('只能') ? 'cancel' : 'confirm');
        opts.onChanged?.();
        render();
        toast(overlay, msg);
      });
    });

    overlay.querySelectorAll<HTMLElement>('[data-wh-place]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.whPlace!;
        let msg = '';
        saveManager.mutate((d) => {
          const liv = d.aiLiving ?? living;
          const r = placeFromWarehouse(d, liv as typeof living, id, 'room_1f_hall1');
          msg = r.msg;
          d.aiLiving = liv as typeof d.aiLiving;
        });
        playUiSound(msg.includes('不能') || msg.includes('没有') ? 'cancel' : 'confirm');
        opts.onChanged?.();
        render();
        toast(overlay, msg);
      });
    });

    overlay.querySelectorAll<HTMLElement>('[data-wh-play]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.whPlay!;
        const actor = opts.characterId ?? 'player';
        let msg = '';
        saveManager.mutate((d) => {
          const liv = d.aiLiving ?? living;
          const r = playEntertainment(d, liv as typeof living, id, actor, 'player');
          msg = r.msg;
          d.aiLiving = liv as typeof d.aiLiving;
        });
        playUiSound(msg.includes('没有') || msg.includes('不能') ? 'cancel' : 'confirm');
        opts.onChanged?.();
        render();
        toast(overlay, msg);
      });
    });
  };

  document.body.appendChild(overlay);
  playUiSound('tap');
  render();
  if (mode === 'shop') runWelcomeSequence();
}

function propRowHtml(p: CampPropDef, qty: number, characterId?: string): string {
  const eat =
    p.category === 'food' || p.tags.includes('consume')
      ? `<button class="btn btn-secondary btn-sm" type="button" data-wh-eat="${p.id}">吃</button>`
      : '';
  const equip =
    characterId && p.category === 'equip'
      ? `<button class="btn btn-primary btn-sm" type="button" data-wh-equip="${p.id}">挂载·回满</button>`
      : '';
  const place =
    p.tags.includes('place') || p.tags.includes('furniture') || p.category === 'furniture'
      ? `<button class="btn btn-secondary btn-sm" type="button" data-wh-place="${p.id}">摆放</button>`
      : '';
  const play =
    characterId &&
    (p.tags.includes('play') || p.category === 'entertain' || p.tags.includes('entertain'))
      ? `<button class="btn btn-secondary btn-sm" type="button" data-wh-play="${p.id}">娱乐</button>`
      : '';
  const sell = `<button class="btn btn-secondary btn-sm" type="button" data-wh-sell="${p.id}">卖 ${getSellPrice(p)}</button>`;
  return `<div class="camp-wh-card">
    <img src="${texUrl(p.icon)}" alt="" width="56" height="56" loading="lazy"/>
    <div class="camp-wh-meta"><b>${escapeHtml(p.nameZh)}</b> ×${qty}<br/><span class="camp-living-hint">${escapeHtml(p.look)}</span></div>
    <div class="camp-wh-actions">${equip}${place}${play}${eat}${sell}</div>
  </div>`;
}

function shopOfferRowHtml(p: CampPropDef, sold: boolean): string {
  const price = getShopPrice(p);
  const kind = shopKindLabel(shopKindForProp(p));
  if (sold) {
    return `<div class="camp-wh-card is-sold">
      <img src="${texUrl(p.icon)}" alt="" width="56" height="56" loading="lazy"/>
      <div class="camp-wh-meta"><b>${escapeHtml(p.nameZh)}</b><br/><span class="camp-living-hint">${kind} · 已售罄</span></div>
      <div class="camp-wh-actions"><button class="btn btn-secondary btn-sm" type="button" disabled>售罄</button></div>
    </div>`;
  }
  return `<div class="camp-wh-card">
    <img src="${texUrl(p.icon)}" alt="" width="56" height="56" loading="lazy"/>
    <div class="camp-wh-meta"><b>${escapeHtml(p.nameZh)}</b><br/><span class="camp-living-hint">${kind} · ${price} 锈币 · 库存1</span></div>
    <div class="camp-wh-actions"><button class="btn btn-primary btn-sm" type="button" data-wh-buy="${p.id}">买</button></div>
  </div>`;
}

function toast(overlay: HTMLElement, msg: string): void {
  const el = overlay.querySelector<HTMLElement>('[data-wh-toast]');
  if (!el) return;
  el.hidden = false;
  el.textContent = msg;
  window.setTimeout(() => {
    if (el.textContent === msg) el.hidden = true;
  }, 2400);
}
