import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { CombatQualityProfile } from './combatQuality';

export class CombatPostFX {
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly profile: CombatQualityProfile,
  ) {
    if (!profile.bloomEnabled) return;

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    const scale = profile.bloomHalfRes ? 0.5 : 1;
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w * scale, h * scale),
      profile.bloomStrength,
      profile.bloomRadius,
      profile.bloomThreshold,
    );
    this.composer.addPass(this.bloomPass);
  }

  setSize(width: number, height: number): void {
    if (!this.composer || !this.bloomPass) return;
    const scale = this.profile.bloomHalfRes ? 0.5 : 1;
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width * scale, height * scale);
  }

  render(): void {
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloomPass = null;
  }
}
