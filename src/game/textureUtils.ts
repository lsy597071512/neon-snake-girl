import * as THREE from 'three';
import type { CombatTheme } from './combatThemes';

export function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createEmojiTexture(
  emoji: string,
  bg: string,
  border: string,
  size = 256,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const r = size * 0.12;
  ctx.fillStyle = bg;
  ctx.strokeStyle = border;
  ctx.lineWidth = size * 0.04;
  roundRect(ctx, size * 0.08, size * 0.08, size * 0.84, size * 0.84, r);
  ctx.fill();
  ctx.stroke();

  ctx.font = `${size * 0.52}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + size * 0.02);

  return canvasTexture(canvas);
}

export function createGlowTexture(color: string, intensity = 0.8): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // P2+：去除中心纯白色（之前用 rgba(255,255,255,*) 是爆闪主源，additive 叠加后必白）。
  // 中心用 color 本色 + 半透，过渡到透明 —— 任意叠加都不可能突破 color 通道上限。
  grd.addColorStop(0, color);
  grd.addColorStop(0.5, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  return canvasTexture(canvas);
}

/** P2：环波贴图（自下而上衰减，沿径向集中，靠 scaleY 控张合） */
export function createShockRingTexture(color: string): THREE.CanvasTexture {
  const w = 256;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  // 上下渐变 alpha（中间厚、上下尖）
  // P2+：去掉环波中央白色（之前是 rgba(255,255,255,1) 居中 + color 两侧，
  // additive 下就是白色爆闪带）。改用 color 一致，保持环波是单色发光带。
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.45, color);
  grad.addColorStop(0.55, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const hg = ctx.createLinearGradient(0, 0, w, 0);
  hg.addColorStop(0, 'rgba(0,0,0,0)');
  hg.addColorStop(0.15, 'rgba(255,255,255,1)');
  hg.addColorStop(0.85, 'rgba(255,255,255,1)');
  hg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = hg;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  const tex = canvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** P2：能量弧线（沿径向，朝向相机的椭圆环）—— 复用 glow 但旋转/拉长 */
export function createEnergyArcTexture(color: string): THREE.CanvasTexture {
  const w = 128;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = 'rgba(0,0,0,0)';
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 三道由内向外偏移的弧（饱和叠加）
  for (let i = 0; i < 3; i++) {
    const r = w * (0.32 + i * 0.08);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, Math.PI * 0.15, Math.PI * 0.85);
    ctx.lineWidth = 4 + (2 - i) * 1.5;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  return canvasTexture(canvas);
}

/** P2：竖直拖尾（沿 -Z 推进时拉长形成尾迹） */
export function createTrailTexture(color: string): THREE.CanvasTexture {
  const w = 32;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const grd = ctx.createLinearGradient(0, h, 0, 0);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(0.4, color);
  // P2+：拖尾头部不再用纯白点（之前是 rgba(255,255,255,0.95) 圆点）。
  // 改用 color 顶端 + 半透，保持色调一致。
  grd.addColorStop(1, color);
  ctx.fillStyle = grd;
  ctx.fillRect(w * 0.22, 0, w * 0.56, h);
  // 头点（仍画一个圆点，但用 color 而非白色）
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.08, w * 0.18, 0, Math.PI * 2);
  ctx.fill();
  return canvasTexture(canvas);
}

/** P2：方形碎片（贴地面爆炸用） */
export function createShardTexture(color: string): THREE.CanvasTexture {
  const s = 64;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.beginPath();
  // 不规则四边形模拟碎片
  ctx.moveTo(s * 0.5, s * 0.05);
  ctx.lineTo(s * 0.92, s * 0.4);
  ctx.lineTo(s * 0.78, s * 0.92);
  ctx.lineTo(s * 0.18, s * 0.82);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  return canvasTexture(canvas);
}

/** P2：六角冰晶 */
export function createFrostTexture(color: string): THREE.CanvasTexture {
  const s = 96;
  const canvas = document.createElement('canvas');
  canvas.width = s;
  canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(s / 2, s / 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * s * 0.45, Math.sin(a) * s * 0.45);
    ctx.stroke();
    // 支枝
    const mx = Math.cos(a) * s * 0.3;
    const my = Math.sin(a) * s * 0.3;
    const ax = a + Math.PI / 6;
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.lineTo(mx + Math.cos(ax) * s * 0.12, my + Math.sin(ax) * s * 0.12);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  return canvasTexture(canvas);
}

/** P2：竖向闪电（从空中劈下的能量线） */
export function createLightningTexture(color: string): THREE.CanvasTexture {
  const w = 24;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  // P2+：去内核白线。之前内核是 rgba(255,255,255,*) 居中，additive 必白爆闪。
  // 改为用 color + 较粗线宽 + 阴影模糊保持"亮"的观感。
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(w * 0.5, h);
  let x = w * 0.5;
  for (let y = h; y > 8; y -= 16) {
    x += (Math.random() - 0.5) * 6;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  return canvasTexture(canvas);
}

export function createSparkTexture(color: string): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.22, 0, Math.PI * 2);
  ctx.fill();
  return canvasTexture(canvas);
}

/** 贴地弹幕平面：宽（车道方向）× 长（沿 -Z 前进） */
export const COMBAT_BULLET_PLANE_WIDTH = 0.22;
export const COMBAT_BULLET_PLANE_LENGTH = 1.15;

let bulletTexture: THREE.CanvasTexture | null = null;
let bulletPlaneGeometry: THREE.PlaneGeometry | null = null;
let bulletPlaneMaterial: THREE.MeshBasicMaterial | null = null;

export function getBulletTexture(): THREE.CanvasTexture {
  if (bulletTexture) return bulletTexture;
  const w = 36;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const grd = ctx.createLinearGradient(0, h, 0, 0);
  grd.addColorStop(0, 'rgba(0, 80, 120, 0)');
  grd.addColorStop(0.25, 'rgba(46, 203, 255, 0.45)');
  grd.addColorStop(0.65, 'rgba(120, 240, 255, 0.92)');
  grd.addColorStop(1, 'rgba(255, 214, 176, 1)');
  ctx.fillStyle = grd;
  ctx.fillRect(w * 0.22, h * 0.08, w * 0.56, h * 0.84);
  ctx.fillStyle = 'rgba(255,214,176,0.95)';
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.08, w * 0.18, 0, Math.PI * 2);
  ctx.fill();
  bulletTexture = canvasTexture(canvas);
  return bulletTexture;
}

export function getBulletPlaneGeometry(): THREE.PlaneGeometry {
  if (!bulletPlaneGeometry) {
    bulletPlaneGeometry = new THREE.PlaneGeometry(
      COMBAT_BULLET_PLANE_WIDTH,
      COMBAT_BULLET_PLANE_LENGTH,
    );
    bulletPlaneGeometry.translate(0, COMBAT_BULLET_PLANE_LENGTH / 2, 0);
  }
  return bulletPlaneGeometry;
}

export function getBulletPlaneMaterial(): THREE.MeshBasicMaterial {
  if (!bulletPlaneMaterial) {
    bulletPlaneMaterial = new THREE.MeshBasicMaterial({
      map: getBulletTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.95,
      side: THREE.DoubleSide,
    });
  }
  return bulletPlaneMaterial;
}

/** 贴地平面弹幕：绕 X -90° 后本地 +Y 对齐世界 -Z（沿道路向前） */
export function createCombatBulletMesh(): THREE.Mesh {
  const mesh = new THREE.Mesh(getBulletPlaneGeometry(), getBulletPlaneMaterial());
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

export function resetBulletTextureCache(): void {
  bulletTexture?.dispose();
  bulletTexture = null;
  bulletPlaneGeometry?.dispose();
  bulletPlaneGeometry = null;
  bulletPlaneMaterial?.dispose();
  bulletPlaneMaterial = null;
}

export type CombatEnemyKind = 'drone' | 'boss' | 'door' | 'barrel';

const enemyTextures = new Map<CombatEnemyKind, THREE.CanvasTexture>();

export function getCombatEnemyTexture(kind: CombatEnemyKind): THREE.CanvasTexture {
  const cached = enemyTextures.get(kind);
  if (cached) return cached;

  const size = kind === 'boss' ? 320 : 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  if (kind === 'drone') {
    ctx.fillStyle = '#1a2838';
    roundRect(ctx, size * 0.12, size * 0.18, size * 0.76, size * 0.72, size * 0.1);
    ctx.fill();
    ctx.strokeStyle = '#5a7088';
    ctx.lineWidth = size * 0.03;
    ctx.stroke();
    ctx.fillStyle = '#ff4757';
    ctx.beginPath();
    ctx.arc(size * 0.35, size * 0.42, size * 0.08, 0, Math.PI * 2);
    ctx.arc(size * 0.65, size * 0.42, size * 0.08, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2a3848';
    for (const x of [0.22, 0.78]) {
      ctx.fillRect(size * x, size * 0.55, size * 0.12, size * 0.28);
    }
    ctx.strokeStyle = '#2ecbff';
    ctx.lineWidth = size * 0.02;
    ctx.beginPath();
    ctx.moveTo(size * 0.2, size * 0.3);
    ctx.lineTo(size * 0.5, size * 0.15);
    ctx.lineTo(size * 0.8, size * 0.3);
    ctx.stroke();
  } else if (kind === 'boss') {
    const grd = ctx.createLinearGradient(0, 0, 0, size);
    grd.addColorStop(0, '#501818');
    grd.addColorStop(1, '#280808');
    ctx.fillStyle = grd;
    roundRect(ctx, size * 0.08, size * 0.1, size * 0.84, size * 0.85, size * 0.12);
    ctx.fill();
    ctx.strokeStyle = '#ff4757';
    ctx.lineWidth = size * 0.04;
    ctx.stroke();
    ctx.fillStyle = '#ff2240';
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.38, size * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff8840';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(size * 0.5 + Math.cos(a) * size * 0.28, size * 0.55 + Math.sin(a) * size * 0.2, size * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'door') {
    ctx.fillStyle = '#302050';
    roundRect(ctx, size * 0.15, size * 0.12, size * 0.7, size * 0.78, size * 0.08);
    ctx.fill();
    ctx.strokeStyle = '#b57dff';
    ctx.lineWidth = size * 0.04;
    ctx.stroke();
    ctx.fillStyle = '#8860cc';
    ctx.font = `bold ${size * 0.22}px Orbitron, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('GATE', size / 2, size * 0.55);
  } else {
    ctx.fillStyle = '#402818';
    roundRect(ctx, size * 0.2, size * 0.35, size * 0.6, size * 0.5, size * 0.06);
    ctx.fill();
    ctx.strokeStyle = '#ff8c42';
    ctx.lineWidth = size * 0.035;
    ctx.stroke();
    ctx.fillStyle = '#ff6622';
    ctx.beginPath();
    ctx.arc(size * 0.5, size * 0.42, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = canvasTexture(canvas);
  enemyTextures.set(kind, tex);
  return tex;
}

export function createSkyGradientTexture(top: string, bottom: string): THREE.CanvasTexture {
  const w = 4;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, top);
  grd.addColorStop(1, bottom);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  const tex = canvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function createSilhouetteTexture(theme: CombatTheme): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(20, 24, 32, 0.55)';
  for (let i = 0; i < 18; i++) {
    const x = (i % 6) * (w / 6) + Math.random() * 40;
    const bh = 40 + Math.random() * 80;
    ctx.fillRect(x, h - bh, 30 + Math.random() * 50, bh);
  }
  ctx.fillStyle = theme.neonLane.replace('0.55', '0.15').replace('0.5', '0.15');
  ctx.fillRect(0, h - 8, w, 8);
  return canvasTexture(canvas);
}

export function createRoadTexture(theme?: Pick<CombatTheme, 'neonLane' | 'neonCenter'>): THREE.CanvasTexture {
  const w = 512;
  const h = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#32383e';
  ctx.fillRect(0, 0, w, h);

  for (let i = 0; i < 600; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const len = 4 + Math.random() * 18;
    ctx.strokeStyle = `rgba(20, 22, 26, ${0.12 + Math.random() * 0.28})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * len, y + len * 0.6);
    ctx.stroke();
  }

  const laneNeon = theme?.neonLane ?? 'rgba(0, 229, 255, 0.55)';
  const centerNeon = theme?.neonCenter ?? 'rgba(255, 255, 255, 0.9)';

  ctx.strokeStyle = laneNeon;
  ctx.lineWidth = 4;
  ctx.shadowColor = laneNeon;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(w * 0.18, 0);
  ctx.lineTo(w * 0.18, h);
  ctx.moveTo(w * 0.82, 0);
  ctx.lineTo(w * 0.82, h);
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = centerNeon;
  ctx.lineWidth = 5;
  ctx.setLineDash([28, 22]);
  ctx.shadowColor = centerNeon;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;

  const tex = canvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 8);
  return tex;
}

/** 战斗场景路面贴图（二方连续） */
export const COMBAT_ROAD_TEXTURE = './tex/changjing/road01.png';

const COMBAT_FLOOR_WIDTH = 16;
const COMBAT_FLOOR_LENGTH = 1000;
/** 路面贴图沿行进方向每多少米重复一次（可调试） */
export const COMBAT_ROAD_METERS_PER_TILE = 16;

const DEFAULT_ROAD_TEXTURE_ASPECT = 512 / 2048;

export function getRoadTextureAspect(tex: THREE.Texture): number {
  const img = tex.image as { width?: number; height?: number } | undefined;
  if (img?.width && img?.height) return img.width / img.height;
  return DEFAULT_ROAD_TEXTURE_ASPECT;
}

/** dimian02 等宽地面：UV 按世界米制写入，避免 Plane 默认 0-1 UV 在宽 mesh 上拉伸 */
export function applyWorldSpaceRoadUvs(
  geometry: THREE.BufferGeometry,
  metersPerTile = COMBAT_ROAD_METERS_PER_TILE,
  texAspect = DEFAULT_ROAD_TEXTURE_ASPECT,
): void {
  const pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!pos || !uv) return;

  const tileAcross = metersPerTile * texAspect;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const ly = pos.getY(i);
    // PlaneGeometry 本地 X/Y → 绕 X 轴 -90° 后对应世界 X / -Z
    uv.setXY(i, lx / tileAcross, ly / metersPerTile);
  }
  uv.needsUpdate = true;
}

export function configureCombatRoadTextureWorldSpace(tex: THREE.Texture): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.repeat.set(1, 1);
  tex.needsUpdate = true;
}

export function configureCombatRoadTexture(
  tex: THREE.Texture,
  metersPerTile = COMBAT_ROAD_METERS_PER_TILE,
  floorWidth = COMBAT_FLOOR_WIDTH,
  floorLength = COMBAT_FLOOR_LENGTH,
): void {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;

  const img = tex.image as { width?: number; height?: number } | undefined;
  if (img?.width && img?.height) {
    const aspect = img.width / img.height;
    const repeatAlongRoad = floorLength / metersPerTile;
    const repeatAcrossRoad = floorWidth / (metersPerTile * aspect);
    tex.repeat.set(repeatAcrossRoad, repeatAlongRoad);
  } else {
    tex.repeat.set(1, floorLength / metersPerTile);
  }
  tex.needsUpdate = true;
}

export function createRustMetalTexture(seed = 1): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#8a4a28';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 600; i++) {
    const x = (Math.sin(i * seed * 13.7) * 0.5 + 0.5) * size;
    const y = (Math.cos(i * seed * 7.3) * 0.5 + 0.5) * size;
    ctx.fillStyle = `rgba(${80 + (i % 40)}, ${35 + (i % 25)}, ${15 + (i % 15)}, ${0.08 + (i % 10) / 40})`;
    ctx.fillRect(x, y, 2 + (i % 6), 2 + (i % 4));
  }

  ctx.strokeStyle = 'rgba(180, 90, 40, 0.25)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    ctx.moveTo(0, i * 32);
    ctx.lineTo(size, i * 32 + 10);
    ctx.stroke();
  }

  const tex = canvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 2);
  return tex;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** 从参考图底部裁切路面区域，用于与 vista 衔接 */
export function extractRoadFromReference(img: HTMLImageElement): THREE.CanvasTexture | null {
  if (!img.width || !img.height) return null;
  const canvas = document.createElement('canvas');
  const w = 512;
  const h = 512;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const srcH = Math.floor(img.height * 0.42);
  const srcY = img.height - srcH;
  ctx.drawImage(img, 0, srcY, img.width, srcH, 0, 0, w, h);
  return canvasTexture(canvas);
}
