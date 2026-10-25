import * as THREE from 'three';
import { SkillFx3D } from './SkillFx3D';

const root = document.querySelector<HTMLDivElement>('#stellar-preview');
if (!root) throw new Error('stellar preview root missing');
const previewRoot = root;

const style = document.createElement('style');
style.textContent = `
  :root { color-scheme: dark; font-family: "Rajdhani", "Noto Sans SC", system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; min-width: 320px; background: #070b14; color: #f4f1dc; }
  #stellar-preview { min-height: 100svh; display: grid; grid-template-rows: auto 1fr auto; background: radial-gradient(circle at 50% 18%, #283455 0, #0d1424 42%, #05070d 100%); }
  .stellar-head { padding: max(16px, env(safe-area-inset-top)) 18px 12px; border-bottom: 1px solid #d3aa4c55; background: #080d18cc; backdrop-filter: blur(12px); }
  .eyebrow { margin: 0 0 4px; color: #ffd45c; font-size: 11px; letter-spacing: .18em; text-transform: uppercase; }
  h1 { margin: 0; font-size: clamp(22px, 6vw, 36px); letter-spacing: .04em; }
  .copy { max-width: 760px; margin: 6px 0 0; color: #aeb7ca; font-size: 13px; line-height: 1.5; }
  #stage { position: relative; min-height: 430px; overflow: hidden; }
  #stage canvas { display: block; width: 100%; height: 100%; touch-action: none; }
  .hud { position: absolute; inset: 16px 16px auto; display: flex; justify-content: space-between; gap: 12px; pointer-events: none; }
  .chip { padding: 7px 10px; border: 1px solid #ffd45c66; background: #0b1220bb; color: #ffd45c; font-size: 12px; letter-spacing: .08em; }
  .skill-callout { position: absolute; left: 50%; top: 16%; transform: translateX(-50%); width: min(92%, 480px); text-align: center; opacity: 0; pointer-events: none; }
  .skill-callout.show { animation: banner 1.2s ease-out both; }
  .skill-callout strong { display: block; color: #ffd45c; font-size: clamp(24px, 7vw, 42px); letter-spacing: .12em; text-shadow: 0 0 18px #ffd45caa; }
  .skill-callout span { color: #fff0a8; font-size: 13px; }
  @keyframes banner { 0% { opacity: 0; transform: translate(-50%, 12px) scale(.9); } 18%, 70% { opacity: 1; transform: translate(-50%, 0) scale(1); } 100% { opacity: 0; transform: translate(-50%, -12px) scale(1.02); } }
  .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 14px 18px max(16px, env(safe-area-inset-bottom)); border-top: 1px solid #26334d; background: #080d18; }
  button { min-height: 44px; border: 1px solid #ffd45c99; background: #161e32; color: #ffe89b; padding: 0 16px; font: inherit; font-weight: 700; cursor: pointer; }
  button:active { transform: translateY(1px); background: #2b3550; }
  .note { color: #8d99b2; font-size: 12px; line-height: 1.4; }
`;
document.head.appendChild(style);

previewRoot.innerHTML = `
  <header class="stellar-head">
    <p class="eyebrow">UR · BOSS SPECIALIST · MOBILE VFX TEST</p>
    <h1>光轮裁决 / Stellar Judgment</h1>
    <p class="copy">以“锁定目标 → 空间标记 → 金色裁决柱 → 地面冲击圈”为一套完整读招。当前预览只使用低面数几何，不加载角色模型，方便先判断战斗表现和移动端负载。</p>
  </header>
  <main id="stage" aria-label="光轮裁决三维预览">
    <div class="hud"><span class="chip">UR03 · 天音</span><span class="chip">LOW PROFILE · 1.5 DPR</span></div>
    <div class="skill-callout" id="callout"><strong>光轮裁决</strong><span>目标锁定 · 天罚落点</span></div>
  </main>
  <footer class="controls">
    <button id="cast" type="button">释放光轮裁决</button>
    <button id="auto" type="button">自动循环：关</button>
    <span class="note">点击画布也可释放。技能冷却 4.5 秒；按住按钮不会重复叠加。</span>
  </footer>
`;

const stage = root.querySelector<HTMLDivElement>('#stage')!;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0b1220, 12, 34);
const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 60);
camera.position.set(0, 4.2, 8.5);
camera.lookAt(0, 1.2, -5);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(0x070b14, 1);
stage.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0x8da8d8, 0x090b12, 1.2));
const key = new THREE.DirectionalLight(0xffd76b, 1.4);
key.position.set(-4, 7, 4);
scene.add(key);

const road = new THREE.Mesh(
  new THREE.PlaneGeometry(13, 44),
  new THREE.MeshBasicMaterial({ color: 0x101a2b }),
);
road.rotation.x = -Math.PI / 2;
road.position.set(0, -0.02, -8);
scene.add(road);

for (const x of [-2.4, 0, 2.4]) {
  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(0.035, 44),
    new THREE.MeshBasicMaterial({ color: 0x40516e, transparent: true, opacity: 0.75 }),
  );
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(x, 0.01, -8);
  scene.add(lane);
}

const boss = new THREE.Group();
boss.position.set(0, 1.05, -6.4);
const bossBody = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.95, 1),
  new THREE.MeshStandardMaterial({ color: 0x343c52, emissive: 0x16192c, metalness: 0.8, roughness: 0.35 }),
);
boss.add(bossBody);
const bossRing = new THREE.Mesh(
  new THREE.TorusGeometry(1.25, 0.035, 8, 32),
  new THREE.MeshBasicMaterial({ color: 0xff704d, transparent: true, opacity: 0.72 }),
);
bossRing.rotation.x = Math.PI / 2;
boss.add(bossRing);
scene.add(boss);

const player = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.38, 1.05, 5, 12),
  new THREE.MeshStandardMaterial({ color: 0x798ca8, emissive: 0x101a2e, metalness: 0.65, roughness: 0.4 }),
);
player.position.set(0, 0.8, 2.3);
scene.add(player);

const skillFx = new SkillFx3D(scene);
let cooldown = 0;
let auto = false;
let autoTimer = 0;
let last = performance.now();

function cast(): void {
  if (cooldown > 0) return;
  cooldown = 4.5;
  skillFx.spawn('stellar_judgment', player.position.x, player.position.y, player.position.z, '#ffd54f', '#fff0a8', boss.position, 2.2);
  const callout = previewRoot.querySelector<HTMLDivElement>('#callout')!;
  callout.classList.remove('show');
  void callout.offsetWidth;
  callout.classList.add('show');
}

function resize(): void {
  const rect = stage.getBoundingClientRect();
  renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
  camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
  camera.updateProjectionMatrix();
}

root.querySelector<HTMLButtonElement>('#cast')!.addEventListener('click', cast);
root.querySelector<HTMLButtonElement>('#auto')!.addEventListener('click', () => {
  auto = !auto;
  root.querySelector<HTMLButtonElement>('#auto')!.textContent = `自动循环：${auto ? '开' : '关'}`;
});
renderer.domElement.addEventListener('pointerdown', cast);
window.addEventListener('resize', resize);
resize();

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  cooldown = Math.max(0, cooldown - dt);
  if (auto) {
    autoTimer += dt;
    if (autoTimer >= 5) {
      autoTimer = 0;
      cast();
    }
  }
  boss.rotation.y += dt * 0.45;
  bossRing.rotation.z += dt * 0.8;
  skillFx.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
