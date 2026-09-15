/**
 * 营地平面图：全屏楼层 + 角色头像沿导航网格实时移动
 * 横屏地图在竖屏中可拖拽平移（跟手：手指上滑→地图上移）
 */
import { CHARACTER_MAP } from '../data/characters';
import { CAMP_FLOOR_MAP_IMAGE, CAMP_MAP_PIXEL_SIZE, CAMP_ROOM_MAP, type CampFloor } from '../data/campLayout';
import {
  ensureAgentsForOwned,
  listAgentsOnFloor,
  type CampAgentState,
} from '../ai/campAgents';
import { getFocusRoomIds } from '../ai/campEvents';
import { resolvePresence } from '../ai/livingState';
import type { AiLivingSave } from '../ai/types';
import { getCharAvatarSrc } from './uiAssets';
import { texUrl } from '../utils/texUrl';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function ensureCampMapAgents(living: AiLivingSave, ownedIds: string[]): void {
  ensureAgentsForOwned(ownedIds, (id) => resolvePresence(id, living).roomId);
}

function buildFocusMarkers(living: AiLivingSave, floor: CampFloor): string {
  const focusIds = getFocusRoomIds(living);
  return focusIds
    .map((roomId) => {
      const room = CAMP_ROOM_MAP[roomId];
      if (!room || room.floor !== floor) return '';
      return `<div class="camp-event-focus" style="left:${room.mapX}%;top:${room.mapY}%" title="事件焦点：${escapeHtml(room.label)}"></div>`;
    })
    .join('');
}

function buildPinHtml(agents: CampAgentState[], focusedId: string | null): string {
  const slotCount: Record<string, number> = {};
  return agents
    .map((a) => {
      const key = `${Math.round(a.x)}:${Math.round(a.y)}`;
      const n = slotCount[key] ?? 0;
      slotCount[key] = n + 1;
      const ox = (n % 3) * 2.4 - (n > 0 ? 2.4 : 0);
      const oy = Math.floor(n / 3) * 2.8;
      const x = Math.min(97, Math.max(3, a.x + ox));
      const y = Math.min(97, Math.max(3, a.y + oy));
      const avatar = getCharAvatarSrc(a.characterId);
      const name = CHARACTER_MAP[a.characterId]?.name ?? a.characterId;
      const room = CAMP_ROOM_MAP[a.roomId];
      const roomLabel = room ? room.label : a.roomId;
      const active = focusedId === a.characterId ? ' is-focused' : '';
      const moving = a.moving ? ' is-moving' : '';
      const img = avatar
        ? `<img class="camp-map-avatar-img" src="${texUrl(avatar)}" alt="" />`
        : `<span class="camp-map-avatar-fallback">${escapeHtml(name.slice(0, 1))}</span>`;
      return `
        <button type="button" class="camp-map-pin${active}${moving}" style="left:${x}%;top:${y}%"
          data-camp-pin="${a.characterId}" data-camp-room="${a.roomId}"
          title="${escapeHtml(name)} · ${escapeHtml(a.behavior || roomLabel)}" aria-label="${escapeHtml(name)}">
          ${img}
          <span class="camp-map-pin-name">${escapeHtml(name)}</span>
          <span class="camp-map-pin-act">${escapeHtml(a.behavior || roomLabel)}</span>
        </button>`;
    })
    .join('');
}

export function renderCampFloorMapHtml(
  living: AiLivingSave,
  ownedIds: string[],
  floor: CampFloor,
  focusedId: string | null,
): string {
  ensureCampMapAgents(living, ownedIds);
  const mapSrc = texUrl(CAMP_FLOOR_MAP_IMAGE[floor]);
  const agents = listAgentsOnFloor(floor);
  const markers = buildPinHtml(agents, focusedId);
  const focusMarks = buildFocusMarkers(living, floor);

  return `
    <div class="camp-floor-map" data-camp-floor-map data-floor="${floor}">
      <div class="camp-floor-tabs">
        <button type="button" class="camp-floor-tab${floor === 1 ? ' is-on' : ''}" data-camp-floor="1">一楼</button>
        <button type="button" class="camp-floor-tab${floor === 2 ? ' is-on' : ''}" data-camp-floor="2">二楼</button>
        <button type="button" class="camp-floor-tab${floor === -1 ? ' is-on' : ''}" data-camp-floor="-1">负一楼</button>
      </div>
      <div class="camp-floor-stage" data-camp-floor-viewport>
        <div class="camp-floor-pan" data-camp-floor-pan>
          <img class="camp-floor-bg" src="${mapSrc}" alt="营地${floor === -1 ? '负一' : floor}楼平面" draggable="false" data-camp-floor-bg />
          <div class="camp-floor-event-layer">${focusMarks}</div>
          <div class="camp-floor-pins" data-camp-pins>${markers || '<p class="camp-floor-empty">这层暂时没人</p>'}</div>
        </div>
      </div>
      <p class="camp-floor-hint">拖拽查看全图 · 点击头像对话</p>
    </div>`;
}

export function resolveFocusSceneForCharacter(
  characterId: string,
  living: AiLivingSave,
): { sceneId: string; roomId: string; behavior: string } {
  const p = resolvePresence(characterId, living);
  return { sceneId: p.locationId, roomId: p.roomId, behavior: p.behavior };
}

/** 刷新图钉位置（运动帧只改坐标） */
export function refreshCampFloorMapPins(
  root: ParentNode,
  living: AiLivingSave,
  ownedIds: string[],
  floor: CampFloor,
  focusedId: string | null,
  ensureAgents = false,
): void {
  if (ensureAgents) ensureCampMapAgents(living, ownedIds);

  const pinsHost = root.querySelector('[data-camp-pins]') ?? root.querySelector('.camp-floor-pins');
  if (!pinsHost) return;

  const agents = listAgentsOnFloor(floor);
  const existing = new Map<string, HTMLElement>();
  pinsHost.querySelectorAll<HTMLElement>('[data-camp-pin]').forEach((el) => {
    const id = el.dataset.campPin;
    if (id) existing.set(id, el);
  });

  if (existing.size && agents.length && agents.every((a) => existing.has(a.characterId))) {
    const slotCount: Record<string, number> = {};
    for (const a of agents) {
      const el = existing.get(a.characterId)!;
      const key = `${Math.round(a.x)}:${Math.round(a.y)}`;
      const n = slotCount[key] ?? 0;
      slotCount[key] = n + 1;
      const ox = (n % 3) * 2.4 - (n > 0 ? 2.4 : 0);
      const oy = Math.floor(n / 3) * 2.8;
      const x = Math.min(97, Math.max(3, a.x + ox));
      const y = Math.min(97, Math.max(3, a.y + oy));
      el.style.left = `${x}%`;
      el.style.top = `${y}%`;
      el.style.display = '';
      el.dataset.campRoom = a.roomId;
      el.classList.toggle('is-focused', focusedId === a.characterId);
      el.classList.toggle('is-moving', a.moving);
      const act = el.querySelector('.camp-map-pin-act');
      if (act) act.textContent = a.behavior || CAMP_ROOM_MAP[a.roomId]?.label || '';
    }
    for (const [id, el] of existing) {
      if (!agents.some((a) => a.characterId === id)) el.style.display = 'none';
    }
    return;
  }

  pinsHost.innerHTML = buildPinHtml(agents, focusedId) || '<p class="camp-floor-empty">这层暂时没人</p>';
}

type PanState = {
  x: number;
  y: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  dragging: boolean;
  moved: boolean;
  lastX: number;
  lastY: number;
  pointerId: number | null;
};

const panByViewport = new WeakMap<HTMLElement, PanState>();

function applyPanTransform(pan: HTMLElement, st: PanState): void {
  pan.style.transform = `translate(${st.x}px, ${st.y}px)`;
}

function clampPan(st: PanState): void {
  st.x = Math.min(st.maxX, Math.max(st.minX, st.x));
  st.y = Math.min(st.maxY, Math.max(st.minY, st.y));
}

/** 按视口「cover」放大横屏图，并算出可平移范围；默认居中 */
function layoutCampMapPan(viewport: HTMLElement, pan: HTMLElement, img: HTMLImageElement): void {
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  if (vw < 8 || vh < 8) return;

  const iw = img.naturalWidth || CAMP_MAP_PIXEL_SIZE.w;
  const ih = img.naturalHeight || CAMP_MAP_PIXEL_SIZE.h;
  const cover = Math.max(vw / iw, vh / ih);
  // 略放大，保证横竖都能拖一点
  const scale = cover * 1.08;
  const pw = iw * scale;
  const ph = ih * scale;
  pan.style.width = `${pw}px`;
  pan.style.height = `${ph}px`;
  img.style.width = '100%';
  img.style.height = '100%';

  const minX = Math.min(0, vw - pw);
  const minY = Math.min(0, vh - ph);
  const maxX = 0;
  const maxY = 0;
  const prev = panByViewport.get(viewport);
  const st: PanState = {
    x: prev && !prev.dragging ? prev.x : (vw - pw) / 2,
    y: prev && !prev.dragging ? prev.y : (vh - ph) / 2,
    minX,
    maxX,
    minY,
    maxY,
    dragging: prev?.dragging ?? false,
    moved: false,
    lastX: 0,
    lastY: 0,
    pointerId: prev?.pointerId ?? null,
  };
  clampPan(st);
  panByViewport.set(viewport, st);
  applyPanTransform(pan, st);
}

/**
 * 绑定营地地图拖拽：跟手平移（手指往哪拖，地图往哪走）
 */
export function bindCampFloorMapPan(root: ParentNode): void {
  const viewport = root.querySelector<HTMLElement>('[data-camp-floor-viewport]');
  const pan = root.querySelector<HTMLElement>('[data-camp-floor-pan]');
  const img = root.querySelector<HTMLImageElement>('[data-camp-floor-bg]');
  if (!viewport || !pan || !img) return;
  if (viewport.dataset.panBound === '1') {
    layoutCampMapPan(viewport, pan, img);
    return;
  }
  viewport.dataset.panBound = '1';

  const relayout = () => layoutCampMapPan(viewport, pan, img);
  if (img.complete && img.naturalWidth) relayout();
  else img.addEventListener('load', relayout, { once: true });
  window.addEventListener('resize', relayout);

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    const st = panByViewport.get(viewport);
    if (!st) return;
    st.dragging = true;
    st.moved = false;
    st.lastX = e.clientX;
    st.lastY = e.clientY;
    st.pointerId = e.pointerId;
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add('is-panning');
  });

  viewport.addEventListener('pointermove', (e) => {
    const st = panByViewport.get(viewport);
    if (!st?.dragging || st.pointerId !== e.pointerId) return;
    const dx = e.clientX - st.lastX;
    const dy = e.clientY - st.lastY;
    st.lastX = e.clientX;
    st.lastY = e.clientY;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) st.moved = true;
    // 跟手：手指右移 → 地图右移；手指上移 → 地图上移
    st.x += dx;
    st.y += dy;
    clampPan(st);
    applyPanTransform(pan, st);
  });

  const endDrag = (e: PointerEvent) => {
    const st = panByViewport.get(viewport);
    if (!st || st.pointerId !== e.pointerId) return;
    st.dragging = false;
    st.pointerId = null;
    viewport.classList.remove('is-panning');
    try {
      viewport.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);

  // 拖过一段距离后吞掉 click，避免误点头像
  viewport.addEventListener(
    'click',
    (e) => {
      const st = panByViewport.get(viewport);
      if (st?.moved) {
        e.preventDefault();
        e.stopPropagation();
        st.moved = false;
      }
    },
    true,
  );

  // 防止图片原生拖拽
  img.addEventListener('dragstart', (e) => e.preventDefault());
}
