import * as THREE from 'three';
import type { CharacterSkillId } from '../core/skillEffects';

/**
 * P2+：治本常量——颜色通道上限。
 * SkillFx3D 全部使用 MeshBasicMaterial + AdditiveBlending + 大 opacity（0.85~1），
 * 任意 RGB 通道 ≥ 1.0 在 additive 叠加下都会把屏幕推成白色爆闪。
 * 此处把传入 color/accent 一律压到 ≤ 0.85，从源头杜绝技能特效白色爆闪。
 */
const FX_COLOR_CAP = 0.85;

/**
 * 角色技能 3D 几何包装层
 *
 * 之前所有技能特效都是 2D Sprite（`spawnSkillBurst / spawnLightPillar / spawnImpactSparks` …），
 * 俯视角下就是"贴纸"，缺乏空间立体感——尤其 `frost / pierce / shield / judgment / pulse`
 * 这种"应该围绕角色身体出现"的几何语义，平面贴图完全看不出来。
 *
 * 本模块用真正的 3D Mesh（CylinderGeometry / TorusGeometry / SphereGeometry / ConeGeometry），
 * 给每个 shapeKind 提供"角色专属外壳"，与 Sprite 层并行渲染，透明叠加。
 *
 * - 不替代 VfxPool 的 Sprite 主光效（那是打基础），只在其外再加一层**几何感**包装
 * - 全部 `MeshBasicMaterial + AdditiveBlending + depthWrite=false`，零光照开销，移动端友好
 * - 自动管理生命周期：到时间自动 `dispose + remove`
 */

export type SkillShapeKind =
  | 'frost'
  | 'spark'
  | 'pierce'
  | 'rain'
  | 'shield'
  | 'judgment'
  | 'pulse';

interface ActiveShell {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  materials: THREE.MeshBasicMaterial[];
  life: number;
  maxLife: number;
  /** 每秒角速度（弧度）。绕 Y 轴旋转展示 */
  spin: number;
  /**
   * 由 spawn 时计算的"基准缩放倍率"（referenceHeight/2.2 × CASTER_FX_SIZE_MUL）。
   * update 每帧 group.scale = baseScale × popScale × shrink，避免被弹出/淡出动画覆盖掉。
   */
  baseScale: number;
  /** 缩放从 0 弹出到 1 的速度系数 */
  popIn: number;
  /**
   * 跟随回调（可选）：每帧调用，返回当前世界坐标。
   * 用于让特效跟着施法角色/目标移动。返回 null/false 表示本帧不更新位置。
   */
  follow?: () => { x: number; y: number; z: number } | null | false;
  /**
   * spawn 时的位置（follow 不调用或返回 null 时回退到 group.position，由 spawn 时已经 set）。
   * 可选：旧版 spawn 没设；但 spawn 入口会补上，保持向后兼容。
   */
  origin?: { x: number; y: number; z: number };
  /** 不透明度上限（默认 0.42 防爆闪；裁决 0.7） */
  maxOpacity?: number;
  /** 直线速度（风刃横扫等需要位移的模型，米/秒） */
  vel?: { x: number; y: number; z: number };
}

export class SkillFx3D {
  private readonly scene: THREE.Scene;
  private readonly active: ActiveShell[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** 角色特效设计时的"标准身高"参考值（单位：世界坐标） */
  private static readonly REFERENCE_HEIGHT = 2.2;

  /**
   * 主入口：根据技能 ID 触发对应的 3D 包装。
   * @param referenceHeight 施法角色在场景中的真实渲染身高（米）。特效整体 group 会按
   *   `referenceHeight / 2.2` 缩放，确保任何体型角色下特效大小都"贴合角色"。
   *   不传则用 fallback 2.2。
   */
  /**
   * 角色特效整体尺寸系数：用于在"贴角色"基础上做整体缩放。
   * P2 微调：将作用于角色身上的特效再缩约 50%（用户要求）。
   */
  /** CASTER_FX_SIZE_MUL：贴角色特效的整体倍率（用户二次缩小反馈）。
   *  此前为 0.5，被 update 每帧覆盖不生效；本次再 ×1/3 → 0.167 ≈ 缩小到 1/6。 */
  private static readonly CASTER_FX_SIZE_MUL = 0.5 * (1 / 3);

  spawn(
    skillId: CharacterSkillId,
    x: number,
    y: number,
    z: number,
    color: string,
    accent: string,
    target?: { x: number; y: number; z: number },
    referenceHeight: number = SkillFx3D.REFERENCE_HEIGHT,
    follow?: () => { x: number; y: number; z: number } | null | false,
  ): void {
    // 只恢复 UR 光轮裁决：它是单目标、短生命周期的“天罚落点”，
    // 其余技能继续保持轻量 2D 反馈，避免移动端同时堆叠多个几何壳。
    if (skillId !== 'stellar_judgment') return;
    const scale = Math.min(1.1, Math.max(0.72, referenceHeight / SkillFx3D.REFERENCE_HEIGHT)) * 1.44;
    this.spawnJudgmentShell(x, y, z, color, accent, target, scale);
    const active = this.active[this.active.length - 1];
    if (active && follow) active.follow = follow;
  }

  /** 每帧驱动所有活动 shell 的生命周期。Combat3D 在 update() 调用一次即可 */
  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      a.life += dt;
      const t = Math.min(1, a.life / a.maxLife);

      // 弹出动画：前 20% 从 0 弹出到 1.0；总倍率 = baseScale × popScale × shrink
      const popT = Math.min(1, a.life / (a.maxLife * 0.2));
      const popScale = popT < 1 ? easeOutBack(popT) : 1;
      a.group.scale.setScalar(a.baseScale * popScale * (1 - t * 0.1));

      // 跟随施法者/目标：每帧同步 group.position。
      // 取消 "spawn 一次就钉死在出生点" 的旧行为，让特效跟着角色移动一起跑。
      if (a.follow) {
        const p = a.follow();
        if (p) {
          a.group.position.set(p.x, p.y, p.z);
        }
      }

      // 直线位移（风刃横扫等）
      if (a.vel) {
        a.group.position.x += a.vel.x * dt;
        a.group.position.y += a.vel.y * dt;
        a.group.position.z += a.vel.z * dt;
      }

      // 旋转
      if (a.spin !== 0) {
        a.group.rotation.y += a.spin * dt;
      }

      // 透明度曲线（消除爆闪）：
      //   前 25%  从 0 缓升到上限
      //   25%~60% 维持上限
      //   60%~100% 平滑淡出到 0
      // 整体封顶 MAX_OPACITY，且不开启 toneMapped（避免 sRGB 重建把 0.45 提升成白色）。
      // 真正修复"白色爆闪"靠这两点 + 全程不让任何材质 opacity 越过封顶。
      const MAX_OPACITY = a.maxOpacity ?? 0.42;
      let env: number;
      if (t < 0.25) {
        env = t / 0.25; // 0 → 1
      } else if (t < 0.6) {
        env = 1;
      } else {
        env = 1 - (t - 0.6) / (1 - 0.6); // 1 → 0
      }
      const opacity = env * MAX_OPACITY;
      for (const m of a.materials) {
        m.opacity = opacity;
        m.toneMapped = false;
      }

      if (a.life >= a.maxLife) {
        for (const m of a.meshes) {
          this.scene.remove(m);
          m.geometry.dispose();
        }
        for (const mat of a.materials) {
          mat.dispose();
        }
        this.active.splice(i, 1);
      }
    }
  }

  /** 关卡结束 / 切场景时清理所有进行中的 shell */
  dispose(): void {
    for (const a of this.active) {
      for (const m of a.meshes) {
        this.scene.remove(m);
        m.geometry.dispose();
      }
      for (const mat of a.materials) {
        mat.dispose();
      }
    }
    this.active.length = 0;
  }

  // ============== 7 种 shapeKind 几何包装 ==============

  /**
   * frost（夜爪撕裂）：双层套筒——外层冰蓝色玻璃柱 + 内层白色冰锥（冰霜向上凝结）
   */
  private spawnFrostShell(x: number, y: number, z: number, color: string, accent: string, scale = 1): void {
    // 基准：以角色身高 = 1 为设计参考（外筒半径 0.55、总高 1.6）；scale 由 referenceHeight 放大
    const g = new THREE.Group();
    g.position.set(x, y, z);
    // 外层套筒：略宽、半透（直径≈角色 1.1×）
    const outerMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.4, 24, 1, true), outerMat);
    outer.position.y = 0.7;
    // 内层套筒：白色高亮、稍高
    const innerMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.7, 16, 1, true), innerMat);
    inner.position.y = 0.85;
    // 顶冠：冰锥（圆锥朝上）
    const capMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.55, 16), capMat);
    cap.position.y = 1.95;
    // 底环：发光环（薄圈）
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.03, 8, 32), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;

    [outer, inner, cap, ring].forEach((m) => g.add(m));
    this.scene.add(g);
    this.active.push({
      group: g,
      meshes: [outer, inner, cap, ring],
      materials: [outerMat, innerMat, capMat, ringMat],
      life: 0,
      maxLife: 1.6,
      spin: 0.8,
      popIn: 1,
      baseScale: scale,
    });
  }

  /**
   * spark（翠翼连闪）：三道光柱（每道一柱）——绿色细长柱从角色向上射出
   */
  private spawnSparkShell(x: number, y: number, z: number, color: string, accent: string, scale = 1): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    // 三柱间距 0.18（紧贴身体），柱高 ≈ 角色身高 1.2 倍
    const offsets = [-0.18, 0, 0.18];
    const mats: THREE.MeshBasicMaterial[] = [];
    const meshes: THREE.Mesh[] = [];
    for (const ox of offsets) {
      const mat = new THREE.MeshBasicMaterial({
        color: ox === 0 ? accent : color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 12), mat);
      pillar.position.set(ox, 0.85, 0);
      g.add(pillar);
      mats.push(mat);
      meshes.push(pillar);
    }
    // 底部光球
    const orbMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), orbMat);
    orb.position.y = 0.22;
    g.add(orb);
    mats.push(orbMat);
    meshes.push(orb);

    this.scene.add(g);
    this.active.push({
      group: g,
      meshes,
      materials: mats,
      life: 0,
      maxLife: 1.2,
      spin: 0,
      popIn: 1,
      baseScale: scale,
    });
  }

  /**
   * pierce（绯尾贯穿）：一条沿 Z 方向延伸的细长六棱柱（贯穿残影），粉红
   */
  private spawnPierceShell(x: number, y: number, z: number, color: string, accent: string, scale = 1): void {
    const g = new THREE.Group();
    g.position.set(x, y + 0.5, z);
    // 长条"贯穿柱"——总长约角色身高 3 倍，向前延伸
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.03, 2.6, 12), mat);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 1.0;
    g.add(shaft);
    // 顶端尖锥
    const tipMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 12), tipMat);
    tip.rotation.x = Math.PI / 2;
    tip.position.z = 2.5;
    g.add(tip);
    // 尾部光点（贴近身体）
    const tailMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), tailMat);
    tail.position.z = 0;
    g.add(tail);

    this.scene.add(g);
    this.active.push({
      group: g,
      meshes: [shaft, tip, tail],
      materials: [mat, tipMat, tailMat],
      life: 0,
      maxLife: 0.8,
      spin: 0,
      popIn: 1,
      baseScale: scale,
    });
  }

  /**
   * rain（锻渣雨幕）：上空巨型熔渣锥 + 落地冲击环
   */
  private spawnRainShell(x: number, y: number, z: number, color: string, accent: string, scale = 1): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    // 上空倒置熔渣锥：底径 ≈ 角色身高 1×，总高 ≈ 角色身高 1.5×
    const coneMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.4, 16), coneMat);
    cone.position.y = 2.1;
    cone.rotation.x = Math.PI;
    g.add(cone);
    // 锥体底圈（环）
    const topRingMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const topRing = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.04, 8, 24), topRingMat);
    topRing.rotation.x = Math.PI / 2;
    topRing.position.y = 2.7;
    g.add(topRing);
    // 地面冲击环（粗环）
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 8, 32), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);

    this.scene.add(g);
    this.active.push({
      group: g,
      meshes: [cone, topRing, ring],
      materials: [coneMat, topRingMat, ringMat],
      life: 0,
      maxLife: 1.4,
      spin: 1.2,
      popIn: 1,
      baseScale: scale,
    });
  }

  /**
   * shield（冰华护壳）：球形冰晶护盾——双层球壳（外蓝内白）
   */
  private spawnShieldShell(x: number, y: number, z: number, color: string, accent: string, scale = 1): void {
    const g = new THREE.Group();
    g.position.set(x, y + 0.55, z);
    // 双层球壳：外球半径 ≈ 角色身高 0.7×
    const outerMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      wireframe: true,
    });
    const outer = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), outerMat);
    g.add(outer);
    // 内层白球壳（实心但半透）
    const innerMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.65, 24, 16), innerMat);
    g.add(inner);
    // 赤道环（水平旋转的扁平环，强化"盾"的几何感）
    const ringMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.025, 8, 48), ringMat);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);

    this.scene.add(g);
    this.active.push({
      group: g,
      meshes: [outer, inner, ring],
      materials: [outerMat, innerMat, ringMat],
      life: 0,
      maxLife: 1.8,
      spin: 0.6,
      popIn: 1,
      baseScale: scale,
    });
  }

  /**
   * judgment（光轮裁决）：金黄天罚——从天而降的粗壮光柱 + 顶端"神罚十字"
   */
  private spawnJudgmentShell(
    x: number,
    y: number,
    z: number,
    color: string,
    accent: string,
    target?: { x: number; y: number; z: number },
    scale = 1,
  ): void {
    const p = target ?? { x, y, z };
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    // 主光柱：半径 ≈ 角色身高 0.4×、柱高 ≈ 角色身高 3.5×
    const pillarMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 3.5, 20), pillarMat);
    pillar.position.y = 1.75;
    g.add(pillar);
    // 顶端十字架（两条交叉的细圆柱）
    const crossMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const crossH = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 12), crossMat);
    crossH.rotation.z = Math.PI / 2;
    crossH.position.y = 3.7;
    g.add(crossH);
    const crossV = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.3, 12), crossMat);
    crossV.position.y = 3.7;
    g.add(crossV);
    // 底圈（金色冲击圈）
    const ringMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 32), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    g.add(ring);
    // 顶端金色光球
    const orbMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), orbMat);
    orb.position.y = 3.7;
    g.add(orb);

    this.scene.add(g);
    this.active.push({
      group: g,
      meshes: [pillar, crossH, crossV, ring, orb],
      materials: [pillarMat, crossMat, ringMat, orbMat],
      life: 0,
      maxLife: 1.4,
      spin: 0,
      popIn: 1,
      baseScale: scale,
      maxOpacity: 0.7,
    });
  }

  /**
   * pulse（兔械同调）：暖橙脉冲——双层环形扩张体（外环 + 内环，同心旋转）
   */
  private spawnPulseShell(x: number, y: number, z: number, color: string, accent: string, scale = 1): void {
    const g = new THREE.Group();
    g.position.set(x, y + 0.4, z);
    // 外环：半径 ≈ 角色身高 0.6×
    const outerMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const outer = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 8, 48), outerMat);
    g.add(outer);
    // 内环（细，反向色）
    const innerMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 8, 32), innerMat);
    inner.rotation.x = Math.PI / 2;
    g.add(inner);
    // 中心光球
    const orbMat = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), orbMat);
    g.add(orb);

    this.scene.add(g);
    this.active.push({
      group: g,
      meshes: [outer, inner, orb],
      materials: [outerMat, innerMat, orbMat],
      life: 0,
      maxLife: 1.4,
      spin: 1.6,
      popIn: 1,
      baseScale: scale,
    });
  }

  /** 巨型风刃横扫（ashcrow 破风突贯）：宽 7 米斜劈刃体，沿 -z 劈砍整道 */
  spawnBladeSweep(x: number, y: number, z: number, color: string, accent: string, scale = 1): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const bladeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const blade = new THREE.Mesh(new THREE.BoxGeometry(8, 0.8, 0.3), bladeMat);
    blade.rotation.z = 0.5;
    blade.rotation.y = 0.15;
    g.add(blade);
    const edgeMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const edge = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.22, 0.34), edgeMat);
    edge.rotation.z = 0.5;
    edge.position.y = -0.7;
    g.add(edge);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 0.28), bladeMat);
    cross.rotation.z = -0.45;
    g.add(cross);
    this.scene.add(g);
    this.active.push({
      group: g, meshes: [blade, edge, cross], materials: [bladeMat, edgeMat],
      life: 0, maxLife: 3.0, spin: 0, popIn: 1, baseScale: scale,
      maxOpacity: 0.6, vel: { x: 0, y: 0, z: -34 },
    });
  }

  /** 连斩牵引线（neoncoil/frostline）：施法者枪口直连目标的粗光束，目标绝不模糊 */
  spawnSlashLine(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: string, width = 0.35, lifeSec = 0.3): void {
    const from = new THREE.Vector3(x1, y1, z1);
    const to = new THREE.Vector3(x2, y2, z2);
    const len = Math.max(0.5, from.distanceTo(to));
    const g = new THREE.Group();
    g.position.copy(from);
    g.lookAt(to);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(width, width, len), mat);
    beam.position.z = len / 2;
    g.add(beam);
    this.scene.add(g);
    this.active.push({
      group: g, meshes: [beam], materials: [mat],
      life: 0, maxLife: lifeSec, spin: 0, popIn: 1, baseScale: 1, maxOpacity: 0.85,
    });
  }

  /** 熔城炮弹（prismrift）：巨型火球按速飞行，0.6秒后正好砸中，飞行=蓄力 */
  spawnCannonShell(x: number, y: number, z: number, color: string, accent: string, speed: number, scale = 1.4): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const coreMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), coreMat);
    g.add(core);
    const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.7, 16, 12), glowMat);
    g.add(glow);
    this.scene.add(g);
    this.active.push({
      group: g, meshes: [core, glow], materials: [coreMat, glowMat],
      life: 0, maxLife: 0.62, spin: 0, popIn: 1, baseScale: scale,
      maxOpacity: 0.9, vel: { x: 0, y: 0, z: -speed },
    });
  }

  /** 熔渣尖刺（ironrain 被动雨幕）：从高空砸向单个目标的梭形熔渣 */
  spawnRainSpike(x: number, topY: number, z: number, color: string, accent: string, speed: number, life: number): void {
    const g = new THREE.Group();
    g.position.set(x, topY, z);
    const spikeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.55, 3.2, 6), spikeMat);
    spike.rotation.x = Math.PI;
    g.add(spike);
    const glowMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 10), glowMat);
    g.add(glow);
    this.scene.add(g);
    this.active.push({
      group: g, meshes: [spike, glow], materials: [spikeMat, glowMat],
      life: 0, maxLife: life, spin: 0, popIn: 1, baseScale: 1,
      maxOpacity: 0.85, vel: { x: 0, y: -speed, z: 0 },
    });
  }

  /** 织网金穹（mirror 弹道织网）：玩家上空三层大金环穹顶，最大半径 4.4 米 */
  spawnWeaveDome(x: number, y: number, z: number, color: string, accent: string, scale = 1): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const mats: THREE.MeshBasicMaterial[] = [];
    const meshes: THREE.Mesh[] = [];
    const radii = [2.2, 3.3, 4.4];
    radii.forEach((r, i) => {
      const m = new THREE.MeshBasicMaterial({ color: i % 2 ? accent : color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.09, 8, 64), m);
      ring.rotation.x = Math.PI / 2 - 0.25 * i;
      ring.position.y = 0.4 * i;
      g.add(ring);
      mats.push(m);
      meshes.push(ring);
    });
    const orbMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), orbMat);
    orb.position.y = 2.6;
    g.add(orb);
    mats.push(orbMat);
    meshes.push(orb);
    this.scene.add(g);
    this.active.push({
      group: g, meshes, materials: mats,
      life: 0, maxLife: 1.4, spin: 1.2, popIn: 1, baseScale: scale, maxOpacity: 0.75,
    });
  }

  /** 庇护穹顶（heartforge 楯影庇护）：跟随单角色的半球护罩 */
  spawnAegisDome(
    follow: () => { x: number; y: number; z: number } | null | false,
    color: string,
    accent: string,
    scale = 1,
    life = 6,
  ): void {
    const g = new THREE.Group();
    const domeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.7, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.position.y = 0.1;
    g.add(dome);
    const ringMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.07, 8, 48), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    g.add(ring);
    this.scene.add(g);
    this.active.push({
      group: g, meshes: [dome, ring], materials: [domeMat, ringMat],
      life: 0, maxLife: life, spin: 0.6, popIn: 1, baseScale: scale,
      maxOpacity: 0.5, follow,
    });
  }

  /** 冰刺环（skyshard 极寒静域）：8 根冰锥围圈 + 地面冰环 */
  spawnShardRing(x: number, groundY: number, z: number, color: string, accent: string, scale = 1): void {
    const g = new THREE.Group();
    g.position.set(x, groundY, z);
    const mats: THREE.MeshBasicMaterial[] = [];
    const meshes: THREE.Mesh[] = [];
    const spikeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.6, 6), spikeMat);
      spike.position.set(Math.cos(ang) * 3.5, 1.3, Math.sin(ang) * 3.5);
      spike.rotation.z = -Math.cos(ang) * 0.25;
      spike.rotation.x = Math.sin(ang) * 0.25;
      g.add(spike);
      meshes.push(spike);
    }
    mats.push(spikeMat);
    const ringMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.5, 0.08, 8, 64), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    g.add(ring);
    mats.push(ringMat);
    meshes.push(ring);
    this.scene.add(g);
    this.active.push({
      group: g, meshes, materials: mats,
      life: 0, maxLife: 1.2, spin: 0.5, popIn: 1, baseScale: scale, maxOpacity: 0.7,
    });
  }
}

/** 弹出曲线：开始略小于 0（拉回），到 1 时回弹略超 1，再回 1 */
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
