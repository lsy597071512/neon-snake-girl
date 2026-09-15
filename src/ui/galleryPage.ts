import {
  SCENE_GALLERY_CATEGORIES,
  getAlbumImages,
  getSceneGalleryCategory,
  type SceneGalleryCategory,
  type SceneGalleryImage,
} from '../data/sceneGallery';
import { texUrl } from '../utils/texUrl';
import { playUiSound } from './uiSound';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 渲染书本式场景图库主内容 */
export function renderSceneGalleryHtml(activeCategoryId: string): string {
  const cat =
    getSceneGalleryCategory(activeCategoryId) ?? SCENE_GALLERY_CATEGORIES[0];
  const album = getAlbumImages(cat);

  const toc = SCENE_GALLERY_CATEGORIES.map((c) => {
    const active = c.id === cat.id ? ' is-active' : '';
    const kind = c.kind === 'world' ? 'world' : 'region';
    return `
      <button type="button" class="gal-toc-item${active}" data-gal-cat="${c.id}" data-gal-kind="${kind}">
        <span class="gal-toc-mark" aria-hidden="true"></span>
        <span class="gal-toc-body">
          <span class="gal-toc-name">${escapeHtml(c.name)}</span>
          <span class="gal-toc-en">${escapeHtml(c.titleEn)}</span>
        </span>
        <span class="gal-toc-count">${getAlbumImages(c).length}</span>
      </button>`;
  }).join('');

  const plates = album
    .map(
      (img) => `
      <button type="button" class="gal-plate" data-gal-open="${img.id}" data-gal-src="${escapeHtml(img.src)}" aria-label="${escapeHtml(img.title)}">
        <span class="gal-plate-frame">
          <img class="gal-plate-img" src="${texUrl(img.src)}" alt="" loading="lazy" draggable="false" />
        </span>
        <span class="gal-plate-meta">
          <span class="gal-plate-title">${escapeHtml(img.title)}</span>
          ${img.caption ? `<span class="gal-plate-cap">${escapeHtml(img.caption)}</span>` : ''}
        </span>
      </button>`,
    )
    .join('');

  const placeChips = cat.places
    .map(
      (p) =>
        `<span class="gal-place-chip" title="${escapeHtml(p.blurb)}">${escapeHtml(p.name)}</span>`,
    )
    .join('');

  return `
    <section class="panel wl-sub-page gal-page" aria-label="场景图库">
      <div class="gal-book">
        <aside class="gal-spine" aria-label="图集目录">
          <div class="gal-spine-head">
            <p class="gal-kicker">SCENE CODEX</p>
            <h3 class="gal-spine-title">锈带图库</h3>
            <p class="gal-spine-sub">场景概念 · 按区域分类</p>
          </div>
          <nav class="gal-toc">${toc}</nav>
        </aside>
        <div class="gal-spread">
          <header class="gal-spread-head">
            <div class="gal-spread-titles">
              <h3 class="gal-spread-name">${escapeHtml(cat.name)}</h3>
              <span class="gal-spread-en">${escapeHtml(cat.titleEn)}</span>
            </div>
            <p class="gal-spread-blurb">${escapeHtml(cat.blurb)}</p>
            <div class="gal-place-row">${placeChips}</div>
          </header>
          <div class="gal-album${album.length === 1 ? ' gal-album--single' : ''}">
            ${plates || '<p class="gal-empty">该分类暂无横屏图集</p>'}
          </div>
          <p class="gal-footnote">竖屏概念图用于作战选图背景 · 后续将细化至区域内地点</p>
        </div>
      </div>
    </section>
  `;
}

export function openGalleryViewer(
  category: SceneGalleryCategory,
  image: SceneGalleryImage,
): void {
  const overlay = document.createElement('div');
  overlay.className = 'gal-viewer-overlay';
  overlay.dataset.galViewer = 'true';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', image.title);

  overlay.innerHTML = `
    <div class="gal-viewer-panel">
      <div class="gal-viewer-top">
        <div class="gal-viewer-titles">
          <span class="gal-viewer-cat">${escapeHtml(category.name)}</span>
          <h3 class="gal-viewer-title">${escapeHtml(image.title)}</h3>
        </div>
        <button type="button" class="btn btn-secondary" data-gal-close>关闭</button>
      </div>
      <div class="gal-viewer-stage">
        <img class="gal-viewer-img" src="${texUrl(image.src)}" alt="${escapeHtml(image.title)}" draggable="false" />
      </div>
      ${
        image.caption
          ? `<p class="gal-viewer-cap">${escapeHtml(image.caption)}</p>`
          : ''
      }
    </div>
  `;

  const close = () => {
    playUiSound('cancel');
    overlay.remove();
  };
  overlay.querySelector('[data-gal-close]')?.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).dataset.galViewer) close();
  });

  document.body.appendChild(overlay);
  playUiSound('tap');
}

export function bindGalleryPage(
  root: HTMLElement,
  opts: {
    activeCategoryId: string;
    onSelectCategory: (id: string) => void;
  },
): void {
  root.querySelectorAll('[data-gal-cat]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = (el as HTMLElement).dataset.galCat;
      if (!id || id === opts.activeCategoryId) return;
      playUiSound('tap');
      opts.onSelectCategory(id);
    });
  });

  const cat =
    getSceneGalleryCategory(opts.activeCategoryId) ?? SCENE_GALLERY_CATEGORIES[0];
  root.querySelectorAll('[data-gal-open]').forEach((el) => {
    el.addEventListener('click', () => {
      const imgId = (el as HTMLElement).dataset.galOpen;
      const img = getAlbumImages(cat).find((i) => i.id === imgId);
      if (!img) return;
      openGalleryViewer(cat, img);
    });
  });
}
